const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./support/http.cjs');
test('reassignment and appointment completion preserve booking and calendar invariants',async t=>{
 const {db,req,login}=harness(t),admin=await login('admin@ecc.example');
 const post=(p,body={},status=200)=>req(p,{method:'POST',token:admin,body,status});
 const patch=(p,body,status=200)=>req(p,{method:'PATCH',token:admin,body,status});
 const make=async name=>(await post('/leads',{full_name:name,email:name+'@appointment-lifecycle.example.test',country_of_interest:'Spain',application_type:'TOURIST',assigned_to:1},201)).id;
 const id=await make('booked-client'),other=await make('other-client');
 const start=new Date(Date.now()+7*86400000).toISOString(),end=new Date(Date.parse(start)+3600000).toISOString(),due=start.slice(0,10);
 const slot=(await post('/booking/slots',{staff_id:1,starts_at:start,ends_at:end},201)).id;
 const booked=await post('/workflow/'+id+'/bookings',{slot_id:slot},201);
 const conflict=(await post('/tasks',{lead_id:other,title:'Consultant 2 appointment',assignee_id:2,due_date:due,scheduled_at:start,category:'APPOINTMENT'},201)).id;
 const ordinary=(await post('/tasks',{lead_id:id,title:'Transferable follow up',assignee_id:1,due_date:due,category:'FOLLOW_UP'},201)).id;
 await t.test('lead reassignment transfers other work while preserving the booked consultant',async()=>{
  const response=await post('/workflow/'+id+'/assignment',{assigned_to:2,transfer_tasks:true});
  assert.equal(response.transferred,1);assert.equal(response.bookings_preserved,1);
  assert.equal(db.prepare('SELECT assigned_to FROM leads WHERE id=?').get(id).assigned_to,2);
  assert.equal(db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(ordinary).assignee_id,2);
  const row=db.prepare('SELECT t.assignee_id,bs.staff_id FROM bookings b JOIN tasks t ON t.id=b.task_id JOIN booking_slots bs ON bs.id=b.slot_id WHERE b.id=?').get(booked.id);
  assert.deepEqual(row,{assignee_id:1,staff_id:1});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE assignee_id=2 AND category='APPOINTMENT' AND status<>'DONE' AND scheduled_at=?").get(start).n,1);
 });
 await t.test('a conflicting non-booked appointment rejects the entire reassignment',async()=>{
  const source=await make('non-booked-source');
  const follow=(await post('/tasks',{lead_id:source,title:'Follow up before conflict',assignee_id:1,due_date:due,category:'TASK'},201)).id;
  const later=new Date(Date.parse(end)+3600000).toISOString();
  const moving=(await post('/tasks',{lead_id:source,title:'To transfer',assignee_id:1,due_date:due,scheduled_at:later,category:'INTERVIEW'},201)).id;
  await post('/tasks',{lead_id:other,title:'Target already busy',assignee_id:2,due_date:due,scheduled_at:later,category:'INTERVIEW'},201);
  const count=db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n;
  const result=await post('/workflow/'+source+'/assignment',{assigned_to:2,transfer_tasks:true},400);
  assert.equal(result.error,'TASK_TRANSFER_APPOINTMENT_CONFLICT');
  assert.equal(db.prepare('SELECT assigned_to FROM leads WHERE id=?').get(source).assigned_to,1);
  for(const task of [follow,moving])assert.equal(db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(task).assignee_id,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,count);
 });
 await t.test('completion, undo and cancellation remain consistent in the client portal',async()=>{
  const magic=crypto.randomBytes(32).toString('hex');db.prepare("UPDATE leads SET status='CLIENT',portal_hash=? WHERE id=?").run(crypto.createHash('sha256').update(magic).digest('hex'),id);
  const bookings=()=>req('/portal/bookings',{portal:magic});
  await patch('/tasks/'+booked.task_id,{status:'DONE'});
  assert.equal((await bookings())[0].status,'COMPLETED');
  assert.equal((await req('/booking/slots',{token:admin})).some(s=>s.id===slot),false);
  await post('/workflow/'+other+'/bookings',{slot_id:slot},400);
  await post('/workflow/'+id+'/bookings/cancel',{booking_id:booked.id},400);
  await patch('/tasks/'+booked.task_id,{assignee_id:2},409);
  await patch('/tasks/'+booked.task_id,{status:'PENDING'});
  assert.equal((await bookings())[0].status,'BOOKED');
  await post('/workflow/'+id+'/bookings/cancel',{booking_id:booked.id});
  assert.equal((await bookings())[0].status,'CANCELLED');
  assert.equal(db.prepare('SELECT status FROM tasks WHERE id=?').get(booked.task_id).status,'DONE');
  const response=await patch('/tasks/'+booked.task_id,{status:'PENDING'},409);assert.equal(response.error,'CANCELLED_APPOINTMENT_USE_REBOOK');
  assert.equal((await req('/booking/slots',{token:admin})).some(s=>s.id===slot),true);
  await post('/workflow/'+id+'/bookings',{slot_id:slot},201);
 });
 await t.test('reopening a completed appointment still checks the consultant calendar',async()=>{
  // The previous appointment was rebooked for consultant 1.
  const active=db.prepare("SELECT * FROM bookings WHERE slot_id=? AND status='BOOKED'").get(slot);
  await patch('/tasks/'+active.task_id,{status:'DONE'});
  const overlapping=(await post('/tasks',{lead_id:other,title:'Work during completed time',assignee_id:1,due_date:due,scheduled_at:start,category:'APPOINTMENT'},201)).id;
  await patch('/tasks/'+active.task_id,{status:'PENDING'},409);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(active.id).status,'COMPLETED');
  await patch('/tasks/'+overlapping,{status:'DONE'});
  await patch('/tasks/'+active.task_id,{status:'IN_PROGRESS'});
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(active.id).status,'BOOKED');
 });
});

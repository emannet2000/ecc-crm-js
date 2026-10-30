const {test}=require('node:test'),assert=require('node:assert/strict');
const harness=require('./support/http.cjs');

test('staff assignments reject client accounts and keep internal notifications private',async t=>{
 const {db,req,login,operations}=harness(t),admin=await login('admin@ecc.example');
 const post=(p,body={},status=200)=>req(p,{method:'POST',body,token:admin,status});
 const patch=(p,body,status=200)=>req(p,{method:'PATCH',body,token:admin,status});
 const create=(full_name,email)=>post('/leads',{full_name,email,country_of_interest:'Spain',application_type:'TOURIST',assigned_to:1},201);
 const owner=await create('Client owner','client-owner@example.test'),other=await create('Private applicant','private-applicant@example.test');
 db.prepare("UPDATE leads SET status='PROPOSAL' WHERE id=?").run(owner.id);
 const client=await post('/workflow/'+owner.id+'/client-account',{},201);
 const task=(await post('/tasks',{lead_id:other.id,title:'Internal fixture',assignee_id:1,due_date:'2026-01-01',category:'TASK'},201)).id;
 const counts=()=>({tasks:db.prepare('SELECT COUNT(*) n FROM tasks').get().n,emails:db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n});
 const before=counts();
 await t.test('client lead assignment cannot transfer records or queue internal emails',async()=>{
  await post('/workflow/'+other.id+'/assignment',{assigned_to:client.id,transfer_tasks:true},400);
  assert.equal(db.prepare('SELECT assigned_to FROM leads WHERE id=?').get(other.id).assigned_to,1);
  assert.equal(db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(task).assignee_id,1);
  assert.deepEqual(counts(),before);
 });
 await t.test('all task creation and reassignment routes reject clients without side effects',async()=>{
  await post('/tasks',{lead_id:other.id,title:'INTERNAL client leak',assignee_id:client.id,due_date:'2026-01-01',category:'TASK'},400);
  await post('/leads/'+other.id+'/tasks',{title:'INTERNAL legacy leak',assignee_id:client.id,due_date:'2026-01-01'},400);
  await patch('/tasks/'+task,{assignee_id:client.id,title:'INTERNAL reassignment leak'},400);
  assert.equal(db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(task).assignee_id,1);
  assert.deepEqual(counts(),before);
 });
 await t.test('active staff assignments continue to work and inactive staff are rejected',async()=>{
  await post('/workflow/'+other.id+'/assignment',{assigned_to:2,transfer_tasks:true});
  assert.equal(db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(task).assignee_id,2);
  await patch('/tasks/'+task,{assignee_id:1});
  await post('/leads/'+other.id+'/tasks',{title:'Staff legacy task',assignee_id:1,due_date:'2026-01-01'},201);
  db.prepare('UPDATE users SET is_active=0 WHERE id=2').run();
  await post('/workflow/'+other.id+'/assignment',{assigned_to:2},400);
  await post('/tasks',{lead_id:other.id,title:'Inactive task',assignee_id:2,due_date:'2026-01-01',category:'TASK'},400);
 });
 await t.test('historical invalid client assignments cannot receive staff notifications or reminders',async()=>{
  // Simulate records saved before the role checks existed.
  db.prepare('UPDATE leads SET assigned_to=? WHERE id=?').run(client.id,other.id);
  db.prepare('UPDATE tasks SET assignee_id=? WHERE id=?').run(client.id,task);
  const beforeClient=db.prepare('SELECT COUNT(*) n FROM email_outbox WHERE recipient=?').get('client-owner@example.test').n;
  operations.staffNotify(other.id,'Internal staff notice','Private applicant data');
  await patch('/tasks/'+task,{title:'Internal historical task'});
  operations.reminders();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox WHERE recipient=?').get('client-owner@example.test').n,beforeClient);
 });
});

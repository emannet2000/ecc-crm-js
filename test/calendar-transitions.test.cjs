const {test}=require('node:test'),assert=require('node:assert/strict');
const harness=require('./support/http.cjs');

test('case-event categories and repeated calendar states stay synchronized',async t=>{
 const {db,req,login}=harness(t),{integrations}=require('../dist/server');
 const admin=await login('admin@ecc.example'),staff=await login('cristina@ecc.example');
 const post=(p,body={},token=admin,status=200)=>req(p,{method:'POST',body,token,status});
 const patch=(p,body,status=200)=>req(p,{method:'PATCH',body,token:admin,status});
 const lead=(await post('/leads',{full_name:'Calendar transitions',email:'calendar-transitions@example.test',country_of_interest:'Spain',application_type:'TOURIST',assigned_to:1},admin,201)).id;
 db.prepare("UPDATE leads SET status='CLIENT' WHERE id=?").run(lead);
 const start=new Date(Date.now()+10*86400000).toISOString(),due=start.slice(0,10);
 await t.test('changing a note to an appointment reserves the time, and changing back releases it',async()=>{
  const path='/workflow/'+lead+'/case-events';
  await post(path,{type:'NOTE',title:'Case note',due_date:due,details:'Fixture',client_visible:false});
  const event=db.prepare('SELECT id FROM case_events WHERE lead_id=?').get(lead);
  const edit={type:'APPOINTMENT',title:'Converted appointment',due_date:due,occurs_at:start,details:'Fixture',client_visible:false};
  await patch(path+'/'+event.id,edit);
  assert.equal(db.prepare('SELECT category FROM tasks WHERE case_event_id=?').get(event.id).category,'APPOINTMENT');
  const conflict=await post('/tasks',{lead_id:lead,title:'Conflicting appointment',assignee_id:1,due_date:due,scheduled_at:start,category:'APPOINTMENT'},admin,409);
  assert.equal(conflict.error,'APPOINTMENT_CONFLICT');
  await patch(path+'/'+event.id,{...edit,type:'NOTE'});
  assert.equal(db.prepare('SELECT category FROM tasks WHERE case_event_id=?').get(event.id).category,'TASK');
  await post('/tasks',{lead_id:lead,title:'Available appointment',assignee_id:1,due_date:due,scheduled_at:start,category:'APPOINTMENT'},admin,201);
 });
 await t.test('A to B to A sends three updates without duplicating unresolved deliveries',async()=>{
  const keys=['ECC_INTEGRATION_GATEWAY_URL','ECC_INTEGRATION_GATEWAY_TOKEN','ECC_INTEGRATION_WEBHOOK_SECRET'],previous=keys.map(k=>process.env[k]),originalFetch=global.fetch;
  t.after(()=>{global.fetch=originalFetch;keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]})});
  process.env.ECC_INTEGRATION_GATEWAY_URL='https://gateway.example.test/jobs';process.env.ECC_INTEGRATION_GATEWAY_TOKEN='mock';process.env.ECC_INTEGRATION_WEBHOOK_SECRET='mock-secret-with-at-least-32-bytes';
  await post('/admin/integrations/settings',{kind:'CALENDAR',provider:'Calendar mock',enabled:true});
  const task=db.prepare("SELECT id FROM tasks WHERE lead_id=? AND category='APPOINTMENT'").get(lead),delivered=[];
  global.fetch=async(url,options)=>{const job=JSON.parse(options.body);delivered.push(job);return {ok:true,json:async()=>({id:job.id,state:'SUCCEEDED',provider_reference:'remote-event-1',version:'v'+delivered.length})}};
  const sync=()=>post('/integrations/calendar/sync',{},staff);
  for(const title of ['A','B','A']){
   await patch('/tasks/'+task.id,{title});
   assert.equal((await sync()).queued,1);
   assert.equal((await sync()).queued,0);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM integration_jobs WHERE state='QUEUED'").get().n,1);
   assert.equal((await integrations.process()).processed,1);
   assert.equal((await sync()).queued,0);
  }
  assert.deepEqual(delivered.map(j=>j.payload.title),['A','B','A']);
  assert.equal(new Set(delivered.map(j=>j.id)).size,3);
  const link=db.prepare('SELECT local_hash FROM integration_calendar_links WHERE task_id=?').get(task.id);
  assert.equal(link.local_hash,integrations.taskHash(db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)));
 });
});

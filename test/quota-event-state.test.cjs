const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./support/http.cjs');

test('concurrent uploads reserve quota and completed case events create completed tasks',async t=>{
 const {db,req,raw,login}=harness(t),admin=await login('admin@ecc.example'),staff=await login('cristina@ecc.example');
 const post=(p,body,token=admin,status=200)=>req(p,{method:'POST',body,token,status});
 const lead=(await post('/leads',{full_name:'Concurrency fixture',email:'concurrent@example.test',country_of_interest:'Spain',application_type:'TOURIST',assigned_to:1},admin,201)).id;
 const data=Buffer.from('%PDF-1.4\nConcurrent fixture'),file={kind:'APPLICATION',name:'sample.pdf',mime:'application/pdf',data:data.toString('base64')},url='/workflow/'+lead+'/documents';
 const tools=require('../dist/document-tools'),originalScan=tools.scan;t.after(()=>{tools.scan=originalScan});
 // Hold the first request inside scanning so the second must observe its reservation.
 async function overlap(first,second,{fail=false}={}){
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
  tools.scan=async()=>{entered();await gate;if(fail)throw Error('DOCUMENT_SCANNER_UNAVAILABLE');return {status:'CLEAN',sha256:crypto.createHash('sha256').update(data).digest('hex')}};
  const pending=first();await started;
  let blocked;try{blocked=await second()}finally{release()}
  const finished=await pending;tools.scan=originalScan;return {blocked,finished};
 }
 const upload=(p=url,options={})=>raw(p,{method:'POST',token:staff,body:file,...options});
 await t.test('monthly upload limit includes requests waiting for scanning',async()=>{
  db.prepare('UPDATE users SET usage_limits=? WHERE id=1').run(JSON.stringify({uploads_per_month:1}));
  const {finished,blocked}=await overlap(()=>upload(),()=>upload());
  assert.equal(finished.status,201);assert.equal(blocked.status,429);assert.equal(JSON.parse(blocked.text).metric,'uploads_per_month');
  assert.equal((await req('/usage/me',{token:staff})).used.uploads_per_month,1);
 });
 await t.test('storage limit includes in-flight bytes and failed requests release reservations',async()=>{
  const current=(await req('/usage/me',{token:staff})).storage_bytes;
  db.prepare('UPDATE users SET usage_limits=? WHERE id=1').run(JSON.stringify({storage_mb:(current+data.length)/1048576}));
  const {finished,blocked}=await overlap(()=>upload(),()=>upload(),{fail:true});
  assert.equal(finished.status,400);assert.equal(blocked.status,429);assert.equal(JSON.parse(blocked.text).error,'STORAGE_LIMIT_REACHED');
  assert.equal((await req('/usage/me',{token:staff})).used.uploads_per_month,1);
  assert.equal((await upload()).status,201);
  assert.equal((await req('/usage/me',{token:staff})).storage_bytes,current+data.length);
 });
 await t.test('private links and password sessions share the client reservation',async()=>{
  db.prepare("UPDATE leads SET status='PROPOSAL' WHERE id=?").run(lead);
  const activation=await post('/workflow/'+lead+'/client-account',{},admin,201),password='ConcurrentClientPassword123!';
  await post('/auth/reset-password',{token:activation.activation_path.split('/').pop(),password},null);
  const client=await login('concurrent@example.test',password);
  db.prepare('UPDATE users SET usage_limits=? WHERE id=?').run(JSON.stringify({uploads_per_month:1}),activation.id);
  const magic=crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE leads SET portal_hash=? WHERE id=?').run(crypto.createHash('sha256').update(magic).digest('hex'),lead);
  const {finished,blocked}=await overlap(()=>upload('/portal/documents',{token:client}),()=>upload('/portal/documents',{token:null,portal:magic}));
  assert.equal(finished.status,201);assert.equal(blocked.status,429);
  assert.equal((await req('/usage/me',{token:client})).used.uploads_per_month,1);
 });
 await t.test('new completed dated events stay complete in tasks and reminders',async()=>{
  db.prepare("UPDATE leads SET status='CLIENT' WHERE id=?").run(lead);
  for(const status of ['DONE','OPEN'])await post('/workflow/'+lead+'/case-events',{type:'DEADLINE',title:'Milestone '+status,due_date:'2026-01-01',status,details:'Entered milestone',client_visible:false});
  const rows=db.prepare('SELECT e.status event_status,t.status task_status,t.id task_id FROM case_events e JOIN tasks t ON t.case_event_id=e.id WHERE e.lead_id=? ORDER BY e.id').all(lead);
  assert.deepEqual(rows.map(r=>[r.event_status,r.task_status]),[['DONE','DONE'],['OPEN','PENDING']]);
  const overdue=await req('/tasks?overdue=1',{token:admin});
  assert.equal(overdue.some(r=>r.id===rows[0].task_id),false);
  assert.equal(overdue.some(r=>r.id===rows[1].task_id),true);
 });
});

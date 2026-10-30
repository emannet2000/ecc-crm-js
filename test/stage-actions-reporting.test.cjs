const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./support/http.cjs');
test('stage changes respect decisions and current client counts stay separate from conversions',async t=>{
 const {db,req,login}=harness(t),admin=await login('admin@ecc.example'),staff=await login('cristina@ecc.example');
 const post=(p,body,token=admin,status=200)=>req(p,{method:'POST',token,body,status});
 const create=async(name,assigned)=>{const l=await post('/leads',{full_name:name,email:name+'@stage-counts.example.test',country_of_interest:'Spain',application_type:'TOURIST',assigned_to:assigned},admin,201);db.prepare("UPDATE leads SET status='CLIENT' WHERE id=?").run(l.id);return l.id};
 const own=await create('own',1),other=await create('other',2);
 const token=crypto.randomBytes(32).toString('hex');db.prepare('UPDATE leads SET portal_hash=? WHERE id=?').run(crypto.createHash('sha256').update(token).digest('hex'),own);
 const saveCase=(decision)=>req('/workflow/'+own+'/case',{method:'PATCH',token:admin,body:{submission_reference:'CASE-1',authority:'Fixture',submitted_on:'2026-01-01',decision,decision_on:decision==='PENDING'?null:'2026-02-01',notes:'Fixture'}});
 const setStage=(stage,status=200)=>req('/workflow/'+own+'/application-status',{method:'PATCH',token:admin,body:{stage},status});
 const state=()=>db.prepare('SELECT l.application_stage,c.decision FROM leads l LEFT JOIN case_records c ON c.lead_id=l.id WHERE l.id=?').get(own);
 await t.test('outcomes cannot be created or contradicted through the progress selector',async()=>{
  for(const stage of ['APPROVED','REFUSED'])await setStage(stage,400);
  for(const stage of ['PREPARATION','SUBMITTED','UNDER_REVIEW'])await setStage(stage);
  for(const [decision,wrong]of [['REFUSED','APPROVED'],['APPROVED','REFUSED'],['WITHDRAWN','APPROVED']]){
   await saveCase(decision);
   const before=state(),emails=db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,audits=db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
   const error=await setStage(wrong,400);assert.equal(error.error,'UPDATE_CASE_DECISION_BEFORE_CHANGING_OUTCOME');
   await setStage('UNDER_REVIEW',400);
   assert.deepEqual(state(),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM email_outbox').get().n,emails);assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n,audits);
   await setStage('CLOSED');await saveCase(decision);assert.equal(state().application_stage,'CLOSED');
   assert.equal((await req('/portal',{portal:token})).case_record.decision,decision);
  }
  await saveCase('PENDING');await setStage('UNDER_REVIEW');
  await setStage('CLOSED');await saveCase('PENDING');assert.equal(state().application_stage,'CLOSED');
  await setStage('PREPARATION');assert.deepEqual(state(),{application_stage:'PREPARATION',decision:'PENDING'});
 });
 await t.test('active counts follow the Clients list across scope, archive and reopen',async()=>{
  let team=await req('/dashboard',{token:admin}),scoped=await req('/dashboard',{token:staff});
  assert.equal(team.active_clients,2);assert.equal(scoped.active_clients,1);assert.equal(scoped.conversion.clients,1);
  await post('/workflow/'+own+'/pipeline',{status:'ARCHIVED',reason:'Archive fixture'});
  team=await req('/dashboard',{token:admin});scoped=await req('/dashboard',{token:staff});
  assert.equal(team.active_clients,1);assert.equal(team.conversion.clients,2);assert.equal(scoped.active_clients,0);assert.equal(scoped.conversion.clients,1);
  assert.equal((await req('/leads?status=CLIENT',{token:staff})).total,0);
  await post('/workflow/'+own+'/pipeline',{status:'REOPEN'});
  assert.equal((await req('/dashboard',{token:staff})).active_clients,1);
  await post('/workflow/'+own+'/pipeline',{status:'ARCHIVED',reason:'Archive fixture again'});await post('/workflow/'+other+'/pipeline',{status:'ARCHIVED',reason:'Archive other fixture'});
  team=await req('/dashboard',{token:admin});assert.equal(team.active_clients,0);assert.equal(team.conversion.clients,2);
 });
});

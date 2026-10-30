const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./support/http.cjs');
test('case decision corrections keep staff and client application stages consistent',async t=>{
 const {req,db,login}=harness(t),admin=await login('admin@ecc.example');
 const lead=await req('/leads',{method:'POST',token:admin,status:201,body:{full_name:'Decision correction',email:'decision-correction@example.test',country_of_interest:'Spain',application_type:'TOURIST',assigned_to:1}});
 const token=crypto.randomBytes(32).toString('hex');db.prepare("UPDATE leads SET status='CLIENT',portal_hash=? WHERE id=?").run(crypto.createHash('sha256').update(token).digest('hex'),lead.id);
 const base={submission_reference:'CASE-1',authority:'Fixture authority',submitted_on:'2026-01-01',notes:'Reviewed case'};
 async function save(decision,expected,extra={}){
  await req('/workflow/'+lead.id+'/case',{method:'PATCH',token:admin,body:{...base,decision,decision_on:decision==='PENDING'?null:'2026-02-01',...extra}});
  const staff=await req('/workflow/'+lead.id,{token:admin}),client=await req('/portal',{portal:token});
  assert.equal(staff.case_record.decision,decision);assert.equal(staff.application_stage,expected);
  assert.equal(client.case_record.decision,decision);assert.equal(client.application_stage,expected);
  assert.equal(client.case_record.notes,undefined);
 }
 await save('APPROVED','APPROVED');await save('PENDING','UNDER_REVIEW');
 await save('REFUSED','REFUSED');await save('PENDING','UNDER_REVIEW');
 await save('WITHDRAWN','CLOSED');await save('PENDING','UNDER_REVIEW');
 await save('APPROVED','APPROVED');await save('PENDING','PREPARATION',{submitted_on:null});
 for(const stage of ['ONBOARDING','DOCUMENT_COLLECTION','PREPARATION','SUBMITTED','UNDER_REVIEW']){
  db.prepare('UPDATE leads SET application_stage=? WHERE id=?').run(stage,lead.id);
  await save('PENDING',stage);
 }
 const audit=db.prepare("SELECT new_values FROM audit_log WHERE entity_type='lead' AND entity_id=? AND action='CASE_UPDATED' ORDER BY id DESC LIMIT 1").get(lead.id);
 assert.equal(JSON.parse(audit.new_values).application_stage,'UNDER_REVIEW');
});

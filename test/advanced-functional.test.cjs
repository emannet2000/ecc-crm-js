const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const harness=require('./support/http.cjs');
test('advanced workflows, snapshots, reconciliation, qualifications and language selection',async t=>{
 const h=harness(t),{db,req,login}=h,{advanced}=require('../dist/server');process.env.BACKUP_DIR=path.join(path.dirname(db.name),'backups');t.after(()=>delete process.env.BACKUP_DIR);
 const admin=await login('admin@ecc.example'),agent=await login('cristina@ecc.example');
 const post=(p,b={},token=admin,status=200)=>req(p,{method:'POST',body:b,token,status});
 const create=async name=>(await post('/leads',{full_name:name,email:name+'@test.example',country_of_interest:'Spain',application_type:'WORK',assigned_to:1},admin,201)).id;
 const id=await create('advanced');
 await t.test('ordered tasks, escalating assignees and recurrence are idempotent',async()=>{
  await post('/admin/workflows',{name:'Sequence',stage:'INQUIRY',repeat_days:2,steps:[{title:'First',due_days:0,assignee_id:1,escalations:[{after_days:0,user_id:2}]},{title:'Second',due_days:1,assignee_id:1}]},agent,403);
  const def=(await post('/admin/workflows',{name:'Sequence',stage:'INQUIRY',repeat_days:2,steps:[{title:'First',due_days:0,assignee_id:1,escalations:[{after_days:0,user_id:2}]},{title:'Second',due_days:1,assignee_id:1}]},admin,201)).id;
  const now=Date.now();advanced.tick(now);advanced.tick(now);let runs=db.prepare('SELECT * FROM workflow_step_runs').all();assert.equal(runs.length,1);assert.equal(db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(runs[0].task_id).assignee_id,2);
  db.prepare("UPDATE tasks SET status='DONE' WHERE id=?").run(runs[0].task_id);advanced.tick(now);runs=db.prepare('SELECT * FROM workflow_step_runs').all();assert.equal(runs.length,2);db.prepare("UPDATE tasks SET status='DONE' WHERE id=?").run(runs[1].task_id);advanced.tick(now);assert.equal(db.prepare('SELECT state FROM workflow_executions').get().state,'COMPLETE');advanced.tick(now+3*86400000);assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_executions').get().n,2);await req('/admin/workflows/'+def,{method:'PATCH',token:admin,body:{enabled:false}});
 });
 await t.test('weighted amounts preserve currencies and scheduled report generation uses current scope',async()=>{
  const proposal=db.prepare("INSERT INTO proposals(lead_id,country,purpose,currency,items,terms,status) VALUES(?,'Spain','WORK','AED',?,'Terms','DRAFT')").run(id,JSON.stringify([{description:'ECC',amount_cents:10000,billable:true},{description:'Funds',amount_cents:90000,billable:false}])).lastInsertRowid;
  await post('/admin/forecast-probabilities',{probabilities:{INQUIRY:25}});const forecast=await req('/reports/weighted-forecast',{token:admin});assert.equal(forecast.totals[0].weighted_cents,2500);
  const report=(await post('/reports/saved',{name:'Assigned cases',definition:{group_by:'country'}},agent,201)).id;
  await post('/reports/schedules',{report_id:report,interval_days:7,first_on:new Date().toISOString().slice(0,10)},agent,201);advanced.tick();advanced.tick();assert.equal(db.prepare('SELECT COUNT(*) n FROM report_deliveries').get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM email_outbox WHERE subject='ECC report: Assigned cases'").get().n,1);
 });
 await t.test('commission ownership and rates survive reassignment and cumulative refund rounding',async()=>{
  await post('/admin/accounting/commission',{user_id:1,basis_points:1000});const charge=db.prepare("INSERT INTO charges(lead_id,description,amount_cents,currency) VALUES(?,'Service',1000,'AED')").run(id).lastInsertRowid;
  const payment=db.prepare("INSERT INTO payments(charge_id,amount_cents,reference,paid_at) VALUES(?,1000,'ADV-RECEIPT','2026-10-29')").run(charge).lastInsertRowid;db.prepare('UPDATE leads SET assigned_to=2 WHERE id=?').run(id);
  db.prepare("INSERT INTO refunds(payment_id,amount_cents,reference,reason,refunded_on) VALUES(?,300,'ADV-REF-1','Return','2026-10-29')").run(payment);db.prepare("INSERT INTO refunds(payment_id,amount_cents,reference,reason,refunded_on) VALUES(?,200,'ADV-REF-2','Return','2026-10-29')").run(payment);
  let items=db.prepare('SELECT * FROM commission_items WHERE payment_id=? ORDER BY id').all(payment);assert.deepEqual(items.map(i=>i.amount_cents),[100,-30,-20]);assert.ok(items.every(i=>i.user_id===1));
  await post('/admin/commissions/'+items[0].id+'/approve',{},admin,400);await post('/admin/commissions/policy',{method:'ON_RECEIPT_NET_REFUNDS',approval_reason:'Approved test policy',confirm:true});await post('/admin/commissions/'+items[0].id+'/approve');await post('/admin/commissions/payout',{user_id:1,currency:'AED',reference:'ADV-PAYOUT',paid_on:'2026-10-29'},admin,400);
  for(const item of items.slice(1))await post('/admin/commissions/'+item.id+'/approve');const payout=await post('/admin/commissions/payout',{user_id:1,currency:'AED',reference:'ADV-PAYOUT',paid_on:'2026-10-29'},admin,201);assert.equal(payout.amount_cents,50);assert.deepEqual(await post('/admin/commissions/payout',{user_id:1,currency:'AED',reference:'ADV-PAYOUT',paid_on:'2026-10-29'},admin,201),payout);db.prepare('UPDATE leads SET assigned_to=1 WHERE id=?').run(id);
 });
 await t.test('qualification checks and document corrections require reviewed evidence',async()=>{
  await post('/workflow/'+id+'/qualifications',{skills:['Nursing','Care'],education_level:3,experience_years:4,languages:{IELTS:7}},agent);
  const partner=(await post('/placements/partners',{kind:'EMPLOYER',name:'Employer',country:'Spain'},admin,201)).id,opportunity=(await post('/placements/opportunities',{partner_id:partner,title:'Nurse',purpose:'WORK'},admin,201)).id;
  await post('/placements/opportunities/'+opportunity+'/criteria',{skills:['nursing'],education_level:3,experience_years:2,languages:{ielts:6},documents:['Passport']});const matches=await req('/workflow/'+id+'/qualification-matches',{token:agent});assert.equal(matches.matches[0].meets_requirements,true);
  const doc=db.prepare("INSERT INTO documents(lead_id,name,mime,data,kind,status) VALUES(?,'passport.pdf','application/pdf',?,'APPLICATION','ACCEPTED')").run(id,Buffer.from('%PDF-1.4')).lastInsertRowid;
  const fields={full_name:'Correct Name',date_of_birth:'1990-02-03',passport_number:'A1234567'};db.prepare("INSERT INTO document_extractions(document_id,text,fields,review_status) VALUES(?,'Extracted document',?,'ACCEPTED')").run(doc,JSON.stringify(fields));
  const review=await req('/workflow/'+id+'/documents/'+doc+'/field-review',{token:agent});assert.ok(review.validation.some(v=>v.key==='full_name'&&v.type==='MISMATCH'));
  await post('/workflow/'+id+'/documents/'+doc+'/apply-fields',{fingerprint:review.fingerprint,keys:['full_name','passport_number'],confirm:true},agent);assert.equal(db.prepare('SELECT full_name FROM leads WHERE id=?').get(id).full_name,'Correct Name');
  const application=(await post('/workflow/'+id+'/placements',{opportunity_id:opportunity},agent,201)).id;await post('/workflow/'+id+'/placements/'+application+'/documents',{document_id:doc,title:'Passport'},agent,201);await post('/workflow/'+id+'/placements/'+application+'/documents/review',{title:'Passport',status:'ACCEPTED',notes:'Checked'},agent);
 });
 await t.test('approved locale maps notifications without dropping transaction details',async()=>{
  await post('/admin/languages',{locale:'fil',name:'Filipino',direction:'ltr',dictionary:{Save:'I-save',Cancel:'Kanselahin'},approve:true},admin,201);assert.equal((await req('/public/locales/fil')).dictionary.Save,'I-save');
  await post('/admin/localized-templates',{locale:'fil',name:'Message alert',subject:'Mensahe {{reference}}',body:'Kumusta {{name}}\n{{body}}'},admin,201);const template=db.prepare("SELECT id FROM localized_templates WHERE locale='fil'").get().id;
  await post('/admin/notification-templates',{locale:'fil',subject_key:'ECC message for you',template_id:template});await post('/workflow/'+id+'/language',{locale:'fil'},agent);await post('/workflow/'+id+'/messages',{body:'Hello client'},agent,201);const mail=db.prepare('SELECT subject,body FROM email_outbox ORDER BY id DESC LIMIT 1').get();assert.match(mail.subject,/Mensahe/);assert.match(mail.body,/Your ECC team sent you a message/);
 });
 await t.test('progressed cases reconcile without changing signed proposal content or receipt identity',async()=>{
  const source=await create('duplicate-progressed'),doc=db.prepare("INSERT INTO documents(lead_id,name,mime,data,kind,status) VALUES(?,'source.pdf','application/pdf',?,'APPLICATION','ACCEPTED')").run(source,Buffer.from('%PDF-source')).lastInsertRowid;
  db.prepare("UPDATE leads SET status='ASSESSMENT',assessment_at='2026-10-29',assessment_notes='Original source assessment' WHERE id=?").run(source);db.prepare("UPDATE leads SET status='ASSESSMENT' WHERE id=?").run(id);
  const proposal=db.prepare('SELECT id FROM proposals WHERE lead_id=? ORDER BY id LIMIT 1').get(id).id;
  const p=await post('/admin/case-reconciliation/preview',{source_id:source,target_id:id});assert.deepEqual(p.blockers,[]);
  const result=await post('/admin/case-reconciliation/commit',{source_id:source,target_id:id,fingerprint:p.fingerprint,current_proposal_id:proposal,client_user_id:null,case_record_owner:'TARGET',reason:'Reviewed duplicate case',confirm_same_person:true,confirm_distinct_invoices:true},admin,201);
  assert.equal(result.target_id,id);assert.equal(db.prepare('SELECT lead_id FROM documents WHERE id=?').get(doc).lead_id,id);assert.equal(db.prepare('SELECT status FROM leads WHERE id=?').get(source).status,'ARCHIVED');assert.equal((await req('/workflow/'+id+'/reconciled-history',{token:agent}))[0].source_assessment.notes,'Original source assessment');await post('/workflow/'+source+'/messages',{body:'Cannot edit merged source'},admin,409);
 });
});

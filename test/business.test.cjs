const {test}=require('node:test');const assert=require('node:assert/strict');const harness=require('./support/http.cjs');
test('business tools preserve scope, booking conflicts, placement and financial records',async t=>{
 const {db,req,raw,login}=harness(t),admin=await login('admin@ecc.example'),agent=await login('cristina@ecc.example');
 const post=(p,b={},token=admin,status=200)=>req(p,{method:'POST',body:b,token,status});
 const create=async(name,assigned=1,purpose='WORK')=>(await post('/leads',{full_name:name,email:name+'@test.example',country_of_interest:'Spain',application_type:purpose,assigned_to:assigned},admin,201)).id;
 const id=await create('business'),other=await create('private',2);
 await t.test('published slots book atomically and hide private bookings',async()=>{
  const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+88200000).toISOString();
  const slot=(await post('/booking/slots',{staff_id:1,starts_at:start,ends_at:end},admin,201)).id;
  await post('/booking/slots',{staff_id:1,starts_at:start,ends_at:end},admin,400);
  const booking=await post('/workflow/'+id+'/bookings',{slot_id:slot},agent,201);
  await post('/workflow/'+other+'/bookings',{slot_id:slot},agent,403);
  await post('/workflow/'+other+'/bookings',{slot_id:slot},admin,400);
  assert.equal((await req('/booking/slots',{token:agent})).length,0);
  const cal=await raw('/calendar/export.ics',{token:agent});assert.equal(cal.status,200);assert.match(cal.text,/BEGIN:VEVENT/);
  await post('/workflow/'+id+'/bookings/cancel',{booking_id:booking.id},agent);
  assert.equal((await req('/booking/slots',{token:agent})).length,1);
  await post('/workflow/'+id+'/bookings',{slot_id:slot},admin,201);assert.equal((await req('/workflow/'+id+'/bookings',{token:agent})).length,2);
  await req('/booking/slots/'+slot,{method:'DELETE',token:admin,status:400});
  await post('/tasks',{lead_id:id,title:'Conflicting interview',assignee_id:1,due_date:start.slice(0,10),scheduled_at:start,category:'INTERVIEW'},admin,409);
  await req('/workflow/'+other+'/bookings',{token:agent,status:403});
 });
 await t.test('partners, opportunities, matching and offer tracking',async()=>{
  await post('/placements/partners',{kind:'EMPLOYER',name:'Employer',country:'Spain'},agent,403);
  const partner=(await post('/placements/partners',{kind:'EMPLOYER',name:'Employer',country:'Spain'},admin,201)).id;
  const opportunity=(await post('/placements/opportunities',{partner_id:partner,title:'Developer',purpose:'WORK'},admin,201)).id;
  assert.equal((await req('/workflow/'+id+'/matches',{token:agent}))[0].id,opportunity);
  const application=(await post('/workflow/'+id+'/placements',{opportunity_id:opportunity},agent,201)).id;
  await req('/workflow/'+id+'/placements/'+application,{method:'PATCH',token:agent,body:{status:'OFFERED',reference:'JOB-1',offer_details:'Signed offer issued'}});
  await post('/workflow/'+other+'/placements',{opportunity_id:opportunity},admin,201);
  const data=await req('/placements',{token:agent});assert.equal(data.applications.length,1);assert.equal(data.applications[0].status,'OFFERED');await req('/placements/opportunities/'+opportunity,{method:'PATCH',token:admin,body:{status:'CLOSED'}});assert.equal((await req('/workflow/'+id+'/matches',{token:agent})).length,0);
 });
 await t.test('shared inbox and report builder respect assigned access',async()=>{
  await post('/workflow/'+id+'/messages',{body:'Accessible conversation'},agent,201);await post('/workflow/'+other+'/messages',{body:'Private conversation'},admin,201);
  assert.equal((await req('/inbox',{token:agent})).length,1);
  await post('/workflow/'+id+'/source',{source:'Website'},agent);
  const rows=await post('/reports/custom',{group_by:'source'},agent);assert.equal(rows.length,1);assert.equal(rows[0].label,'Website');
  await post('/reports/custom',{group_by:'l.email; DROP TABLE leads'},agent,400);assert.equal((await req('/reports/custom?group_by=source',{token:agent}))[0].label,'Website');assert.equal((await req('/reports/stage-times',{token:agent}))[0].stage,'INQUIRY');
  await post('/reports/saved',{name:'Sources',definition:{group_by:'source'}},agent,201);
  assert.equal((await req('/reports/saved',{token:agent})).length,1);assert.equal((await req('/reports/saved',{token:admin})).length,0);
 });
 await t.test('privacy exports and translated messages are admin restricted',async()=>{
  await req('/workflow/'+id+'/privacy-export',{token:agent,status:403});
  const exported=await req('/workflow/'+id+'/privacy-export',{token:admin});assert.equal(exported.lead.full_name,'business');assert.equal(exported.lead.portal_hash,undefined);
  const request=(await post('/workflow/'+id+'/privacy-requests',{kind:'ERASURE',reason:'Customer requested removal'},admin,201)).id;
  await post('/admin/privacy/'+request+'/resolve',{status:'COMPLETED',resolution:'Pretend erased'},admin,400);
  await post('/admin/privacy/'+request+'/resolve',{status:'DECLINED',resolution:'Requires retention review'});
  await post('/admin/localized-templates',{locale:'fil',name:'Greeting',subject:'Hello {{name}}',body:'Reference {{reference}}'},admin,201);
  const template=(await req('/admin/localized-templates',{token:admin}))[0];
  await post('/workflow/'+id+'/template-message',{template_id:template.id},admin,201);
  assert.equal(db.prepare('SELECT subject FROM email_outbox ORDER BY id DESC LIMIT 1').get().subject,'Hello business');
 });
 await t.test('eligibility stores immutable rule and answer snapshots',async()=>{
  const rule=(await post('/admin/eligibility/rules',{name:'Screening',country:'Spain',purpose:'WORK',threshold:5,criteria:[{label:'Relevant experience',points:5},{label:'Language',points:2}]},admin,201)).id;
  const result=await post('/workflow/'+id+'/eligibility',{rule_id:rule,answers:[true,false]},agent,201);assert.equal(result.score,5);assert.equal(result.meets_configured_threshold,true);
  await post('/workflow/'+id+'/eligibility',{rule_id:rule,answers:['true',false]},agent,400);
  const snapshot=db.prepare('SELECT snapshot FROM eligibility_assessments WHERE id=?').get(result.id);assert.equal(JSON.parse(snapshot.snapshot).name,'Screening');
 });
 await t.test('bank statement import is idempotent and exact-match reconciliation preserves billing',async()=>{
  const charge=db.prepare("INSERT INTO charges(lead_id,description,amount_cents,currency,due_date) VALUES(?,'Service',10000,'AED','2026-10-29')").run(id).lastInsertRowid;
  const payment=db.prepare("INSERT INTO payments(charge_id,amount_cents,reference,paid_at) VALUES(?,10000,'BANK-TEST','2026-10-29')").run(charge).lastInsertRowid;
  const csv='reference,currency,amount,paid_on\nBANK-TEST,AED,100,2026-10-29';
  await post('/admin/accounting/bank-import',{csv},admin,201);await post('/admin/accounting/bank-import',{csv},admin,201);
  const data=await req('/admin/accounting',{token:admin});assert.equal(data.bank_entries.length,1);
  await post('/admin/accounting/reconcile',{entry_id:data.bank_entries[0].id,payment_id:payment});
  await post('/admin/accounting/reconcile',{entry_id:data.bank_entries[0].id,payment_id:payment},admin,400);
  await post('/admin/accounting/commission',{user_id:1,basis_points:1000});const totals=await req('/admin/accounting',{token:admin});assert.equal(totals.commissions[0].commission_cents,1000);
 });
});

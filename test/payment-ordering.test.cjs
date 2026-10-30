const {test}=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');

function fixture(t){
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE charges(id INTEGER PRIMARY KEY,lead_id INTEGER,currency TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,charge_id INTEGER,amount_cents INTEGER,reference TEXT,paid_at TEXT,receipt_no TEXT);
 CREATE TABLE refunds(id INTEGER PRIMARY KEY,payment_id INTEGER,amount_cents INTEGER,reference TEXT,reason TEXT,refunded_on TEXT,created_by INTEGER);
 INSERT INTO charges VALUES(1,1,'AED');`);
 const ops={finances:()=>[{id:1,status:'ISSUED',balance_cents:10000,installments:[],currency:'AED',invoice_no:'INV-1',payments:[]}]};
 const service=require('../dist/online-payments')(db,ops,()=>{},()=>{});
 db.prepare('INSERT INTO checkout_attempts(id,charge_id,lead_id,amount_cents,currency,form) VALUES(?,?,?,?,?,?)').run('attempt-1',1,1,10000,'AED','{}');
 return {db,service};
}
const paymentEvent=(metadata)=>({id:'evt_paid',type:'checkout.session.completed',data:{object:{id:'cs_early',payment_status:'paid',payment_intent:'pi_early',amount_total:10000,currency:'aed',metadata}}});
const refundEvent=(metadata)=>({id:'evt_refund',type:'refund.created',data:{object:{id:'re_early',payment_intent:'pi_early',status:'succeeded',amount:4000,currency:'aed',metadata}}});
function refundFixture(t){
 const f=fixture(t);f.service.processEvent(paymentEvent({ecc_attempt_id:'attempt-1'}));
 f.db.prepare('INSERT INTO provider_refund_requests(id,payment_id,amount_cents,reason) VALUES(?,?,?,?)').run('refund-request-123',1,4000,'Agreed partial refund');return f;
}

test('early checkout webhook links by attempt metadata and stays idempotent',t=>{
 const {db,service}=fixture(t),event=paymentEvent({ecc_attempt_id:'attempt-1'});
 assert.equal(service.processEvent(event).outcome,'APPLIED');
 assert.deepEqual(db.prepare('SELECT state,session_id FROM checkout_attempts').get(),{state:'PAID',session_id:'cs_early'});
 assert.equal(service.processEvent(event).duplicate,true);
 assert.equal(service.processEvent({...event,id:'evt_paid_again'}).outcome,'DUPLICATE_PAYMENT');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
});

test('unmatched checkout webhook remains retryable until the session is linked',t=>{
 const {db,service}=fixture(t),event=paymentEvent();
 assert.throws(()=>service.processEvent(event),/PAYMENT_ATTEMPT_NOT_LINKED/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_webhooks').get().n,0);
 db.prepare('UPDATE checkout_attempts SET session_id=?').run('cs_early');
 assert.equal(service.processEvent(event).outcome,'APPLIED');
});

test('early refund webhook reconciles its pending request through metadata',t=>{
 const {db,service}=refundFixture(t),event=refundEvent({ecc_refund_id:'refund-request-123'});
 assert.equal(service.processEvent(event).outcome,'REFUND_APPLIED');
 assert.deepEqual(db.prepare('SELECT state,provider_id FROM provider_refund_requests').get(),{state:'SUCCEEDED',provider_id:'re_early'});
 assert.equal(db.prepare('SELECT reason FROM refunds').get().reason,'Agreed partial refund');
 assert.equal(service.processEvent({...event,id:'evt_refund_again'}).outcome,'REFUND_APPLIED');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM refunds').get().n,1);
 assert.equal(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM provider_refund_requests WHERE state='PENDING'").get().n,0);
});

test('existing refund still reconciles request when the provider ID becomes available later',t=>{
 const {db,service}=refundFixture(t),event=refundEvent();
 service.processEvent(event);
 assert.equal(db.prepare('SELECT state FROM provider_refund_requests').get().state,'PENDING');
 db.prepare('UPDATE provider_refund_requests SET provider_id=?').run('re_early');
 assert.equal(service.processEvent({...event,id:'evt_refund_retry'}).outcome,'REFUND_APPLIED');
 assert.equal(db.prepare('SELECT state FROM provider_refund_requests').get().state,'SUCCEEDED');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM refunds').get().n,1);
});

test('refund metadata cannot reconcile a request with a different amount',t=>{
 const {db,service}=refundFixture(t);
 db.prepare('UPDATE provider_refund_requests SET amount_cents=5000').run();
 assert.equal(service.processEvent(refundEvent({ecc_refund_id:'refund-request-123'})).outcome,'REFUND_REVIEW_REQUIRED');
 assert.equal(db.prepare('SELECT state FROM provider_refund_requests').get().state,'PENDING');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM refunds').get().n,0);
});

test('delayed checkout API response cannot reopen an already paid attempt',async t=>{
 const {db,service}=fixture(t),routes=new Map();
 const previousFetch=global.fetch,keys=['PAYMENT_PROVIDER','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],previous=keys.map(k=>process.env[k]);
 t.after(()=>{global.fetch=previousFetch;keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]})});
 process.env.PAYMENT_PROVIDER='stripe';process.env.STRIPE_SECRET_KEY='sk_test_mock';process.env.STRIPE_WEBHOOK_SECRET='whsec_mock';
 service.register({get(){},post(path,...handlers){routes.set(path,handlers.at(-1))}},()=>()=>{});
 global.fetch=async()=>{
  service.processEvent(paymentEvent({ecc_attempt_id:'attempt-1'}));
  return {ok:true,json:async()=>({id:'cs_early',url:'https://checkout.stripe.com/c/pay/cs_early'})};
 };
 let response;
 const res={json(value){response=value;return this},status(code){assert.fail('Unexpected HTTP '+code)}};
 await routes.get('/portal/invoices/:invoice/checkout')({client:{id:1,email:'client@example.test'},params:{invoice:'1'},body:{}},res);
 assert.equal(response.url,'https://checkout.stripe.com/c/pay/cs_early');
 assert.equal(db.prepare('SELECT state FROM checkout_attempts').get().state,'PAID');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
});

test('refund webhook before API response leaves the full remaining balance refundable',async t=>{
 const {db,service}=fixture(t);service.processEvent(paymentEvent({ecc_attempt_id:'attempt-1'}));
 const routes=new Map(),previousFetch=global.fetch,keys=['PAYMENT_PROVIDER','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],previous=keys.map(k=>process.env[k]);
 t.after(()=>{global.fetch=previousFetch;keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]})});
 process.env.PAYMENT_PROVIDER='stripe';process.env.STRIPE_SECRET_KEY='sk_test_mock';process.env.STRIPE_WEBHOOK_SECRET='whsec_mock';
 service.register({get(){},post(path,...handlers){routes.set(path,handlers.at(-1))}},()=>()=>{});
 let calls=0;
 global.fetch=async(url,options)=>{
  const form=new URLSearchParams(options.body),id='re_race_'+(++calls),refund={id,status:'succeeded',payment_intent:'pi_early',amount:Number(form.get('amount')),currency:'aed',metadata:{ecc_refund_id:form.get('metadata[ecc_refund_id]')}};
  service.processEvent({id:'evt_'+id,type:'refund.created',data:{object:refund}});
  return {ok:true,json:async()=>refund};
 };
 const handler=routes.get('/workflow/:id/payments/:payment/provider-refund');
 for(const [amount,request_id]of [[40,'refund-request-first'],[60,'refund-request-second']]){
  let response;
  await handler({params:{id:'1',payment:'1'},body:{amount,request_id,reason:'Agreed refund'}},{json(value){response=value;return this},status(code){assert.fail('Unexpected HTTP '+code)}});
  assert.equal(response.status,'succeeded');
 }
 assert.equal(calls,2);
 assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM refunds').get().n,10000);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM provider_refund_requests WHERE state='SUCCEEDED'").get().n,2);
});

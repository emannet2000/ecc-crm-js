const {text,date}=require('./operations').validation;
module.exports=(db,audit)=>{
 db.exec(`CREATE TABLE IF NOT EXISTS commission_items(id INTEGER PRIMARY KEY,source TEXT UNIQUE NOT NULL,payment_id INTEGER,user_id INTEGER,currency TEXT NOT NULL,amount_cents INTEGER NOT NULL,basis_points INTEGER,reference_snapshot TEXT NOT NULL,reason TEXT NOT NULL,status TEXT DEFAULT 'PENDING',approved_by INTEGER,approved_at TEXT,payout_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS commission_payouts(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,currency TEXT NOT NULL,amount_cents INTEGER NOT NULL,reference TEXT UNIQUE NOT NULL,paid_on TEXT NOT NULL,recorded_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TRIGGER IF NOT EXISTS commission_capture_payment AFTER INSERT ON payments BEGIN
 INSERT INTO commission_items(source,payment_id,user_id,currency,amount_cents,basis_points,reference_snapshot,reason)
 SELECT 'payment:'||NEW.id,NEW.id,l.assigned_to,c.currency,CAST(ROUND(NEW.amount_cents*COALESCE(r.basis_points,0)/10000.0) AS INTEGER),COALESCE(r.basis_points,0),l.reference_no,'Owner and commission rate captured when receipt was recorded'
 FROM charges c JOIN leads l ON l.id=c.lead_id LEFT JOIN commission_rules r ON r.user_id=l.assigned_to WHERE c.id=NEW.charge_id;
 END;
 CREATE TRIGGER IF NOT EXISTS commission_capture_refund AFTER INSERT ON refunds BEGIN
 INSERT INTO commission_items(source,payment_id,user_id,currency,amount_cents,basis_points,reference_snapshot,reason,status)
 SELECT 'refund:'||NEW.id,e.payment_id,e.user_id,e.currency,
 -CAST(ROUND((SELECT COALESCE(SUM(amount_cents),0) FROM refunds WHERE payment_id=NEW.payment_id)*COALESCE(e.basis_points,0)/10000.0) AS INTEGER)-COALESCE((SELECT SUM(amount_cents) FROM commission_items WHERE payment_id=NEW.payment_id AND source LIKE 'refund:%'),0),
 e.basis_points,e.reference_snapshot,'Automatic refund adjustment',CASE WHEN e.basis_points IS NULL THEN 'NEEDS_REVIEW' ELSE 'PENDING' END
 FROM commission_items e WHERE e.source='payment:'||NEW.payment_id;
 END;`);
 // Existing payment owners/rates cannot safely be reconstructed from today's assignment.
 db.prepare(`INSERT OR IGNORE INTO commission_items(source,payment_id,user_id,currency,amount_cents,basis_points,reference_snapshot,reason,status)
 SELECT 'payment:'||p.id,p.id,NULL,c.currency,0,NULL,l.reference_no,'Historical receipt: owner and rate require explicit reconciliation','NEEDS_REVIEW' FROM payments p JOIN charges c ON c.id=p.charge_id JOIN leads l ON l.id=c.lead_id`).run();
 const safe=fn=>(q,s)=>{try{fn(q,s)}catch(e){s.status(400).json({error:e.message})}};
 const policy=()=>{const row=db.prepare("SELECT value FROM organization_settings WHERE key='commission_policy'").get();return row?JSON.parse(row.value):null};
 function register(v1,auth){const admin=auth('admin');
  v1.get('/admin/commissions',admin,(q,s)=>s.json({policy:policy(),items:db.prepare('SELECT i.*,u.full_name FROM commission_items i LEFT JOIN users u ON u.id=i.user_id ORDER BY i.id DESC LIMIT 1000').all(),payouts:db.prepare('SELECT p.*,u.full_name FROM commission_payouts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC').all()}));
  v1.post('/admin/commissions/policy',admin,safe((q,s)=>{if(q.body.method!=='ON_RECEIPT_NET_REFUNDS'||!text(q.body.approval_reason,2000)||q.body.confirm!==true)throw Error('EXPLICIT_COMMISSION_POLICY_APPROVAL_REQUIRED');const value={method:q.body.method,approval_reason:q.body.approval_reason,approved_by:q.user.id,approved_at:new Date().toISOString()};db.prepare("INSERT INTO organization_settings(key,value) VALUES('commission_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));audit('commission_policy',0,'APPROVED',q.user.name,null,value);s.json({ok:true})}));
  v1.post('/admin/commissions/adjust',admin,safe((q,s)=>{const b=q.body,p=db.prepare('SELECT p.*,c.currency,l.reference_no FROM payments p JOIN charges c ON c.id=p.charge_id JOIN leads l ON l.id=c.lead_id WHERE p.id=?').get(Number(b.payment_id));if(!p||!db.prepare("SELECT id FROM users WHERE id=? AND role<>'client'").get(Number(b.user_id))||!Number.isSafeInteger(b.amount_cents)||b.amount_cents===0||Math.abs(b.amount_cents)>p.amount_cents||!text(b.reason,2000)||!text(b.reference,200))throw Error('VALID_PAYMENT_STAFF_AMOUNT_REASON_AND_UNIQUE_REFERENCE_REQUIRED');const id=db.prepare('INSERT INTO commission_items(source,payment_id,user_id,currency,amount_cents,basis_points,reference_snapshot,reason) VALUES(?,?,?,?,?,NULL,?,?)').run('adjustment:'+b.reference,p.id,Number(b.user_id),p.currency,b.amount_cents,p.reference_no,b.reason).lastInsertRowid;audit('commission_item',id,'ADJUSTED',q.user.name,null,b);s.status(201).json({id})}));
  v1.post('/admin/commissions/:id/approve',admin,safe((q,s)=>{if(!policy())throw Error('COMMISSION_POLICY_NOT_APPROVED');const r=db.prepare("UPDATE commission_items SET status='APPROVED',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING' AND user_id IS NOT NULL").run(q.user.id,q.params.id);if(!r.changes)throw Error('PENDING_COMMISSION_WITH_KNOWN_OWNER_REQUIRED');audit('commission_item',Number(q.params.id),'APPROVED',q.user.name,null,{});s.json({ok:true})}));
  v1.post('/admin/commissions/payout',admin,safe((q,s)=>{if(!policy())throw Error('COMMISSION_POLICY_NOT_APPROVED');const b=q.body;if(!Number.isSafeInteger(b.user_id)||!text(b.reference,200)||!date(b.paid_on)||!['AED','USD','EUR','GBP','CAD','AUD','NZD'].includes(b.currency))throw Error('STAFF_CURRENCY_PAYMENT_DATE_AND_REFERENCE_REQUIRED');const result=db.transaction(()=>{
    const old=db.prepare('SELECT * FROM commission_payouts WHERE reference=?').get(b.reference);if(old){if(old.user_id!==b.user_id||old.currency!==b.currency||old.paid_on!==b.paid_on)throw Error('PAYOUT_REFERENCE_CONFLICT');return {id:old.id,amount_cents:old.amount_cents}}
    const pending=db.prepare("SELECT id FROM commission_items WHERE user_id=? AND currency=? AND status='PENDING' AND amount_cents<0").get(b.user_id,b.currency);if(pending)throw Error('APPROVE_NEGATIVE_ADJUSTMENTS_BEFORE_PAYOUT');
    const rows=db.prepare("SELECT * FROM commission_items WHERE user_id=? AND currency=? AND status='APPROVED' AND payout_id IS NULL").all(b.user_id,b.currency),amount=rows.reduce((sum,r)=>sum+r.amount_cents,0);if(!Number.isSafeInteger(amount)||amount<=0)throw Error('POSITIVE_APPROVED_NET_COMMISSION_REQUIRED');
    const id=db.prepare('INSERT INTO commission_payouts(user_id,currency,amount_cents,reference,paid_on,recorded_by) VALUES(?,?,?,?,?,?)').run(b.user_id,b.currency,amount,b.reference,b.paid_on,q.user.id).lastInsertRowid;for(const row of rows)db.prepare("UPDATE commission_items SET status='PAID',payout_id=? WHERE id=?").run(id,row.id);audit('commission_payout',id,'RECORDED',q.user.name,null,{...b,amount_cents:amount});return {id,amount_cents:amount};})();s.status(201).json(result);
  }));
 }
 return {register};
};

import {canSetApplicationStage,isApplicationStage,type CaseDecision} from './shared/workflow-model';
import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const crypto = require('node:crypto') as typeof import('node:crypto');
const calculator = require('./shared/visa-calculator') as typeof import('./shared/visa-calculator');
const service = (v1: Router, db: Database, auth: Auth, audit: Audit, profiles: Services) => {
    const columns = db.prepare('PRAGMA table_info(leads)').all().map((c: any) => c.name);
    for (const [name, type] of Object.entries<any>({ assessment_approved: 'INTEGER DEFAULT 0', assessment_at: 'TEXT', assessment_notes: 'TEXT', document_deadline: 'TEXT', documents_approved: 'INTEGER DEFAULT 0', portal_hash: 'TEXT', application_stage: "TEXT DEFAULT 'ONBOARDING'" }))
        if (!columns.includes(name))
            db.exec(`ALTER TABLE leads ADD COLUMN ${name} ${type}`);
    db.exec(`CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,lead_id INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,kind TEXT NOT NULL DEFAULT 'INITIAL',status TEXT NOT NULL DEFAULT 'PENDING',review_notes TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS requirements(id INTEGER PRIMARY KEY,lead_id INTEGER NOT NULL,title TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS proposals(id INTEGER PRIMARY KEY,lead_id INTEGER NOT NULL,country TEXT,purpose TEXT,currency TEXT NOT NULL,items TEXT NOT NULL,terms TEXT NOT NULL,status TEXT DEFAULT 'DRAFT',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS charges(id INTEGER PRIMARY KEY,lead_id INTEGER NOT NULL,description TEXT NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT NOT NULL,due_date TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,charge_id INTEGER NOT NULL,amount_cents INTEGER NOT NULL,reference TEXT NOT NULL,paid_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
    if (!db.prepare('PRAGMA table_info(proposals)').all().some((c: any) => c.name === 'estimate'))
        db.exec('ALTER TABLE proposals ADD COLUMN estimate TEXT');
    const ops = (require('./operations') as typeof import('./operations'))(db, audit);
    const fail = (s: any, error: any, code = 400) => s.status(code).json({ error });
    const getLead = (id: any) => db.prepare('SELECT * FROM leads WHERE id=?').get(id);
    const log = (q: any, id: any, action: any, data: any) => audit('lead', id, action, q.user?.name || 'client', null, data);
    const money = (x: any) => Number.isFinite(Number(x)) && Number(x) > 0 && Number(x) <= 100000000 && Math.abs(Number(x) * 100 - Math.round(Number(x) * 100)) < 0.00001;
    const date = (x: any) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
    const currency = (x: any) => typeof x === 'string' && /^[A-Z]{3}$/.test(x);
    const portal = ops.portal;
    const finances = ops.finances;
    const detail = (id: any, client = false) => ({ applicant_profile: profiles.get(id), documents: db.prepare('SELECT id,name,mime,kind,status,review_notes,created_at,requirement_id,expires_on,proposal_id FROM documents WHERE lead_id=? ORDER BY id').all(id).map(d => ({ ...d, effective_status: d.expires_on && d.expires_on < new Date().toISOString().slice(0, 10) ? 'EXPIRED' : d.status })), proposals: db.prepare(`SELECT * FROM proposals WHERE lead_id=? ${client ? "AND (sent_at IS NOT NULL OR (status='APPROVED' AND EXISTS(SELECT 1 FROM leads WHERE id=proposals.lead_id AND status='CLIENT')))" : ''} ORDER BY revision DESC,id DESC`).all(id).map(p => ({ ...p, items: JSON.parse(p.items), estimate: p.estimate ? JSON.parse(p.estimate) : null, agreement: p.agreement ? JSON.parse(p.agreement) : null })), ...ops.extras(id, client) });
    function conversionReadiness(l: any) {
        const p = db.prepare("SELECT * FROM proposals WHERE lead_id=? AND status='APPROVED' ORDER BY revision DESC,id DESC LIMIT 1").get(l.id);
        const signed = !!p && (!!db.prepare("SELECT id FROM documents WHERE lead_id=? AND proposal_id=? AND kind='SIGNED_AGREEMENT' AND status='ACCEPTED' AND (expires_on IS NULL OR expires_on>=date('now')) AND (?=0 OR EXISTS(SELECT 1 FROM document_safety ds WHERE ds.document_id=documents.id AND ds.status='CLEAN'))").get(l.id, p.id, process.env.DOCUMENT_SCANNER_COMMAND ? 1 : 0) || !!ops.signedAgreementReady?.(p));
        const checks = [{ key: 'stage', label: 'Lead is in proposal stage', complete: l.status === 'PROPOSAL' }, { key: 'assessment', label: 'Assessment approved', complete: !!l.assessment_approved }, { key: 'documents', label: 'Initial document set approved with accepted, unexpired documents', complete: !!l.documents_approved && ops.documentReady(l.id) }, { key: 'proposal', label: 'Current proposal approved', complete: !!p }, { key: 'acceptance', label: 'Customer accepted the current proposal', complete: p?.customer_status === 'ACCEPTED' }, { key: 'signature', label: 'Signed agreement reviewed and accepted for this proposal', complete: signed }];
        return { ready: checks.every((c: any) => c.complete), already_client: l.status === 'CLIENT', checks, missing: checks.filter((c: any) => !c.complete).map((c: any) => c.label) };
    }
    v1.get('/workflow/:id/conversion-readiness', auth(), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id); if (!l)
        return fail(s, 'NOT_FOUND', 404); s.json(conversionReadiness(l)); });
    v1.get('/workflow/:id/applicant-profile', auth(), (q: HttpRequest, s: HttpResponse) => { const p = profiles.signed(q.params.id); if (!p)
        return fail(s, 'NOT_FOUND', 404); s.set('Cache-Control', 'no-store').json(p); });
    v1.get('/workflow/:id', auth(), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id); if (!l)
        return fail(s, 'NOT_FOUND', 404); const { portal_hash, ...safe } = l; s.json({ ...safe, ...detail(l.id), conversion_readiness: conversionReadiness(l) }); });
    v1.patch('/workflow/:id/application-status', auth(), (q: HttpRequest, s: HttpResponse) => {
        const l=getLead(q.params.id),stage=q.body.stage;
        if(!l||l.status!=='CLIENT')return fail(s,'CLIENT_REQUIRED');
        if(!isApplicationStage(stage))return fail(s,'INVALID_APPLICATION_STATUS');
        const error=db.transaction(()=>{
            const current=getLead(l.id);
            if(current?.status!=='CLIENT')return 'CLIENT_REQUIRED';
            const decision=(db.prepare('SELECT decision FROM case_records WHERE lead_id=?').get(l.id)?.decision||'PENDING') as CaseDecision;
            if(!canSetApplicationStage(stage,decision))return 'UPDATE_CASE_DECISION_BEFORE_CHANGING_OUTCOME';
            db.prepare('UPDATE leads SET application_stage=? WHERE id=?').run(stage,l.id);
            log(q,l.id,'APPLICATION_STATUS_UPDATED',{stage,decision});
            return null;
        })();
        if(error)return fail(s,error);
        s.json({ok:true});
    });
    v1.post('/workflow/:id/assessment', auth(), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id), b = q.body; if (!l)
        return fail(s, 'NOT_FOUND', 404); if (!['INQUIRY', 'ASSESSMENT', 'DOCUMENTS_PENDING', 'PROPOSAL'].includes(l.status) || db.prepare("SELECT id FROM proposals WHERE lead_id=? AND status IN ('DRAFT','APPROVED')").get(l.id))
        return fail(s, 'ASSESSMENT_LOCKED_AFTER_PROPOSAL'); if (!date(b.date) || !String(b.notes || '').trim() || typeof b.approved !== 'boolean')
        return fail(s, 'DATE_NOTES_AND_DECISION_REQUIRED'); db.transaction(() => { db.prepare("UPDATE leads SET assessment_at=?,assessment_notes=?,assessment_approved=?,documents_approved=0,status=? WHERE id=?").run(b.date, b.notes, b.approved ? 1 : 0, b.approved ? 'DOCUMENTS_PENDING' : 'ASSESSMENT', l.id); log(q, l.id, 'ASSESSMENT', { date: b.date, notes: b.notes, approved: b.approved }); })(); s.json({ ok: true }); });
    v1.post('/workflow/:id/requirements', auth(), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id), b = q.body; if (!l)
        return fail(s, 'NOT_FOUND', 404); if (!l.assessment_approved || !['ASSESSMENT', 'DOCUMENTS_PENDING', 'PROPOSAL'].includes(l.status) || db.prepare("SELECT id FROM proposals WHERE lead_id=? AND status IN ('DRAFT','APPROVED')").get(l.id))
        return fail(s, 'ASSESSMENT_APPROVAL_REQUIRED'); const titles = Array.isArray(b.titles) ? [...new Set<string>(b.titles.filter((t: any) => typeof t === 'string').map((t: any) => t.trim()).filter(Boolean))] : []; if (!titles.length || titles.length > 100 || titles.some(t => t.length > 500) || !date(b.deadline))
        return fail(s, 'CHECKLIST_AND_DEADLINE_REQUIRED'); db.transaction(() => { db.prepare("UPDATE requirements SET active=0 WHERE lead_id=? AND kind='INITIAL'").run(l.id); for (const title of titles) {
        const prior = db.prepare("SELECT id FROM requirements WHERE lead_id=? AND title=? AND kind='INITIAL' ORDER BY id LIMIT 1").get(l.id, title);
        if (prior)
            db.prepare('UPDATE requirements SET active=1,due_date=? WHERE id=?').run(b.deadline, prior.id);
        else
            db.prepare("INSERT INTO requirements(lead_id,title,kind,due_date) VALUES(?,?,'INITIAL',?)").run(l.id, title, b.deadline);
    } db.prepare('UPDATE leads SET document_deadline=?,documents_approved=0 WHERE id=?').run(b.deadline, l.id); db.prepare('INSERT INTO tasks(lead_id,title,assignee_id,due_date) VALUES(?,?,?,?)').run(l.id, 'Submit initial documents: ' + titles.join(', '), l.assigned_to || q.user.id, b.deadline); log(q, l.id, 'REQUIREMENTS_SET', { titles, deadline: b.deadline }); })(); s.json({ ok: true }); });
    const upload = async (q: HttpRequest, s: HttpResponse, id: any) => { const b = q.body, l = getLead(id); if (!l)
        return fail(s, 'NOT_FOUND', 404); const allowed = ['application/pdf', 'image/jpeg', 'image/png']; if (!allowed.includes(b.mime) || typeof b.data !== 'string' || !b.data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data) || !String(b.name || '').trim() || !['INITIAL', 'SIGNED_AGREEMENT', 'APPLICATION'].includes(b.kind))
        return fail(s, 'UPLOAD_PDF_JPEG_OR_PNG'); const data = Buffer.from(b.data, 'base64'); if (!data.length || data.length > 5 * 1024 * 1024)
        return fail(s, 'MAXIMUM_FILE_SIZE_5MB'); const valid = b.mime === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-' : b.mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : data[0] === 255 && data[1] === 216 && data[2] === 255; if (!valid)
        return fail(s, 'FILE_CONTENT_TYPE_MISMATCH'); let safety; try {
        safety = await (require('./document-tools') as typeof import('./document-tools')).scan(data, b.mime);
    }
    catch (e: any) {
        return fail(s, e.message);
    } const requirement = b.requirement_id ? db.prepare('SELECT * FROM requirements WHERE id=? AND lead_id=? AND kind=? AND active=1').get(b.requirement_id, id, b.kind) : null; if (b.kind === 'INITIAL' && !requirement || b.requirement_id && !requirement)
        return fail(s, 'MATCHING_REQUIREMENT_REQUIRED'); if (b.expires_on && !date(b.expires_on))
        return fail(s, 'INVALID_EXPIRY_DATE'); if (b.kind === 'SIGNED_AGREEMENT' && !db.prepare("SELECT id FROM proposals WHERE id=? AND lead_id=? AND status='APPROVED' AND customer_status='ACCEPTED'").get(b.proposal_id || 0, id))
        return fail(s, 'ACCEPTED_PROPOSAL_REQUIRED'); db.transaction(() => { const inserted = db.prepare('INSERT INTO documents(lead_id,name,mime,data,kind,requirement_id,expires_on,proposal_id) VALUES(?,?,?,?,?,?,?,?)').run(id, String(b.name).slice(0, 180), b.mime, data, b.kind, requirement?.id || null, b.expires_on || null, b.kind === 'SIGNED_AGREEMENT' ? b.proposal_id : null); db.prepare('INSERT INTO document_safety(document_id,sha256,status) VALUES(?,?,?)').run(inserted.lastInsertRowid, safety.sha256, safety.status); if (b.kind === 'INITIAL')
        db.prepare('UPDATE leads SET documents_approved=0 WHERE id=?').run(id); log(q, id, 'DOCUMENT_UPLOADED', { name: b.name, kind: b.kind }); })(); s.status(201).json({ ok: true }); };
    v1.post('/workflow/:id/documents', auth(), (q: HttpRequest, s: HttpResponse, next: HttpNext) => upload(q, s, q.params.id).catch(next));
    v1.patch('/workflow/:id/documents/:doc', auth(), (q: HttpRequest, s: HttpResponse) => { const d = db.prepare('SELECT * FROM documents WHERE id=? AND lead_id=?').get(q.params.doc, q.params.id); if (!d)
        return fail(s, 'NOT_FOUND', 404); if (q.body.status === 'ACCEPTED' && process.env.DOCUMENT_SCANNER_COMMAND && !db.prepare("SELECT document_id FROM document_safety WHERE document_id=? AND status='CLEAN'").get(d.id))
        return fail(s, 'CLEAN_DOCUMENT_SCAN_REQUIRED'); if (q.body.status === 'ACCEPTED' && d.expires_on && d.expires_on < new Date().toISOString().slice(0, 10))
        return fail(s, 'DOCUMENT_EXPIRED'); if (!['ACCEPTED', 'REJECTED'].includes(q.body.status))
        return fail(s, 'INVALID_REVIEW'); if (q.body.status === 'REJECTED' && !String(q.body.notes || '').trim())
        return fail(s, 'REJECTION_REASON_REQUIRED'); db.transaction(() => { db.prepare('UPDATE documents SET status=?,review_notes=? WHERE id=?').run(q.body.status, String(q.body.notes || ''), d.id); if (d.kind === 'INITIAL')
        db.prepare('UPDATE leads SET documents_approved=0 WHERE id=?').run(d.lead_id); log(q, d.lead_id, 'DOCUMENT_REVIEW', { id: d.id, status: q.body.status, notes: q.body.notes }); })(); s.json({ ok: true }); });
    v1.post('/workflow/:id/documents-approve', auth('approver', 'admin'), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id); if (!l)
        return fail(s, 'NOT_FOUND', 404); if (l.status === 'CLIENT')
        return fail(s, 'ALREADY_CLIENT'); if (!l.assessment_approved || !ops.documentReady(l.id))
        return fail(s, 'EVERY_INITIAL_REQUIREMENT_NEEDS_AN_ACCEPTED_UNEXPIRED_DOCUMENT'); db.transaction(() => { db.prepare("UPDATE leads SET documents_approved=1,status='PROPOSAL' WHERE id=?").run(l.id); log(q, l.id, 'DOCUMENTS_APPROVED', { checklist_verified: true }); })(); s.json({ ok: true }); });
    (require('./proposal-routes') as typeof import('./proposal-routes'))(v1, db, auth, audit, ops);
    v1.post('/workflow/:id/convert', auth('approver', 'admin'), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id); if (!l)
        return fail(s, 'NOT_FOUND', 404); if (l.status !== 'PROPOSAL')
        return fail(s, 'PROPOSAL_STAGE_REQUIRED'); const p = db.prepare("SELECT * FROM proposals WHERE lead_id=? AND status='APPROVED' ORDER BY revision DESC,id DESC LIMIT 1").get(l.id); if (!conversionReadiness(l).ready)
        return fail(s, 'APPROVED_ASSESSMENT_DOCUMENTS_PROPOSAL_AND_ACCEPTED_SIGNED_AGREEMENT_REQUIRED'); const token = crypto.randomBytes(32).toString('hex'); db.transaction(() => { db.prepare("UPDATE leads SET status='CLIENT',portal_hash=? WHERE id=?").run(crypto.createHash('sha256').update(token).digest('hex'), l.id); const payable = JSON.parse(p.items).filter((i: any) => i.billable !== false).reduce((n: any, i: any) => n + i.amount_cents, 0); if (payable > 0) {
        const invoice = db.prepare('INSERT INTO charges(lead_id,description,amount_cents,currency) VALUES(?,?,?,?)').run(l.id, 'Accepted proposal #' + p.id, payable, p.currency);
        ops.decorateInvoice(invoice.lastInsertRowid, JSON.parse(p.items).filter((i: any) => i.billable !== false), p.agreement ? JSON.parse(p.agreement).installments : []);
    } ops.invite(l, token, 'client'); log(q, l.id, 'CONVERTED_TO_CLIENT', { proposal_id: p.id }); })(); s.json({ portal_path: '/#/portal/' + token }); });
    v1.post('/workflow/:id/portal-link', auth('approver', 'admin'), (q: HttpRequest, s: HttpResponse) => { const l = getLead(q.params.id); if (!l || l.status !== 'CLIENT')
        return fail(s, 'CLIENT_REQUIRED'); const token = crypto.randomBytes(32).toString('hex'); db.transaction(() => { db.prepare('UPDATE leads SET portal_hash=? WHERE id=?').run(crypto.createHash('sha256').update(token).digest('hex'), l.id); ops.invite(l, token, 'client'); log(q, l.id, 'PORTAL_LINK_REPLACED', {}); })(); s.json({ portal_path: '/#/portal/' + token }); });
    v1.post('/workflow/:id/payments', auth('approver', 'admin'), (q: HttpRequest, s: HttpResponse) => { const b = q.body, c = finances(q.params.id).find((c: any) => c.id === Number(b.charge_id)); if (!c || c.status === 'VOID')
        return fail(s, 'ISSUED_INVOICE_REQUIRED'); if (!money(b.amount) || !String(b.reference || '').trim() || !date(b.paid_at))
        return fail(s, 'AMOUNT_REFERENCE_AND_DATE_REQUIRED'); const cents = Math.round(Number(b.amount) * 100); const prior = db.prepare('SELECT * FROM payments WHERE charge_id=? AND reference=?').get(c.id, b.reference.trim()); if (prior) {
        if (prior.amount_cents === cents && prior.paid_at === b.paid_at)
            return s.status(201).json({ id: prior.id, receipt_no: prior.receipt_no });
        return fail(s, 'PAYMENT_REFERENCE_ALREADY_USED');
    } if (cents > c.balance_cents)
        return fail(s, 'PAYMENT_EXCEEDS_BALANCE'); const result = db.transaction(() => { const r = db.prepare('INSERT INTO payments(charge_id,amount_cents,reference,paid_at) VALUES(?,?,?,?)').run(c.id, cents, b.reference.trim(), b.paid_at); const receipt = 'ECC-RCP-' + new Date().getFullYear() + '-' + String(r.lastInsertRowid).padStart(5, '0'); db.prepare('UPDATE payments SET receipt_no=? WHERE id=?').run(receipt, r.lastInsertRowid); log(q, q.params.id, 'PAYMENT_RECORDED', { payment_id: r.lastInsertRowid, receipt_no: receipt, charge_id: c.id, amount_cents: cents, currency: c.currency, reference: b.reference }); return { id: r.lastInsertRowid, receipt_no: receipt }; })(); s.status(201).json(result); });
    const download = (q: HttpRequest, s: HttpResponse, id: any) => { const d = db.prepare('SELECT * FROM documents WHERE id=? AND lead_id=?').get(q.params.doc, id); if (!d)
        return fail(s, 'NOT_FOUND', 404); s.set({ 'Content-Type': d.mime, 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(d.name), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }).send(d.data); };
    v1.get('/workflow/:id/documents/:doc', auth(), (q: HttpRequest, s: HttpResponse) => download(q, s, q.params.id));
    v1.get('/portal/profile', portal, (q: HttpRequest, s: HttpResponse) => { const p = profiles.signed(q.client.id); if (!p)
        return fail(s, 'NOT_FOUND', 404); s.set('Cache-Control', 'no-store').json(p); });
    v1.get('/portal', portal, (q: HttpRequest, s: HttpResponse) => { const l = q.client; s.set('Cache-Control', 'no-store').json({ id: l.id, reference_no: l.reference_no, full_name: l.full_name, email: l.email, phone: l.phone, country_of_interest: l.country_of_interest, application_type: l.application_type, status: l.status, application_stage: l.application_stage, ...detail(l.id, true) }); });
    v1.post('/portal/documents', portal, (q: HttpRequest, s: HttpResponse, next: HttpNext) => upload(q, s, q.client.id).catch(next));
    v1.get('/portal/documents/:doc', portal, (q: HttpRequest, s: HttpResponse) => download(q, s, q.client.id));
    ops.register(v1, auth);
    return ops;
};
export = service;

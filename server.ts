import {personDetails,personName} from './shared/person-details';
import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const express = require('express') as typeof import('express'), Database = require('better-sqlite3') as typeof import('better-sqlite3'), bcrypt = require('bcryptjs') as typeof import('bcryptjs'), jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me', PORT = process.env.PORT || 2000;
const db = new Database(process.env.DB || 'ecc.db') as Database;
db.pragma('journal_mode=WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,full_name TEXT,role TEXT,password_hash TEXT,is_active INT DEFAULT 1);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY,reference_no TEXT UNIQUE,full_name TEXT,email TEXT,phone TEXT,country_of_interest TEXT,application_type TEXT,origin_country TEXT,message TEXT,notes TEXT DEFAULT '',status TEXT DEFAULT 'INQUIRY',assigned_to INT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,lead_id INT,title TEXT,assignee_id INT,due_date TEXT,status TEXT DEFAULT 'PENDING',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,entity_type TEXT,entity_id INT,action TEXT,changed_by TEXT,old_values TEXT,new_values TEXT,at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const personColumns=new Set(db.prepare('PRAGMA table_info(leads)').all().map(r=>r.name));
for(const [key,type] of Object.entries({first_name:'TEXT',middle_name:'TEXT',last_name:'TEXT',age:'INTEGER',nationality:'TEXT',address:'TEXT',gender:'TEXT'}))if(!personColumns.has(key))db.exec(`ALTER TABLE leads ADD COLUMN ${key} ${type}`);
if (!db.prepare('SELECT COUNT(*) c FROM users').get().c && process.env.NODE_ENV !== 'production') {
    const h = bcrypt.hashSync('Test1234!', 12), i = db.prepare('INSERT INTO users(email,full_name,role,password_hash) VALUES(?,?,?,?)');
    [['cristina@ecc.example', 'Cristina Dela Cruz', 'staff'], ['maria@ecc.example', 'Maria Santos', 'approver'], ['admin@ecc.example', 'Admin ECC', 'admin']].forEach(u => i.run(...u, h));
}
let operations: any, access: any, services: any, growth, business: any, catalog: any, advanced, integrations: any;
const audit: any = (t: any, id: any, a: any, by: any, o: any, n: any) => { const r = db.prepare('INSERT INTO audit_log(entity_type,entity_id,action,changed_by,old_values,new_values) VALUES(?,?,?,?,?,?)').run(t, id, a, by, o ? JSON.stringify(o) : null, n ? JSON.stringify(n) : null); operations?.onAudit(t, id, a, by, o, n); return r; };
const COUNTRIES = ['Spain', 'Portugal', 'Canada', 'Australia', 'New Zealand', 'Malta'], TYPES = ['TOURIST', 'STUDY', 'WORK', 'RESIDENCY'], STATUSES = ['INQUIRY', 'ASSESSMENT', 'DOCUMENTS_PENDING', 'PROPOSAL', 'CLIENT'];
const profiles = (require('./applicant-profiles') as typeof import('./applicant-profiles'))(db);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use((q: HttpRequest, s: HttpResponse, next: HttpNext) => services ? services.observe(q, s, next) : next());
app.post('/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (q: HttpRequest, s: HttpResponse) => services.payments.webhook(q, s));
app.post('/v1/public/integrations/events', express.raw({ type: 'application/json', limit: '2mb' }), (q: HttpRequest, s: HttpResponse) => integrations.webhook(q, s));
app.use(express.json({ limit: '8mb' }));
app.use((q: HttpRequest, s: HttpResponse, n) => { s.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' }); q.method === 'OPTIONS' ? s.sendStatus(204) : n(); });
const hits = new Map();
const limit = (max: any) => (q: HttpRequest, s: HttpResponse, n: any) => { const k = q.path.toLowerCase() + q.ip, t = Date.now(), a = (hits.get(k) || []).filter((x: any) => t - x < 6e4); if (a.length >= max)
    return s.status(429).json({ error: 'RATE_LIMITED' }); a.push(t); hits.set(k, a); n(); };
const auth: any = (...roles: any[]) => (q: HttpRequest, s: HttpResponse, next: HttpNext) => access.auth(...roles)(q, s, next);
const v1 = express.Router();
v1.use((q: HttpRequest, s: HttpResponse, next: HttpNext) => access.middleware(q, s, next));
v1.use((q: HttpRequest, s: HttpResponse, next: HttpNext) => business ? business.preflight(q, s, next) : next());
v1.get('/health', (q: HttpRequest, s: HttpResponse) => s.json({ ok: true }));
v1.post('/auth/login', limit(5), (q: HttpRequest, s: HttpResponse) => {
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(q.body.email || '').toLowerCase());
    if (!u || !bcrypt.compareSync(String(q.body.password || ''), u.password_hash))
        return s.status(401).json({ error: 'INVALID_CREDENTIALS' });
    if (!u.is_active)
        return s.status(403).json({ error: 'INACTIVE' });
    s.json(services.security.login(u));
});
v1.get('/auth/me', auth(), (q: HttpRequest, s: HttpResponse) => s.json(q.user));
v1.get('/public/calculator/countries', (q: HttpRequest, s: HttpResponse) => s.json(catalog.countries()));
v1.post('/public/inquiries', limit(10), (q: HttpRequest, s: HttpResponse) => {
    const b = q.body, e = String(b.email || '').trim().toLowerCase();
    let personal;try{personal=personDetails(b);b.full_name=personName(b);}catch(e:any){return s.status(400).json({error:e.message});}
    if (typeof b.full_name !== 'string' || typeof b.email !== 'string' || !b.full_name.trim() || !/^\S+@\S+\.\S+$/.test(e) || !catalog.countries().includes(b.country_of_interest) || !TYPES.includes(b.application_type) || (b.phone != null && typeof b.phone !== 'string') || (b.message != null && typeof b.message !== 'string'))
        return s.status(400).json({ error: 'VALIDATION_ERROR' });
    let profile = null;
    if ('profile' in b) {
        try {
            profile = profiles.validate(b);
        }
        catch (e: any) {
            return s.status(400).json({ error: e.message });
        }
    }
    const result = db.transaction(() => {
        if (profile) {
            const prior = db.prepare('SELECT a.request_hash,l.reference_no FROM applicant_profiles a JOIN leads l ON l.id=a.lead_id WHERE a.submission_key=?').get(profile.submissionKey);
            if (prior)
                return prior.request_hash === profile.requestHash ? { reference_no: prior.reference_no } : { conflict: true };
        }
        const n = db.prepare('SELECT COALESCE(MAX(id),0) n FROM leads').get().n + 1, ref = `LEAD-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
        const cr = db.prepare("SELECT id FROM users WHERE role IN ('staff','agent','approver','admin') AND is_active=1 ORDER BY CASE WHEN role IN ('staff','agent') THEN 0 WHEN role='approver' THEN 1 ELSE 2 END,id LIMIT 1").get();
        const r = db.prepare('INSERT INTO leads(reference_no,full_name,email,phone,country_of_interest,application_type,origin_country,message,assigned_to) VALUES(?,?,?,?,?,?,?,?,?)').run(ref, b.full_name.trim(), e, profile ? profile.profile['Phone Number'] : b.phone || null, b.country_of_interest, b.application_type, profile ? profile.profile.Country : b.origin_country || 'UAE', b.message || null, cr ? cr.id : null);
        const keys=Object.keys(personal);if(keys.length)db.prepare(`UPDATE leads SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`).run(...keys.map(k=>personal[k]),r.lastInsertRowid);
        if (profile)
            db.prepare('INSERT INTO applicant_profiles(lead_id,profile,signature,submission_key,request_hash) VALUES(?,?,?,?,?)').run(r.lastInsertRowid, JSON.stringify(profile.profile), profile.signature, profile.submissionKey, profile.requestHash);
        audit('lead', r.lastInsertRowid, 'CREATE', 'public', null, { reference_no: ref, applicant_profile: !!profile });
        if (cr)
            db.prepare("INSERT INTO tasks(lead_id,title,assignee_id,due_date) VALUES(?,?,?,date('now','+1 day'))").run(r.lastInsertRowid, 'Schedule initial assessment interview', cr.id);
        return { reference_no: ref };
    })();
    if (result.conflict)
        return s.status(409).json({ error: 'SUBMISSION_ALREADY_SAVED_WITH_DIFFERENT_DETAILS' });
    s.status(201).json(result);
});
v1.get('/leads', auth(), (q: HttpRequest, s: HttpResponse) => {
    const { status, assigned_to, search, page = 1 } = q.query, w = [], p = [];
    if (!Number.isSafeInteger(Number(page)) || Number(page) < 1 || Number(page) > 1000000)
        return s.status(400).json({ error: 'INVALID_PAGE' });
    if (q.scope_user) {
        w.push('(l.assigned_to=? OR EXISTS(SELECT 1 FROM tasks t WHERE t.lead_id=l.id AND t.assignee_id=?))');
        p.push(q.scope_user, q.scope_user);
    }
    if (status) {
        w.push('l.status=?');
        p.push(status);
    }
    if (assigned_to) {
        w.push('l.assigned_to=?');
        p.push(assigned_to);
    }
    if (search) {
        w.push('(l.full_name LIKE ? OR l.email LIKE ? OR l.reference_no LIKE ?)');
        p.push(...Array(3).fill(`%${search}%`));
    }
    const W = w.length ? 'WHERE ' + w.join(' AND ') : '', total = db.prepare(`SELECT COUNT(*) c FROM leads l ${W}`).get(...p).c;
    const rows = db.prepare(`SELECT l.*,u.full_name assignee FROM leads l LEFT JOIN users u ON u.id=l.assigned_to ${W} ORDER BY l.id DESC LIMIT 20 OFFSET ?`).all(...p, (Math.max(1, +page) - 1) * 20);
    s.json({ total, page: +page, rows });
});
v1.get('/leads/:id', auth(), (q: HttpRequest, s: HttpResponse) => {
    const l = db.prepare('SELECT l.*,u.full_name assignee FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=?').get(q.params.id);
    if (!l)
        return s.status(404).json({ error: 'NOT_FOUND' });
    s.json({ ...l, tasks: db.prepare('SELECT t.*,u.full_name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE lead_id=? ORDER BY id').all(l.id),
        history: db.prepare("SELECT * FROM audit_log WHERE (entity_type='lead' AND entity_id=?) OR (entity_type='task' AND entity_id IN (SELECT id FROM tasks WHERE lead_id=?)) ORDER BY id DESC").all(l.id, l.id) });
});
v1.patch('/leads/:id', auth(), (q: HttpRequest, s: HttpResponse) => {
    const l = db.prepare('SELECT * FROM leads WHERE id=?').get(q.params.id);
    if (!l)
        return s.status(404).json({ error: 'NOT_FOUND' });
    const b = q.body, ch: Record<string, any> = {}, invalid = () => s.status(400).json({ error: 'VALID_LEAD_DETAILS_REQUIRED' });
    try{Object.assign(ch,personDetails(b));}catch(e:any){return s.status(400).json({error:e.message});}
    if ('status' in b)
        return s.status(400).json({ error: 'USE_WORKFLOW_ACTIONS' });
    for (const [key, max] of ([['full_name', 200], ['email', 254], ['phone', 100], ['origin_country', 200]] as [string,number][]))
        if (key in b) {
            if (typeof b[key] !== 'string' || b[key].length > max || (['full_name', 'email'].includes(key) && !b[key].trim()))
                return invalid();
            ch[key] = b[key].trim();
            if (key === 'email') {
                if (!/^\S+@\S+\.\S+$/.test(ch[key]))
                    return invalid();
                ch[key] = ch[key].toLowerCase();
            }
        }
    if(['first_name','middle_name','last_name'].some(k=>k in b)){const combined={...l,...ch};const name=personName(combined);if(name.length>200)return invalid();if(name)ch.full_name=name;}
    if ('country_of_interest' in b) {
        if (!Object.values<any>(operations.pricing().data).some((c: any) => c.label === b.country_of_interest))
            return invalid();
        ch.country_of_interest = b.country_of_interest;
    }
    if ('application_type' in b) {
        if (!TYPES.includes(b.application_type))
            return invalid();
        ch.application_type = b.application_type;
    }
    const pathwayChanged = ['country_of_interest', 'application_type'].some(k => k in ch && ch[k] !== l[k]);
    if (pathwayChanged && (!['INQUIRY', 'ASSESSMENT'].includes(l.status) || l.assessment_approved || db.prepare('SELECT lead_id FROM applicant_profiles WHERE lead_id=?').get(l.id) || db.prepare('SELECT id FROM proposals WHERE lead_id=?').get(l.id) || db.prepare('SELECT id FROM charges WHERE lead_id=?').get(l.id)))
        return s.status(400).json({ error: 'DESTINATION_AND_SERVICE_LOCKED_AFTER_ASSESSMENT_OR_SIGNED_RECORDS' });
    if ('notes' in b)
        ch.notes = String(b.notes);
    const k = Object.keys(ch);
    if (!k.length)
        return s.status(400).json({ error: 'NO_CHANGES' });
    db.transaction(() => {
        db.prepare(`UPDATE leads SET ${k.map(x => x + '=?').join(',')} WHERE id=?`).run(...k.map(x => ch[x]), l.id);
        if ('phone' in ch)
            db.prepare('UPDATE leads SET phone_normalized=? WHERE id=?').run(ch.phone.replace(/\D/g, ''), l.id);
        const details = ['full_name', 'email', 'phone', 'origin_country'].filter(key => key in ch);
        if (details.length) {
            const overrides = JSON.parse(l.profile_overrides || '{}');
            for (const key of details)
                overrides[key] = ch[key];
            db.prepare('UPDATE leads SET profile_overrides=? WHERE id=?').run(JSON.stringify(overrides), l.id);
        }
        audit('lead', l.id, 'UPDATE', q.user.name, Object.fromEntries(k.map(x => [x, l[x]])), ch);
    })();
    s.json({ ok: true });
});
v1.post('/leads/:id/tasks', auth(), (q: HttpRequest, s: HttpResponse) => {
    if (!db.prepare('SELECT 1 FROM leads WHERE id=?').get(q.params.id))
        return s.status(404).json({ error: 'NOT_FOUND' });
    const body = q.body, status = body.status || 'PENDING', assignee = body.assignee_id || q.user.id;
    if (typeof body.title !== 'string' || !body.title.trim() || !['PENDING', 'IN_PROGRESS', 'DONE'].includes(status) || (body.due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_date) || isNaN(Date.parse(body.due_date)) || new Date(body.due_date).toISOString().slice(0, 10) !== body.due_date)) || !db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND role IN ('staff','agent','approver','admin')").get(assignee))
        return s.status(400).json({ error: 'VALIDATION_ERROR' });
    const r = db.prepare('INSERT INTO tasks(lead_id,title,assignee_id,due_date,status) VALUES(?,?,?,?,?)').run(q.params.id, body.title.trim(), assignee, body.due_date || null, status);
    audit('task', r.lastInsertRowid, 'CREATE', q.user.name, null, { title: q.body.title });
    s.status(201).json({ id: r.lastInsertRowid });
});
v1.patch('/tasks/:id', auth(), (q: HttpRequest, s: HttpResponse) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(q.params.id);
    if (!t)
        return s.status(404).json({ error: 'NOT_FOUND' });
    const ch: Record<string, any> = {};
    for (const k of ['title', 'due_date', 'status', 'assignee_id', 'category', 'scheduled_at'])
        if (k in q.body)
            ch[k] = q.body[k];
    if (('title' in ch && (typeof ch.title !== 'string' || !ch.title.trim())) || ('due_date' in ch && ch.due_date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(ch.due_date) || isNaN(Date.parse(ch.due_date)))) || ('assignee_id' in ch && !db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND role IN ('staff','agent','approver','admin')").get(ch.assignee_id)))
        return s.status(400).json({ error: 'VALIDATION_ERROR' });
    if ('status' in ch && !['PENDING', 'IN_PROGRESS', 'DONE'].includes(ch.status))
        return s.status(400).json({ error: 'VALIDATION_ERROR' });
    const category = ch.category || t.category, when = ('scheduled_at' in ch) ? ch.scheduled_at : t.scheduled_at;
    if (!['TASK', 'INTERVIEW', 'FOLLOW_UP', 'APPOINTMENT'].includes(category) || (when && isNaN(Date.parse(when))) || (['INTERVIEW', 'APPOINTMENT'].includes(category) && !when))
        return s.status(400).json({ error: 'INVALID_SCHEDULE' });
    if ('scheduled_at' in ch)
        ch.scheduled_at = ch.scheduled_at ? new Date(ch.scheduled_at).toISOString() : null;
    const k = Object.keys(ch);
    if (!k.length)
        return s.status(400).json({ error: 'NO_CHANGES' });
    db.transaction(() => { db.prepare(`UPDATE tasks SET ${k.map(x => x + '=?').join(',')} WHERE id=?`).run(...k.map(x => ch[x]), t.id); if (t.case_event_id)
        db.prepare('UPDATE case_events SET title=?,due_date=?,occurs_at=?,status=? WHERE id=?').run(ch.title || t.title, ('due_date' in ch) ? ch.due_date : t.due_date, when || null, (ch.status || t.status) === 'DONE' ? 'DONE' : 'OPEN', t.case_event_id); audit('task', t.id, 'UPDATE', q.user.name, Object.fromEntries(k.map(x => [x, t[x]])), ch); })();
    s.json({ ok: true });
});
v1.get('/audit/:entity/:id', auth(), (q: HttpRequest, s: HttpResponse) => s.json(db.prepare('SELECT * FROM audit_log WHERE entity_type=? AND entity_id=? ORDER BY id').all(q.params.entity, q.params.id)));
operations = (require('./workflow') as typeof import('./workflow'))(v1, db, auth, audit, profiles);
access = (require('./access-control') as typeof import('./access-control'))(db, SECRET, audit);
operations.setAccess(access);
access.register(v1);
services = (require('./release-services') as typeof import('./release-services'))(db, operations, access, audit, SECRET);
services.register(v1, auth, limit);
growth = (require('./growth-tools') as typeof import('./growth-tools'))(db, operations, access, audit);
growth.register(v1, auth);
business = (require('./business-tools') as typeof import('./business-tools'))(db, operations, access, audit);
business.register(v1, auth);
catalog = (require('./destination-catalog') as typeof import('./destination-catalog'))(db, operations, audit);
catalog.register(v1, auth);
(require('./document-tools') as typeof import('./document-tools'))(db, operations, audit).register(v1, auth);
advanced = (require('./advanced-workflows') as typeof import('./advanced-workflows'))(db, operations, access, audit);
advanced.register(v1, auth);
(require('./commission-ledger') as typeof import('./commission-ledger'))(db, audit).register(v1, auth);
(require('./qualification-tools') as typeof import('./qualification-tools'))(db, operations, audit).register(v1, auth);
(require('./case-reconciliation') as typeof import('./case-reconciliation'))(db, operations, access, audit, services.backup).register(v1, auth);
(require('./privacy-lifecycle') as typeof import('./privacy-lifecycle'))(db, operations, audit, services.backup).register(v1, auth);
const localization = (require('./localization-service') as typeof import('./localization-service'))(db, operations, audit);
localization.register(v1, auth);
operations.setNotificationTranslator(localization.translateNotification);
integrations = (require('./integration-hub') as typeof import('./integration-hub'))(db, operations, access, audit, services.record);
integrations.register(v1, auth);
app.use('/v1', v1);
for (const [path, target] of Object.entries<any>({ admin: 'admin', agent: 'agent', client: 'client-login', clients: 'clients', portals: 'portals' }))
    app.get('/' + path, (q: HttpRequest, s: HttpResponse) => s.redirect('/#/' + target));
app.use(express.static('public'));
app.use((err: any, q: HttpRequest, s: HttpResponse, next: HttpNext) => { services.record('UNHANDLED_REQUEST_ERROR', q); s.status(err.status || 500).json({ error: err.status === 413 ? 'FILE_TOO_LARGE' : 'REQUEST_FAILED' }); });
const service = { app, db, operations, access, services, growth, advanced, integrations };
if (require.main === module) {
    (require('./production-config') as typeof import('./production-config')).assert(db);
    if (process.env.NODE_ENV === 'production' && !db.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1").get())
        throw Error('BOOTSTRAP_ADMIN_REQUIRED');
    app.listen(PORT, () => { operations.start(); services.start(); const integrationTimer = setInterval(() => integrations.process().catch(() => services.record('INTEGRATION_WORKER_FAILED')), 5000); integrationTimer.unref(); const automationTimer = setInterval(() => { try {
        growth.runRules();
        advanced.tick();
    }
    catch {
        services.record('AUTOMATION_FAILED');
    } }, 60000); automationTimer.unref(); console.log(`ECC CRM → http://localhost:${PORT}`); });
}
export = service;

import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
const crypto = require('node:crypto') as typeof import('node:crypto');
const levels = { ADMIN: ['*'], MANAGER: ['leads.team', 'leads.assign', 'tasks.team', 'documents.review', 'proposals.prepare', 'proposals.approve', 'finance.manage', 'cases.manage', 'reports.team', 'clients.invite'], AGENT: ['leads.assigned', 'tasks.assigned', 'documents.review', 'proposals.prepare', 'cases.manage', 'reports.assigned'], VIEWER: ['leads.assigned.read', 'tasks.assigned.read', 'reports.assigned'], CLIENT: ['client.read', 'client.upload', 'client.message', 'client.corrections', 'client.accept'] };
const roleLevel = (role: any) => (({ admin: 'ADMIN', approver: 'MANAGER', agent: 'AGENT', staff: 'AGENT', client: 'CLIENT' }) as any)[role] || 'VIEWER';
const metrics = ['leads_per_month', 'uploads_per_month', 'messages_per_month', 'storage_mb'];
const service = (db: Database, secret: string, audit: Audit) => {
    const add = (name: any, type: any) => { if (!db.prepare('PRAGMA table_info(users)').all().some((c: any) => c.name === name))
        db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`); };
    add('client_lead_id', 'INTEGER');
    add('permission_level', 'TEXT');
    add('usage_level', "TEXT DEFAULT 'STANDARD'");
    add('usage_limits', "TEXT DEFAULT '{}'");
    db.exec(`CREATE TABLE IF NOT EXISTS usage_levels(name TEXT PRIMARY KEY,limits TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS usage_events(id INTEGER PRIMARY KEY,user_id INTEGER,lead_id INTEGER,action TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,period TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS organization_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS usage_actor ON usage_events(user_id,period,action);`);
    db.prepare("INSERT OR IGNORE INTO usage_levels(name,limits) VALUES('STANDARD','{}')").run();
    db.exec('CREATE TABLE IF NOT EXISTS client_applications(user_id INTEGER NOT NULL,lead_id INTEGER UNIQUE NOT NULL,linked_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,lead_id))');
    db.prepare("INSERT OR IGNORE INTO client_applications(user_id,lead_id) SELECT id,client_lead_id FROM users WHERE role='client' AND client_lead_id IS NOT NULL").run();
    const applicationIds = (u: any) => u?.role === 'client' ? db.prepare('SELECT lead_id FROM client_applications WHERE user_id=? ORDER BY lead_id DESC').all(u.id).map(r => r.lead_id) : [];
    const clientForLead = (id: any) => db.prepare("SELECT u.* FROM users u JOIN client_applications a ON a.user_id=u.id WHERE a.lead_id=? AND u.role='client' AND u.is_active=1").get(id) || null;
    const resolveClientId = (q: any, u: any) => { const ids = applicationIds({ ...u, role: 'client' }), requested = q.headers['x-application-id']; if (requested !== undefined)
        return /^[1-9]\d*$/.test(String(requested)) && ids.includes(Number(requested)) ? Number(requested) : null; return ids.find(id => db.prepare("SELECT id FROM leads WHERE id=? AND status IN ('CLIENT','PROPOSAL')").get(id)) || null; };
    const effective = (u: any) => u.role === 'client' ? 'CLIENT' : u.role === 'admin' ? 'ADMIN' : u.permission_level || roleLevel(u.role);
    const publicUser = (u: any) => ({ id: u.id, full_name: u.full_name, name: u.full_name, email: u.email, role: (({ ADMIN: 'admin', MANAGER: 'approver', AGENT: 'staff', VIEWER: 'viewer', CLIENT: 'client' }) as any)[effective(u)], account_role: u.role, permission_level: effective(u), capabilities: (levels as any)[effective(u)] || [], portal_role: u.role === 'client' ? 'client' : effective(u) === 'ADMIN' ? 'admin' : 'agent', usage_level: u.usage_level || 'STANDARD', client_lead_id: u.client_lead_id || null, client_application_ids: applicationIds(u) });
    const session = (q: any) => { const header = q.headers.authorization; if (typeof header !== 'string' || !header.startsWith('Bearer '))
        throw Error('UNAUTHORIZED'); const claims = jwt.verify(header.slice(7), secret); if(typeof claims==='string')throw Error('UNAUTHORIZED');const u = db.prepare('SELECT * FROM users WHERE id=?').get(claims.id); if (claims.purpose || !u || !u.is_active || (u.role === 'client' && !u.email_verified_at) || (claims.v || 0) !== (u.token_version || 0))
        throw Error('UNAUTHORIZED'); return publicUser(u); };
    const auth = (...roles: any[]) => (q: HttpRequest, s: HttpResponse, next: HttpNext) => { try {
        q.user = q.user || session(q);
    }
    catch {
        return s.status(401).json({ error: 'UNAUTHORIZED' });
    } if (roles.length && !roles.includes(q.user.role))
        return s.status(403).json({ error: 'FORBIDDEN' }); next(); };
    const ownLead = (id: any, u: any) => !!db.prepare('SELECT id FROM leads WHERE id=? AND (assigned_to=? OR EXISTS(SELECT 1 FROM tasks WHERE lead_id=leads.id AND assignee_id=?))').get(id, u.id, u.id);
    function limits(u: any) { const preset = db.prepare('SELECT limits FROM usage_levels WHERE name=?').get(u.usage_level || 'STANDARD'); return { ...JSON.parse(preset?.limits || '{}'), ...JSON.parse(u.usage_limits || '{}') }; }
    function storedBytes(ids: any = null) {
        const scope = ids === null ? '' : ` WHERE lead_id IN (${ids.map(() => '?').join(',') || 'NULL'})`, params = ids || [];
        return db.prepare('SELECT COALESCE(SUM(length(data)),0) n FROM documents' + scope).get(...params).n +
            db.prepare('SELECT COALESCE(SUM(length(signature)),0) n FROM proposal_signatures' + scope).get(...params).n;
    }
    function usage(u: any, leadId: any = null) { const period = new Date().toISOString().slice(0, 7), ids = u?.role === 'client' ? applicationIds(u) : [], slots = ids.map(() => '?').join(',') || 'NULL', where = u ? u.role === 'client' ? `(user_id=? OR (user_id IS NULL AND lead_id IN (${slots})))` : 'user_id=?' : 'user_id IS NULL AND lead_id=?', args = u ? u.role === 'client' ? [u.id, ...ids] : [u.id] : [leadId]; const rows = db.prepare(`SELECT action,SUM(quantity) n FROM usage_events WHERE ${where} AND period=? GROUP BY action`).all(...args, period), counts = Object.fromEntries(rows.map(r => [r.action, r.n])); let storage; if (u?.role === 'client')
        storage = storedBytes(ids);
    else if (!u)
        storage = storedBytes([leadId]);
    else
        storage = db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM usage_events WHERE user_id=? AND action='storage_bytes'").get(u.id).n; return { period, usage_level: u?.usage_level || 'STANDARD', permission_level: u ? effective(u) : 'CLIENT', limits: u ? limits(u) : {}, used: { leads_per_month: counts.leads || 0, uploads_per_month: counts.uploads || 0, messages_per_month: counts.messages || 0, storage_mb: Math.round(storage / 1048576 * 1000) / 1000 }, storage_bytes: storage }; }
    const capacity = () => { const row = db.prepare("SELECT value FROM organization_settings WHERE key='active_user_limit'").get(); const max = row ? JSON.parse(row.value) : null, count = db.prepare('SELECT COUNT(*) n FROM users WHERE is_active=1').get().n; if (max !== null && count >= max)
        throw Error('ACTIVE_USER_LIMIT_REACHED'); };
    function validateAccount(b: any, existing: any = null) { const role = b.role || existing?.role || 'agent', allowed = { admin: ['ADMIN'], approver: ['MANAGER', 'VIEWER'], agent: ['AGENT', 'MANAGER', 'VIEWER'], staff: ['AGENT', 'MANAGER', 'VIEWER'], client: ['CLIENT'] }; if (!(allowed as any)[role])
        throw Error('INVALID_ACCOUNT_ROLE'); const level = b.permission_level || existing?.permission_level || roleLevel(role); if (!(allowed as any)[role].includes(level))
        throw Error('PERMISSION_LEVEL_DOES_NOT_MATCH_ROLE'); const usageLevel = b.usage_level || existing?.usage_level || 'STANDARD'; if (!db.prepare('SELECT name FROM usage_levels WHERE name=?').get(usageLevel))
        throw Error('UNKNOWN_USAGE_LEVEL'); const overrides = b.usage_limits ?? JSON.parse(existing?.usage_limits || '{}'); validateLimits(overrides); return { role, permission_level: level, usage_level: usageLevel, usage_limits: JSON.stringify(overrides) }; }
    function validateLimits(value: any) { if (!value || Array.isArray(value) || typeof value !== 'object' || Object.entries<any>(value).some(([k, v]) => !metrics.includes(k) || (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e9 || (k !== 'storage_mb' && !Number.isInteger(v))))))
        throw Error('INVALID_USAGE_LIMITS'); }
    // Synchronous reservation checks cover requests paused in asynchronous upload processing.
    const pendingUsage = new Set<{user_id:number|null;lead_id:number|null;metric:string;bytes:number;period:string}>();
    const meter: any = (q: HttpRequest, s: HttpResponse, next: HttpNext) => {
        let p;
        try {
            p = decodeURIComponent(q.path).toLowerCase().replace(/\/+$/, '') || '/';
        }
        catch {
            return s.status(400).json({ error: 'INVALID_PATH' });
        }
        const record = p.match(/^\/(?:workflow|leads|tasks)\/([^/]+)(?:\/|$)/);
        if (record && (!/^[1-9]\d*$/.test(record[1]) || !Number.isSafeInteger(Number(record[1]))))
            return s.status(400).json({ error: 'INVALID_RECORD_ID' });
        const publicPath = p === '/health' || p.startsWith('/public/') || ['/auth/login', '/auth/reset-password', '/auth/mfa/login', '/auth/verification/confirm'].includes(p);
        if (publicPath)
            return next();
        if (q.headers.authorization) {
            try {
                q.user = session(q);
            }
            catch {
                return s.status(401).json({ error: 'UNAUTHORIZED' });
            }
        }
        const isPortal = p === '/portal' || p.startsWith('/portal/');
        let actor: any, leadId = null;
        if (isPortal) {
            const token = q.headers['x-portal-token'];
            if (typeof token === 'string' && token.length === 64) {
                const l = db.prepare("SELECT id FROM leads WHERE portal_hash=? AND status IN ('CLIENT','PROPOSAL')").get(crypto.createHash('sha256').update(token).digest('hex'));
                leadId = l?.id || null;
                if (l)
                    actor = clientForLead(l.id);
            }
            else if (q.user?.role === 'client') {
                actor = db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id);
                leadId = resolveClientId(q, actor);
            }
        }
        else {
            if (!q.user)
                return s.status(401).json({ error: 'UNAUTHORIZED' });
            actor = db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id);
            const self = ['/auth/me', '/auth/change-password', '/auth/security', '/auth/mfa/setup', '/auth/mfa/enable', '/auth/mfa/disable', '/auth/verification/request', '/usage/me'].includes(p);
            if (!self && q.user.role === 'client')
                return s.status(403).json({ error: 'CLIENT_PORTAL_ONLY' });
            const level = q.user.permission_level, team = ['ADMIN', 'MANAGER'].includes(level);
            q.scope_user = team ? null : q.user.id;
            const adminPath = p.startsWith('/admin/') || p.startsWith('/pricing/versions') || p.startsWith('/notifications') || (p.startsWith('/agreements/templates') && q.method !== 'GET');
            if (adminPath && level !== 'ADMIN')
                return s.status(403).json({ error: 'ADMIN_PERMISSION_REQUIRED' });
            if (!self && level === 'VIEWER' && !['GET', 'HEAD'].includes(q.method))
                return s.status(403).json({ error: 'READ_ONLY_ACCOUNT' });
            let match = p.match(/^\/(?:workflow|leads)\/(\d+)(?:\/|$)/);
            if (match)
                leadId = Number(match[1]);
            else if (/^\/tasks\/\d+$/.test(p)) {
                const task = db.prepare('SELECT lead_id,assignee_id FROM tasks WHERE id=?').get(p.split('/')[2]);
                if (task && !team && !['GET', 'HEAD'].includes(q.method) && task.assignee_id !== q.user.id)
                    return s.status(403).json({ error: 'TASK_ASSIGNEE_ONLY' });
                leadId = task?.lead_id || null;
            }
            else if (p === '/tasks' && q.method === 'POST')
                leadId = Number(q.body.lead_id);
            if (leadId && !team && !ownLead(leadId, q.user))
                return s.status(403).json({ error: 'ASSIGNED_RECORDS_ONLY' });
            if (!team && q.body?.assignee_id && Number(q.body.assignee_id) !== q.user.id && ['POST', 'PATCH'].includes(q.method) && (p.startsWith('/tasks') || /^\/leads\/\d+\/tasks$/.test(p)))
                return s.status(403).json({ error: 'TASK_ASSIGNMENT_PERMISSION_REQUIRED' });
            if (p.startsWith('/audit/')) {
                const [, , type, id] = p.split('/');
                if (!['lead', 'task'].includes(type) && level !== 'ADMIN')
                    return s.status(403).json({ error: 'FORBIDDEN' });
                const target = type === 'lead' ? Number(id) : type === 'task' ? db.prepare('SELECT lead_id FROM tasks WHERE id=?').get(id)?.lead_id : null;
                if (target && !team && !ownLead(target, q.user))
                    return s.status(403).json({ error: 'ASSIGNED_RECORDS_ONLY' });
            }
        }
        let metric = null, bytes = 0;
        if (q.method === 'POST') {
            if ((/^\/workflow\/\d+\/documents$/.test(p) || p === '/portal/documents') && typeof q.body.data === 'string') {
                metric = 'uploads';
                bytes = Buffer.byteLength(q.body.data, 'base64');
            }
            if (/^\/workflow\/\d+\/messages$/.test(p) || p === '/portal/messages')
                metric = 'messages';
            if (/^\/portal\/proposals\/\d+\/sign$/.test(p) && typeof q.body.signature_data === 'string') {
                metric = 'uploads';
                bytes = Buffer.byteLength(q.body.signature_data.split(',')[1] || '', 'base64');
            }
            if (p === '/leads')
                metric = 'leads';
        }
        if (metric && (actor || leadId)) {
            const summary = usage(actor, leadId), key = metric + '_per_month', limit = summary.limits[key];
            const clientIds = actor?.role === 'client' ? applicationIds(actor) : [];
            const related: any = (r: any) => actor ? actor.role === 'client' ? (r.user_id === actor.id || (r.user_id === null && clientIds.includes(r.lead_id))) : r.user_id === actor.id : r.user_id === null && r.lead_id === leadId;
            const pending = [...pendingUsage].filter(related), reservedCount = pending.filter(r => r.period === summary.period && r.metric === metric).length, reservedBytes = pending.reduce((n, r) => n + r.bytes, 0);
            if (limit !== undefined && limit !== null && (summary.used as any)[key] + reservedCount >= limit)
                return s.status(429).json({ error: 'USAGE_LIMIT_REACHED', metric: key, limit });
            const storageLimit = summary.limits.storage_mb;
            if (bytes && storageLimit !== undefined && storageLimit !== null && summary.storage_bytes + reservedBytes + bytes > storageLimit * 1048576)
                return s.status(429).json({ error: 'STORAGE_LIMIT_REACHED', limit_mb: storageLimit });
            const reservation = { user_id: actor?.id || null, lead_id: leadId, metric, bytes, period: summary.period };
            pendingUsage.add(reservation);
            const end = s.end;
            let settled = false;
            s.end = function (chunk?: any, ...args: any[]) {
                if (!settled) {
                    settled = true;
                    try {
                        if (s.statusCode >= 200 && s.statusCode < 300) {
                            let actualLead = leadId;
                            if (metric === 'leads' && chunk) {
                                try {
                                    actualLead = JSON.parse(String(chunk)).id || null;
                                }
                                catch { }
                            }
                            db.transaction(() => {
                                db.prepare('INSERT INTO usage_events(user_id,lead_id,action,quantity,period) VALUES(?,?,?,?,?)').run(actor?.id || null, actualLead, metric, 1, summary.period);
                                if (bytes)
                                    db.prepare('INSERT INTO usage_events(user_id,lead_id,action,quantity,period) VALUES(?,?,?,?,?)').run(actor?.id || null, actualLead, 'storage_bytes', bytes, summary.period);
                            })();
                        }
                    }
                    finally {
                        pendingUsage.delete(reservation);
                    }
                }
                return (end as any).call(this, chunk, ...args);
            };
        }
        next();
    };
    function register(v1: Router) {
        v1.get('/access/levels', auth(), (q: HttpRequest, s: HttpResponse) => s.json({ permissions: levels, roles: { admin: ['ADMIN'], approver: ['MANAGER', 'VIEWER'], agent: ['AGENT', 'MANAGER', 'VIEWER'], staff: ['AGENT', 'MANAGER', 'VIEWER'], client: ['CLIENT'] }, usage_levels: db.prepare('SELECT * FROM usage_levels ORDER BY name').all().map(l => ({ name: l.name, limits: JSON.parse(l.limits) })) }));
        v1.get('/usage/me', auth(), (q: HttpRequest, s: HttpResponse) => s.json(usage(db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id))));
        v1.get('/admin/usage', auth('admin'), (q: HttpRequest, s: HttpResponse) => { const row = db.prepare("SELECT value FROM organization_settings WHERE key='active_user_limit'").get(); s.json({ active_user_limit: row ? JSON.parse(row.value) : null, active_users: db.prepare('SELECT COUNT(*) n FROM users WHERE is_active=1').get().n, storage_bytes: storedBytes(), users: db.prepare('SELECT * FROM users ORDER BY full_name').all().map(u => ({ ...publicUser(u), is_active: u.is_active, usage: usage(u) })), usage_levels: db.prepare('SELECT * FROM usage_levels ORDER BY name').all().map(l => ({ name: l.name, limits: JSON.parse(l.limits) })) }); });
        v1.post('/admin/usage-levels', auth('admin'), (q: HttpRequest, s: HttpResponse) => { try {
            if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(q.body.name || ''))
                throw Error('USAGE_LEVEL_NAME_REQUIRED');
            validateLimits(q.body.limits);
            db.prepare('INSERT INTO usage_levels(name,limits) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET limits=excluded.limits').run(q.body.name, JSON.stringify(q.body.limits));
            audit?.('usage_level', q.body.name, 'UPDATED', q.user.name, null, { limits: q.body.limits });
            s.json({ ok: true });
        }
        catch (e: any) {
            s.status(400).json({ error: e.message });
        } });
        v1.post('/admin/organization-limits', auth('admin'), (q: HttpRequest, s: HttpResponse) => { const max = q.body.active_user_limit; if (max !== null && (!Number.isInteger(max) || max < 1))
            return s.status(400).json({ error: 'POSITIVE_USER_LIMIT_OR_NULL_REQUIRED' }); db.prepare("INSERT INTO organization_settings(key,value) VALUES('active_user_limit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(max)); audit?.('organization', 0, 'USER_LIMIT_UPDATED', q.user.name, null, { active_user_limit: max }); s.json({ ok: true }); });
    }
    return { applicationIds, clientForLead, resolveClientId, auth, session, publicUser, middleware: meter, register, validateAccount, capacity, usage, levels };
};
export = service;

import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const crypto = require('node:crypto') as typeof import('node:crypto'), bcrypt = require('bcryptjs') as typeof import('bcryptjs');
const service = (v1: Router, c: any) => {
    const { db, finance, guard, lead, portal, fail, queue, log, getAccess } = c;
    v1.get('/portal/applications', portal, (q: HttpRequest, s: HttpResponse) => { if (!q.user || q.user.role !== 'client')
        return s.json([{ id: q.client.id, reference_no: q.client.reference_no, full_name: q.client.full_name, country_of_interest: q.client.country_of_interest, application_type: q.client.application_type, status: q.client.status }]); s.json(db.prepare('SELECT l.id,l.reference_no,l.full_name,l.country_of_interest,l.application_type,l.status FROM leads l JOIN client_applications a ON a.lead_id=l.id WHERE a.user_id=? ORDER BY l.id DESC').all(q.user.id)); });
    v1.post('/workflow/:id/client-account', finance, guard((q: HttpRequest, s: HttpResponse) => {
        const l = lead(q.params.id);
        if (!l || !['CLIENT', 'PROPOSAL'].includes(l.status))
            return fail(s, 'PROPOSAL_OR_CLIENT_REQUIRED');
        if (db.prepare('SELECT user_id FROM client_applications WHERE lead_id=?').get(l.id))
            return fail(s, 'APPLICATION_ALREADY_LINKED');
        const existing = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(l.email), root = String(process.env.PUBLIC_BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');
        if (existing) {
            if (existing.role !== 'client' || !existing.is_active)
                return fail(s, 'EMAIL_BELONGS_TO_ANOTHER_OR_INACTIVE_ACCOUNT');
            if (q.body.confirm_existing !== true)
                return s.status(409).json({ error: 'CONFIRM_LINK_EXISTING_CLIENT', email: existing.email });
            db.transaction(() => { db.prepare('INSERT INTO client_applications(user_id,lead_id) VALUES(?,?)').run(existing.id, l.id); queue(l.id, l.email, 'Another application added to your ECC portal', `Your application ${l.reference_no} is available at ${root}/#/client?application=${l.id}. Sign in with your existing account.`); log(q, l.id, 'CLIENT_ACCOUNT_LINKED', { user_id: existing.id }); })();
            return s.status(201).json({ id: existing.id, linked: true });
        }
        const token = crypto.randomBytes(32).toString('hex'), id = db.transaction(() => { getAccess().capacity(); const id = db.prepare("INSERT INTO users(email,full_name,role,password_hash,client_lead_id,permission_level,usage_level) VALUES(?,?,'client',?,?,'CLIENT','STANDARD')").run(l.email, l.full_name, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12), l.id).lastInsertRowid; db.prepare('INSERT INTO client_applications(user_id,lead_id) VALUES(?,?)').run(id, l.id); db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at,purpose,recipient) VALUES(?,?,datetime('now','+1 hour'),'ACTIVATION',?)").run(id, crypto.createHash('sha256').update(token).digest('hex'), l.email); queue(l.id, l.email, 'Activate your ECC client account', `Set your password within one hour:\n${root}/#/reset/${token}\nThen sign in at ${root}/#/client-login`); log(q, l.id, 'CLIENT_ACCOUNT_CREATED', { user_id: id }); return id; })();
        s.status(201).json({ id, activation_path: '/#/reset/' + token });
    }));
};
export = service;

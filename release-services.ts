import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const crypto = require('node:crypto') as typeof import('node:crypto');
const service = (db: Database, ops: Services, access: Services, audit: Audit, secret: string) => {
    db.exec('CREATE TABLE IF NOT EXISTS system_errors(id INTEGER PRIMARY KEY,request_id TEXT,code TEXT NOT NULL,route TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    const record = (code: any, q: any = null) => { try {
        db.prepare('INSERT INTO system_errors(request_id,code,route) VALUES(?,?,?)').run(q?.request_id || null, String(code).slice(0, 100), q?.route?.path || null);
        db.prepare('DELETE FROM system_errors WHERE id NOT IN (SELECT id FROM system_errors ORDER BY id DESC LIMIT 1000)').run();
        console.error(JSON.stringify({ event: 'ecc_error', code, request_id: q?.request_id || null }));
    }
    catch {
        console.error(JSON.stringify({ event: 'ecc_error', code: 'MONITOR_STORAGE_UNAVAILABLE' }));
    } };
    const backup = (require('./backup-service') as typeof import('./backup-service'))(db, record), security = (require('./auth-security') as typeof import('./auth-security'))(db, secret, access, ops, audit), signing = (require('./agreement-signing') as typeof import('./agreement-signing'))(db, ops, audit), payments = (require('./online-payments') as typeof import('./online-payments'))(db, ops, audit, record), requirements = (require('./requirement-catalog') as typeof import('./requirement-catalog'))(db, ops, audit);
    const extra = ops.extras;
    ops.extras = (id: any, client = false) => ({ ...extra(id, client), charges: ops.finances(id) });
    function observe(q: HttpRequest, s: HttpResponse, next: HttpNext) { q.request_id = crypto.randomUUID(); s.set('X-Request-Id', q.request_id); s.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); if (process.env.NODE_ENV === 'production')
        s.set('Strict-Transport-Security', 'max-age=31536000'); if (q.path?.startsWith('/v1/'))
        s.set('Cache-Control', 'no-store'); next(); }
    function register(v1: Router, auth: Auth, limit: any) {
        security.register(v1, auth, limit);
        signing.register(v1, auth);
        payments.register(v1, auth);
        requirements.register(v1, auth);
        v1.get('/admin/system', auth('admin'), async (q: HttpRequest, s: HttpResponse) => { try {
            s.json({ production: process.env.NODE_ENV === 'production', configuration_issues: (require('./production-config') as typeof import('./production-config')).issues(db), backups: { ...backup.status(), files: await backup.list() }, email_configured: !!process.env.EMAIL_PROVIDER && !!process.env.EMAIL_FROM, payments_configured: payments.configured(), failed_emails: db.prepare("SELECT COUNT(*) n FROM email_outbox WHERE status='FAILED'").get().n, errors: db.prepare('SELECT * FROM system_errors ORDER BY id DESC LIMIT 100').all(), approved_agreements: db.prepare("SELECT COUNT(*) n FROM agreement_templates WHERE status='APPROVED'").get().n });
        }
        catch (e: any) {
            record('SYSTEM_STATUS_FAILED', q);
            s.status(500).json({ error: 'SYSTEM_STATUS_FAILED' });
        } });
        v1.post('/admin/system/backups', auth('admin'), async (q: HttpRequest, s: HttpResponse) => { try {
            s.status(201).json(await backup.create());
        }
        catch (e: any) {
            s.status(400).json({ error: e.message });
        } });
        v1.post('/admin/system/backups/verify', auth('admin'), async (q: HttpRequest, s: HttpResponse) => { try {
            s.json(await backup.exercise(q.body.name));
        }
        catch (e: any) {
            record('RESTORE_VERIFICATION_FAILED', q);
            s.status(400).json({ error: e.message });
        } });
        v1.post('/admin/system/email-test', auth('admin'), (q: HttpRequest, s: HttpResponse) => { if (!/^\S+@\S+\.\S+$/.test(q.body.recipient || ''))
            return s.status(400).json({ error: 'RECIPIENT_REQUIRED' }); ops.queue(null, q.body.recipient, 'ECC delivery verification', 'This is an ECC email delivery check. Confirm receipt in your inbox before marking live delivery tested.'); s.status(201).json({ queued: true, live_receipt_confirmed: false }); });
    }
    return { register, observe, record, backup, security, payments, start: () => backup.start() };
};
export = service;

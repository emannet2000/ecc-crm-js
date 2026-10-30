import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const { text } = (require('./operations') as typeof import('./operations')).validation;
const UI_STRINGS = ['ECC CRM', 'Dashboard', 'Leads', 'Clients', 'Convert lead to client', 'Task calendar', 'Reports', 'Business tools', 'Agreements', 'My account', 'User accounts', 'Permissions & usage', 'Pricing', 'Email', 'Operations', 'Country requirements', 'Import & automation', 'Client portal', 'Logout', 'Sign out', 'Staff / agent sign in', 'Client sign in', 'Sign in', 'Email', 'Password', 'Save', 'Cancel', 'Edit', 'Name', 'Status', 'Applicant', 'Staff', 'Country', 'Deadline', 'Start', 'End', 'Preview import', 'Import leads', 'Workflow rules', 'Appointments', 'Book an appointment', 'Book appointment', 'Book / manage appointments', 'Your appointments', 'Back to application', 'Recruitment & admissions', 'Shared inbox', 'Report builder', 'Points assessments', 'Document processing', 'Privacy review', 'Accounting', 'Translated templates', 'Destinations & pathways', 'Full name', 'Full legal name', 'Phone', 'Reference', 'Offer', 'Applications and offers', 'Partners', 'Opportunities', 'Publish slot', 'Publish availability', 'View bookings', 'Add partner', 'Add opportunity', 'Run report', 'Record review', 'Accept proposal', 'Request changes', 'Upload document', 'Download', 'Open conversation', 'Due', 'Scheduled', 'Progress', 'Tasks', 'Notes', 'History', 'Save Notes', 'Language', 'Advanced workflows', 'Case reconciliation', 'Commission ledger', 'Privacy lifecycle', 'Language administration', 'Integrations', 'Weighted forecast', 'Report schedules', 'Qualification matching', 'Document field review'];
// Include static form labels and headings already used by the application, without
// collecting customer-entered content into the public translation catalog.
for (const name of ['index.html', 'application.html', 'workspace.js', 'workflow.js', 'business.js', 'growth.js', 'advanced.js', 'release.js']) {
    const source = (require('node:fs') as typeof import('node:fs')).readFileSync((require('node:path') as typeof import('node:path')).join(__dirname, '../public', name), 'utf8');
    for (const match of source.matchAll(/(?:field|optionalField|selectField|area)\('([^']+)'/g))
        if (!match[1].includes('${') && !UI_STRINGS.includes(match[1]))
            UI_STRINGS.push(match[1]);
    for (const match of source.matchAll(/<(?:h[1-6]|button|summary|legend|th|label|p)\b[^>]*>([^<>{}$]+)<\//g)) {
        const value = match[1].trim();
        if (value && value.length <= 1000 && !UI_STRINGS.includes(value))
            UI_STRINGS.push(value);
    }
}
const service = (db: Database, ops: Services, audit: Audit) => {
    db.exec(`CREATE TABLE IF NOT EXISTS interface_locales(locale TEXT PRIMARY KEY,name TEXT NOT NULL,direction TEXT NOT NULL DEFAULT 'ltr',dictionary TEXT NOT NULL,approved_by INTEGER NOT NULL,approved_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS lead_locales(lead_id INTEGER PRIMARY KEY,locale TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_templates(subject_key TEXT NOT NULL,locale TEXT NOT NULL,template_id INTEGER NOT NULL,PRIMARY KEY(subject_key,locale));`);
    const safe = (fn: any) => (q: HttpRequest, s: HttpResponse) => { try {
        fn(q, s);
    }
    catch (e: any) {
        s.status(400).json({ error: e.message });
    } };
    const locales = () => [{ locale: 'en', name: 'English', direction: 'ltr' }, ...db.prepare('SELECT locale,name,direction FROM interface_locales ORDER BY name').all()];
    const allowed = (locale: any) => locales().some(l => l.locale === locale);
    function translateNotification(id: any, subject: any, body: any) { const locale = db.prepare('SELECT locale FROM lead_locales WHERE lead_id=?').get(id)?.locale; if (!locale || locale === 'en')
        return { subject, body }; const t = db.prepare('SELECT t.* FROM notification_templates n JOIN localized_templates t ON t.id=n.template_id WHERE n.subject_key=? AND n.locale=? AND t.locale=n.locale').get(subject, locale); if (!t)
        return { subject, body }; const l = db.prepare('SELECT full_name,reference_no FROM leads WHERE id=?').get(id); const render = (value: any) => value.replaceAll('{{name}}', l.full_name).replaceAll('{{reference}}', l.reference_no).replaceAll('{{body}}', body); return { subject: render(t.subject), body: render(t.body) }; }
    function register(v1: Router, auth: Auth) {
        const admin = auth('admin');
        v1.get('/public/locales', (q: HttpRequest, s: HttpResponse) => s.json(locales()));
        v1.get('/public/locales/:locale', (q: HttpRequest, s: HttpResponse) => { if (q.params.locale === 'en')
            return s.json({ locale: 'en', name: 'English', direction: 'ltr', dictionary: {} }); const l = db.prepare('SELECT locale,name,direction,dictionary FROM interface_locales WHERE locale=?').get(q.params.locale); if (!l)
            return s.status(404).json({ error: 'LOCALE_NOT_FOUND' }); s.json({ ...l, dictionary: JSON.parse(l.dictionary) }); });
        v1.get('/admin/languages', admin, (q: HttpRequest, s: HttpResponse) => s.json({ locales: locales(), strings: UI_STRINGS, notification_mappings: db.prepare('SELECT n.*,t.name FROM notification_templates n JOIN localized_templates t ON t.id=n.template_id').all() }));
        v1.post('/admin/languages', admin, safe((q: HttpRequest, s: HttpResponse) => { const b = q.body; if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(b.locale || '') || b.locale === 'en' || !text(b.name, 100) || !['ltr', 'rtl'].includes(b.direction) || b.approve !== true || !b.dictionary || Array.isArray(b.dictionary) || typeof b.dictionary !== 'object' || !Object.keys(b.dictionary).length || Object.entries<any>(b.dictionary).some(([k, v]) => !UI_STRINGS.includes(k) || !text(v, 1000)))
            throw Error('APPROVED_LANGUAGE_AND_ALLOWED_TRANSLATION_KEYS_REQUIRED'); db.prepare('INSERT INTO interface_locales(locale,name,direction,dictionary,approved_by) VALUES(?,?,?,?,?) ON CONFLICT(locale) DO UPDATE SET name=excluded.name,direction=excluded.direction,dictionary=excluded.dictionary,approved_by=excluded.approved_by,approved_at=CURRENT_TIMESTAMP').run(b.locale, b.name, b.direction, JSON.stringify(b.dictionary), q.user.id); audit('interface_locale', 0, 'APPROVED', q.user.name, null, { locale: b.locale, keys: Object.keys(b.dictionary) }); s.status(201).json({ ok: true }); }));
        function preference(q: HttpRequest, s: HttpResponse, id: any) { if (!allowed(q.body.locale))
            throw Error('APPROVED_LOCALE_REQUIRED'); db.prepare('INSERT INTO lead_locales(lead_id,locale) VALUES(?,?) ON CONFLICT(lead_id) DO UPDATE SET locale=excluded.locale').run(id, q.body.locale); audit('lead', Number(id), 'LANGUAGE_SELECTED', q.user?.name || 'client', null, { locale: q.body.locale }); s.json({ ok: true }); }
        v1.get('/portal/language', ops.portal, (q: HttpRequest, s: HttpResponse) => s.json({ locale: db.prepare('SELECT locale FROM lead_locales WHERE lead_id=?').get(q.client.id)?.locale || 'en' }));
        v1.post('/portal/language', ops.portal, safe((q: HttpRequest, s: HttpResponse) => preference(q, s, q.client.id)));
        v1.get('/workflow/:id/language', auth(), (q: HttpRequest, s: HttpResponse) => s.json({ locale: db.prepare('SELECT locale FROM lead_locales WHERE lead_id=?').get(q.params.id)?.locale || 'en' }));
        v1.post('/workflow/:id/language', auth(), safe((q: HttpRequest, s: HttpResponse) => preference(q, s, q.params.id)));
        v1.post('/admin/notification-templates', admin, safe((q: HttpRequest, s: HttpResponse) => { const b = q.body, t = db.prepare('SELECT * FROM localized_templates WHERE id=? AND locale=?').get(Number(b.template_id), b.locale); if (!allowed(b.locale) || !text(b.subject_key, 300) || !t || !t.body.includes('{{body}}'))
            throw Error('APPROVED_LOCALE_TEMPLATE_AND_BODY_PLACEHOLDER_REQUIRED'); db.prepare('INSERT INTO notification_templates(subject_key,locale,template_id) VALUES(?,?,?) ON CONFLICT(subject_key,locale) DO UPDATE SET template_id=excluded.template_id').run(b.subject_key, b.locale, t.id); audit('notification_template', t.id, 'MAPPED', q.user.name, null, b); s.json({ ok: true }); }));
    }
    return { register, translateNotification };
};
service.UI_STRINGS = UI_STRINGS;
export = service;

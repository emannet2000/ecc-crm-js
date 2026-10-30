import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const { mkdtemp, writeFile, rm } = require('node:fs/promises') as typeof import('node:fs/promises');
const { tmpdir } = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');
const { execFile } = require('node:child_process') as typeof import('node:child_process');
const { promisify } = require('node:util') as typeof import('node:util');
const run = promisify(execFile), crypto = require('node:crypto') as typeof import('node:crypto');
async function temporary(data: any, mime: any, fn: any) { const dir = await mkdtemp(path.join(tmpdir(), 'ecc-document-')); try {
    const file = path.join(dir, 'document' + (mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg'));
    await writeFile(file, data, { mode: 0o600 });
    return await fn(file);
}
finally {
    await rm(dir, { recursive: true, force: true });
} }
async function scan(data: any, mime: any) { const digest = crypto.createHash('sha256').update(data).digest('hex'); if (!process.env.DOCUMENT_SCANNER_COMMAND)
    return { status: 'UNCONFIGURED', sha256: digest }; return temporary(data, mime, async (file: any) => { try {
    await run(process.env.DOCUMENT_SCANNER_COMMAND!, ['--no-summary', '--', file], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return { status: 'CLEAN', sha256: digest };
}
catch (e: any) {
    throw Error(e.code === 1 ? 'DOCUMENT_MALWARE_DETECTED' : 'DOCUMENT_SCANNER_UNAVAILABLE');
} }); }
const service = (db: Database, ops: Services, audit: Audit) => {
    db.exec(`CREATE TABLE IF NOT EXISTS document_safety(document_id INTEGER PRIMARY KEY,sha256 TEXT NOT NULL,status TEXT NOT NULL,checked_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS document_extractions(document_id INTEGER PRIMARY KEY,text TEXT NOT NULL,fields TEXT NOT NULL DEFAULT '{}',review_status TEXT DEFAULT 'PENDING',review_notes TEXT DEFAULT '',reviewed_by INTEGER,extracted_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
    const status = () => ({ scanner_configured: !!process.env.DOCUMENT_SCANNER_COMMAND, ocr_configured: !!process.env.DOCUMENT_OCR_COMMAND, pdf_text_configured: !!process.env.DOCUMENT_PDF_TEXT_COMMAND });
    function register(v1: Router, auth: Auth) {
        v1.get('/admin/document-processing', auth('admin'), (q: HttpRequest, s: HttpResponse) => s.json(status()));
        v1.get('/workflow/:id/documents/:doc/processing', auth(), (q: HttpRequest, s: HttpResponse) => { const d = db.prepare('SELECT id FROM documents WHERE id=? AND lead_id=?').get(q.params.doc, q.params.id); if (!d)
            return s.status(404).json({ error: 'DOCUMENT_NOT_FOUND' }); const extraction = db.prepare('SELECT * FROM document_extractions WHERE document_id=?').get(d.id); s.json({ safety: db.prepare('SELECT * FROM document_safety WHERE document_id=?').get(d.id) || { status: 'NOT_SCANNED' }, extraction: extraction ? { ...extraction, fields: JSON.parse(extraction.fields) } : null }); });
        v1.post('/workflow/:id/documents/:doc/scan', auth(), async (q: HttpRequest, s: HttpResponse) => {
            try {
                const d = db.prepare('SELECT * FROM documents WHERE id=? AND lead_id=?').get(q.params.doc, q.params.id);
                if (!d)
                    return s.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
                if (!process.env.DOCUMENT_SCANNER_COMMAND)
                    return s.status(503).json({ error: 'DOCUMENT_SCANNER_NOT_CONFIGURED' });
                let result;
                try {
                    result = await scan(d.data, d.mime);
                }
                catch (e: any) {
                    db.prepare("INSERT INTO document_safety(document_id,sha256,status) VALUES(?,?,'FAILED') ON CONFLICT(document_id) DO UPDATE SET status='FAILED',checked_at=CURRENT_TIMESTAMP").run(d.id, crypto.createHash('sha256').update(d.data).digest('hex'));
                    db.prepare("UPDATE documents SET status='REJECTED',review_notes=? WHERE id=?").run(e.message, d.id);
                    db.prepare('UPDATE leads SET documents_approved=0 WHERE id=?').run(d.lead_id);
                    audit('lead', d.lead_id, 'DOCUMENT_SCAN_FAILED', q.user.name, null, { document_id: d.id });
                    throw e;
                }
                db.prepare('INSERT INTO document_safety(document_id,sha256,status) VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET sha256=excluded.sha256,status=excluded.status,checked_at=CURRENT_TIMESTAMP').run(d.id, result.sha256, result.status);
                audit('lead', d.lead_id, 'DOCUMENT_SCANNED', q.user.name, null, { document_id: d.id, status: result.status });
                s.json(result);
            }
            catch (e: any) {
                s.status(400).json({ error: e.message });
            }
        });
        v1.post('/workflow/:id/documents/:doc/extract', auth(), async (q: HttpRequest, s: HttpResponse) => {
            try {
                const d = db.prepare('SELECT * FROM documents WHERE id=? AND lead_id=?').get(q.params.doc, q.params.id);
                if (!d)
                    return s.status(404).json({ error: 'DOCUMENT_NOT_FOUND' });
                const check = await scan(d.data, d.mime);
                if (check.status !== 'CLEAN')
                    return s.status(503).json({ error: 'SCAN_DOCUMENT_BEFORE_PROCESSING' });
                const pdf = d.mime === 'application/pdf', command = pdf ? process.env.DOCUMENT_PDF_TEXT_COMMAND : process.env.DOCUMENT_OCR_COMMAND;
                if (!command)
                    return s.status(503).json({ error: pdf ? 'PDF_TEXT_EXTRACTOR_NOT_CONFIGURED' : 'DOCUMENT_OCR_NOT_CONFIGURED' });
                const text = await temporary(d.data, d.mime, async (file: any) => { const { stdout } = await run(command, pdf ? ['-layout', file, '-'] : [file, 'stdout'], { timeout: 30000, maxBuffer: 1024 * 1024 }); return stdout.slice(0, 100000); });
                if (!text.trim())
                    throw Error('NO_TEXT_EXTRACTED');
                const fields = (require('./qualification-tools') as typeof import('./qualification-tools')).extractFields(text);
                db.prepare("INSERT INTO document_extractions(document_id,text,fields) VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET text=excluded.text,fields=excluded.fields,review_status='PENDING',review_notes='',reviewed_by=NULL,extracted_at=CURRENT_TIMESTAMP").run(d.id, text, JSON.stringify(fields));
                audit('lead', d.lead_id, 'DOCUMENT_TEXT_EXTRACTED', q.user.name, null, { document_id: d.id });
                s.json({ text, fields, review_status: 'PENDING' });
            }
            catch (e: any) {
                s.status(400).json({ error: ['DOCUMENT_MALWARE_DETECTED', 'DOCUMENT_SCANNER_UNAVAILABLE', 'NO_TEXT_EXTRACTED'].includes(e.message) ? e.message : 'DOCUMENT_EXTRACTION_FAILED' });
            }
        });
        v1.post('/workflow/:id/documents/:doc/extraction-review', auth(), (q: HttpRequest, s: HttpResponse) => { const d = db.prepare('SELECT id FROM documents WHERE id=? AND lead_id=?').get(q.params.doc, q.params.id), b = q.body; if (!d)
            return s.status(404).json({ error: 'DOCUMENT_NOT_FOUND' }); if (!['ACCEPTED', 'REJECTED'].includes(b.status) || typeof b.notes !== 'string' || b.notes.length > 5000)
            return s.status(400).json({ error: 'VALID_REVIEW_STATUS_AND_NOTES_REQUIRED' }); const r = db.prepare('UPDATE document_extractions SET review_status=?,review_notes=?,reviewed_by=? WHERE document_id=?').run(b.status, b.notes, q.user.id, d.id); if (!r.changes)
            return s.status(404).json({ error: 'EXTRACTION_NOT_FOUND' }); audit('lead', Number(q.params.id), 'DOCUMENT_EXTRACTION_REVIEWED', q.user.name, null, { document_id: d.id, status: b.status }); s.json({ ok: true }); });
    }
    return { register };
};
service.scan = scan;
export = service;

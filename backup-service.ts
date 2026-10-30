import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const fs = require('node:fs/promises') as typeof import('node:fs/promises'), path = require('node:path') as typeof import('node:path'), crypto = require('node:crypto') as typeof import('node:crypto'), Database = require('better-sqlite3') as typeof import('better-sqlite3');
const sha = (b: any) => crypto.createHash('sha256').update(b).digest('hex');
function key() { const s = process.env.BACKUP_ENCRYPTION_KEY; if (!s)
    return null; if (!/^[a-f0-9]{64}$/i.test(s))
    throw Error('BACKUP_KEY_MUST_BE_32_BYTES_HEX'); return Buffer.from(s, 'hex'); }
function encode(data: any) { const k = key(); if (!k)
    return data; const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv), body = Buffer.concat([c.update(data), c.final()]); return Buffer.concat([Buffer.from('ECCBAK1'), iv, c.getAuthTag(), body]); }
function decode(data: any) { if (data.subarray(0, 7).toString() !== 'ECCBAK1')
    return data; const k = key(); if (!k)
    throw Error('BACKUP_ENCRYPTION_KEY_REQUIRED'); const d = crypto.createDecipheriv('aes-256-gcm', k, data.subarray(7, 19)); d.setAuthTag(data.subarray(19, 35)); return Buffer.concat([d.update(data.subarray(35)), d.final()]); }
async function validate(file: any) { const db = new Database(file, { readonly: true, fileMustExist: true }); try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok')
        throw Error('BACKUP_INTEGRITY_FAILED');
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any) => r.name);
}
finally {
    db.close();
} }
async function restore(source: any, destination: any) { const raw = await fs.readFile(source), manifest = JSON.parse(await fs.readFile(source + '.json', 'utf8')); if (sha(raw) !== manifest.sha256)
    throw Error('BACKUP_CHECKSUM_FAILED'); await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 }); const tmp = destination + '.restore-' + crypto.randomUUID(); try {
    await fs.writeFile(tmp, decode(raw), { mode: 0o600, flag: 'wx' });
    await validate(tmp);
    await fs.link(tmp, destination);
    return { ok: true, destination };
}
finally {
    await fs.rm(tmp, { force: true });
} }
const service: any = (db: Database, record: (code:string,...context:any[])=>void = () => { }) => {
    let busy = false, last: any = null;
    const dir = () => path.resolve(process.env.BACKUP_DIR || 'var/backups');
    async function list() { try {
        return (await fs.readdir(dir())).filter(n => /^ecc-backup-[\w-]+\.(sqlite|enc)$/.test(n)).sort().reverse();
    }
    catch (e: any) {
        if (e.code === 'ENOENT')
            return [];
        throw e;
    } }
    async function create() { if (busy)
        throw Error('BACKUP_ALREADY_RUNNING'); busy = true; let temp; try {
        await fs.mkdir(dir(), { recursive: true, mode: 0o700 });
        const name = 'ecc-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
        temp = path.join(dir(), name + '.tmp');
        await db.backup(temp);
        await validate(temp);
        const data = encode(await fs.readFile(temp)), file = path.join(dir(), name + (key() ? '.enc' : '.sqlite'));
        await fs.writeFile(file, data, { mode: 0o600, flag: 'wx' });
        const manifest = { created_at: new Date().toISOString(), sha256: sha(data), bytes: data.length, encrypted: !!key() };
        await fs.writeFile(file + '.json', JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
        last = { name: path.basename(file), ...manifest };
        const keep = Math.max(1, Math.min(365, Number(process.env.BACKUP_RETENTION) || 14));
        for (const old of (await list()).slice(keep)) {
            await fs.rm(path.join(dir(), old));
            await fs.rm(path.join(dir(), old + '.json'), { force: true });
        }
        return last;
    }
    catch (e: any) {
        record('BACKUP_FAILED');
        throw e;
    }
    finally {
        busy = false;
        if (temp)
            await fs.rm(temp, { force: true });
    } }
    async function exercise(name: any) { if (!(await list()).includes(name))
        throw Error('BACKUP_NOT_FOUND'); const folder = await fs.mkdtemp(path.join(dir(), '.restore-test-')); try {
        const destination = path.join(folder, 'restored.db');
        await restore(path.join(dir(), name), destination);
        const tables = await validate(destination);
        return { ok: true, tables: tables.length, checked_at: new Date().toISOString() };
    }
    finally {
        await fs.rm(folder, { recursive: true, force: true });
    } }
    function start() { const minutes = Math.max(1, Number(process.env.BACKUP_INTERVAL_MINUTES) || 1440); const timer = setInterval(() => create().catch(() => { }), minutes * 60000); timer.unref(); create().catch(() => { }); return () => clearInterval(timer); }
    return { create, list, exercise, start, status: () => ({ busy, last, encrypted: !!key(), interval_minutes: Number(process.env.BACKUP_INTERVAL_MINUTES) || 1440 }) };
};
service.restore = restore;
service.validate = validate;
export = service;

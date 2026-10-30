import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const crypto = require('node:crypto') as typeof import('node:crypto'), bcrypt = require('bcryptjs') as typeof import('bcryptjs'), jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes: any) { let bits = 0, value = 0, result = ''; for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
    }
} if (bits)
    result += alphabet[(value << (5 - bits)) & 31]; return result; }
function unbase32(s: any) { let bits = 0, value = 0, out = []; for (const ch of s.replace(/=+$/, '')) {
    const n = alphabet.indexOf(ch);
    if (n < 0)
        throw Error('INVALID_TOTP_SECRET');
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
    }
} return Buffer.from(out); }
function totp(secret: string, counter: any) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', unbase32(secret)).update(b).digest(), i = h[h.length - 1] & 15; return String((h.readUInt32BE(i) & 0x7fffffff) % 1000000).padStart(6, '0'); }
const digest = (s: any) => crypto.createHash('sha256').update(s).digest('hex');
const service = (db: Database, secret: string, access: Services, ops: Services, audit: Audit) => {
    const add = (table: any, name: any, type: any) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c: any) => c.name === name))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); };
    for (const [n, t] of Object.entries<any>({ mfa_secret: 'TEXT', mfa_pending: 'TEXT', mfa_last_counter: 'INTEGER DEFAULT -1', mfa_recovery: "TEXT DEFAULT '[]'", email_verified_at: 'TEXT' }))
        add('users', n, t);
    add('password_resets', 'purpose', "TEXT DEFAULT 'RESET'");
    add('password_resets', 'recipient', 'TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS auth_challenges(token_hash TEXT PRIMARY KEY,user_id INTEGER,attempts INTEGER DEFAULT 0,token_version INTEGER DEFAULT 0,expires_at INTEGER,used INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS email_verifications(token_hash TEXT PRIMARY KEY,user_id INTEGER,recipient TEXT,expires_at INTEGER,used INTEGER DEFAULT 0);`);
    add('auth_challenges', 'token_version', 'INTEGER DEFAULT 0');
    const encryptionKey = () => { const raw = process.env.MFA_ENCRYPTION_KEY; if (raw && /^[a-f0-9]{64}$/i.test(raw))
        return Buffer.from(raw, 'hex'); if (process.env.NODE_ENV === 'production')
        throw Error('MFA_ENCRYPTION_KEY_REQUIRED'); return crypto.createHash('sha256').update('mfa-dev:' + secret).digest(); };
    const seal = (value: any) => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv), data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64'); };
    const open = (value: any) => { const b = Buffer.from(value, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
    const tokenFor = (u: any) => jwt.sign({ id: u.id, v: u.token_version || 0 }, secret, { expiresIn: '8h' });
    function verify(u: any, code: any, seed = u.mfa_secret) { if (typeof code !== 'string')
        return false; if (seed && /^\d{6}$/.test(code)) {
        const current = Math.floor(Date.now() / 30000);
        for (let n = current - 1; n <= current + 1; n++)
            if (n > u.mfa_last_counter && crypto.timingSafeEqual(Buffer.from(totp(open(seed), n)), Buffer.from(code))) {
                db.prepare('UPDATE users SET mfa_last_counter=? WHERE id=?').run(n, u.id);
                return true;
            }
    } const recovery = JSON.parse(u.mfa_recovery || '[]'), at = recovery.indexOf(digest(code.trim().toUpperCase())); if (at >= 0) {
        recovery.splice(at, 1);
        db.prepare('UPDATE users SET mfa_recovery=? WHERE id=?').run(JSON.stringify(recovery), u.id);
        return true;
    } return false; }
    function verification(u: any) { const token = crypto.randomBytes(32).toString('hex'); db.transaction(() => { db.prepare('UPDATE email_verifications SET used=1 WHERE user_id=? AND used=0').run(u.id); db.prepare('INSERT INTO email_verifications(token_hash,user_id,recipient,expires_at) VALUES(?,?,?,?)').run(digest(token), u.id, u.email, Date.now() + 86400000); ops.queue(u.client_lead_id, u.email, 'Verify your ECC email', `Verify this email address within 24 hours:\n${String(process.env.PUBLIC_BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '')}/#/verify/${token}`); })(); return { verification_required: true }; }
    function login(u: any) { if (u.role === 'client' && !u.email_verified_at) {
        const previous = db.prepare('SELECT expires_at FROM email_verifications WHERE user_id=? AND used=0 ORDER BY expires_at DESC LIMIT 1').get(u.id);
        if (!previous || previous.expires_at < Date.now())
            verification(u);
        return { verification_required: true };
    } if (u.mfa_secret) {
        if (db.prepare('SELECT COALESCE(SUM(attempts),0) n FROM auth_challenges WHERE user_id=? AND used=0 AND expires_at>?').get(u.id, Date.now()).n >= 5)
            return { mfa_required: true, locked: true };
        const challenge = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO auth_challenges(token_hash,user_id,expires_at,token_version) VALUES(?,?,?,?)').run(digest(challenge), u.id, Date.now() + 300000, u.token_version || 0);
        return { mfa_required: true, challenge };
    } return { token: tokenFor(u), user: access.publicUser(u) }; }
    function register(v1: Router, auth: Auth, limit: any) {
        const guard = (fn: any) => (q: HttpRequest, s: HttpResponse) => { try {
            return fn(q, s);
        }
        catch (e: any) {
            s.status(400).json({ error: e.message });
        } };
        v1.post('/auth/mfa/login', limit(8), guard((q: HttpRequest, s: HttpResponse) => { const b = q.body; if (typeof b.challenge !== 'string' || b.challenge.length !== 64)
            return s.status(401).json({ error: 'INVALID_CHALLENGE' }); const result = db.transaction(() => { const challenge = db.prepare('SELECT * FROM auth_challenges WHERE token_hash=?').get(digest(b.challenge)); if (!challenge || challenge.used || challenge.attempts >= 5 || challenge.expires_at < Date.now())
            return null; const u = db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(challenge.user_id); if (!u || !u.mfa_secret || challenge.token_version !== (u.token_version || 0) || db.prepare('SELECT COALESCE(SUM(attempts),0) n FROM auth_challenges WHERE user_id=? AND used=0 AND expires_at>?').get(u.id, Date.now()).n >= 5)
            return null; db.prepare('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=?').run(challenge.token_hash); if (!verify(u, b.code))
            return null; db.prepare('UPDATE auth_challenges SET used=1 WHERE user_id=?').run(u.id); audit('user', u.id, 'MFA_LOGIN', u.full_name, null, {}); return { token: tokenFor(u), user: access.publicUser(u) }; })(); if (!result)
            return s.status(401).json({ error: 'INVALID_OR_USED_MFA_CODE' }); s.json(result); }));
        v1.get('/auth/security', auth(), (q: HttpRequest, s: HttpResponse) => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id); s.json({ mfa_enabled: !!u.mfa_secret, email: u.email, email_verified: !!u.email_verified_at, recovery_codes_remaining: JSON.parse(u.mfa_recovery || '[]').length }); });
        v1.post('/auth/mfa/setup', auth(), limit(5), guard((q: HttpRequest, s: HttpResponse) => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id); if (u.mfa_secret || !bcrypt.compareSync(String(q.body.password || ''), u.password_hash))
            throw Error('CURRENT_PASSWORD_REQUIRED_OR_MFA_ALREADY_ENABLED'); const seed = base32(crypto.randomBytes(20)); db.prepare('UPDATE users SET mfa_pending=? WHERE id=?').run(seal(seed), u.id); s.json({ secret: seed, uri: `otpauth://totp/${encodeURIComponent('ECC:' + u.email)}?secret=${seed}&issuer=ECC&algorithm=SHA1&digits=6&period=30` }); }));
        v1.post('/auth/mfa/enable', auth(), limit(5), guard((q: HttpRequest, s: HttpResponse) => { let codes; db.transaction(() => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id); if (!u.mfa_pending || u.mfa_secret || !verify(u, q.body.code, u.mfa_pending))
            throw Error('VALID_AUTHENTICATOR_CODE_REQUIRED'); codes = Array.from({ length: 10 }, () => crypto.randomBytes(6).toString('hex').toUpperCase()); db.prepare('UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_recovery=?,token_version=token_version+1 WHERE id=?').run(JSON.stringify(codes.map(digest)), u.id); audit('user', u.id, 'MFA_ENABLED', u.full_name, null, {}); })(); s.json({ ok: true, recovery_codes: codes, sign_in_again: true }); }));
        v1.post('/auth/mfa/disable', auth(), limit(5), guard((q: HttpRequest, s: HttpResponse) => { db.transaction(() => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id); if (!u.mfa_secret || !bcrypt.compareSync(String(q.body.password || ''), u.password_hash) || !verify(u, q.body.code))
            throw Error('PASSWORD_AND_FRESH_MFA_OR_RECOVERY_CODE_REQUIRED'); db.prepare("UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_recovery='[]',mfa_last_counter=-1,token_version=token_version+1 WHERE id=?").run(u.id); audit('user', u.id, 'MFA_DISABLED', u.full_name, null, {}); })(); s.json({ ok: true, sign_in_again: true }); }));
        v1.post('/auth/verification/request', auth(), limit(3), guard((q: HttpRequest, s: HttpResponse) => s.json(verification(db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id)))));
        v1.post('/auth/verification/confirm', limit(8), guard((q: HttpRequest, s: HttpResponse) => { if (typeof q.body.token !== 'string' || q.body.token.length !== 64)
            throw Error('INVALID_VERIFICATION'); db.transaction(() => { const r = db.prepare('SELECT * FROM email_verifications WHERE token_hash=? AND used=0 AND expires_at>?').get(digest(q.body.token), Date.now()); const u = r && db.prepare('SELECT * FROM users WHERE id=? AND is_active=1').get(r.user_id); if (!u || u.email !== r.recipient)
            throw Error('INVALID_OR_EXPIRED_VERIFICATION'); db.prepare('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?').run(u.id); db.prepare('UPDATE email_verifications SET used=1 WHERE token_hash=?').run(r.token_hash); audit('user', u.id, 'EMAIL_VERIFIED', u.full_name, null, {}); })(); s.json({ ok: true }); }));
    }
    return { register, login, verification, totp, base32 };
};
service.totp = totp;
service.base32 = base32;
export = service;

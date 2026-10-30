import type { Database, Audit, Auth, Services, HttpRequest, HttpResponse, HttpNext } from './types/runtime';
import type { Router } from 'express';
const crypto = require('node:crypto') as typeof import('node:crypto');
const schema = require('./shared/application-schema') as typeof import('./shared/application-schema');
const service = (db: Database) => {
    db.exec('CREATE TABLE IF NOT EXISTS pathway_aliases(name TEXT PRIMARY KEY,purpose TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS applicant_profiles(lead_id INTEGER PRIMARY KEY,profile TEXT NOT NULL,signature BLOB NOT NULL,submission_key TEXT UNIQUE,request_hash TEXT,submitted_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    function validate(b: any) {
        const countryConfig = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_versions'").get() && db.prepare("SELECT config FROM pricing_versions WHERE status='APPROVED' AND effective_from<=date('now') ORDER BY effective_from DESC,id DESC LIMIT 1").get();
        const countries = countryConfig ? Object.values<any>(JSON.parse(countryConfig.config).data).map((c: any) => c.label) : schema.countries;
        const pathways = { ...schema.pathways, ...Object.fromEntries(db.prepare('SELECT * FROM pathway_aliases').all().map(r => [r.name, r.purpose])) };
        const p = b.profile;
        if (!p || typeof p !== 'object' || Array.isArray(p) || !Object.hasOwn(pathways, p['Selected Pathway']))
            throw Error('SELECT_APPLICATION_PATHWAY');
        const pathway = p['Selected Pathway'], clean: Record<string,string> = { 'Selected Pathway': pathway, 'Destination Country': b.country_of_interest };
        if (pathways[pathway] !== b.application_type)
            throw Error('PATHWAY_TYPE_MISMATCH');
        for (const group of schema.groups) {
            if (!schema.visible(group.key, Object.keys(schema.pathways).find(k => schema.pathways[k] === pathways[pathway]) || pathway))
                continue;
            for (const f of group.fields) {
                const v = p[f.name];
                if (v !== undefined && (typeof v !== 'string' || v.length > 4000))
                    throw Error('INVALID_PROFILE_FIELD');
                const value = (v || '').trim();
                if (f.required && !value)
                    throw Error('MISSING_' + f.name.toUpperCase().replaceAll(' ', '_'));
                if (value && f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
                    throw Error('INVALID_PROFILE_DATE');
                if (value && f.type === 'email' && !/^\S+@\S+\.\S+$/.test(value))
                    throw Error('INVALID_PROFILE_EMAIL');
                clean[f.name] = value;
            }
        }
        if (!countries.includes(b.country_of_interest) || clean['Full Name'] !== b.full_name.trim() || clean['Email Address'].toLowerCase() !== b.email.trim().toLowerCase())
            throw Error('PROFILE_DETAILS_MISMATCH');
        if (p['Declaration Confirmed'] !== 'Yes')
            throw Error('DECLARATION_REQUIRED');
        clean['Declaration Confirmed'] = 'Yes';
        clean['Declaration Text'] = schema.declaration;
        if (clean['Language Test Taken'] && !['TOEFL', 'IELTS', 'ELLT', 'Others'].includes(clean['Language Test Taken']))
            throw Error('INVALID_LANGUAGE_TEST');
        if (!clean['Language Test Taken'])
            delete clean['Language Test Band Score'];
        if (clean['Language Test Taken'] !== 'Others')
            delete clean['Other Language Test Name'];
        else if (!clean['Other Language Test Name'])
            throw Error('OTHER_LANGUAGE_TEST_NAME_REQUIRED');
        if (pathways[pathway] === 'STUDY')
            clean['Study Pathway - Planned Country of Study'] = b.country_of_interest;
        if (typeof b.signature_data !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(b.signature_data))
            throw Error('APPLICANT_SIGNATURE_REQUIRED');
        const signature = Buffer.from(b.signature_data.split(',')[1], 'base64');
        if (signature.length < 32 || signature.length > 1024 * 1024 || !signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || signature.subarray(12, 16).toString() !== 'IHDR' || signature.readUInt32BE(16) < 1 || signature.readUInt32BE(20) < 1 || signature.readUInt32BE(16) > 8192 || signature.readUInt32BE(20) > 4096)
            throw Error('INVALID_SIGNATURE_PNG');
        if (typeof b.submission_id !== 'string' || !/^[a-zA-Z0-9-]{32,64}$/.test(b.submission_id))
            throw Error('INVALID_SUBMISSION_ID');
        return { profile: clean, signature, submissionKey: b.submission_id, requestHash: crypto.createHash('sha256').update(JSON.stringify(clean)).update(signature).digest('hex') };
    }
    const get = (id: any) => { const row = db.prepare('SELECT profile,submitted_at FROM applicant_profiles WHERE lead_id=?').get(id); return row ? { ...JSON.parse(row.profile), submitted_at: row.submitted_at } : null; };
    const signed = (id: any) => { const row = db.prepare('SELECT signature FROM applicant_profiles WHERE lead_id=?').get(id); return row ? { profile: get(id), signature_data: 'data:image/png;base64,' + row.signature.toString('base64') } : null; };
    return { validate, get, signed };
};
export = service;

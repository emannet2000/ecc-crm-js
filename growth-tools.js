const crypto = require('node:crypto');
const COUNTRIES = ['Spain', 'Portugal', 'Canada', 'Australia', 'New Zealand', 'Malta'];
const TYPES = ['TOURIST', 'STUDY', 'WORK', 'RESIDENCY'];
const STAGES = ['INQUIRY', 'ASSESSMENT', 'DOCUMENTS_PENDING', 'PROPOSAL', 'CLIENT'];
const FIELDS = ['full_name', 'email', 'phone', 'country_of_interest', 'application_type', 'origin_country'];
function parseCSV(text) {
  if (typeof text !== 'string' || text.length > 2e6) throw Error('CSV_MAXIMUM_2MB');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; }
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') { if (row.some(x => x.trim())) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else { if (closed || c === '"') throw Error('INVALID_CSV_QUOTES'); cell += c; }
    if (rows.length > 1001) throw Error('IMPORT_MAXIMUM_1000_ROWS');
  }
  if (quoted) throw Error('UNCLOSED_CSV_QUOTE');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 1001) throw Error('CSV_REQUIRES_HEADER_AND_1_TO_1000_ROWS');
  const headers = rows.shift().map(x => x.trim());
  if (headers.some(x => !x) || new Set(headers).size !== headers.length) throw Error('UNIQUE_COLUMN_HEADERS_REQUIRED');
  return { headers, rows };
}
module.exports = (db, ops, access, audit) => {
  db.exec(`CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY,created_by INTEGER NOT NULL,payload TEXT NOT NULL,result TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS lead_merges(source_id INTEGER PRIMARY KEY,target_id INTEGER NOT NULL,reason TEXT NOT NULL,created_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS automation_rules(id INTEGER PRIMARY KEY,name TEXT NOT NULL,stage TEXT NOT NULL,country TEXT,title TEXT NOT NULL,days INTEGER NOT NULL,assignee_id INTEGER,overdue_only INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS automation_runs(rule_id INTEGER NOT NULL,lead_id INTEGER NOT NULL,task_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(rule_id,lead_id));`);
  const guard = fn => (q, s) => { try { fn(q, s); } catch (e) { s.status(400).json({ error: e.message }); } };
  const activeStaff = id => db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND role<>'client' AND COALESCE(permission_level,'')<>'VIEWER'").get(id);
  function preview(b) {
    const parsed = parseCSV(b.csv), mapping = b.mapping || Object.fromEntries(FIELDS.map(k => [k, k]));
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).some(k => !FIELDS.includes(k))) throw Error('INVALID_FIELD_MAPPING');
    if (['full_name','email','country_of_interest','application_type'].some(k => !parsed.headers.includes(mapping[k]))) throw Error('MAP_REQUIRED_FIELDS');
    if (!activeStaff(Number(b.assigned_to))) throw Error('ACTIVE_STAFF_ASSIGNEE_REQUIRED');
    const seenEmails = new Set(), seenPhones = new Set();
    return parsed.rows.map((cells, i) => {
      const lead = Object.fromEntries(FIELDS.map(k => [k, (cells[parsed.headers.indexOf(mapping[k])] || '').trim()]));
      lead.email = lead.email.toLowerCase(); lead.application_type = lead.application_type.toUpperCase(); lead.origin_country ||= 'UAE';
      const phone = lead.phone.replace(/\D/g, ''), errors = [];
      if (cells.length !== parsed.headers.length) errors.push('Column count does not match header');
      if (!lead.full_name || lead.full_name.length > 200) errors.push('Full name required, maximum 200 characters');
      if (!/^\S+@\S+\.\S+$/.test(lead.email) || lead.email.length > 254) errors.push('Valid email required');
      if (!Object.values(ops.pricing().data).some(c=>c.label===lead.country_of_interest)) errors.push('Unsupported country');
      if (!TYPES.includes(lead.application_type)) errors.push('Unsupported application type');
      if (lead.phone.length > 100 || lead.origin_country.length > 200) errors.push('Contact field too long');
      const duplicates = db.prepare("SELECT id,reference_no FROM leads WHERE lower(email)=? OR (?<>'' AND phone_normalized=?)").all(lead.email, phone, phone);
      const batch_duplicate = seenEmails.has(lead.email) || !!phone && seenPhones.has(phone);
      seenEmails.add(lead.email); if (phone) seenPhones.add(phone);
      return { row: i + 2, lead, errors, duplicates, batch_duplicate };
    });
  }
  function mergePreview(sourceId, targetId) {
    const source = db.prepare('SELECT * FROM leads WHERE id=?').get(Number(sourceId)), target = db.prepare('SELECT * FROM leads WHERE id=?').get(Number(targetId));
    if (!source || !target || source.id === target.id) throw Error('TWO_DIFFERENT_LEADS_REQUIRED');
    if (db.prepare('SELECT source_id FROM lead_merges WHERE source_id IN (?,?) OR target_id=?').get(source.id,target.id,source.id)) throw Error('MERGED_RECORD_CANNOT_BE_MERGED_AGAIN');
    // Financial, signed and assessment records must retain their original case identity.
    const blockers = [];
    if (['ARCHIVED','LOST','DISQUALIFIED','WITHDRAWN'].includes(target.status)) blockers.push('closed target');
    if (source.country_of_interest !== target.country_of_interest || source.application_type !== target.application_type) blockers.push('different destination or pathway');
    for (const [name, table] of [['applicant profile','applicant_profiles'],['proposal','proposals'],['invoice','charges'],['client account','client_applications'],['case record','case_records']]) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE lead_id=?`).get(source.id)) blockers.push(name);
    }
    if (!['INQUIRY','ASSESSMENT'].includes(source.status) || source.assessment_at || source.assessment_approved) blockers.push('progressed assessment');
    const counts = Object.fromEntries(['tasks','documents','requirements','messages','case_events','correction_requests'].map(t => [t,db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE lead_id=?`).get(source.id).n]));
    if (counts.documents || counts.requirements || counts.case_events || counts.correction_requests) blockers.push('case documents or review records');
    const safe = l => ({id:l.id,reference_no:l.reference_no,full_name:l.full_name,email:l.email,phone:l.phone,status:l.status});
    return {source:safe(source),target:safe(target),counts,blockers,fingerprint:crypto.createHash('sha256').update(JSON.stringify({source,target,counts})).digest('hex')};
  }
  function candidates(rule) {
    return db.prepare(`SELECT l.id,l.full_name,l.assigned_to FROM leads l WHERE l.status=? AND (? IS NULL OR l.country_of_interest=?)
      AND NOT EXISTS(SELECT 1 FROM lead_merges m WHERE m.source_id=l.id)
      AND NOT EXISTS(SELECT 1 FROM automation_runs r WHERE r.rule_id=? AND r.lead_id=l.id)
      AND (?=0 OR EXISTS(SELECT 1 FROM tasks t WHERE t.lead_id=l.id AND t.status<>'DONE' AND t.due_date<date('now')))
      ORDER BY l.id LIMIT 1000`).all(rule.stage,rule.country,rule.country,rule.id,rule.overdue_only).filter(l=>activeStaff(rule.assignee_id||l.assigned_to||0));
  }
  function runRules(dryRun = false, actor = 'automation') {
    return db.transaction(() => {
      const results=[];
      for(const rule of db.prepare('SELECT * FROM automation_rules WHERE enabled=1 ORDER BY id').all()) {
        const leads=candidates(rule); results.push({rule_id:rule.id,name:rule.name,leads:leads.map(l=>({id:l.id,full_name:l.full_name}))});
        if(dryRun) continue;
        for(const lead of leads) {
          const assignee=rule.assignee_id||lead.assigned_to;
          const task=db.prepare("INSERT INTO tasks(lead_id,title,assignee_id,due_date,category) VALUES(?,?,?,date('now',?),'FOLLOW_UP')").run(lead.id,rule.title,assignee,`+${rule.days} days`).lastInsertRowid;
          if(rule.assignee_id) db.prepare('UPDATE leads SET assigned_to=? WHERE id=?').run(assignee,lead.id);
          db.prepare('INSERT INTO automation_runs(rule_id,lead_id,task_id) VALUES(?,?,?)').run(rule.id,lead.id,task);
          audit('task',task,'CREATE',actor,null,{rule_id:rule.id,title:rule.title});
          audit('lead',lead.id,'AUTOMATION_APPLIED',actor,null,{rule_id:rule.id,task_id:task,assigned_to:assignee});
        }
      }
      return {dry_run:dryRun,results};
    })();
  }
  function register(v1,auth) {
    const admin=auth('admin');
    v1.post('/admin/imports/xlsx',admin,(q,s)=>{
      if(typeof q.body.data!=='string'||q.body.data.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(q.body.data))return s.status(400).json({error:'XLSX_MAXIMUM_2MB'});
      const data=Buffer.from(q.body.data,'base64');if(data.length>2e6)return s.status(400).json({error:'XLSX_MAXIMUM_2MB'});
      const {Worker}=require('node:worker_threads'),worker=new Worker(require('node:path').join(__dirname,'scripts/xlsx-import-worker.cjs'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16}});
      let done=false;const timer=setTimeout(()=>finish({error:'XLSX_PROCESSING_TIMEOUT'}),10000);
      function finish(result){if(done)return;done=true;clearTimeout(timer);worker.terminate();s.status(result.error?400:200).json(result)}
      worker.once('message',finish);worker.once('error',()=>finish({error:'XLSX_PROCESSING_FAILED'}));worker.once('exit',code=>{if(!done)finish({error:'XLSX_PROCESSING_FAILED'})});
    });
    v1.post('/admin/imports/headers',admin,guard((q,s)=>s.json({headers:parseCSV(q.body.csv).headers})));
    v1.post('/admin/imports/preview',admin,guard((q,s)=>s.json({fields:FIELDS,rows:preview(q.body)})));
    v1.post('/admin/imports/commit',admin,guard((q,s)=>{
      const key=q.body.request_id;
      if(typeof key!=='string'||!/^[-\w]{8,100}$/.test(key)) throw Error('IMPORT_REQUEST_ID_REQUIRED');
      const payload=JSON.stringify({csv:q.body.csv,mapping:q.body.mapping,assigned_to:q.body.assigned_to});
      const result=db.transaction(()=>{
        const previous=db.prepare('SELECT * FROM import_batches WHERE id=?').get(key);
        if(previous) { if(previous.created_by!==q.user.id||previous.payload!==payload) throw Error('IMPORT_REQUEST_ID_CONFLICT'); return JSON.parse(previous.result); }
        const rows=preview(q.body);if(rows.some(r=>r.errors.length)) throw Error('FIX_INVALID_ROWS_BEFORE_IMPORT');
        const allowed=rows.filter(r=>!r.duplicates.length&&!r.batch_duplicate),usage=access.usage(db.prepare('SELECT * FROM users WHERE id=?').get(q.user.id));
        const cap=usage.limits.leads_per_month;
        if(cap!=null&&usage.used.leads_per_month+allowed.length>cap) throw Error('USAGE_LIMIT_REACHED');
        const created=[];
        db.prepare('INSERT INTO import_batches(id,created_by,payload) VALUES(?,?,?)').run(key,q.user.id,payload);
        for(const row of allowed){const l=row.lead,n=db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM leads').get().n,reference='LEAD-'+new Date().getFullYear()+'-'+String(n).padStart(4,'0');
          const id=db.prepare('INSERT INTO leads(reference_no,full_name,email,phone,phone_normalized,country_of_interest,application_type,origin_country,assigned_to) VALUES(?,?,?,?,?,?,?,?,?)').run(reference,l.full_name,l.email,l.phone,l.phone.replace(/\D/g,''),l.country_of_interest,l.application_type,l.origin_country,Number(q.body.assigned_to)).lastInsertRowid;
          // Import does not send unsolicited inquiry acknowledgments.
          db.prepare("INSERT INTO audit_log(entity_type,entity_id,action,changed_by,new_values) VALUES('lead',?,'IMPORTED',?,?)").run(id,q.user.name,JSON.stringify({batch:key,row:row.row}));
          db.prepare("INSERT INTO usage_events(user_id,lead_id,action,quantity,period) VALUES(?,?,'leads',1,?)").run(q.user.id,id,usage.period);
          created.push({id,reference_no:reference});
        }
        const result={created,skipped:rows.length-created.length};db.prepare('UPDATE import_batches SET result=? WHERE id=?').run(JSON.stringify(result),key);return result;
      })();s.status(201).json(result);
    }));
    v1.post('/admin/merges/preview',admin,guard((q,s)=>s.json(mergePreview(q.body.source_id,q.body.target_id))));
    v1.post('/admin/merges/commit',admin,guard((q,s)=>{
      const result=db.transaction(()=>{const p=mergePreview(q.body.source_id,q.body.target_id);
        if(p.blockers.length) throw Error('SOURCE_HAS_PROTECTED_CASE_RECORDS');
        if(q.body.fingerprint!==p.fingerprint) throw Error('RECORDS_CHANGED_PREVIEW_AGAIN');
        if(typeof q.body.reason!=='string'||!q.body.reason.trim()||q.body.reason.length>2000) throw Error('MERGE_REASON_REQUIRED');
        const source=db.prepare('SELECT * FROM leads WHERE id=?').get(p.source.id);
        for(const table of ['tasks','messages']) db.prepare(`UPDATE ${table} SET lead_id=? WHERE lead_id=?`).run(p.target.id,p.source.id);
        db.prepare("UPDATE leads SET notes=COALESCE(notes,'')||?,portal_hash=NULL,previous_status=status,status='ARCHIVED',closed_reason=? WHERE id=?").run('',`Merged into ${p.target.reference_no}: ${q.body.reason}`,p.source.id);
        if(source.notes||source.message) db.prepare("UPDATE leads SET notes=COALESCE(notes,'')||? WHERE id=?").run(`\n[${p.source.reference_no}] ${source.notes||''}${source.message?'\nInquiry: '+source.message:''}`,p.target.id);
        db.prepare('INSERT INTO lead_merges(source_id,target_id,reason,created_by) VALUES(?,?,?,?)').run(p.source.id,p.target.id,q.body.reason.trim(),q.user.id);
        audit('lead',p.source.id,'MERGED_INTO',q.user.name,null,{target_id:p.target.id,reason:q.body.reason});audit('lead',p.target.id,'MERGED_FROM',q.user.name,null,{source_id:p.source.id,source:p.source,message:source.message,reason:q.body.reason});
        return {ok:true,target_id:p.target.id,source_id:p.source.id};})();s.json(result);
    }));
    v1.get('/admin/automation',admin,(q,s)=>s.json({rules:db.prepare('SELECT * FROM automation_rules ORDER BY id').all(),runs:db.prepare('SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 100').all()}));
    v1.post('/admin/automation',admin,guard((q,s)=>{
      const b=q.body;
      if(typeof b.name!=='string'||!b.name.trim()||b.name.length>200||!STAGES.includes(b.stage)||b.country&&!Object.values(ops.pricing().data).some(c=>c.label===b.country)||typeof b.title!=='string'||!b.title.trim()||b.title.length>500||!Number.isInteger(b.days)||b.days<0||b.days>365||b.assignee_id&&!activeStaff(Number(b.assignee_id))) throw Error('VALID_RULE_NAME_STAGE_TASK_DAYS_AND_ASSIGNEE_REQUIRED');
      const id=db.prepare('INSERT INTO automation_rules(name,stage,country,title,days,assignee_id,overdue_only) VALUES(?,?,?,?,?,?,?)').run(b.name.trim(),b.stage,b.country||null,b.title.trim(),b.days,b.assignee_id?Number(b.assignee_id):null,b.overdue_only===true?1:0).lastInsertRowid;
      audit('automation',id,'CREATED',q.user.name,null,b);s.status(201).json({id});
    }));
    v1.patch('/admin/automation/:id',admin,guard((q,s)=>{if(typeof q.body.enabled!=='boolean')throw Error('ENABLED_BOOLEAN_REQUIRED');const r=db.prepare('UPDATE automation_rules SET enabled=? WHERE id=?').run(q.body.enabled?1:0,q.params.id);if(!r.changes) return s.status(404).json({error:'NOT_FOUND'});audit('automation',Number(q.params.id),'TOGGLED',q.user.name,null,q.body);s.json({ok:true});}));
    v1.post('/admin/automation/run',admin,guard((q,s)=>{if(typeof q.body.dry_run!=='boolean')throw Error('EXPLICIT_DRY_RUN_REQUIRED');s.json(runRules(q.body.dry_run,q.user.name));}));
  }
  return {register,runRules};
};
module.exports.parseCSV=parseCSV;

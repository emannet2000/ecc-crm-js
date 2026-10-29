const {text,date}=require('./operations').validation;
module.exports=(db,ops,access,audit)=>{
 db.exec(`CREATE TABLE IF NOT EXISTS workflow_definitions(id INTEGER PRIMARY KEY,name TEXT NOT NULL,stage TEXT NOT NULL,country TEXT,repeat_days INTEGER,steps TEXT NOT NULL,enabled INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS workflow_executions(id INTEGER PRIMARY KEY,definition_id INTEGER NOT NULL,lead_id INTEGER NOT NULL,steps TEXT NOT NULL,state TEXT DEFAULT 'RUNNING',started_at TEXT NOT NULL,completed_at TEXT);
 CREATE TABLE IF NOT EXISTS workflow_step_runs(execution_id INTEGER NOT NULL,step_index INTEGER NOT NULL,task_id INTEGER NOT NULL,escalations INTEGER DEFAULT 0,PRIMARY KEY(execution_id,step_index));
 CREATE TABLE IF NOT EXISTS report_schedules(id INTEGER PRIMARY KEY,report_id INTEGER NOT NULL,user_id INTEGER NOT NULL,interval_days INTEGER NOT NULL,next_run TEXT NOT NULL,enabled INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS report_deliveries(schedule_id INTEGER NOT NULL,scheduled_for TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(schedule_id,scheduled_for));
 CREATE TABLE IF NOT EXISTS forecast_probabilities(stage TEXT PRIMARY KEY,probability INTEGER NOT NULL);`);
 const safe=fn=>(q,s)=>{try{fn(q,s)}catch(e){s.status(400).json({error:e.message})}};
 const staff=id=>db.prepare("SELECT id FROM users WHERE id=? AND is_active=1 AND role<>'client' AND COALESCE(permission_level,'')<>'VIEWER'").get(Number(id));
 const stages=['INQUIRY','ASSESSMENT','DOCUMENTS_PENDING','PROPOSAL','CLIENT'];
 const iso=v=>new Date(v).toISOString(),day=v=>iso(v).slice(0,10);
 function tick(now=Date.now()){
  return db.transaction(()=>{let tasks=0,escalations=0,deliveries=0;
   for(const def of db.prepare('SELECT * FROM workflow_definitions WHERE enabled=1').all()){
    const leads=db.prepare("SELECT l.* FROM leads l WHERE l.status=? AND (? IS NULL OR l.country_of_interest=?) AND NOT EXISTS(SELECT 1 FROM lead_merges m WHERE m.source_id=l.id)").all(def.stage,def.country,def.country);
    for(const lead of leads){const last=db.prepare('SELECT * FROM workflow_executions WHERE definition_id=? AND lead_id=? ORDER BY id DESC LIMIT 1').get(def.id,lead.id);
     if(!last||last.state==='COMPLETE'&&def.repeat_days&&Date.parse(last.completed_at)+def.repeat_days*86400000<=now){db.prepare('INSERT INTO workflow_executions(definition_id,lead_id,steps,started_at) VALUES(?,?,?,?)').run(def.id,lead.id,def.steps,iso(now))}
    }
    for(const ex of db.prepare("SELECT e.*,l.assigned_to,l.status lead_status FROM workflow_executions e JOIN leads l ON l.id=e.lead_id WHERE e.definition_id=? AND e.state='RUNNING'").all(def.id)){
     if(['ARCHIVED','LOST','DISQUALIFIED','WITHDRAWN'].includes(ex.lead_status))continue;
     const steps=JSON.parse(ex.steps);let waiting=false;
     for(let index=0;index<steps.length;index++){
      const step=steps[index],previous=db.prepare('SELECT r.*,t.status,t.due_date,t.assignee_id FROM workflow_step_runs r JOIN tasks t ON t.id=r.task_id WHERE r.execution_id=? AND r.step_index=?').get(ex.id,index);
      if(previous?.status==='DONE')continue;
      if(previous){const chain=step.escalations||[];let count=previous.escalations;
       while(count<chain.length&&Date.parse(previous.due_date+'T00:00:00Z')+chain[count].after_days*86400000<=now){const escalation=chain[count];if(!staff(escalation.user_id))break;db.prepare('UPDATE tasks SET assignee_id=? WHERE id=?').run(escalation.user_id,previous.task_id);count++;db.prepare('UPDATE workflow_step_runs SET escalations=? WHERE execution_id=? AND step_index=?').run(count,ex.id,index);audit('task',previous.task_id,'UPDATE','workflow',null,{assignee_id:escalation.user_id,escalation:count,execution_id:ex.id});escalations++}
      }else{const assignee=step.assignee_id||ex.assigned_to;if(!staff(assignee))break;const task=db.prepare("INSERT INTO tasks(lead_id,title,assignee_id,due_date,category) VALUES(?,?,?,?,'FOLLOW_UP')").run(ex.lead_id,step.title,assignee,day(now+step.due_days*86400000)).lastInsertRowid;db.prepare('INSERT INTO workflow_step_runs(execution_id,step_index,task_id) VALUES(?,?,?)').run(ex.id,index,task);audit('task',task,'CREATE','workflow',null,{title:step.title,execution_id:ex.id,step_index:index});tasks++}
      waiting=true;break;
     }
     if(!waiting)db.prepare("UPDATE workflow_executions SET state='COMPLETE',completed_at=? WHERE id=?").run(iso(now),ex.id);
    }
   }
   for(const schedule of db.prepare('SELECT sc.*,r.definition,r.name,u.email,u.role,u.permission_level,u.is_active FROM report_schedules sc JOIN saved_reports r ON r.id=sc.report_id JOIN users u ON u.id=sc.user_id WHERE sc.enabled=1 AND sc.next_run<=?').all(iso(now))){
    if(!schedule.is_active||schedule.role==='client')continue;
    // Resolve access at delivery time, rather than retaining the creator's former team permissions.
    const level=access.publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(schedule.user_id)).permission_level;
    const scope=['ADMIN','MANAGER'].includes(level)?null:schedule.user_id,definition=JSON.parse(schedule.definition);
    const columns={country:'l.country_of_interest',stage:'l.status',pathway:'l.application_type',assignee:"COALESCE(u.full_name,'Unassigned')",source:"COALESCE(src.source,'Unspecified')",month:"substr(l.created_at,1,7)"};
    if(!Object.hasOwn(columns,definition.group_by))continue;
    const where=['(? IS NULL OR l.assigned_to=? OR EXISTS(SELECT 1 FROM tasks t WHERE t.lead_id=l.id AND t.assignee_id=?))'],params=[scope,scope,scope];
    if(definition.from){where.push('date(l.created_at)>=?');params.push(definition.from)}if(definition.to){where.push('date(l.created_at)<=?');params.push(definition.to)}if(definition.country){where.push('l.country_of_interest=?');params.push(definition.country)}
    const rows=db.prepare(`SELECT ${columns[definition.group_by]} label,COUNT(*) total,SUM(l.status='CLIENT') clients FROM leads l LEFT JOIN users u ON u.id=l.assigned_to LEFT JOIN lead_sources src ON src.lead_id=l.id WHERE ${where.join(' AND ')} GROUP BY ${columns[definition.group_by]}`).all(...params);
    const inserted=db.prepare('INSERT OR IGNORE INTO report_deliveries(schedule_id,scheduled_for) VALUES(?,?)').run(schedule.id,schedule.next_run);
    if(inserted.changes){ops.queue(null,schedule.email,'ECC report: '+schedule.name,rows.map(r=>`${r.label}: ${r.total} leads; ${r.clients} clients`).join('\n')||'No matching records',`scheduled-report-${schedule.id}-${schedule.next_run}`);deliveries++}
    // Missed intervals produce one current report, not an email flood.
    db.prepare('UPDATE report_schedules SET next_run=? WHERE id=?').run(iso(now+schedule.interval_days*86400000),schedule.id);
   }
   return {tasks,escalations,deliveries};
  })();
 }
 function register(v1,auth){const admin=auth('admin'),manager=auth('admin','approver');
  v1.get('/admin/workflows',admin,(q,s)=>s.json({definitions:db.prepare('SELECT * FROM workflow_definitions ORDER BY id DESC').all().map(d=>({...d,steps:JSON.parse(d.steps)})),executions:db.prepare('SELECT e.*,l.reference_no FROM workflow_executions e JOIN leads l ON l.id=e.lead_id ORDER BY e.id DESC LIMIT 200').all(),step_runs:db.prepare('SELECT * FROM workflow_step_runs ORDER BY execution_id DESC LIMIT 500').all()}));
  v1.post('/admin/workflows',admin,safe((q,s)=>{const b=q.body;if(!text(b.name,200)||!stages.includes(b.stage)||b.country&&!Object.values(ops.pricing().data).some(c=>c.label===b.country)||b.repeat_days!=null&&(!Number.isInteger(b.repeat_days)||b.repeat_days<1||b.repeat_days>365)||!Array.isArray(b.steps)||!b.steps.length||b.steps.length>20)throw Error('VALID_WORKFLOW_AND_1_TO_20_STEPS_REQUIRED');
   for(const step of b.steps){if(!text(step.title,500)||!Number.isInteger(step.due_days)||step.due_days<0||step.due_days>365||step.assignee_id&&!staff(step.assignee_id)||step.escalations&&(!Array.isArray(step.escalations)||step.escalations.length>10))throw Error('INVALID_WORKFLOW_STEP');let last=-1;for(const e of step.escalations||[]){if(!Number.isInteger(e.after_days)||e.after_days<=last||e.after_days>365||!staff(e.user_id))throw Error('ORDERED_ESCALATION_DAYS_AND_ACTIVE_STAFF_REQUIRED');last=e.after_days}}
   const id=db.prepare('INSERT INTO workflow_definitions(name,stage,country,repeat_days,steps) VALUES(?,?,?,?,?)').run(b.name.trim(),b.stage,b.country||null,b.repeat_days||null,JSON.stringify(b.steps)).lastInsertRowid;audit('workflow_definition',id,'CREATED',q.user.name,null,b);s.status(201).json({id})}));
  v1.patch('/admin/workflows/:id',admin,safe((q,s)=>{if(typeof q.body.enabled!=='boolean')throw Error('ENABLED_BOOLEAN_REQUIRED');const r=db.prepare('UPDATE workflow_definitions SET enabled=? WHERE id=?').run(q.body.enabled?1:0,q.params.id);if(!r.changes)return s.status(404).json({error:'NOT_FOUND'});audit('workflow_definition',Number(q.params.id),'TOGGLED',q.user.name,null,q.body);s.json({ok:true})}));
  v1.post('/admin/workflows/run',admin,safe((q,s)=>s.json(tick())));
  v1.get('/reports/schedules',auth(),(q,s)=>s.json(db.prepare('SELECT sc.*,r.name FROM report_schedules sc JOIN saved_reports r ON r.id=sc.report_id WHERE sc.user_id=? ORDER BY sc.id DESC').all(q.user.id)));
  v1.post('/reports/schedules',auth(),safe((q,s)=>{const b=q.body,r=db.prepare('SELECT * FROM saved_reports WHERE id=? AND created_by=?').get(Number(b.report_id),q.user.id);if(!r||!Number.isInteger(b.interval_days)||b.interval_days<1||b.interval_days>365||!date(b.first_on))throw Error('OWN_REPORT_INTERVAL_AND_FIRST_DATE_REQUIRED');const id=db.prepare('INSERT INTO report_schedules(report_id,user_id,interval_days,next_run) VALUES(?,?,?,?)').run(r.id,q.user.id,b.interval_days,b.first_on+'T00:00:00.000Z').lastInsertRowid;s.status(201).json({id})}));
  v1.patch('/reports/schedules/:id',auth(),safe((q,s)=>{if(typeof q.body.enabled!=='boolean')throw Error('ENABLED_BOOLEAN_REQUIRED');const r=db.prepare('UPDATE report_schedules SET enabled=? WHERE id=? AND user_id=?').run(q.body.enabled?1:0,q.params.id,q.user.id);if(!r.changes)return s.status(404).json({error:'NOT_FOUND'});s.json({ok:true})}));
  v1.get('/reports/weighted-forecast',manager,(q,s)=>{const probabilities=Object.fromEntries(db.prepare('SELECT * FROM forecast_probabilities').all().map(r=>[r.stage,r.probability])),totals=new Map(),excluded=[];
   for(const l of db.prepare("SELECT id,status,reference_no FROM leads WHERE status IN ('INQUIRY','ASSESSMENT','DOCUMENTS_PENDING','PROPOSAL')").all()){
    const p=db.prepare("SELECT * FROM proposals WHERE lead_id=? AND status IN ('DRAFT','APPROVED') ORDER BY revision DESC,id DESC LIMIT 1").get(l.id);if(!p||probabilities[l.status]===undefined){excluded.push(l.reference_no);continue}
    const amount=JSON.parse(p.items).filter(i=>i.billable!==false).reduce((n,i)=>n+i.amount_cents,0),row=totals.get(p.currency)||{currency:p.currency,pipeline_cents:0,weighted_cents:0,cases:0};row.pipeline_cents+=amount;row.weighted_cents+=Math.round(amount*probabilities[l.status]/100);row.cases++;totals.set(p.currency,row);
   }s.json({probabilities,totals:[...totals.values()],excluded_without_quote_or_probability:excluded});
  });
  v1.post('/admin/forecast-probabilities',admin,safe((q,s)=>{const b=q.body;if(!b.probabilities||typeof b.probabilities!=='object'||Array.isArray(b.probabilities)||!Object.keys(b.probabilities).length||Object.entries(b.probabilities).some(([k,v])=>!stages.includes(k)||!Number.isInteger(v)||v<0||v>100))throw Error('STAGE_PROBABILITIES_0_TO_100_REQUIRED');db.transaction(()=>{for(const [stage,p]of Object.entries(b.probabilities))db.prepare('INSERT INTO forecast_probabilities(stage,probability) VALUES(?,?) ON CONFLICT(stage) DO UPDATE SET probability=excluded.probability').run(stage,p);audit('forecast',0,'PROBABILITIES_UPDATED',q.user.name,null,b)})();s.json({ok:true})}));
 }
 return {register,tick};
};

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');

test('backup directory failure releases lock, records failure, and permits a successful retry',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ecc-backup-retry-')),db=new Database(':memory:');
 const previous=process.env.BACKUP_DIR;
 t.after(async()=>{db.close();if(previous===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=previous;await fs.rm(dir,{recursive:true,force:true})});
 db.exec('CREATE TABLE retained_data(value TEXT); INSERT INTO retained_data VALUES(\'preserved\')');
 const obstacle=path.join(dir,'regular-file');await fs.writeFile(obstacle,'not a directory');
 process.env.BACKUP_DIR=path.join(obstacle,'backups');
 const errors=[],backup=require('../dist/backup-service')(db,code=>errors.push(code));
 await assert.rejects(backup.create(),{code:'ENOTDIR'});
 assert.equal(backup.status().busy,false);
 assert.deepEqual(errors,['BACKUP_FAILED']);
 process.env.BACKUP_DIR=path.join(dir,'valid-backups');
 const saved=await backup.create();
 assert.equal(backup.status().busy,false);
 assert.ok((await backup.list()).includes(saved.name));
 assert.equal((await backup.exercise(saved.name)).ok,true);
});

test('workflow waits for an eligible assignee and completes only after its task is done',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,is_active INTEGER,role TEXT,permission_level TEXT,email TEXT);
 CREATE TABLE leads(id INTEGER PRIMARY KEY,status TEXT,assigned_to INTEGER,country_of_interest TEXT);
 CREATE TABLE tasks(id INTEGER PRIMARY KEY,lead_id INTEGER,title TEXT,assignee_id INTEGER,due_date TEXT,category TEXT,status TEXT DEFAULT 'PENDING');
 CREATE TABLE lead_merges(source_id INTEGER,target_id INTEGER);
 CREATE TABLE saved_reports(id INTEGER PRIMARY KEY,definition TEXT,name TEXT);
 INSERT INTO users VALUES(1,0,'staff','AGENT','agent@example.test');
 INSERT INTO leads VALUES(1,'INQUIRY',1,'Spain');`);
 const workflow=require('../dist/advanced-workflows')(db,{}, {},()=>{});
 // Test both an explicit step assignee and assignment inherited from the lead.
 for(const steps of [[{title:'Explicit assignee',due_days:1,assignee_id:1}],[{title:'Inherited assignee',due_days:1}]])
  db.prepare('INSERT INTO workflow_definitions(name,stage,steps) VALUES(?,?,?)').run('Required follow up','INQUIRY',JSON.stringify(steps));
 const now=Date.now();
 assert.equal(workflow.tick(now).tasks,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM workflow_executions WHERE state='RUNNING' AND completed_at IS NULL").get().n,2);
 assert.equal(workflow.tick(now+1000).tasks,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM workflow_executions').get().n,2);
 db.prepare('UPDATE users SET is_active=1').run();
 assert.equal(workflow.tick(now+2000).tasks,2);
 assert.equal(workflow.tick(now+3000).tasks,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM workflow_executions WHERE state='RUNNING'").get().n,2);
 db.prepare("UPDATE tasks SET status='DONE'").run();
 workflow.tick(now+4000);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM workflow_executions WHERE state='COMPLETE' AND completed_at IS NOT NULL").get().n,2);
});

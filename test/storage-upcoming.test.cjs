const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const harness=require('./support/http.cjs');

test('signature storage counts across client applications and overdue work cannot hide upcoming tasks',async t=>{
 const {db,req,login,access}=harness(t),admin=await login('admin@ecc.example');
 const post=(p,body={},token=admin,status=200)=>req(p,{method:'POST',body,token,status});
 const create=async name=>{const l=await post('/leads',{full_name:name,email:'signature-quota@example.test',country_of_interest:'Spain',application_type:'TOURIST',assigned_to:1},admin,201);db.prepare("UPDATE leads SET status='PROPOSAL' WHERE id=?").run(l.id);return l.id};
 const first=await create('Storage first'),second=await create('Storage second');
 const account=await post('/workflow/'+first+'/client-account',{},admin,201),password='SignatureStoragePassword123!';
 await post('/auth/reset-password',{token:account.activation_path.split('/').pop(),password},null);
 await post('/workflow/'+second+'/client-account',{confirm_existing:true},admin,201);
 const client=await login('signature-quota@example.test',password);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5NsAAAAASUVORK5CYII=',signatureBytes=Buffer.from(png.split(',')[1],'base64').length;
 const proposal=id=>db.prepare("INSERT INTO proposals(lead_id,country,purpose,currency,items,terms,status,customer_status,sent_at) VALUES(?,'Spain','TOURIST','AED','[]','Quota fixture','APPROVED','ACCEPTED',CURRENT_TIMESTAMP)").run(id).lastInsertRowid;
 const one=proposal(first),two=proposal(second);
 await t.test('signature bytes count toward shared storage and block further documents and signatures',async()=>{
  db.prepare('UPDATE users SET usage_limits=? WHERE id=?').run(JSON.stringify({storage_mb:signatureBytes/1048576}),account.id);
  await req('/portal/proposals/'+one+'/sign',{method:'POST',token:client,headers:{'x-application-id':String(first)},body:{name:'Quota signer',consent:true,signature_data:png},status:201});
  assert.equal((await req('/usage/me',{token:client})).storage_bytes,signatureBytes);
  assert.equal(access.usage(null,first).storage_bytes,signatureBytes);
  assert.equal((await req('/admin/usage',{token:admin})).storage_bytes,signatureBytes);
  const file={kind:'APPLICATION',name:'sample.pdf',mime:'application/pdf',data:Buffer.from('%PDF-1.4\nExtra bytes').toString('base64')};
  for(const id of [first,second]){
   const blocked=await req('/portal/documents',{method:'POST',token:client,headers:{'x-application-id':String(id)},body:file,status:429});
   assert.equal(blocked.error,'STORAGE_LIMIT_REACHED');
  }
  await req('/portal/proposals/'+two+'/sign',{method:'POST',token:client,headers:{'x-application-id':String(second)},body:{name:'Quota signer',consent:true,signature_data:png},status:429});
  // The same bound applies when the client uses a private portal link.
  const magic=crypto.randomBytes(32).toString('hex');db.prepare('UPDATE leads SET portal_hash=? WHERE id=?').run(crypto.createHash('sha256').update(magic).digest('hex'),second);
  await req('/portal/documents',{method:'POST',portal:magic,body:file,status:429});
  // Raising the cap allows exactly the remaining document bytes.
  const documentBytes=Buffer.from(file.data,'base64').length;
  db.prepare('UPDATE users SET usage_limits=? WHERE id=?').run(JSON.stringify({storage_mb:(signatureBytes+documentBytes)/1048576}),account.id);
  await req('/portal/documents',{method:'POST',token:client,headers:{'x-application-id':String(second)},body:file,status:201});
  assert.equal((await req('/usage/me',{token:client})).storage_bytes,signatureBytes+documentBytes);
  assert.equal((await req('/admin/usage',{token:admin})).storage_bytes,signatureBytes+documentBytes);
 });
 await t.test('upcoming includes today through seven days while overdue tasks remain counted separately',async()=>{
  const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const task=(title,date,status='PENDING')=>db.prepare("INSERT INTO tasks(lead_id,title,assignee_id,due_date,category,status) VALUES(?,?,1,?,'TASK',?)").run(first,title,date,status).lastInsertRowid;
  for(let n=0;n<30;n++)task('Old overdue '+n,day(-10));
  const today=task('Due today',day(0)),tomorrow=task('Due tomorrow',day(1)),last=task('Last day',day(7));
  task('Outside range',day(8));task('Completed',day(1),'DONE');
  const dashboard=await req('/dashboard',{token:admin});
  assert.deepEqual(dashboard.upcoming.map(r=>r.id),[today,tomorrow,last]);
  assert.equal(dashboard.overdue_tasks,30);
 });
});

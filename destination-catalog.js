const baseSchema=require('./public/application-schema');
module.exports=(db,ops,audit)=>{
 db.exec('CREATE TABLE IF NOT EXISTS pathway_aliases(name TEXT PRIMARY KEY,purpose TEXT NOT NULL)');
 const countries=()=>Object.values(ops.pricing().data).map(c=>c.label);
 const pathways=()=>({...baseSchema.pathways,...Object.fromEntries(db.prepare('SELECT * FROM pathway_aliases ORDER BY name').all().map(r=>[r.name,r.purpose]))});
 function register(v1,auth){
  v1.get('/public/catalog',(q,s)=>s.json({countries:countries(),pathways:pathways()}));
  v1.get('/admin/destinations',auth('admin'),(q,s)=>s.json({countries:countries(),pathways:pathways()}));
  v1.post('/admin/pathways',auth('admin'),(q,s)=>{const b=q.body;if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||Object.hasOwn(baseSchema.pathways,b.name.trim())||!['TOURIST','STUDY','WORK','RESIDENCY'].includes(b.purpose))return s.status(400).json({error:'NEW_PATHWAY_NAME_AND_CALCULATION_PURPOSE_REQUIRED'});if(db.prepare('SELECT name FROM pathway_aliases WHERE name=?').get(b.name.trim()))return s.status(409).json({error:'PATHWAY_ALREADY_EXISTS'});db.prepare('INSERT INTO pathway_aliases(name,purpose) VALUES(?,?)').run(b.name.trim(),b.purpose);audit('catalog',0,'PATHWAY_ADDED',q.user.name,null,b);s.status(201).json({ok:true})});
  v1.post('/admin/destinations',auth('admin'),(q,s)=>{try{
   const b=q.body,config=structuredClone(ops.pricing()),key='custom_'+Buffer.from(String(b.country)).toString('hex'),mapping={TOURIST:'tourist',STUDY:'student',WORK:'work',RESIDENCY:'residency'};
   if(typeof b.country!=='string'||!b.country.trim()||b.country.length>100||countries().some(c=>c.toLowerCase()===b.country.trim().toLowerCase())||typeof b.processor!=='string'||!b.processor.trim()||b.processor.length>500||b.confirm_reviewed!==true)throw Error('NEW_COUNTRY_PROCESSOR_AND_REVIEW_CONFIRMATION_REQUIRED');
   const entry={label:b.country.trim(),processor:b.processor.trim(),pathways:{}};
   for(const [purpose,type]of Object.entries(mapping)){
    const p=b.pathways?.[purpose];if(!p||typeof p.title!=='string'||!p.title.trim()||p.title.length>200||!Array.isArray(p.rows)||!p.rows.length||p.rows.length>100||p.rows.some(r=>!Array.isArray(r)||r.length!==3||typeof r[0]!=='string'||!r[0].trim()||r[0].length>300||!Number.isFinite(r[1])||!Number.isFinite(r[2])||r[1]<0||r[2]<r[1]||r[2]>1e8))throw Error('ALL_FOUR_PATHWAYS_REQUIRE_TITLES_AND_VALID_AED_RANGES');
    entry.pathways[type]={title:p.title.trim(),note:'ECC-entered estimates; verify the applicable category before quoting.',coverage:[],rows:p.rows};
   }
   config.data[key]=entry;config.competitorBenchmarks[key]={note:'No competitor benchmark supplied.',rows:[]};config.change_summary={country:entry.label,purpose:'TOURIST',rows:[]};
   const id=db.prepare("INSERT INTO pricing_versions(status,effective_from,config,created_by) VALUES('DRAFT',date('now'),?,?)").run(JSON.stringify(config),q.user.id).lastInsertRowid;
   audit('pricing',id,'DESTINATION_DRAFTED',q.user.name,null,{country:entry.label});s.status(201).json({id,note:'Review and approve this pricing version to publish the destination.'});
  }catch(e){s.status(400).json({error:e.message})}});
 }
 return {register,countries,pathways};
};

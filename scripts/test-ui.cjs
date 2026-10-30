const {spawnSync}=require('node:child_process');
for(const file of ['react-acceptance.cjs','basic-workflows-acceptance.cjs','browser-acceptance.cjs','admin-acceptance.cjs']){
 const result=spawnSync(process.execPath,[require('node:path').join(__dirname,file)],{stdio:'inherit',env:process.env});
 if(result.error){console.error(result.error.message);process.exit(1)}
 if(result.status!==0)process.exit(result.status||1);
}
console.log('All native React browser checks passed.');

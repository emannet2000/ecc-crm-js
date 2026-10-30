const esbuild=require('esbuild'),fs=require('node:fs/promises'),path=require('node:path'),ts=require('typescript');
const watch=process.argv.includes('--watch');
const options={entryPoints:['frontend/main.tsx'],bundle:true,outdir:'public/assets',entryNames:'app',minify:!watch,sourcemap:true,loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':JSON.stringify(watch?'development':'production')}};
async function browserSources(){
 for(const [name,globalName]of [['pricing-data','ECCPricing'],['visa-calculator','ECCCalculator'],['application-schema','ECCApplication']])
  await esbuild.build({entryPoints:['shared/'+name+'.ts'],bundle:true,platform:'browser',format:'iife',globalName,outfile:'public/'+name+'.js',target:'es2022',footer:{js:"if(typeof module === 'object' && module.exports) module.exports = "+globalName+";"}});
 for(const name of (await fs.readdir('browser')).filter(n=>n.endsWith('.ts'))){
  const source=await fs.readFile(path.join('browser',name),'utf8');
  const result=ts.transpileModule(source,{fileName:name,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,moduleDetection:ts.ModuleDetectionKind.Legacy}});
  await fs.writeFile(path.join('public',name.replace(/\.ts$/,'.js')),'// Generated from browser/'+name+'; edit the TypeScript source.\n'+result.outputText);
  if(name==='workspace-shell.ts'){const html=await fs.readFile('public/workspace.html','utf8');await fs.writeFile('public/workspace.html',html.replace(/<script>[\s\S]*?<\/script>/,()=>'<script>\n'+result.outputText+'</script>'))}
 }
}
(async()=>{await browserSources();if(watch){const ctx=await esbuild.context(options);await ctx.watch();console.log('Watching React TypeScript interface');}else await esbuild.build(options)})().catch(e=>{console.error(e);process.exit(1)});

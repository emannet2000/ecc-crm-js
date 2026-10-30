const esbuild=require('esbuild');
const options={entryPoints:['frontend/main.jsx'],bundle:true,outdir:'public/assets',entryNames:'app',minify:!process.argv.includes('--watch'),sourcemap:true,loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':JSON.stringify(process.argv.includes('--watch')?'development':'production')}};
(async()=>{if(process.argv.includes('--watch')){const ctx=await esbuild.context(options);await ctx.watch();console.log('Watching React interface');}else await esbuild.build(options)})().catch(()=>process.exit(1));

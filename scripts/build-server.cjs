const {execFileSync}=require('node:child_process');
execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.json'],{stdio:'inherit'});

const fs=require('node:fs'),path=require('node:path');
if(!fs.existsSync(path.join(__dirname,'../dist/server.js')))require('./build-server.cjs');

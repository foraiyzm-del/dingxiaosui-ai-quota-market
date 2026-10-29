import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const source=path.resolve(import.meta.dirname,'..');
const destination=path.resolve(process.argv[2]||'');
if(!process.argv[2] || destination===source || destination.startsWith(source+path.sep))throw new Error('Specify a fresh test directory outside the source project');
try{await fs.access(destination);throw new Error('Test directory already exists; no overwrite allowed')}catch(e){if(e.code!=='ENOENT')throw e}
const excluded=new Set(['node_modules','.git','.wrangler','.sites-runtime','.next','.vinext','dist','backend-stage','.sites-package-v3','deliverables','.local-test']);
await fs.cp(source,destination,{recursive:true,filter:p=>{const rel=path.relative(source,p),parts=rel.split(path.sep);return !parts.some(x=>excluded.has(x)||x.startsWith('.env')||x.startsWith('.dev.vars'))&&!/\.tar(\.gz)?$/.test(p)}});
await fs.symlink(await fs.realpath(path.join(source,'node_modules')),path.join(destination,'node_modules'),'junction');
await fs.writeFile(path.join(destination,'.openai/hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
await fs.writeFile(path.join(destination,'.dev.vars'),`APP_ENV=local\nLOCAL_AUTH_ENABLED=1\nLOCAL_AUTH_SECRET=${randomBytes(32).toString('hex')}\nAI_CONFIG_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nPLATFORM_ADMIN_SUBJECTS=local-test:test-platform\n`);
console.log('Fresh isolated test source prepared:',destination);
console.log('No database copied. Existing dependencies reused; no install performed.');

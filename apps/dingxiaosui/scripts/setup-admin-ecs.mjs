import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {sqlite} from '../runtime/node-env.mjs';
const db=sqlite();
if(db.prepare('SELECT id FROM password_accounts WHERE platform_admin=1').get())throw Error('An administrator already exists; no setup link issued');
if(!process.env.APP_ORIGIN)throw Error('APP_ORIGIN required');
const token=randomBytes(32).toString('hex');
db.exec('BEGIN IMMEDIATE');
try{db.prepare('UPDATE setup_tokens SET consumed=1 WHERE consumed=0').run();db.prepare('INSERT INTO setup_tokens(token_hash,expires_at) VALUES (?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+86400000);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
const out=path.resolve(process.env.ZDX_DATA_DIR||'./data','admin-setup.txt');
fs.writeFileSync(out,`${process.env.APP_ORIGIN}/login#setup=${token}\n`,{mode:0o600});
console.log('One-use setup link written to protected file:',out);

// Exercises the real password-auth handler against in-memory SQLite only.
// No existing data, network, paid model, or persistent account is touched.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');
const env={APP_ENV:'production',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:'http://127.0.0.1:8845',EVENT_ACTIVATION_ENABLED:'0'};
globalThis.__zdxEventAuthTestEnv=env;
const source=fs.readFileSync(path.join(root,'lib/password-auth.ts'),'utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.__zdxEventAuthTestEnv;');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {authAction,passwordIdentity,digest}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const password='Only-In-Memory-Test-Password';
function fixture(eventMode){
 const database=new DatabaseSync(':memory:');
 database.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())database.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 class Statement{
  constructor(sql,values=[]){this.sql=sql;this.values=values}
  bind(...values){return new Statement(this.sql,values)}
  async first(){return database.prepare(this.sql).get(...this.values)||null}
  async run(){return database.prepare(this.sql).run(...this.values)}
 }
 env.EVENT_ACTIVATION_ENABLED=eventMode?'1':'0';
 env.DB={prepare:sql=>new Statement(sql),async batch(statements){database.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec('COMMIT');return results}catch(error){database.exec('ROLLBACK');throw error}}};
 return database;
}
async function request(username,action='register',ip='same-event-wifi',origin=env.APP_ORIGIN){return authAction(new Request(env.APP_ORIGIN+'/api/auth',{method:'POST',headers:{origin,'content-type':'application/json','x-real-ip':ip},body:JSON.stringify({action,username,password,displayName:'受控测试账号'})}));}
async function status(response,expected){assert.equal(response.status,expected,await response.text());}
const checks=[];
let database=fixture(false);
try{
 for(let i=0;i<10;i++)await status(await request('normal-register-'+i),200);
 await status(await request('normal-register-11'),429);checks.push('ordinary registration remains 10 per IP per hour');
 for(let i=0;i<30;i++)await status(await request('normal-attempt-'+i,'invalid','ordinary-attempt-ip'),400);
 await status(await request('normal-attempt-31','invalid','ordinary-attempt-ip'),429);checks.push('ordinary attempts remain 30 per IP per 15 minutes');
}finally{database.close()}
database=fixture(true);
try{
 // Real registrations from one network, without lowering password hashing cost.
 const registrations=await Promise.all(Array.from({length:30},(_,i)=>request('event-guest-'+i)));
 for(const result of registrations)await status(result,200);
 assert.equal(database.prepare('SELECT COUNT(*) AS n FROM password_accounts').get().n,30);
 checks.push('30 concurrent guests can register from one IP');
 const login=await request('event-guest-0','login','session-check-ip');assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert((await passwordIdentity(new Headers({cookie})))?.displayName==='受控测试账号');checks.push('registered guest can log in and resolve a session');
 database.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,?,?)').run(await digest('register:register-boundary-ip'),99,Date.now()+3600_000);
 await status(await request('event-register-100','register','register-boundary-ip'),200);
 await status(await request('event-register-101','register','register-boundary-ip'),429);checks.push('event registration blocks the 101st attempt per IP per hour');
 for(let i=0;i<300;i++)await status(await request('event-attempt-'+i,'invalid','event-attempt-ip'),400);
 await status(await request('event-attempt-301','invalid','event-attempt-ip'),429);checks.push('event total attempts block at 301 per IP per 15 minutes');
 for(let i=0;i<10;i++)await status(await request('same-account-limit','invalid','per-account-ip-'+i),400);
 await status(await request('same-account-limit','invalid','per-account-ip-11'),429);checks.push('per-account 10 per 15 minutes remains enforced across IPs');
 await status(await request('cross-site-guest','register','origin-ip','https://untrusted.invalid'),403);checks.push('same-origin protection remains enforced');
 assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log(JSON.stringify({passed:true,checks,storage:'in-memory SQLite; no persistent users or model calls'},null,2));
}finally{database.close();delete globalThis.__zdxEventAuthTestEnv}

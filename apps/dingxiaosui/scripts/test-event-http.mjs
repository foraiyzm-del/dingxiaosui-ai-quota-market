// Real HTTP auth/admin/redemption checks in a new private fixture. No model calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const port=8846,origin=`http://127.0.0.1:${port}`,folder=path.resolve('.ecs-test','event-http-'+Date.now()),dataDir=path.join(folder,'data'),app=path.join(folder,'app');
await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});
for(const key of Object.keys(process.env))if(/^(?:AI_|OPENAI_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|ZLG_|PLATFORM_ADMIN_)/.test(key))delete process.env[key];
Object.assign(process.env,{ZDX_DATA_DIR:dataDir,APP_ENV:'production',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:origin,AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),EVENT_ACTIVATION_ENABLED:'1',ZLG_GATEWAY_REQUIRED:'0',NEXT_TELEMETRY_DISABLED:'1'});
await import('./migrate-ecs.mjs');const {sqlite}=await import('../runtime/node-env.mjs');
fs.cpSync(path.resolve('.next/standalone'),app,{recursive:true,filter:source=>!/^\.env(?:\.|$)|^\.dev\.vars/.test(path.basename(source))});fs.cpSync(path.resolve('public'),path.join(app,'public'),{recursive:true});fs.cpSync(path.resolve('.next/static'),path.join(app,'.next/static'),{recursive:true});
let server,checks=0;
async function start(){server=spawn(process.execPath,[path.join(app,'server.js')],{cwd:app,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'ignore'});for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Server stopped');try{if((await fetch(origin+'/api/me')).status===401)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server not ready');}
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}}
async function request(route,{cookie='',method='GET',body,from=origin,owner='',contentType='application/json'}={}){const r=await fetch(origin+route,{method,headers:{origin:from,'content-type':contentType,...(cookie?{cookie}:{}),...(owner?{'x-zdx-credit-owner':owner}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function expect(r,status=200){assert.equal(r.status,status,JSON.stringify(r.data));checks++;return r.data;}
async function account(name){const r=await request('/api/auth',{method:'POST',body:{action:'register',username:'event-'+randomBytes(8).toString('hex'),password:randomBytes(20).toString('hex'),displayName:name}});expect(r);const me=expect(await request('/api/me',r));return {cookie:r.cookie,id:me.user.id};}
const management='/api/platform/event-codes',wallet='/api/account/event-credits';
try{
 await start();const admin=await account('isolated administrator');sqlite().prepare("UPDATE password_accounts SET platform_admin=1 WHERE id=(SELECT subject FROM auth_identities WHERE user_id=? AND provider='password')").run(admin.id);
 const guests=await Promise.all(Array.from({length:30},(_,i)=>account('HTTP guest '+i)));
 expect(await request(wallet),401);expect(await request(management),401);expect(await request(management,guests[0]),403);
 const before=expect(await request(wallet,guests[0]));assert(before.quotas.every(q=>q.available===0));assert.equal(before.activated,false);
 const issue={action:'issue',requestId:randomUUID(),count:50,label:'isolated 50-card HTTP test'};
 expect(await request(management,{...guests[0],method:'POST',body:issue}),403);
 expect(await request(management,{...admin,method:'POST',body:issue,from:'https://untrusted.invalid'}),403);
 expect(await request(management,{...admin,method:'POST',body:issue,contentType:'text/plain'}),415);
 const issued=expect(await request(management,{...admin,method:'POST',body:issue}));assert.equal(issued.codes.length,50);assert.equal(new Set(issued.codes).size,50);
 assert.deepEqual(expect(await request(management,{...admin,method:'POST',body:issue})).codes,[]);
 expect(await request(management,{...admin,method:'POST',body:{...issue,count:49}}),409);
 const startTime=Date.now(),redemptions=await Promise.all(guests.map((guest,i)=>request(wallet,{...guest,method:'POST',body:{code:issued.codes[i]}})));
 for(const r of redemptions){const d=expect(r);assert.equal(d.quotas.find(q=>q.capability==='image').available,5);assert.equal(d.quotas.find(q=>q.capability==='text').available,10);for(const q of d.quotas)assert(Math.abs(Date.parse(q.expiresAt)-startTime-7*86400000)<30000);}
 assert.equal(expect(await request(wallet,{...guests[0],method:'POST',body:{code:issued.codes[0]}})).alreadyRedeemed,true);
 expect(await request(wallet,{...guests[1],method:'POST',body:{code:issued.codes[0]}}),409);
 expect(await request(wallet,{...guests[0],method:'POST',body:{code:issued.codes[30]},owner:guests[1].id}),403);
 expect(await request(wallet,{...guests[0],method:'POST',body:{code:issued.codes[30],userId:guests[1].id}}),400);
 const raceGuests=await Promise.all([account('unactivated race guest A'),account('unactivated race guest B')]);
 const race=await Promise.all(raceGuests.map(g=>request(wallet,{...g,method:'POST',body:{code:issued.codes[30]}})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);checks+=2;
 const overview=expect(await request(management+'?batchId='+issued.batchId,admin));assert.equal(overview.codes.length,50);assert(!JSON.stringify(overview).includes(issued.codes[0]));assert(!JSON.stringify(overview).includes('code_hash'));
 const revoked=expect(await request(management,{...admin,method:'POST',body:{action:'revoke',batchId:issued.batchId,reason:'isolated unused code revocation'}}));assert.equal(revoked.revoked,19);
 expect(await request(wallet,{...raceGuests[race.findIndex(result=>result.status===409)],method:'POST',body:{code:issued.codes[31]}}),400);
 const compatibility=expect(await request('/api/account/credits',guests[3]));assert.equal(compatibility.available,10);assert.equal(compatibility.welcome.credits,0);
 assert.equal(sqlite().prepare("SELECT count(*) n FROM text_credit_ledger").get().n,0);
 expect(await request('/api/platform/activation-codes',{...admin,method:'POST',body:{action:'issue'}}),409);
 const catalog=expect(await request('/api/credit-plans'));assert.equal(catalog.mode,'event');assert.equal(catalog.plans.filter(p=>p.kind==='paid').length,0);
 const saved=expect(await request(wallet,guests[3]));await stop();await start();assert.deepEqual(expect(await request(wallet,guests[3])),saved);
 for(const route of ['/account/event','/platform/event-codes','/platform/services']){const r=await fetch(origin+route,{headers:{cookie:admin.cookie}});assert.equal(r.status,200);checks++;}
 assert.equal(sqlite().prepare('PRAGMA foreign_key_check').all().length,0);
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({scope:'isolated real HTTP, local password auth, 30 parallel registrations/redemptions, restart persistence; no live AI or payment',checks,passed:true},null,2));
 console.log('PASS:',checks,'HTTP checks. Evidence:',path.join(folder,'results.json'));
}finally{await stop();sqlite().close();}

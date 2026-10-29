// Real HTTP and SQLite checks in a disposable database. Never loads .env.local or calls a model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
const dataDir=path.join(root,'.ecs-test','activation-http-'+Date.now());
const portArg=process.argv.indexOf('--port'),port=portArg<0?8829:Number(process.argv[portArg+1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid test port');
const origin=`http://${process.argv.includes('--ui')?'localhost':'127.0.0.1'}:${port}`,standalone=path.join(root,'.next/standalone');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
Object.assign(process.env,{ZDX_DATA_DIR:dataDir,APP_ENV:'production',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:origin,AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'});
for(const key of ['OPENAI_API_KEY','ARK_API_KEY','DASHSCOPE_API_KEY','DEEPSEEK_API_KEY','LOCAL_OPENAI_ENABLED','LOCAL_AUTH_ENABLED','PLATFORM_ADMIN_SUBJECTS'])delete process.env[key];
await import('./migrate-ecs.mjs');const {sqlite}=await import('../runtime/node-env.mjs');
fs.cpSync(path.join(root,'public'),path.join(standalone,'public'),{recursive:true});fs.cpSync(path.join(root,'.next/static'),path.join(standalone,'.next/static'),{recursive:true});
let server,checks=0;
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}}
async function start(){server=spawn(process.execPath,[path.join(standalone,'server.js')],{cwd:standalone,env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:'ignore'});for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Test server stopped');try{if((await fetch(origin+'/api/me')).status===401)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server not ready');}
async function request(route,{cookie='',method='GET',body,from=origin,contentType='application/json',creditOwner=''}={}){const response=await fetch(origin+route,{method,headers:{...(cookie?{cookie}:{}),...(from?{origin:from}:{}),...(creditOwner?{'x-zdx-credit-owner':creditOwner}:{}),'content-type':contentType},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
function expect(result,status){assert.equal(result.status,status,JSON.stringify(result.data));checks++;return result.data;}
async function account(name){const username='code-'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');const r=await request('/api/auth',{method:'POST',body:{action:'register',username,password,displayName:name}});expect(r,200);const me=expect(await request('/api/me',{cookie:r.cookie}),200);return {cookie:r.cookie,username,password,id:me.user.id};}
try{
 await start();const admin=await account('发码验收管理员'),a=await account('兑换验收客户'),b=await account('并发验收客户');
 sqlite().prepare('UPDATE password_accounts SET platform_admin=1 WHERE username=?').run(admin.username);
 const management='/api/platform/activation-codes',wallet='/api/account/credits';
 expect(await request(management),401);expect(await request(wallet),401);expect(await request(management,a),403);
 const firstWallet=expect(await request(wallet,a),200);assert.equal(firstWallet.available,5);assert.equal(firstWallet.entries.filter(e=>e.kind==='welcome').length,1);const trialReads=await Promise.all(Array.from({length:8},()=>request(wallet,a)));for(const read of trialReads)assert.equal(expect(read,200).available,5);
 const issue={action:'issue',kind:'gift',label:'隔离验收 · 体验',credits:3,count:2,requestId:randomUUID()};
 expect(await request(management,{...a,method:'POST',body:issue}),403);
 for(const from of ['https://untrusted.invalid',''])expect(await request(management,{...admin,method:'POST',body:issue,from}),403);
 expect(await request(management,{...admin,method:'POST',body:issue,contentType:'text/plain'}),415);
 const issued=expect(await request(management,{...admin,method:'POST',body:issue}),200);assert.equal(issued.codes.length,2);
 const replay=expect(await request(management,{...admin,method:'POST',body:issue}),200);assert.equal(replay.batchId,issued.batchId);assert.deepEqual(replay.codes,[]);
 expect(await request(management,{...admin,method:'POST',body:{...issue,credits:4}}),409);
 for(const from of ['https://untrusted.invalid',''])expect(await request(wallet,{...a,method:'POST',body:{code:issued.codes[0]},from}),403);
 const redeemed=expect(await request(wallet,{...a,method:'POST',body:{code:issued.codes[0]}}),200);assert.equal(redeemed.available,8);assert.equal(redeemed.credited,3);
 assert.equal(expect(await request(wallet,{...a,method:'POST',body:{code:issued.codes[0]}}),200).credited,0);
 expect(await request(wallet,{...b,method:'POST',body:{code:issued.codes[0]}}),409);
 expect(await request(wallet,{...a,method:'POST',body:{code:issued.codes[0],userId:b.id}}),400);
 assert.equal(expect(await request(wallet,b),200).balance,5);
 const overview=expect(await request(management+'?batchId='+issued.batchId,admin),200);assert.equal(overview.codes.length,2);assert(!JSON.stringify(overview).includes(issued.codes[0]));assert(!JSON.stringify(overview).includes('code_hash'));
 assert.equal(expect(await request(management,{...admin,method:'POST',body:{action:'revoke',batchId:issued.batchId}}),200).revoked,1);
 expect(await request(wallet,{...a,method:'POST',body:{code:issued.codes[1]}}),400);
 const paid=expect(await request(management,{...admin,method:'POST',body:{...issue,kind:'paid',amountMinor:9900,count:1,requestId:randomUUID()}}),200);
 const race=await Promise.all([a,b].map(user=>request(wallet,{...user,method:'POST',body:{code:paid.codes[0]}})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);checks+=2;
 const savedA=expect(await request(wallet,a),200),savedB=expect(await request(wallet,b),200);assert.equal(savedA.balance+savedB.balance,16);
 await stop();await start();assert.deepEqual(expect(await request(wallet,a),200),savedA);assert.deepEqual(expect(await request(wallet,b),200),savedB);
 const login=await request('/api/auth',{method:'POST',body:{action:'login',username:a.username,password:a.password}});expect(login,200);assert.equal(expect(await request(wallet,{cookie:login.cookie}),200).available,savedA.available);
 const catalog=expect(await request('/api/credit-plans'),200);assert.equal(catalog.plans.find(p=>p.id==='daily-80').credits,80);assert.equal(catalog.plans.find(p=>p.id==='daily-80').amountMinor,9900);assert.equal(catalog.service.available,false);assert(!/apiKey|key_cipher|OPENAI_API_KEY/.test(JSON.stringify(catalog)));
 expect(await request(wallet,{...a,creditOwner:b.id}),403);expect(await request(wallet,{...a,method:'POST',creditOwner:b.id,body:{code:paid.codes[0]}}),403);
 const fixed=expect(await request(management,{...admin,method:'POST',body:{action:'issue',planId:'daily-80',kind:'gift',credits:9999,amountMinor:1,count:1,requestId:randomUUID()}}),200);
 const fixedBatch=expect(await request(management,admin),200).batches.find(row=>row.id===fixed.batchId);assert.equal(fixedBatch.credits,80);assert.equal(fixedBatch.amountMinor,9900);assert.equal(fixedBatch.kind,'paid');
 expect(await request(management,{...admin,method:'POST',body:{action:'issue',planId:'not-real',count:1,requestId:randomUUID()}}),400);
 const trial=expect(await request(management,{...admin,method:'POST',body:{action:'issue',planId:'trial-5',count:1,requestId:randomUUID()}}),200),event=expect(await request(management,{...admin,method:'POST',body:{action:'issue',planId:'event-10',count:1,requestId:randomUUID()}}),200);
 expect(await request(wallet,{...b,method:'POST',body:{code:trial.codes[0]}}),409);expect(await request(wallet,{...b,method:'POST',body:{code:event.codes[0]}}),200);
 const landing=await fetch(origin+'/index.html');assert.equal(landing.status,200);const html=await landing.text();assert(html.includes('99')&&html.includes('80')&&html.includes('新客户体验')&&!html.includes('<!-- CREDIT_OFFERS -->'));checks++;
 if(process.argv.includes('--ui')){
  const uiCode=expect(await request(management,{...admin,method:'POST',body:{...issue,label:'页面验收专用体验',credits:10,count:1,requestId:randomUUID()}}),200).codes[0];
  const file=path.join(dataDir,'ui-credentials.json');fs.writeFileSync(file,JSON.stringify({admin:{username:admin.username,password:admin.password},customer:{username:a.username,password:a.password},code:uiCode}),{mode:0o600});
  // A clearly isolated ledger fixture for visual QA; this is not a real model result.
  const usageId=randomUUID(),time=new Date().toISOString();sqlite().exec('BEGIN IMMEDIATE');try{sqlite().prepare("INSERT INTO text_credit_usage(id,user_id,request_key,request_hash,units,status,created_at,expires_at,completed_at) VALUES (?,?,?,'visual-fixture',1,'succeeded',?,?,?)").run(usageId,a.id,'ui-controlled-use',time,time,time);sqlite().prepare("INSERT INTO text_credit_ledger(id,user_id,delta,kind,usage_id,note,created_at) VALUES (?,?,-1,'usage',?,'页面验收 · 山西小米朋友圈',?)").run(randomUUID(),a.id,usageId,time);sqlite().exec('COMMIT');}catch(error){sqlite().exec('ROLLBACK');throw error;}
  console.log('PASS: '+checks+' HTTP checks; isolated UI fixture '+origin+'; private credentials: '+file);
  await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});
 }
 assert.equal(sqlite().prepare('PRAGMA foreign_key_check').all().length,0);
 console.log('PASS: '+checks+' real HTTP checks: admin access, account isolation, same-origin enforcement, request replay, gift/paid codes, single-use concurrency, revocation and restart persistence. No live model or payment.');
}finally{await stop();sqlite().close();fs.rmSync(dataDir,{recursive:true,force:true});}

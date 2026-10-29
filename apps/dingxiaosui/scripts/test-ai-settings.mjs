import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
if(JSON.parse(fs.readFileSync('.openai/hosting.json')).project_id||!fs.readFileSync('.dev.vars','utf8').includes('APP_ENV=local'))throw Error('Isolated local copy required');
const base='http://127.0.0.1:8813',phase=process.argv[2]||'before-restart';
const state=JSON.parse(fs.readFileSync('.local-test/private-session.json','utf8')),c=state.cookies;
const dir='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const database=new DatabaseSync(path.join(dir,fs.readdirSync(dir).find(x=>x.endsWith('.sqlite'))));
database.exec('PRAGMA busy_timeout=5000;');
const row=()=>database.prepare('SELECT * FROM ai_settings WHERE id=1').get();
const endpoint='/api/platform/ai-settings',results=[];
const key1='local-fixture-key-one',key2='local-fixture-key-two';
async function request(url,{cookie=c.platform,method='GET',body,headers={}}={},status=200){
 const response=await fetch(base+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(7000)});
 const text=await response.text();
 assert(!text.includes(key1)&&!text.includes(key2)&&!text.includes('upstream secret'),'Response exposed a secret');
 assert.equal(response.status,status,`${method} ${url}: ${response.status} ${text.slice(0,120)}`);
 return JSON.parse(text);
}
async function test(name,work){try{const evidence=await work();results.push({name,passed:true,...evidence});console.log('PASS',name)}catch(e){results.push({name,passed:false,error:e.message});throw e}}
async function save(changes={},status=200){const config=(await request(endpoint)).config;const body={kind:config.kind,endpoint:config.endpoint,model:config.model,enabled:config.enabled,jsonMode:config.jsonMode,revision:config.revision,apiKey:'',clearKey:false,...changes};return request(endpoint,{method:'PUT',body},status);}
async function connection(status=200){const config=(await request(endpoint)).config;return request(endpoint+'/test',{method:'POST',body:{revision:config.revision,consent:true}},status)}
const bodies={
 '/api/assist':{consent:true,kind:'会议纪要',context:'本地测试会议记录，确认资料后再发布。'},
 '/api/agent':{consent:true,kind:'daily',context:'本地测试，今天如何整理真实农品资料？',product:{name:'测试农品'}},
 '/api/mascot-chat':{consent:true,question:'有哪些资料？',context:'仅供本地模拟验收，无真实商品信息。'},
 '/api/generate':{consent:true,product:{name:'测试农品',summary:'仅供本地测试'},brief:{topic:'本地模拟'},channels:['朋友圈','小红书']},
};
try{
 if(phase==='before-restart'){
  await test('anonymous and merchants cannot read, save, or test platform configuration',async()=>{
   const before=row();
   for(const cookie of ['',c.ownerA,c.memberA,c.ownerB])for(const [url,method] of [[endpoint,'GET'],[endpoint,'PUT'],[endpoint+'/test','POST']])await request(url,{cookie,method,body:method==='GET'?undefined:{apiKey:key1,userId:state.users.platform.id}},cookie?403:401);
   assert.deepEqual(row(),before);return {requests:12,databaseUnchanged:true,statuses:[401,403]};
  });
  await test('unsafe endpoints and unsupported interface types rejected without saving',async()=>{
   const before=row();for(const url of ['http://api.deepseek.com/chat/completions','https://127.0.0.1/chat/completions','https://outside.example/chat/completions','https://user:pass@api.deepseek.com/chat/completions','https://api.deepseek.com/chat/completions?key=x','https://api.deepseek.com:444/chat/completions','https://api.deepseek.com/responses'])await save({endpoint:url,model:'test-ok',apiKey:key1},400);
   await save({kind:'unsupported',model:'test-ok',apiKey:key1},400);assert.deepEqual(row(),before);return {rejected:8,status:400,databaseUnchanged:true};
  });
  await test('save encrypts key in D1; public/admin responses never return key or ciphertext',async()=>{
   const saved=await save({model:'test-ok',apiKey:key1,enabled:false});assert(saved.config.hasKey);assert(row().key_cipher.startsWith('v1.'));assert(!row().key_cipher.includes(key1));
   assert(!JSON.stringify(saved).includes(row().key_cipher));
   const engine=await request('/api/engine',{cookie:''});assert.equal(engine.mode,'template');assert(!JSON.stringify(engine).includes('endpoint'));
   const result=await connection();assert.equal(result.simulated,true);return {encryptedInD1:true,keyReturned:false,test:result};
  });
  await test('blank key preserves secret, replacement works, endpoint change requires re-entry, stale revision rejected',async()=>{
   const old=row();await save();assert.equal(row().key_cipher,old.key_cipher);
   await save({revision:old.revision},409);
   await save({endpoint:'https://api.openai.com/v1/chat/completions'},400);
   await save({apiKey:key2});assert.notEqual(row().key_cipher,old.key_cipher);assert.equal((await connection()).simulated,true);
   return {blankPreserved:true,replacementVerified:true,staleRevision:409,endpointProtection:400};
  });
  await test('provider failures and invalid formats fail explicitly; no secret echo or fake success',async()=>{
   const errors=[];for(const model of ['test-unauthorized','test-rate-limit','test-bad-json','test-wrong-format']){await save({model});errors.push((await connection(502)).error)}
   return {cases:4,status:502,errors};
  });
  await test('Qwen and Ark request dialects pass synthetic upstream checks',async()=>{
   for(const [kind,model] of [['qwen','test-qwen'],['ark','test-ark']]){await save({kind,model});assert.equal((await connection()).simulated,true)}
   await save({kind:'openai-compatible',model:'test-ok',enabled:true});return {dialects:['qwen','ark'],simulated:true};
  });
  await test('all four text APIs use managed config; active ordinary member may generate',async()=>{
   assert.equal((await request('/api/engine',{cookie:''})).access,'account');
   for(const [url,body] of Object.entries(bodies)){const result=await request(url,{method:'POST',cookie:c.ownerA,body});assert(JSON.stringify(result).includes('本地模拟'))}
   await request('/api/assist',{method:'POST',cookie:c.memberA,body:bodies['/api/assist']});return {endpoints:Object.keys(bodies),status:200,upstream:'local synthetic only'};
  });
  await test('consent, active membership, user status, and same origin enforced before paid call',async()=>{
   const quota=()=>JSON.stringify(database.prepare('SELECT * FROM ai_pilot_usage ORDER BY period').all()),before=quota();
   for(const [url,body] of Object.entries(bodies))await request(url,{method:'POST',cookie:'',headers:{'x-zdx-pilot-code':'forged','oai-authenticated-user-id':'test-platform'},body},401);
   await request('/api/assist',{method:'POST',cookie:c.ownerA,body:{...bodies['/api/assist'],consent:false}},400);
   await request('/api/assist',{method:'POST',cookie:c.ownerA,headers:{origin:'https://outside.example'},body:bodies['/api/assist']},403);
   const merchantURL='/api/platform/merchants/'+state.A.id;
   await request(merchantURL,{method:'PATCH',body:{status:'disabled'}});
   try{await request('/api/assist',{method:'POST',cookie:c.ownerA,body:bodies['/api/assist']},403)}finally{await request(merchantURL,{method:'PATCH',body:{status:'active'}})}
   database.prepare("UPDATE users SET status='disabled' WHERE id=?").run(state.users.ownerA.id);
   try{await request('/api/assist',{method:'POST',cookie:c.ownerA,body:bodies['/api/assist']},403)}finally{database.prepare("UPDATE users SET status='active' WHERE id=?").run(state.users.ownerA.id)}
   assert.equal(quota(),before);return {anonymous:401,consent:400,crossOrigin:403,disabledMerchant:403,disabledUser:403,noQuotaSpent:true};
  });
  await test('body-bearing rejection stability: 60 requests, zero retries or unexpected 503',async()=>{
   const before=row();for(let i=0;i<30;i++){await request(endpoint,{cookie:c.ownerB,method:'PUT',body:{apiKey:key1}},403);await request('/api/assist',{cookie:'',method:'POST',body:bodies['/api/assist']},401)}
   assert.deepEqual(row(),before);return {requests:60,retries:0,timeouts:0,unexpected503:0,databaseUnchanged:true};
  });
  fs.writeFileSync('.local-test/ai-restart-check.json',JSON.stringify({revision:row().revision,updatedAt:row().updated_at}));
 }else if(phase==='after-restart'){
  await test('full Worker restart preserves encrypted config and successful simulated use',async()=>{
   const saved=JSON.parse(fs.readFileSync('.local-test/ai-restart-check.json'));assert.equal(row().revision,saved.revision);assert.equal(row().updated_at,saved.updatedAt);
   const result=await connection();assert.equal(result.simulated,true);await request('/api/assist',{method:'POST',cookie:c.ownerA,body:bodies['/api/assist']});return {sameRevision:true,encryptedKeyStillUsable:true,simulated:true};
  });
  await test('disable and clear take effect; no fallback to another paid provider',async()=>{
   await save({enabled:false,clearKey:true});assert.equal(row().key_cipher,'');assert.equal((await request('/api/engine',{cookie:''})).mode,'template');
   await request('/api/assist',{method:'POST',cookie:c.ownerA,body:bodies['/api/assist']},503);await connection(400);
   return {keyCleared:true,disabledStatus:503,testWithoutKey:400,previewLeftDisabled:true};
  });
 }else if(phase==='production-build'){
  await test('production build rejects test identity and AI management even with local runtime variables and mock binding',async()=>{
   const before=row();
   for(const [url,method] of [[endpoint,'GET'],[endpoint,'PUT'],[endpoint+'/test','POST']])await request(url,{method,body:method==='GET'?undefined:{revision:before.revision,consent:true}},503);
   const r=await fetch(base+'/api/local/session',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'identity=platform',redirect:'manual'});await r.arrayBuffer();assert.equal(r.status,404);
   assert.deepEqual(row(),before);return {managementStatus:503,localLoginStatus:404,databaseUnchanged:true,productionLogin:'NOT integrated or verified'};
  });
 }else throw Error('Unknown phase');
}finally{
 fs.writeFileSync('.local-test/ai-'+phase+'-results.json',JSON.stringify({at:new Date().toISOString(),phase,identity:'explicit local-test identity only',model:'local synthetic upstream only; no real API key or paid call',base,retries:0,results},null,2));database.close();
}

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

// Every network call below is a controlled mock; this script never loads an env file.
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
process.env.ZDX_DATA_DIR=path.resolve('.ecs-test',`apimart-${Date.now()}-${randomBytes(3).toString('hex')}`);
process.env.AI_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
delete process.env.EVENT_ACTIVATION_ENABLED;
await import('./migrate-ecs.mjs');
const runtime=await import('../runtime/node-env.mjs'),database=runtime.sqlite(),now=new Date().toISOString();
for(const id of ['admin','a','b',...Array.from({length:30},(_,i)=>`guest-${i}`)]){
 database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,now);
 database.prepare("INSERT INTO auth_identities VALUES (?,?,'password',?,?)").run(id,id,id,now);
}
database.prepare("INSERT INTO merchants VALUES ('merchant-a','Fixture','active','admin',?)").run(now);
for(const id of ['a',...Array.from({length:30},(_,i)=>`guest-${i}`)])database.prepare("INSERT INTO merchant_memberships VALUES ('merchant-a',?,'member','active',?)").run(id,now);
const dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=who=>who.userId==='admin';");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>globalThis.testWho?{userId:globalThis.testWho,provider:'password',displayName:globalThis.testWho}:null;");
function compile(name){let source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','request-body','tenancy','ai-config','media-config','user-models','shanxi-knowledge','ding-persona','agriculture-policy','media-jobs'])compile(name);
const get=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href);
const protocol=await get('apimart-protocol'),ai=await get('ai-config'),config=await get('media-config'),models=await get('user-models'),jobs=await get('media-jobs'),credits=await get('event-credits');
const who=id=>({id,displayName:id,identity:{provider:'password',userId:id},platformAdmin:id==='admin'});
const secret='isolated-fixture-'+randomBytes(16).toString('hex'),png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
let assetHost='upload.apimart.ai',postMode='ok',taskMode='completed',downloadMode='ok',posts=0,gets=0,downloads=0,lastPayload,lastAuthorization;
const results=[];
async function check(name,work){await work();results.push({name,passed:true});console.log('PASS',name);}
const request=(changes={})=>({capability:'image',modelId:null,prompt:'山西小米农产品宣传图',consent:true,idempotencyKey:randomUUID(),...changes});
const resetLimits=()=>database.prepare("DELETE FROM auth_limits WHERE key LIKE 'media:%'").run();
const unlock=id=>database.prepare('UPDATE media_jobs SET poll_after=0 WHERE id=?').run(id);
globalThis.fetch=async(url,init={})=>{
 const actual=String(url);
 if(actual===protocol.APIMART_IMAGE_ENDPOINT&&init.method==='POST'){
  posts++;lastPayload=JSON.parse(init.body);lastAuthorization=init.headers.authorization;assert.equal(init.redirect,'manual');
  if(postMode==='network')throw Error(secret);
  if(postMode==='429')return Response.json({error:{message:secret}},{status:429});
  if(postMode==='500')return Response.json({error:{message:secret}},{status:500});
  return Response.json({code:200,data:[{status:'submitted',task_id:`task_fixture_${posts}`}]});
 }
 if(actual.startsWith('https://api.apimart.ai/v1/tasks/')){
  gets++;const id=new URL(actual).pathname.split('/').at(-1);await new Promise(resolve=>setTimeout(resolve,1));
  return Response.json({code:200,data:{id,status:taskMode,...(taskMode==='completed'?{result:{images:[{url:['https://'+assetHost+'/f/image/'+id+'.png'],expires_at:Math.floor(Date.now()/1000)+86400}]}}:{})}});
 }
 if(['upload.apimart.ai','getapib.org'].some(host=>actual.startsWith('https://'+host+'/f/image/'))){
  downloads++;assert.equal(init.redirect,'manual');assert.equal(init.headers,undefined,'Never send the API Key to an asset host');
  if(downloadMode==='fail')throw Error(secret);
  if(downloadMode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});
  return new Response(png);
 }
 throw Error('Unexpected network call blocked: '+new URL(actual).hostname);
};

await check('explicit nonstreaming text protocol and supplier-specific quota errors',async()=>{
 const provider={name:'APIMart',kind:'openai-compatible',endpoint:protocol.APIMART_TEXT_ENDPOINT,model:protocol.APIMART_TEXT_MODEL,key:secret,jsonMode:true};
 assert.equal(ai.validateEndpoint(provider.endpoint),provider.endpoint);
 assert.throws(()=>ai.validateEndpoint('https://api.apimart.ai.attacker.example/v1/chat/completions'));
 assert.equal(ai.modelPayload(provider,[{role:'user',content:'fixture'}],100).stream,false);
 const mediaFetch=globalThis.fetch;
 try{
  globalThis.fetch=async(_url,init)=>{assert.equal(JSON.parse(init.body).stream,false);return Response.json({error:{code:'payment_required',message:secret}},{status:402});};
  await assert.rejects(ai.requestCompletion(provider,[{role:'user',content:'fixture'}],100),error=>/APIMart/.test(error.message)&&!error.message.includes('OpenAI')&&!error.message.includes(secret));
 }finally{globalThis.fetch=mediaFetch;}
});
await check('strict APIMart endpoint, supported model and server-only profile',async()=>{
 assert.equal(config.validateMediaEndpoint(protocol.APIMART_IMAGE_ENDPOINT,'image','apimart'),protocol.APIMART_IMAGE_ENDPOINT);
 for(const endpoint of ['https://api.apimart.ai.attacker.example/v1/images/generations','https://api.apimart.ai/other/images/generations','http://api.apimart.ai/v1/images/generations','https://api.apimart.ai/v1/images/generations?secret=fixture'])assert.throws(()=>config.validateMediaEndpoint(endpoint,'image','apimart'));
 assert.throws(()=>config.validateMediaEndpoint(protocol.APIMART_IMAGE_ENDPOINT,'image','openai-compatible'));
 await config.saveMediaConfig({capability:'image',kind:'apimart',endpoint:protocol.APIMART_IMAGE_ENDPOINT,model:protocol.APIMART_IMAGE_MODEL,apiKey:secret,enabled:true,clearKey:false,revision:0},'admin');
 assert(!JSON.stringify(config.publicMediaConfig(await config.mediaConfig('image'),'image')).includes(secret));
 for(const change of [{quality:'max'},{imageProfile:'quality'},{profile:'quality'},{resolution:'4k'},{model:'gpt-image-2.5-sunburst'},{n:4}])await assert.rejects(jobs.createMediaJob(who('a'),request(change)),e=>e.status===400);
 assert.equal(posts,0);
 const job=(await jobs.createMediaJob(who('a'),request())).job;assert.equal(job.status,'queued');
 assert.equal(lastPayload.model,'gpt-image-2.5-flare');assert.equal(lastPayload.quality,'medium');assert.equal(lastPayload.resolution,'2k');assert.equal(lastPayload.size,'3:4');assert.equal(lastPayload.n,1);
 await jobs.createMediaJob(who('a'),request({ratio:'16:9'}),{imageProfile:'quality'});assert.equal(lastPayload.quality,'high');assert.equal(lastPayload.size,'16:9');
});
await check('personal model ownership and compatibility storage remain intact',async()=>{
 const id=await models.saveModel('a',{name:'APIMart personal',kind:'apimart',endpoint:protocol.APIMART_IMAGE_ENDPOINT,model:protocol.APIMART_IMAGE_MODEL,apiKey:secret,jsonMode:false,capability:'image'});
 assert.equal(database.prepare('SELECT kind FROM user_models WHERE id=?').get(id).kind,'openai-compatible');
 assert.equal((await models.ownedModel('a',id)).kind,'apimart');
 await assert.rejects(jobs.createMediaJob(who('b'),request({modelId:id})),e=>e.status===404);
 const before=posts;await jobs.createMediaJob(who('a'),request({modelId:id}));assert.equal(posts,before+1);
});
await check('concurrent duplicate submits reuse one durable task and preserve changed-content conflicts',async()=>{
 resetLimits();const body=request(),before=posts;
 const created=await Promise.all(Array.from({length:10},()=>jobs.createMediaJob(who('a'),body)));
 assert.equal(new Set(created.map(row=>row.job.id)).size,1);assert.equal(posts,before+1);
 await assert.rejects(jobs.createMediaJob(who('a'),{...body,prompt:'changed'}),e=>e.status===409);
});
await check('poll lease, completed mapping, saving recovery and private assets',async()=>{
 resetLimits();const job=(await jobs.createMediaJob(who('a'),request())).job,beforePosts=posts,beforeGets=gets;
 taskMode='processing';await Promise.all(Array.from({length:20},()=>jobs.pollMediaJob('a',job.id)));assert.equal(gets,beforeGets+1);
 assert.equal((await jobs.ownedMediaJob('a',job.id)).status,'running');
 taskMode='completed';downloadMode='fail';unlock(job.id);const pending=await jobs.pollMediaJob('a',job.id);assert.equal(pending.status,'saving');assert.equal(pending.outputs.length,0);assert(!JSON.stringify(pending).includes(secret));
 const saved=await jobs.ownedMediaJob('a',job.id);assert(saved.upstream_id);assert(saved.key_cipher);assert.equal(JSON.parse(saved.outputs_json)[0].persisted,false);
 const count=gets;downloadMode='ok';unlock(job.id);const ready=await jobs.pollMediaJob('a',job.id);assert.equal(ready.status,'succeeded');assert.equal(gets,count,'Retry saved URL without querying or submitting another generation');assert.equal(posts,beforePosts);assert.equal(ready.outputs[0].persisted,true);assert.equal((await jobs.ownedMediaJob('a',job.id)).key_cipher,'');
 await assert.rejects(jobs.mediaAsset('b',job.id,0),e=>e.status===404);assert.equal((await jobs.mediaAsset('a',job.id,0)).status,200);
});
await check('APIMart getapib image is recovered from its stored URL without another paid submission',async()=>{
 resetLimits();assetHost='getapib.org';downloadMode='fail';
 const job=(await jobs.createMediaJob(who('a'),request())).job,beforePosts=posts,beforeDownloads=downloads;
 const pending=await jobs.pollMediaJob('a',job.id);assert.equal(pending.status,'saving');
 assert.equal(downloads,beforeDownloads+1,'The exact APIMart CDN host must reach the downloader');
 const beforeGets=gets;downloadMode='ok';unlock(job.id);
 const ready=await jobs.pollMediaJob('a',job.id);assert.equal(ready.status,'succeeded');
 assert.equal(posts,beforePosts);assert.equal(gets,beforeGets);assert.equal(ready.outputs[0].persisted,true);
 assert.equal((await jobs.mediaAsset('a',job.id,0)).headers.get('content-type'),'image/png');
 for(const host of ['getapib.org.attacker.com','unconfigured.getapib.org']){
  resetLimits();assetHost=host;const rejected=(await jobs.createMediaJob(who('a'),request())).job,count=downloads;
  const output=await jobs.pollMediaJob('a',rejected.id);assert.equal(output.status,'saving');assert.match(output.error,/下载域名/);assert.equal(downloads,count);
 }
 assetHost='upload.apimart.ai';
});
await check('network-unknown, provider 500 and rejected 429 never resubmit the same request',async()=>{
 resetLimits();
 for(const mode of ['network','500','429']){
  postMode=mode;const body=request(),job=(await jobs.createMediaJob(who('a'),body)).job,before=posts;
  assert.equal(job.status,mode==='429'?'failed':'unknown');assert(!JSON.stringify(job).includes(secret));
  assert.equal((await jobs.createMediaJob(who('a'),body)).job.id,job.id);assert.equal(posts,before);
 }
 postMode='ok';
});
await check('malformed task ids, mismatched query and unsafe output URLs are rejected',async()=>{
 assert.throws(()=>protocol.apimartSubmission({code:200,data:[{task_id:'../../internal'}]}));
 assert.throws(()=>protocol.apimartTask({code:200,data:{id:'wrong',status:'completed'}},'expected'));
 assert.throws(()=>jobs.safeMediaUrl('http://127.0.0.1/private'));
 resetLimits();const job=(await jobs.createMediaJob(who('a'),request())).job;downloadMode='redirect';
 const output=await jobs.pollMediaJob('a',job.id);assert.equal(output.status,'saving');assert(!output.outputs.length);downloadMode='ok';
});
await check('30 independent guest jobs persist and complete without duplicate upstream posts',async()=>{
 resetLimits();const before=posts;
 const created=await Promise.all(Array.from({length:30},(_,i)=>jobs.createMediaJob(who(`guest-${i}`),request())));
 assert.equal(posts,before+30);assert.equal(new Set(created.map(j=>j.job.id)).size,30);assert(created.every(j=>j.job.status==='queued'));
 const completed=await Promise.all(created.map((j,i)=>jobs.pollMediaJob(`guest-${i}`,j.job.id)));
 assert(completed.every(j=>j.status==='succeeded'&&j.outputs.length===1&&j.outputs[0].persisted));assert.equal(posts,before+30);
});
await check('a fresh Node process recovers the persisted upstream id without POST',async()=>{
 resetLimits();const job=(await jobs.createMediaJob(who('a'),request())).job;
 const moduleUrl=pathToFileURL(path.join(dir,'media-jobs.mjs')).href;
 const childCode=`import assert from 'node:assert/strict';globalThis.fetch=async(url,init={})=>{assert.notEqual(init.method,'POST');if(String(url).startsWith('https://api.apimart.ai/v1/tasks/')){const id=new URL(url).pathname.split('/').at(-1);return Response.json({code:200,data:{id,status:'completed',result:{images:[{url:['https://upload.apimart.ai/f/image/recovered.png'],expires_at:Math.floor(Date.now()/1000)+86400}]}}});}assert.equal(String(url),'https://upload.apimart.ai/f/image/recovered.png');return new Response(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]));};const jobs=await import(${JSON.stringify(moduleUrl)});const job=await jobs.pollMediaJob('a',${JSON.stringify(job.id)});assert.equal(job.status,'succeeded');console.log('persisted recovery passed');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',childCode],{env:process.env,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.equal((await jobs.ownedMediaJob('a',job.id)).status,'succeeded');
});
let issued;
const quota=async(user,capability)=>(await credits.eventCreditSummary(user)).quotas.find(q=>q.capability===capability);
await check('independent card enables nonmerchant image/video entitlements and blocks unconfigured video and higher profiles',async()=>{
 process.env.EVENT_ACTIVATION_ENABLED='1';resetLimits();
 assert.equal(await config.platformMediaAllowed(who('b'),'image'),false);
 issued=await credits.issueEventCodes('admin',{requestId:randomUUID(),count:50,label:'Isolated APIMart card fixture'});
 await credits.redeemEventCode('b',issued.codes[0]);
 assert.equal(await config.platformMediaAllowed(who('b'),'image'),true);assert.equal(await config.platformMediaAllowed(who('b'),'video'),true);
 const before=posts;
 await assert.rejects(jobs.createMediaJob(who('b'),request(),{imageProfile:'quality'}),e=>e.status===403);
 await assert.rejects(jobs.createMediaJob(who('b'),request({capability:'video',duration:15})),e=>e.status===503);assert.equal(posts,before);
 assert.equal((await jobs.mediaWorkspace(who('b'))).platform.image.available,true);
 assert.equal((await quota('b','image')).available,5);assert.equal((await quota('b','text')).available,10);
});
await check('card image is reserved, kept while saving, and charged once after delivery even after expiry',async()=>{
 resetLimits();assetHost='getapib.org';const job=(await jobs.createMediaJob(who('b'),request())).job;
 assert.equal((await quota('b','image')).available,4);assert.equal((await quota('b','image')).reserved,1);assert.equal((await quota('b','text')).available,10);
 downloadMode='fail';const pending=await jobs.pollMediaJob('b',job.id);assert.equal(pending.status,'saving');assert.equal((await quota('b','image')).used,0);
 const expiry=database.prepare("SELECT expires_at FROM event_credit_lots WHERE user_id='b' AND capability='image'").get().expires_at;
 database.prepare("UPDATE event_credit_lots SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id='b' AND capability='image'").run();
 downloadMode='ok';unlock(job.id);assert.equal((await jobs.pollMediaJob('b',job.id)).status,'succeeded');
 assert.equal((await quota('b','image')).used,1);assert.equal((await quota('b','image')).reserved,0);
 await Promise.all([jobs.pollMediaJob('b',job.id),jobs.mediaWorkspace(who('b'))]);assert.equal((await quota('b','image')).used,1);
 database.prepare("UPDATE event_credit_lots SET expires_at=? WHERE user_id='b' AND capability='image'").run(expiry);assetHost='upload.apimart.ai';
});
await check('explicit failure refunds only local image entitlement; unknown keeps it without retries',async()=>{
 resetLimits();postMode='429';const rejected=(await jobs.createMediaJob(who('b'),request())).job;assert.equal(rejected.status,'failed');assert.equal((await quota('b','image')).available,4);
 postMode='network';const body=request(),unknown=(await jobs.createMediaJob(who('b'),body)).job;assert.equal(unknown.status,'unknown');assert.equal((await quota('b','image')).available,3);assert.equal((await quota('b','image')).reserved,1);
 assert.equal((await credits.eventCreditForRequest('b',unknown.id)).status,'unknown');
 const before=posts;await jobs.createMediaJob(who('b'),body);assert.equal(posts,before);postMode='ok';
 for(let i=0;i<3;i++){resetLimits();const job=(await jobs.createMediaJob(who('b'),request())).job;await jobs.pollMediaJob('b',job.id);}
 assert.equal((await quota('b','image')).available,0);assert.equal((await quota('b','text')).available,10);
 resetLimits();const paid=posts;await assert.rejects(jobs.createMediaJob(who('b'),request()),e=>e.status===402);assert.equal(posts,paid);
});
await check('personal credentials and admin diagnostics do not consume or borrow event image credits',async()=>{
 resetLimits();const personalKey='personal-isolated-fixture-key';
 const personalId=await models.saveModel('b',{name:'Personal fixture',kind:'apimart',endpoint:protocol.APIMART_IMAGE_ENDPOINT,model:protocol.APIMART_IMAGE_MODEL,apiKey:personalKey,jsonMode:false,capability:'image'});
 const prior=await quota('b','image'),own=(await jobs.createMediaJob(who('b'),request({modelId:personalId}))).job;
 assert.equal(lastAuthorization,'Bearer '+personalKey);assert.equal(await credits.eventCreditForRequest('b',own.id),null);await jobs.pollMediaJob('b',own.id);assert.deepEqual(await quota('b','image'),prior);
 const admin=(await jobs.createMediaJob(who('admin'),request())).job;assert.equal(await credits.eventCreditForRequest('admin',admin.id),null);await jobs.pollMediaJob('admin',admin.id);
});
await check('30 redeemed cards reserve and settle independently under concurrent image requests',async()=>{
 resetLimits();await Promise.all(Array.from({length:30},(_,i)=>credits.redeemEventCode(`guest-${i}`,issued.codes[i+1])));
 const before=posts,created=await Promise.all(Array.from({length:30},(_,i)=>jobs.createMediaJob(who(`guest-${i}`),request())));assert.equal(posts,before+30);
 for(let i=0;i<30;i++){assert.equal((await quota(`guest-${i}`,'image')).reserved,1);assert.equal((await quota(`guest-${i}`,'image')).available,4);}
 await Promise.all(created.map((row,i)=>jobs.pollMediaJob(`guest-${i}`,row.job.id)));
 for(let i=0;i<30;i++){assert.equal((await quota(`guest-${i}`,'image')).used,1);assert.equal((await quota(`guest-${i}`,'image')).reserved,0);assert.equal((await quota(`guest-${i}`,'text')).available,10);}
 assert.equal(posts,before+30);
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
const report={at:new Date().toISOString(),scope:'Isolated SQLite, controlled APIMart protocol mocks; no real model, external API request or production data',passed:results.length,results};
const reportPath=path.join(process.env.ZDX_DATA_DIR,'results.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`PASS: ${results.length} APIMart groups. ${reportPath}`);

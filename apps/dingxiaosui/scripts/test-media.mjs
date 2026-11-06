import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
process.env.ZDX_DATA_DIR=path.resolve('.ecs-test',`media-${Date.now()}-${randomBytes(3).toString('hex')}`);
process.env.AI_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
delete process.env.EVENT_ACTIVATION_ENABLED;
await import('./migrate-ecs.mjs');
const runtime=await import('../runtime/node-env.mjs'),database=runtime.sqlite(),now=new Date().toISOString();
for(const id of ['admin','a','b']){database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,now);database.prepare("INSERT INTO auth_identities VALUES (?,?,'password',?,?)").run(id,id,id,now);}
database.prepare("INSERT INTO merchants VALUES ('merchant-a','Fixture','active','admin',?)").run(now);
database.prepare("INSERT INTO merchant_memberships VALUES ('merchant-a','a','owner','active',?)").run(now);
const dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=who=>who.userId==='admin';");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>globalThis.testWho?{userId:globalThis.testWho,provider:'password',displayName:globalThis.testWho}:null;");
function compile(source,name){source=source.replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace(/(['"])\.\.\/\.\.\/\.\.\/sidecar\/([\w-]+\.mjs)\1/g,(_all,_quote,file)=>JSON.stringify(pathToFileURL(path.resolve('../../sidecar',file)).href)).replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])@\/lib\/([\w-]+)\1/g,"'./$2.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','request-body','tenancy','ai-config','media-config','user-models','shanxi-knowledge','ding-persona','agriculture-policy','media-jobs'])compile(fs.readFileSync(`lib/${name}.ts`,'utf8'),name);
for(const [file,name] of [['app/api/media/jobs/route.ts','jobs-route'],['app/api/media/assets/[id]/route.ts','assets-route'],['app/api/platform/media-settings/route.ts','settings-route']])compile(fs.readFileSync(file,'utf8'),name);
const get=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href);
const m=await get('user-models'),c=await get('media-config'),j=await get('media-jobs'),routes=await get('jobs-route'),assets=await get('assets-route'),settings=await get('settings-route');
const who=id=>({id,displayName:id,identity:{provider:'password',userId:id},platformAdmin:id==='admin'});
const secret='fixture-'+randomBytes(20).toString('hex'),png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]),mp4=Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109]);
let calls=[],mode='image',pollStatus='running';
globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),...init});if(String(url).includes('/images/generations')){if(mode==='timeout')throw Error(secret);if(mode==='unauthorized')return Response.json({error:{message:secret}},{status:401});if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://127.0.0.1/secret'}});if(mode==='bad-url')return Response.json({data:[{url:'https://127.0.0.1/result.png'}]});if(mode==='url-image')return Response.json({data:[{url:'https://fixture.tos-cn-beijing.volces.com/image.png'}]});return Response.json({data:[{b64_json:Buffer.from(png).toString('base64')}]});}if(String(url).endsWith('/contents/generations/tasks'))return Response.json({id:'cgt-fixture-task'});if(String(url).includes('/contents/generations/tasks/'))return Response.json({status:pollStatus,...(pollStatus==='succeeded'?{content:{video_url:'https://fixture.tos-cn-beijing.volces.com/video.mp4'}}:{})});if(String(url).endsWith('image.png'))return new Response(png,{headers:{'content-type':'image/png'}});if(String(url).endsWith('video.mp4'))return new Response(mp4,{headers:{'content-type':'video/mp4'}});throw Error('Unexpected mock URL');};
const results=[];
async function check(name,work){await work();results.push({name,passed:true});console.log('PASS',name);}
const freshKey=()=>crypto.randomUUID();
const imageEndpoint='https://ark.cn-beijing.volces.com/api/v3/images/generations',videoEndpoint='https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const modelBody={name:'Fixture image',kind:'ark',endpoint:imageEndpoint,model:'fixture-image-only',apiKey:secret,jsonMode:false,capability:'image'};
const imageId=await m.saveModel('a',modelBody),videoId=await m.saveModel('a',{...modelBody,name:'Fixture video',capability:'video',endpoint:videoEndpoint,model:'fixture-video-only'});
const request=(changes={})=>({capability:'image',modelId:imageId,prompt:'Fixture agricultural product photo',ratio:'16:9',consent:true,idempotencyKey:freshKey(),...changes});
const resetLimits=()=>database.prepare("DELETE FROM auth_limits WHERE key LIKE 'media:%'").run();
let imageJob,videoJob;
await check('media model capabilities, encrypted keys, default isolation and endpoint restrictions',async()=>{
 assert.equal((await m.listModels('b')).models.length,0);await assert.rejects(()=>m.selectModel('a',imageId),e=>e.status===400);await m.selectModel('a',imageId,'image');assert.equal((await m.listModels('a')).defaultModelIds.image,imageId);assert.equal((await m.listModels('a')).defaultModelId,null);await assert.rejects(()=>m.personalProvider(awaitRow()),e=>e.status===400);
 function awaitRow(){return {capability:'image'}}
 for(const endpoint of ['http://ark.cn-beijing.volces.com/api/v3/images/generations','https://127.0.0.1/images/generations','https://ark.cn-beijing.volces.com:444/api/v3/images/generations','https://u:p@ark.cn-beijing.volces.com/api/v3/images/generations','https://ark.cn-beijing.volces.com/api/v3/images/generations?key=x','https://api.openai.com/v1/images/generations'])await assert.rejects(()=>m.saveModel('a',{...modelBody,endpoint}),e=>e.status===400);
 await assert.rejects(()=>m.saveModel('a',{...modelBody,capability:'video',kind:'openai-compatible',endpoint:videoEndpoint}),e=>e.status===400);
 assert(!JSON.stringify(await m.listModels('a')).includes(secret));assert.notEqual(database.prepare('SELECT key_cipher FROM user_models WHERE id=?').get(imageId).key_cipher,secret);
});
await check('real image request shape, persistent owned output, consent and no secret responses',async()=>{
 const count=calls.length;await assert.rejects(()=>j.createMediaJob(who('a'),request({consent:false})),e=>e.status===400);assert.equal(calls.length,count);
 imageJob=(await j.createMediaJob(who('a'),request())).job;assert.equal(imageJob.status,'succeeded');assert.equal(imageJob.outputs[0].persisted,true);const upstream=calls.find(x=>x.url===imageEndpoint);const body=JSON.parse(upstream.body);assert.equal(body.model,'fixture-image-only');assert(body.prompt.includes('更懂山西农产品')&&body.prompt.includes('更懂农业品牌')&&body.prompt.includes('Fixture agricultural product photo'));assert.equal(imageJob.prompt,'Fixture agricultural product photo');assert.equal(body.size,'2560x1440');assert.equal(body.watermark,true);assert.equal(upstream.redirect,'manual');assert.equal(upstream.headers.authorization,`Bearer ${secret}`);
 const file=await j.mediaAsset('a',imageJob.id,0);assert.deepEqual(new Uint8Array(await file.arrayBuffer()),png);await assert.rejects(()=>j.mediaAsset('b',imageJob.id,0),e=>e.status===404);assert(!JSON.stringify(imageJob).includes(secret));assert(!JSON.stringify(imageJob).includes('key_cipher'));
});
await check('idempotency rejects changed content and concurrent creation performs one paid POST',async()=>{
 resetLimits();const body=request(),before=calls.length;const pair=await Promise.all([j.createMediaJob(who('a'),body),j.createMediaJob(who('a'),body)]);assert.equal(pair[0].job.id,pair[1].job.id);assert.equal(calls.length-before,1);await j.createMediaJob(who('a'),body);assert.equal(calls.length-before,1);await assert.rejects(()=>j.createMediaJob(who('a'),{...body,prompt:'changed'}),e=>e.status===409);await assert.rejects(()=>j.createMediaJob(who('b'),request()),e=>e.status===404);
});
await check('image URL is downloaded from trusted asset host and unsafe output is rejected',async()=>{
 resetLimits();mode='url-image';const output=(await j.createMediaJob(who('a'),request())).job;assert.equal(output.status,'succeeded');assert.equal(output.outputs[0].persisted,true);mode='bad-url';const rejected=(await j.createMediaJob(who('a'),request())).job;assert.equal(rejected.status,'unknown');assert.match(rejected.error,/不安全/);assert.match(rejected.error,/可能已计费/);assert(!calls.some(x=>x.url.includes('127.0.0.1')));mode='image';
});
await check('OpenAI-compatible image protocol uses its own dimensions and n=1',async()=>{
 resetLimits();const id=await m.saveModel('a',{...modelBody,kind:'openai-compatible',endpoint:'https://api.openai.com/v1/images/generations'});const output=(await j.createMediaJob(who('a'),request({modelId:id}))).job;assert.equal(output.status,'succeeded');const body=JSON.parse(calls.at(-1).body);assert.equal(body.size,'1536x1024');assert.equal(body.n,1);assert.equal(body.response_format,undefined);
});
await check('video async submission, persisted snapshot, poll lease, output persistence and owner isolation',async()=>{
 resetLimits();const body=request({capability:'video',modelId:videoId,duration:5,ratio:'9:16'});videoJob=(await j.createMediaJob(who('a'),body)).job;assert.equal(videoJob.status,'queued');const create=calls.at(-1);assert.equal(JSON.parse(create.body).content[0].type,'text');assert(JSON.parse(create.body).content[0].text.includes('更懂山西农产品'));assert(JSON.parse(create.body).content[0].text.includes('不得伪造'));assert.equal(JSON.parse(create.body).duration,5);
 await m.saveModel('a',{...modelBody,id:videoId,revision:1,capability:'video',endpoint:videoEndpoint,model:'changed-for-future',apiKey:'future-key'});
 const before=calls.length;assert.equal((await j.pollMediaJob('a',videoJob.id)).status,'running');assert.equal(calls.at(-1).headers.authorization,`Bearer ${secret}`);await j.pollMediaJob('a',videoJob.id);assert.equal(calls.length-before,1);await assert.rejects(()=>j.pollMediaJob('b',videoJob.id),e=>e.status===404);
 database.prepare('UPDATE media_jobs SET poll_after=0 WHERE id=?').run(videoJob.id);pollStatus='succeeded';const complete=await j.pollMediaJob('a',videoJob.id);assert.equal(complete.status,'succeeded');assert.equal(complete.outputs[0].persisted,true);assert.deepEqual(new Uint8Array(await (await j.mediaAsset('a',videoJob.id,0)).arrayBuffer()),mp4);assert.equal(database.prepare('SELECT key_cipher FROM media_jobs WHERE id=?').get(videoJob.id).key_cipher,'');const count=calls.length;await j.pollMediaJob('a',videoJob.id);assert.equal(calls.length,count);
});
await check('overlapping slow polls cannot regress a terminal video status or overwrite its error',async()=>{
 resetLimits();const job=(await j.createMediaJob(who('a'),request({capability:'video',modelId:videoId}))).job;
 const originalFetch=globalThis.fetch;let polls=0,releaseAsset,releaseSecond,assetStarted,secondStarted;
 const assetReady=new Promise(resolve=>{assetStarted=resolve}),secondReady=new Promise(resolve=>{secondStarted=resolve});
 globalThis.fetch=async(url,init={})=>{
  if(String(url).includes('/contents/generations/tasks/')){polls++;if(polls===1)return Response.json({status:'succeeded',content:{video_url:'https://fixture.tos-cn-beijing.volces.com/video.mp4'}});secondStarted();return new Promise(resolve=>{releaseSecond=resolve});}
  if(String(url).endsWith('video.mp4')){assetStarted();return new Promise(resolve=>{releaseAsset=resolve});}
  return originalFetch(url,init);
 };
 try{const first=j.pollMediaJob('a',job.id);await assetReady;database.prepare('UPDATE media_jobs SET poll_after=0 WHERE id=?').run(job.id);const late=j.pollMediaJob('a',job.id);await secondReady;releaseAsset(new Response(mp4));assert.equal((await first).status,'succeeded');releaseSecond(Response.json({status:'running'}));const result=await late;assert.equal(result.status,'succeeded');assert.equal(result.error,null);assert.equal(result.outputs[0].persisted,true);assert.equal(database.prepare('SELECT key_cipher FROM media_jobs WHERE id=?').get(job.id).key_cipher,'');}finally{globalThis.fetch=originalFetch;}
});
await check('the original delayed submission can resolve stale unknown without a second paid POST',async()=>{
 resetLimits();const originalFetch=globalThis.fetch;let releaseSubmit,submitStarted;const ready=new Promise(resolve=>{submitStarted=resolve});const body=request({capability:'video',modelId:videoId});
 globalThis.fetch=async(url,init={})=>{if(String(url)===videoEndpoint&&init.method==='POST'){submitStarted();return new Promise(resolve=>{releaseSubmit=resolve})}return originalFetch(url,init)};
 try{const pending=j.createMediaJob(who('a'),body);await ready;const row=database.prepare('SELECT id FROM media_jobs WHERE user_id=? AND idempotency_key=?').get('a',body.idempotencyKey);database.prepare('UPDATE media_jobs SET created_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',row.id);assert.equal((await j.mediaWorkspace(who('a'))).jobs.find(x=>x.id===row.id).status,'unknown');releaseSubmit(Response.json({id:'cgt-late-submission'}));const resolved=(await pending).job;assert.equal(resolved.status,'queued');assert(database.prepare('SELECT key_cipher FROM media_jobs WHERE id=?').get(row.id).key_cipher);assert.equal((await j.pollMediaJob('a',row.id)).status,'succeeded');}finally{globalThis.fetch=originalFetch;}
});
await check('platform encrypted configuration, revision conflicts and active membership checks',async()=>{
 resetLimits();const config=await c.saveMediaConfig({capability:'image',kind:'ark',endpoint:imageEndpoint,model:'fixture-platform',apiKey:secret,enabled:true,clearKey:false,revision:0},'admin');assert(config.hasKey);assert(!JSON.stringify(config).includes(secret));await assert.rejects(()=>c.saveMediaConfig({...config,apiKey:'',clearKey:false,revision:0},'admin'),e=>e.status===409);
 const count=calls.length;await assert.rejects(()=>j.createMediaJob(who('b'),request({modelId:null})),e=>e.status===403);assert.equal(calls.length,count);const created=(await j.createMediaJob(who('a'),request({modelId:null}))).job;assert.equal(created.status,'succeeded');assert.equal(created.modelName,'平台图片模型');database.prepare("UPDATE merchants SET status='disabled' WHERE id='merchant-a'").run();await assert.rejects(()=>j.createMediaJob(who('a'),request({modelId:null})),e=>e.status===403);assert.equal((await j.createMediaJob(who('a'),request())).job.status,'succeeded');database.prepare("UPDATE merchants SET status='active' WHERE id='merchant-a'").run();
});
await check('upstream errors are sanitized, redirects not followed, unknown timeout never resubmitted',async()=>{
 resetLimits();mode='unauthorized';const fail=(await j.createMediaJob(who('a'),request())).job;assert.equal(fail.status,'failed');assert(!JSON.stringify(fail).includes(secret));mode='redirect';const before=calls.length;assert.equal((await j.createMediaJob(who('a'),request())).job.status,'failed');assert.equal(calls.length-before,1);mode='timeout';const body=request(),unknown=(await j.createMediaJob(who('a'),body)).job;assert.equal(unknown.status,'unknown');const count=calls.length;assert.equal((await j.createMediaJob(who('a'),body)).job.id,unknown.id);assert.equal(calls.length,count);assert(!unknown.error.includes(secret));mode='image';
});
await check('abandoned submitting records become unknown without another upstream POST',async()=>{
 const count=calls.length;database.prepare("UPDATE media_jobs SET status='submitting',created_at=? WHERE id=?").run('2000-01-01T00:00:00.000Z',imageJob.id);const workspace=await j.mediaWorkspace(who('a'));assert.equal(workspace.jobs.find(x=>x.id===imageJob.id).status,'unknown');assert.equal(calls.length,count);assert.equal((await j.mediaWorkspace(who('b'))).jobs.length,0);
});
await check('per-minute, per-user daily and platform aggregate limits prevent paid calls',async()=>{
 resetLimits();for(let i=0;i<4;i++)await j.createMediaJob(who('a'),request());let before=calls.length;await assert.rejects(()=>j.createMediaJob(who('a'),request()),e=>e.status===429);assert.equal(calls.length,before);
 resetLimits();process.env.MEDIA_USER_DAILY_LIMIT='1';await j.createMediaJob(who('a'),request());before=calls.length;await assert.rejects(()=>j.createMediaJob(who('a'),request()),e=>e.status===429);assert.equal(calls.length,before);delete process.env.MEDIA_USER_DAILY_LIMIT;
 resetLimits();process.env.MEDIA_PLATFORM_DAILY_LIMIT='1';await j.createMediaJob(who('a'),request({modelId:null}));before=calls.length;await assert.rejects(()=>j.createMediaJob(who('admin'),request({modelId:null})),e=>e.status===429);assert.equal(calls.length,before);delete process.env.MEDIA_PLATFORM_DAILY_LIMIT;
});
await check('API authentication, active accounts, same-origin, settings administrator and file ownership',async()=>{
 const req=(url,method='GET',body,origin)=>new Request('https://app.fixture'+url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(origin?{origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 globalThis.testWho=null;assert.equal((await routes.GET(req('/api/media/jobs'))).status,401);globalThis.testWho='b';assert.equal((await settings.GET(req('/api/platform/media-settings'))).status,403);assert.equal((await assets.GET(req('/api/media/assets/'+videoJob.id),{params:Promise.resolve({id:videoJob.id})})).status,404);
 globalThis.testWho='a';assert.equal((await routes.POST(req('/api/media/jobs','POST',request(),'https://evil.fixture'))).status,403);database.prepare("UPDATE users SET status='disabled' WHERE id='a'").run();assert.equal((await routes.GET(req('/api/media/jobs'))).status,403);database.prepare("UPDATE users SET status='active' WHERE id='a'").run();globalThis.testWho='admin';assert.equal((await settings.GET(req('/api/platform/media-settings'))).status,200);
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
fs.writeFileSync(path.join(process.env.ZDX_DATA_DIR,'results.json'),JSON.stringify({at:new Date().toISOString(),scope:'isolated Node SQLite and synthetic upstream; no real API key, billing or production connectivity',passed:results.length,results},null,2));
console.log(`PASS: ${results.length} media acceptance groups. Isolated fixture only; no real AI or billing. Evidence: ${path.join(process.env.ZDX_DATA_DIR,'results.json')}`);

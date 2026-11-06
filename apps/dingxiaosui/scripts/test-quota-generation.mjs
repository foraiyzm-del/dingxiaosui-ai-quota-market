// Real isolated Ding SQLite + controlled center transport. Never loads real keys.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
for(const key of Object.keys(process.env))if(/^(?:AI_|OPENAI_|ARK_|DASHSCOPE_|DEEPSEEK_|QUOTA_|SHOP_|ZLG_)/.test(key))delete process.env[key];
Object.assign(process.env,{ZDX_DATA_DIR:path.join(root,'.ecs-test','quota-generation-'+Date.now()+'-'+randomBytes(3).toString('hex')),AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),EVENT_ACTIVATION_ENABLED:'1',QUOTA_CENTER_URL:'https://center.fixture',QUOTA_PLATFORM_KEY:'isolated-platform-key'});
globalThis.fetch=async()=>{throw Error('Unexpected network request blocked');};
await import('./migrate-ecs.mjs');
const runtime=await import('../runtime/node-env.mjs'),database=runtime.sqlite(),now=new Date().toISOString(),dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
for(const id of ['a','b']){
 database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,now);database.prepare("INSERT INTO auth_identities VALUES (?,?,'password',?,?)").run(id,id,id,now);
 database.prepare("INSERT INTO quota_center_accounts(card_hash,user_id,center_user_id,code_id,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)").run('hash-'+id,id,'center-'+id,'card-'+id,now,now);
}
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=()=>false;");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>({userId:globalThis.quotaTestUser||'a',provider:'password',displayName:'fixture'});");
const compiled=new Set(['identity','chatgpt-auth']);
function compile(name){
 if(compiled.has(name))return;compiled.add(name);
 let source=fs.readFileSync(path.join(root,'lib',name+'.ts'),'utf8');
 for(const match of source.matchAll(/from\s+['"]\.\/([\w-]+)['"]/g))compile(match[1]);
 source=source.replace(/import (\w+) from ['"](\.\.?\/[^'"]+\.json)['"];?/g,(_all,id,file)=>'const '+id+'='+fs.readFileSync(path.resolve(root,'lib',file),'utf8')+';')
  .replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href))
  .replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'")
  .replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");
 fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
for(const name of ['ai','media-jobs','quota-generation'])compile(name);
const load=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href),ai=await load('ai'),media=await load('media-jobs'),adapter=await load('quota-generation');
const who=id=>({id,displayName:id,identity:{provider:'password',userId:id},platformAdmin:false});
const jobs=new Map(),requests=[],posts=[],downloads=[],limits={text:3,image:50,video:50};
let optionsUnavailable=false;
let mode='normal',finishMedia=false,contentFails=false,createCount=0;
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]),mp4=Uint8Array.from([0,0,0,20,102,116,121,112,105,115,111,109]);
globalThis.fetch=async(url,init={})=>{
 const target=new URL(url);assert.equal(target.origin,'https://center.fixture');assert.equal(init.headers.Authorization,'Bearer isolated-platform-key');requests.push(target.pathname);
 if(target.pathname==='/api/v1/generation-options'){assert.equal(target.searchParams.get('userId'),'center-a');return optionsUnavailable?Response.json({error:'unavailable'},{status:503}):Response.json({video:{available:true,durationSeconds:5,durationOptions:[5,10,15],resolution:'720p'}});}
 if(target.pathname.endsWith('/delivery')){const body=JSON.parse(init.body);posts.push(body);return Response.json({id:'job-delivery',userId:body.userId,capability:'text',status:body.action==='accept'?'succeeded':'failed',output:{text:'{"answer":"已确认"}'}});}
 if(target.pathname==='/api/v1/generate'){
  const body=JSON.parse(init.body),key=body.userId+'|'+body.requestId;posts.push(body);
  if(jobs.has(key)){const entry=jobs.get(key);if(entry.hash!==JSON.stringify(body))return Response.json({error:'changed request'},{status:409});return Response.json(entry.job);}
  if(limits[body.capability]<=0)return Response.json({error:body.capability+'次数不足'},{status:402});
  limits[body.capability]--;createCount++;
  const job={id:'job-'+createCount,userId:body.userId,capability:body.capability,status:mode==='incomplete'?'ready':body.capability==='text'?'succeeded':mode==='uncertain'?'uncertain':'running',output:body.capability==='text'?{text:mode==='incomplete'?'{"title":"只有标题"}':'{"answer":"山西小米品牌文案","title":"小米"}'}:null};
  jobs.set(key,{hash:JSON.stringify(body),job});
  if(mode==='lost-response')throw Error('controlled connection lost after center accepted');
  return Response.json(job);
 }
 const match=target.pathname.match(/^\/api\/v1\/generation\/([^/]+)(\/content)?$/);assert(match);
 const entry=[...jobs.values()].find(value=>value.job.id===match[1]);assert(entry);assert.equal(target.searchParams.get('userId'),entry.job.userId);
 if(match[2]){downloads.push(entry.job.id);if(contentFails)return Response.json({error:'temporary storage unavailable'},{status:503});return new Response(entry.job.capability==='image'?png:mp4);}
 if(finishMedia&&entry.job.status==='running')entry.job.status='succeeded';
 return Response.json(entry.job);
};
const results=[];async function check(name,work){await work();results.push(name);console.log('PASS',name);}
const request=(changes={})=>({capability:'image',modelId:null,prompt:'山西小米包装设计',ratio:'3:4',consent:true,idempotencyKey:randomUUID(),...changes});
const unlock=id=>database.prepare('UPDATE media_jobs SET poll_after=0 WHERE id=?').run(id);
await check('quota model readiness requires no Ding provider secret and preserves business context',async()=>{
 assert.equal((await ai.aiStatus()).access,'quota_center');
 assert(!(await ai.readAiRequest(new Request('https://ding.fixture/api/dialogue',{method:'POST',body:JSON.stringify({consent:true,requestId:randomUUID()})}),1000) instanceof Response));
 const source={requestId:randomUUID()},answer=await ai.askModel('请遵循品牌知识库',{knowledge:'县域和品种事实',history:[{text:'产品原要求'}]},3500,source,{validate:value=>typeof value.answer==='string'});
 assert.equal(answer.output.title,'小米');const sent=posts.at(-1);assert.equal(sent.userId,'center-a');assert.equal(sent.responseFormat,'json_object');assert.equal(sent.maxTokens,3500);assert(sent.messages[0].content.includes('更懂山西农产品'));assert(sent.messages[1].content.includes('县域和品种事实'));
 const before=createCount;assert.deepEqual(await ai.askModel('请遵循品牌知识库',{knowledge:'县域和品种事实',history:[{text:'产品原要求'}]},3500,source),answer);assert.equal(createCount,before);
 await assert.rejects(()=>ai.askModel('变更需求',{},3500,source),e=>e.status===409);
});
await check('three text uses exhaust only text; no local credit hold is created',async()=>{
 for(let i=0;i<2;i++)await ai.askModel('写文案',{item:i},300,{requestId:randomUUID()});
 const before=createCount;await assert.rejects(()=>ai.askModel('第四次',{},300,{requestId:randomUUID()}),e=>e.status===402);assert.equal(createCount,before);assert.equal(limits.image,50);assert.equal(limits.video,50);assert.equal(database.prepare('SELECT count(*) AS n FROM event_credit_usage').get().n,0);
});
await check('arbitrary quota account gets independent media options instead of fixed event model',async()=>{
 const workspace=await media.mediaWorkspace(who('a'));assert.equal(workspace.creditSource,'quota_center');assert.equal(workspace.platform.image.available,true);assert.equal(workspace.platform.image.referenceImageSupported,true);assert.equal(workspace.platform.video.durationSeconds,5);assert.deepEqual(workspace.platform.video.durationOptions,[5,10,15]);assert.equal(workspace.platform.video.resolution,'720p');assert.deepEqual(workspace.models,[]);
});
let imageJob;
await check('async image has one durable center request, own asset, and no second charge',async()=>{
 const body=request(),before=createCount,pair=await Promise.all([media.createMediaJob(who('a'),body),media.createMediaJob(who('a'),body)]);imageJob=pair[0].job;assert.equal(pair[0].job.id,pair[1].job.id);assert.equal(createCount,before+1);assert.equal(imageJob.status,'running');
 const row=database.prepare('SELECT * FROM media_jobs WHERE id=?').get(imageJob.id);assert.equal(row.provider_kind,'quota-center');assert.equal(row.key_cipher,'');assert.equal(row.upstream_id,'job-'+createCount);assert.equal(posts.at(-1).aspectRatio,'3:4');assert(posts.at(-1).prompt.includes('更懂山西农产品'));
 finishMedia=true;unlock(imageJob.id);imageJob=await media.pollMediaJob('a',imageJob.id);assert.equal(imageJob.status,'succeeded');assert.equal(imageJob.outputs[0].persisted,true);assert.deepEqual(new Uint8Array(await (await media.mediaAsset('a',imageJob.id,0)).arrayBuffer()),png);assert.equal(createCount,before+1);
 await assert.rejects(()=>media.pollMediaJob('b',imageJob.id),e=>e.status===404);await assert.rejects(()=>media.mediaAsset('b',imageJob.id,0),e=>e.status===404);
});
await check('quota video sends selected 10 and 15 seconds and leaves omitted duration to center',async()=>{
 for(const duration of [10,15,undefined]){const before=posts.length;await media.createMediaJob(who('b'),request({capability:'video',duration,ratio:'9:16'}));assert.equal(posts[before].seconds,duration);assert.equal(posts[before].capability,'video');}
});
await check('missing center duration metadata disables video but leaves image available',async()=>{
 optionsUnavailable=true;try{const workspace=await media.mediaWorkspace(who('a'));assert.equal(workspace.platform.video.available,false);assert.deepEqual(workspace.platform.video.durationOptions,[]);assert.equal(workspace.platform.image.available,true);}finally{optionsUnavailable=false;}
});
await check('JSON without an answer is rejected to the center and not returned as copy',async()=>{
 limits.text+=1;mode='incomplete';const before=posts.length;await assert.rejects(()=>ai.askModel('写文案',{item:'缺回答'},300,{requestId:randomUUID()},{validate:output=>typeof output.answer==='string'&&!!output.answer.trim()}),error=>error.status===502);assert.equal(posts.at(-1).action,'reject');assert.ok(posts.length>before);mode='normal';
});
await check('video follows async flow, preserves requested five seconds and persists MP4',async()=>{
 const created=(await media.createMediaJob(who('a'),request({capability:'video',duration:5,ratio:'16:9'}))).job;assert.equal(posts.at(-1).seconds,5);unlock(created.id);const done=await media.pollMediaJob('a',created.id);assert.equal(done.status,'succeeded');assert.deepEqual(new Uint8Array(await (await media.mediaAsset('a',done.id,0)).arrayBuffer()),mp4);
});
await check('saving failure retries only download, never generation or local refund',async()=>{
 contentFails=true;const before=createCount,created=(await media.createMediaJob(who('a'),request())).job;unlock(created.id);assert.equal((await media.pollMediaJob('a',created.id)).status,'saving');contentFails=false;unlock(created.id);assert.equal((await media.pollMediaJob('a',created.id)).status,'succeeded');assert.equal(createCount,before+1);assert.equal(database.prepare('SELECT count(*) AS n FROM event_credit_usage').get().n,0);
});
await check('lost submission response recovers same encrypted payload after restart without another generation',async()=>{
 mode='lost-response';const before=createCount,created=(await media.createMediaJob(who('a'),request())).job;assert.equal(created.status,'queued');const pending=database.prepare('SELECT * FROM media_jobs WHERE id=?').get(created.id);assert(pending.key_cipher.startsWith('quota1.'));assert(!pending.key_cipher.includes('山西'));assert.equal(pending.upstream_id,null);
 mode='normal';unlock(created.id);const resumed=await media.pollMediaJob('a',created.id);assert.equal(resumed.status,'running');assert.equal(createCount,before+1);assert.equal(database.prepare('SELECT key_cipher FROM media_jobs WHERE id=?').get(created.id).key_cipher,'');unlock(created.id);assert.equal((await media.pollMediaJob('a',created.id)).status,'succeeded');
});
await check('uncertain center state remains reviewable and background never recreates work',async()=>{
 mode='uncertain';const before=createCount,created=(await media.createMediaJob(who('a'),request())).job;assert.equal(created.status,'unknown');mode='normal';unlock(created.id);await media.reconcilePendingMediaJobs();assert.equal(createCount,before+1);assert.equal((await media.ownedMediaJob('a',created.id)).status,'unknown');
});
await check('image edit passes validated reference and encrypts large requests without stack overflow',async()=>{
 const reference=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(reference);reference.write('IHDR',12);
 const referenceImage='data:image/png;base64,'+reference.toString('base64');await media.createMediaJob(who('a'),request({referenceImage}));assert.equal(posts.at(-1).referenceImage,referenceImage);
 const large={referenceImage:'data:image/png;base64,'+'A'.repeat(300000),requestId:randomUUID()},cipher=await adapter.encryptQuotaPayload(large);assert.deepEqual(await adapter.decryptQuotaPayload(cipher),large);await assert.rejects(()=>adapter.decryptQuotaPayload(cipher.slice(0,-3)+'bad'),e=>e.status===503);
});
await check('foreign model and changed idempotent body cannot override center routing',async()=>{
 const before=createCount;await assert.rejects(()=>media.createMediaJob(who('a'),request({modelId:'personal-other'})),e=>e.status===400);assert.equal(createCount,before);
 const body=request(),created=await media.createMediaJob(who('a'),body);await assert.rejects(()=>media.createMediaJob(who('a'),{...body,prompt:'changed'}),e=>e.status===409);assert(!JSON.stringify(created).includes('isolated-platform-key'));
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
fs.writeFileSync(path.join(process.env.ZDX_DATA_DIR,'results.json'),JSON.stringify({passed:results.length,results,scope:'isolated database and controlled center; no paid upstream calls'},null,2));
database.close();console.log('PASS quota generation:',results.length,'groups');

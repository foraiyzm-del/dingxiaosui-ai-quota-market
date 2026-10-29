// Isolated SQLite and intercepted upstream only: no real credentials or charges.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
for(const key of Object.keys(process.env))if(/^(AI_|OPENAI_|APIMART_|ARK_|LOCAL_|ZLG_|MEDIA_)/.test(key))delete process.env[key];
Object.assign(process.env,{ZDX_DATA_DIR:path.resolve('.ecs-test','apimart-video-'+Date.now()),AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),EVENT_ACTIVATION_ENABLED:'1'});
await import('./migrate-ecs.mjs');
const runtime=await import('../runtime/node-env.mjs'),database=runtime.sqlite(),dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=who=>who.userId==='admin';");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>null;");
for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','request-body','tenancy','ai-config','media-config','user-models','shanxi-knowledge','ding-persona','agriculture-policy','media-jobs']){
 let source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");
 fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const load=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href),jobs=await load('media-jobs'),config=await load('media-config'),protocol=await load('apimart-protocol'),credits=await load('event-credits'),models=await load('user-models');
const who=id=>({id,displayName:id,platformAdmin:id==='admin',identity:{provider:'password',userId:id}}),users=['admin','none','a','b','c','d','e','f','g','h'];
for(const id of users)database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,new Date().toISOString());
const cards=await credits.issueEventCodes('admin',{requestId:randomUUID(),count:50});
for(const [i,id] of users.slice(2).entries())await credits.redeemEventCode(id,cards.codes[i]);
const secret='isolated-video-key-'+randomBytes(8).toString('hex');
const results=[];async function check(name,run){await run();results.push({name,passed:true});console.log('PASS',name);}
const mp4=Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
let posts=0,gets=0,downloads=0,lastPayload,postMode='ok',taskMode='completed',downloadMode='ok',outputHost='getapib.org',wrongId=false;
globalThis.fetch=async(url,init={})=>{
 const actual=String(url);
 if(actual===protocol.APIMART_VIDEO_ENDPOINT&&init.method==='POST'){
  posts++;lastPayload=JSON.parse(init.body);assert.equal(init.headers.authorization,'Bearer '+secret);assert.equal(init.redirect,'manual');
  if(postMode==='unknown')throw Error(secret);if(postMode==='rejected')return new Response(null,{status:402});
  return Response.json({code:200,data:[{status:'submitted',task_id:'video_'+posts}]});
 }
 if(actual.startsWith('https://api.apimart.ai/v1/tasks/')){
  gets++;const id=new URL(actual).pathname.split('/').at(-1);
  return Response.json({code:200,data:{id:wrongId?'other':id,status:taskMode,...(taskMode==='completed'?{result:{videos:[{url:['https://'+outputHost+'/f/video/'+id+'.mp4'],expires_at:Math.floor(Date.now()/1000)+86400}]}}:{})}});
 }
 if(actual.startsWith('https://getapib.org/f/video/')){
  downloads++;assert.equal(init.headers,undefined,'Never send API credentials to the download host');assert.equal(init.redirect,'manual');
  if(downloadMode==='fail')throw Error(secret);if(downloadMode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});if(downloadMode==='html')return new Response('not a video');return new Response(mp4);
 }
 throw Error('External request blocked');
};
const request=(overrides={})=>({capability:'video',modelId:null,prompt:'山西玉露香梨品牌15秒概念广告',duration:15,ratio:'16:9',consent:true,idempotencyKey:randomUUID(),...overrides});
const create=async(id,overrides={})=>(await jobs.createMediaJob(who(id),request(overrides))).job;
const quota=async id=>(await credits.eventCreditSummary(id)).quotas;
const video=rows=>rows.find(row=>row.capability==='video');
const unlock=id=>database.prepare('UPDATE media_jobs SET poll_after=0 WHERE id=?').run(id);
const reset=()=>database.prepare("DELETE FROM auth_limits WHERE key LIKE 'media:%'").run();

await check('official video endpoint and fixed model profile cannot be upgraded by client',async()=>{
 assert.equal(config.validateMediaEndpoint(protocol.APIMART_VIDEO_ENDPOINT,'video','apimart'),protocol.APIMART_VIDEO_ENDPOINT);
 for(const endpoint of [protocol.APIMART_IMAGE_ENDPOINT,'https://api.apimart.ai/other/videos/generations','https://api.apimart.ai/v1/videos/generations?x=1'])assert.throws(()=>config.validateMediaEndpoint(endpoint,'video','apimart'));
 await config.saveMediaConfig({capability:'video',kind:'apimart',endpoint:protocol.APIMART_VIDEO_ENDPOINT,model:protocol.APIMART_VIDEO_MODEL,enabled:true,clearKey:false,apiKey:secret,revision:0},'admin');
 for(const change of [{duration:5},{duration:10},{duration:30},{prompt:'字'.repeat(4000)},{resolution:'1080p'},{model:'seedance-2.0-fast'},{n:2},{generate_audio:false},{video_urls:['https://getapib.org/reference.mp4']}])await assert.rejects(create('a',change),error=>error.status===400);
 assert.equal(posts,0);await assert.rejects(create('none'),error=>error.status===403);assert.equal(posts,0);
 assert(!JSON.stringify(await jobs.mediaWorkspace(who('a'))).includes(secret));
});
let first;
await check('concurrent video submissions reuse exactly one task and one reserved credit',async()=>{
 const body=request(),prior=posts;
 const rows=await Promise.all(Array.from({length:8},()=>jobs.createMediaJob(who('a'),body)));
 assert.equal(new Set(rows.map(row=>row.job.id)).size,1);assert.equal(posts,prior+1);first=rows[0].job;
 assert.equal(lastPayload.model,'seedance-2.0-mini');assert.equal(lastPayload.duration,15);assert.equal(lastPayload.resolution,'720p');assert.equal(lastPayload.size,'16:9');assert.equal(lastPayload.generate_audio,true);
 assert(lastPayload.prompt.includes('山西玉露香梨'));assert.equal(video(await quota('a')).reserved,1);
 await assert.rejects(jobs.createMediaJob(who('a'),{...body,prompt:'changed'}),error=>error.status===409);
});
await check('video saving retries the original URL, delivers private MP4 and settles once',async()=>{
 const prior=posts;taskMode='processing';await jobs.pollMediaJob('a',first.id);assert.equal((await jobs.ownedMediaJob('a',first.id)).status,'running');
 taskMode='completed';downloadMode='fail';unlock(first.id);const pending=await jobs.pollMediaJob('a',first.id);assert.equal(pending.status,'saving');assert.equal(pending.outputs.length,0);assert(!JSON.stringify(pending).includes(secret));assert.equal(video(await quota('a')).used,0);
 const queries=gets;downloadMode='ok';unlock(first.id);const done=await jobs.pollMediaJob('a',first.id);assert.equal(done.status,'succeeded');assert.equal(gets,queries);assert.equal(posts,prior);assert.equal(done.outputs[0].persisted,true);
 const asset=await jobs.mediaAsset('a',first.id,0);assert.equal(asset.headers.get('content-type'),'video/mp4');assert.deepEqual(new Uint8Array(await asset.arrayBuffer()),mp4);
 await assert.rejects(jobs.mediaAsset('b',first.id,0),error=>error.status===404);assert.equal((await jobs.ownedMediaJob('a',first.id)).key_cipher,'');
 await jobs.pollMediaJob('a',first.id);assert.equal(video(await quota('a')).used,1);
});
await check('two completed clips exhaust only video credits and block a third paid call',async()=>{
 reset();const job=await create('a');await jobs.pollMediaJob('a',job.id);const q=await quota('a');assert.equal(video(q).used,2);assert.equal(video(q).available,0);assert.equal(q.find(row=>row.capability==='image').available,5);assert.equal(q.find(row=>row.capability==='text').available,10);
 const prior=posts;await assert.rejects(create('a'),error=>error.status===402);assert.equal(posts,prior);
});
await check('explicit failure refunds video while unknown submission remains held without reposting',async()=>{
 const failed=await create('b');taskMode='failed';await jobs.pollMediaJob('b',failed.id);taskMode='completed';assert.equal(video(await quota('b')).available,2);
 postMode='unknown';const body=request(),unknown=(await jobs.createMediaJob(who('b'),body)).job;postMode='ok';assert.equal(unknown.status,'unknown');assert.equal(video(await quota('b')).reserved,1);const prior=posts;await jobs.createMediaJob(who('b'),body);assert.equal(posts,prior);
 postMode='rejected';const rejected=await create('c');postMode='ok';assert.equal(rejected.status,'failed');assert.equal(video(await quota('c')).available,2);
});
await check('mismatched status, untrusted hosts, redirects and non-video files never report delivery',async()=>{
 const job=await create('d');wrongId=true;await jobs.pollMediaJob('d',job.id);wrongId=false;assert.equal((await jobs.ownedMediaJob('d',job.id)).status,'queued');
 outputHost='getapib.org.attacker.com';unlock(job.id);const count=downloads;await jobs.pollMediaJob('d',job.id);assert.equal(downloads,count);assert.equal((await jobs.ownedMediaJob('d',job.id)).status,'saving');outputHost='getapib.org';
 const safe=await create('e');downloadMode='redirect';await jobs.pollMediaJob('e',safe.id);assert.equal((await jobs.ownedMediaJob('e',safe.id)).status,'saving');
 downloadMode='html';unlock(safe.id);await jobs.pollMediaJob('e',safe.id);assert.equal((await jobs.ownedMediaJob('e',safe.id)).status,'saving');assert.equal(video(await quota('e')).used,0);downloadMode='ok';unlock(safe.id);await jobs.pollMediaJob('e',safe.id);assert.equal(video(await quota('e')).used,1);
});
await check('fresh process resumes queued video through the background worker without POST',async()=>{
 const job=await create('f');const child=`import assert from 'node:assert/strict';globalThis.fetch=async(url,init={})=>{assert.notEqual(init.method,'POST');if(String(url).startsWith('https://api.apimart.ai/v1/tasks/')){const id=new URL(url).pathname.split('/').at(-1);return Response.json({code:200,data:{id,status:'completed',result:{videos:[{url:['https://getapib.org/f/video/recovered.mp4']}]}}});}assert.equal(String(url),'https://getapib.org/f/video/recovered.mp4');return new Response(Uint8Array.from(${JSON.stringify([...mp4])}));};const jobs=await import(${JSON.stringify(pathToFileURL(path.join(dir,'media-jobs.mjs')).href)});await jobs.reconcilePendingMediaJobs();assert.equal((await jobs.ownedMediaJob('f',${JSON.stringify(job.id)})).status,'succeeded');`;
 // Leave only this queued test job due; earlier deliberate unsafe task stays reserved.
 database.prepare('UPDATE media_jobs SET poll_after=? WHERE id!=?').run(Date.now()+3600000,job.id);
 const childResult=spawnSync(process.execPath,['--input-type=module','-e',child],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(childResult.status,0,childResult.stderr);assert.equal(video(await quota('f')).used,1);
});
await check('personal APIMart video adapter keeps ownership and bypasses event allowance',async()=>{
 const modelId=await models.saveModel('g',{name:'Personal isolated video',kind:'apimart',capability:'video',endpoint:protocol.APIMART_VIDEO_ENDPOINT,model:protocol.APIMART_VIDEO_MODEL,apiKey:secret,jsonMode:false});assert.equal((await models.ownedModel('g',modelId)).kind,'apimart');
 const listed=(await models.listModels('g')).models.find(row=>row.id===modelId);assert.equal(listed.kind,'apimart');
 assert.equal(database.prepare('SELECT kind FROM user_models WHERE id=?').get(modelId).kind,'openai-compatible','Storage compatibility remains unchanged');
 const workspace=await jobs.mediaWorkspace(who('g'));assert.equal(workspace.models.find(row=>row.id===modelId).kind,'apimart');
 const duration=listed.kind==='apimart'?15:5;
 const prior=await quota('g'),job=await create('g',{modelId,duration});assert.equal(lastPayload.duration,15);await jobs.pollMediaJob('g',job.id);assert.deepEqual(await quota('g'),prior);await assert.rejects(create('h',{modelId}),error=>error.status===404);
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
fs.writeFileSync(path.join(process.env.ZDX_DATA_DIR,'results.json'),JSON.stringify({ok:true,controlledNetwork:true,groups:results.length,results},null,2));
console.log('PASS APIMart video:',results.length,'groups;',path.join(process.env.ZDX_DATA_DIR,'results.json'));database.close();

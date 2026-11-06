// Isolated SQLite + controlled fetch. No env files, real keys or external calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import {startMediaReconciler} from '../runtime/media-reconciler.mjs';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
for(const name of Object.keys(process.env))if(/^(?:AI_|OPENAI_|APIMART_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|ZLG_|PLATFORM_ADMIN_)/.test(name))delete process.env[name];
Object.assign(process.env,{ZDX_DATA_DIR:path.resolve('.ecs-test',`media-background-${Date.now()}-${randomBytes(3).toString('hex')}`),AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),EVENT_ACTIVATION_ENABLED:'1'});
await import('./migrate-ecs.mjs');
const runtime=await import('../runtime/node-env.mjs'),database=runtime.sqlite(),dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=who=>who.userId==='admin';");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>null;");
for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','request-body','tenancy','ai-config','media-config','user-models','shanxi-knowledge','ding-persona','agriculture-policy','media-jobs']){
 let source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace(/(['"])\.\.\/\.\.\/\.\.\/sidecar\/([\w-]+\.mjs)\1/g,(_all,_quote,file)=>JSON.stringify(pathToFileURL(path.resolve('../../sidecar',file)).href)).replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");
 fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const load=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href),jobs=await load('media-jobs'),config=await load('media-config'),ai=await load('ai-config'),credits=await load('event-credits');
const users=Array.from({length:30},(_,index)=>'guest-'+index),time=new Date().toISOString();
for(const id of ['admin',...users])database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,time);
const codes=await credits.issueEventCodes('admin',{requestId:randomUUID(),count:50});
await Promise.all(users.map((id,index)=>credits.redeemEventCode(id,codes.codes[index])));
await config.saveMediaConfig({capability:'image',kind:'apimart',endpoint:'https://api.apimart.ai/v1/images/generations',model:'gpt-image-2.5-flare',apiKey:'isolated-fake-background-key',enabled:true,clearKey:false,revision:0},'admin');
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
let posts=0,gets=0,downloads=0,active=0,peak=0,taskMode='completed',downloadMode='ok';
globalThis.fetch=async(url,init={})=>{
 const actual=String(url);
 if(actual==='https://api.apimart.ai/v1/images/generations'&&init.method==='POST'){posts++;return Response.json({code:200,data:[{task_id:'background_'+posts}]});}
 assert.notEqual(init.method,'POST','A recovery operation must never submit a paid generation');
 if(actual.startsWith('https://api.apimart.ai/v1/tasks/')){
  gets++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,10));active--;
  const id=new URL(actual).pathname.split('/').at(-1);
  return Response.json({code:200,data:{id,status:taskMode,...(taskMode==='completed'?{result:{images:[{url:['https://getapib.org/f/image/'+id+'.png'],expires_at:Math.floor(Date.now()/1000)+86400}]}}:{})}});
 }
 if(actual.startsWith('https://getapib.org/f/image/')){downloads++;assert.equal(init.headers,undefined);if(downloadMode==='fail')throw Error('fixture unavailable');return new Response(png);}
 throw Error('Unexpected external request blocked');
};
const actor=id=>({id,displayName:id,platformAdmin:false,identity:{provider:'password',userId:id}});
const create=async id=>(await jobs.createMediaJob(actor(id),{capability:'image',modelId:null,prompt:'隔离测试农产品图片',consent:true,idempotencyKey:randomUUID()})).job;
const unlock=id=>database.prepare('UPDATE media_jobs SET poll_after=0 WHERE id=?').run(id);
const quota=async id=>(await credits.eventCreditSummary(id)).quotas.find(row=>row.capability==='image');
const results=[];async function check(name,work){await work();results.push({name,passed:true});console.log('PASS',name);}

await check('both standard and wrapped text completions work; errors and empty bodies never pass',async()=>{
 const savedFetch=globalThis.fetch,provider={name:'APIMart',kind:'openai-compatible',endpoint:'https://api.apimart.ai/v1/chat/completions',model:'deepseek-v4.1-flash',key:'fixture',jsonMode:true};
 try{
  for(const body of [{choices:[{message:{content:'{"ok":true}'}}]},{code:200,data:{choices:[{message:{content:'{"ok":true}'}}]}}]){globalThis.fetch=async()=>Response.json(body);assert.equal(await ai.requestCompletion(provider,[],64),'{"ok":true}');}
  for(const body of [{code:500,data:{choices:[{message:{content:'must not pass'}}]}},{code:200,data:{}},{choices:[]},{choices:[{message:{content:''}}]},null]){globalThis.fetch=async()=>Response.json(body);await assert.rejects(ai.requestCompletion(provider,[],64),error=>error.status===502);}
 }finally{globalThis.fetch=savedFetch;}
});
await check('background round saves and settles with no browser request',async()=>{
 const job=await create('guest-0'),before=posts;assert.equal((await quota('guest-0')).reserved,1);
 const result=await jobs.reconcilePendingMediaJobs();assert.equal(result.processed,1);
 assert.equal((await jobs.ownedMediaJob('guest-0',job.id)).status,'succeeded');assert.equal((await quota('guest-0')).used,1);assert.equal((await quota('guest-0')).reserved,0);assert.equal(posts,before);
 await assert.rejects(jobs.mediaAsset('guest-1',job.id,0),error=>error.status===404);assert.equal((await jobs.mediaAsset('guest-0',job.id,0)).status,200);
});
await check('batch and worker concurrency are bounded; frontend races use the durable lease',async()=>{
 const created=await Promise.all(users.slice(1,9).map(create)),before=posts;peak=0;
 const round=await jobs.reconcilePendingMediaJobs({batchSize:3,concurrency:2});assert.equal(round.selected,3);assert(peak<=2);assert.equal(posts,before);
 const pending=created.filter(job=>database.prepare('SELECT status FROM media_jobs WHERE id=?').get(job.id).status==='queued');assert.equal(pending.length,5);
 taskMode='processing';const getCount=gets;
 await Promise.all([jobs.reconcilePendingMediaJobs(),...pending.map((job,index)=>jobs.pollMediaJob(users[created.indexOf(job)+1],job.id))]);assert.equal(gets,getCount+5);
 taskMode='completed';for(const job of pending)unlock(job.id);await jobs.reconcilePendingMediaJobs();assert.equal(posts,before);
});
await check('failed download stays reserved then resumes from the original URL without another POST',async()=>{
 const job=await create('guest-10'),before=posts;downloadMode='fail';await jobs.reconcilePendingMediaJobs();assert.equal((await jobs.ownedMediaJob('guest-10',job.id)).status,'saving');assert.equal((await quota('guest-10')).reserved,1);
 downloadMode='ok';unlock(job.id);const getCount=gets;await jobs.reconcilePendingMediaJobs();assert.equal(gets,getCount);assert.equal(posts,before);assert.equal((await quota('guest-10')).used,1);
});
await check('provider failure releases the hold; unknown submissions stay reserved for administrator review',async()=>{
 const failed=await create('guest-11');taskMode='failed';await jobs.reconcilePendingMediaJobs();assert.equal((await jobs.ownedMediaJob('guest-11',failed.id)).status,'failed');assert.equal((await quota('guest-11')).reserved,0);assert.equal((await quota('guest-11')).available,5);taskMode='completed';
 const unknown=await create('guest-12');database.prepare("UPDATE media_jobs SET status='unknown',key_cipher='' WHERE id=?").run(unknown.id);const count=gets,before=posts;
 await jobs.reconcilePendingMediaJobs();assert.equal(gets,count);assert.equal(posts,before);assert.equal((await quota('guest-12')).reserved,1);assert.equal((await credits.eventCreditForRequest('guest-12',unknown.id)).status,'unknown');
});
await check('a crash between terminal status and settlement is repaired locally',async()=>{
 const job=await create('guest-13'),realBatch=runtime.env.DB.batch;let inject=true;
 runtime.env.DB.batch=async statements=>{if(inject&&statements.some(row=>row.sql.startsWith("UPDATE event_credit_usage SET status='succeeded'"))){inject=false;throw Error('fixture interrupted settlement');}return realBatch(statements);};
 try{await jobs.reconcilePendingMediaJobs();}finally{runtime.env.DB.batch=realBatch;}
 assert.equal((await jobs.ownedMediaJob('guest-13',job.id)).status,'succeeded');assert.equal((await quota('guest-13')).reserved,1);
 const before=posts,count=gets;const recovered=await jobs.reconcilePendingMediaJobs();assert.equal(recovered.settled,1);assert.equal((await quota('guest-13')).used,1);assert.equal((await quota('guest-13')).reserved,0);assert.equal(posts,before);assert.equal(gets,count);
});
await check('fresh process starts its worker and resumes the durable task without a browser or POST',async()=>{
 const job=await create('guest-14'),before=posts;
 const child=`import assert from 'node:assert/strict';import {startMediaReconciler} from ${JSON.stringify(pathToFileURL(path.resolve('runtime/media-reconciler.mjs')).href)};globalThis.fetch=async(url,init={})=>{assert.notEqual(init.method,'POST');if(String(url).startsWith('https://api.apimart.ai/v1/tasks/')){const id=new URL(url).pathname.split('/').at(-1);return Response.json({code:200,data:{id,status:'completed',result:{images:[{url:['https://getapib.org/f/image/resumed.png']}]}}});}assert.equal(String(url),'https://getapib.org/f/image/resumed.png');return new Response(Uint8Array.from([137,80,78,71,13,10,26,10]));};const jobs=await import(${JSON.stringify(pathToFileURL(path.join(dir,'media-jobs.mjs')).href)});await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('worker did not run')),5000);const worker=startMediaReconciler(async()=>{await jobs.reconcilePendingMediaJobs();assert.equal((await jobs.ownedMediaJob('guest-14',${JSON.stringify(job.id)})).status,'succeeded');worker.stop();clearTimeout(timeout);resolve();},{initialDelayMs:0,onError:()=>reject(Error('worker failed'))});});`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',child],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.equal((await jobs.ownedMediaJob('guest-14',job.id)).status,'succeeded');assert.equal((await quota('guest-14')).used,1);assert.equal(posts,before);
});
await check('worker is singleton, never overlaps rounds, survives failure and stops cleanly',async()=>{
 let activeRounds=0,peakRounds=0,rounds=0,errors=0;const listeners=process.listenerCount('SIGTERM');let worker;
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{worker?.stop();reject(Error('scheduler timeout'));},3000);worker=startMediaReconciler(async()=>{rounds++;activeRounds++;peakRounds=Math.max(peakRounds,activeRounds);await new Promise(done=>setTimeout(done,15));activeRounds--;if(rounds===1)throw Error('fixture');if(rounds===3){worker.stop();clearTimeout(timeout);resolve();}},{initialDelayMs:0,intervalMs:10,onError:()=>{errors++;}});assert.equal(startMediaReconciler(()=>assert.fail('duplicate worker')),worker);});
 assert.equal(peakRounds,1);assert.equal(errors,1);assert.equal(rounds,3);assert.equal(process.listenerCount('SIGTERM'),listeners);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(rounds,3);
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
const report={at:new Date().toISOString(),scope:'Isolated SQLite + mock upstream; no real API or production data',passed:results.length,results};fs.writeFileSync(path.join(process.env.ZDX_DATA_DIR,'results.json'),JSON.stringify(report,null,2));
database.close();console.log('PASS media background:',results.length,'groups; evidence:',path.join(process.env.ZDX_DATA_DIR,'results.json'));

// Isolated image-edit regression: no env files, production data, or real network.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
Object.assign(process.env,{ZDX_DATA_DIR:path.join(root,'.ecs-test',`image-edit-${Date.now()}-${randomBytes(3).toString('hex')}`),AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_ORIGIN:'http://127.0.0.1:8845'});
delete process.env.EVENT_ACTIVATION_ENABLED;
globalThis.fetch=async()=>{throw Error('Unexpected network request blocked');};
await import('./migrate-ecs.mjs');
const runtime=await import('../runtime/node-env.mjs'),database=runtime.sqlite(),now=new Date().toISOString(),dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
for(const id of ['admin','a','b','outsider']){database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,now);database.prepare("INSERT INTO auth_identities VALUES (?,?,'password',?,?)").run(id,id,id,now);}
database.prepare("INSERT INTO merchants VALUES ('merchant-a','Fixture','active','admin',?)").run(now);
database.prepare("INSERT INTO merchant_memberships VALUES ('merchant-a','a','member','active',?)").run(now);
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=who=>who.userId==='admin';");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>globalThis.testWho?{userId:globalThis.testWho,provider:'password',displayName:globalThis.testWho}:null;");
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
for(const name of ['media-jobs','media-config','apimart-protocol','user-models','event-credits','tenancy'])compile(name);
let routeSource=fs.readFileSync('app/api/media/jobs/route.ts','utf8').replace(/(['"])@\/lib\/([\w-]+)\1/g,(_all,_quote,name)=>{compile(name);return JSON.stringify('./'+name+'.mjs');});
fs.writeFileSync(path.join(dir,'route.mjs'),ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const load=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href);
const jobs=await load('media-jobs'),config=await load('media-config'),protocol=await load('apimart-protocol'),models=await load('user-models'),credits=await load('event-credits'),route=await load('route');
const who=id=>({id,displayName:id,identity:{provider:'password',userId:id},platformAdmin:id==='admin'});
const secret='isolated-edit-key-'+randomBytes(12).toString('hex');
await config.saveMediaConfig({capability:'image',kind:'apimart',endpoint:protocol.APIMART_IMAGE_ENDPOINT,model:protocol.APIMART_IMAGE_MODEL,apiKey:secret,enabled:true,clearKey:false,revision:0},'admin');
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,bytes){const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc32(Buffer.concat([name,bytes])));return Buffer.concat([head,name,bytes,tail]);}
function png(width=2,height=2,color=40,noise=false){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const raw=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)for(let x=0;x<width*4;x++)raw[y*(width*4+1)+x+1]=noise?randomBytes(1)[0]:(x%4===3?255:color);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const referenceBytes=png(),referenceImage='data:image/png;base64,'+referenceBytes.toString('base64'),differentImage='data:image/png;base64,'+png(2,2,170).toString('base64');
const resultImage=png(2,2,80),referenceUrl='https://upload.apimart.ai/f/image/fixture-reference.png';
let uploadMode='ok',generationMode='ok',uploads=0,generations=0,lastUpload,lastPayload,taskNumber=0;
const resetLimits=()=>database.prepare("DELETE FROM auth_limits WHERE key LIKE 'media:%'").run();
const request=(changes={})=>({capability:'image',modelId:null,prompt:'保持产品主体与品牌信息，换成柔和米白背景并优化光线。',ratio:'1:1',consent:true,idempotencyKey:randomUUID(),...changes});
const edit=(changes={})=>request({referenceImage,...changes});
const results=[];async function check(name,work){resetLimits();await work();results.push({name,passed:true});console.log('PASS',name);}
globalThis.fetch=async(url,init={})=>{
 const actual=String(url);
 if(actual==='https://api.apimart.ai/v1/uploads/images'){
  uploads++;assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);assert(init.body instanceof FormData);assert.equal(new Headers(init.headers).get('content-type'),null,'Multipart boundary must be produced by fetch');
  const file=init.body.get('file');assert(file instanceof Blob);lastUpload={type:file.type,name:file.name,bytes:Buffer.from(await file.arrayBuffer())};
  if(uploadMode==='network')throw Error(secret);
  if(uploadMode==='401')return Response.json({error:{message:secret}},{status:401});
  if(uploadMode==='500')return Response.json({error:{message:secret}},{status:500});
  if(uploadMode==='redirect')return new Response(null,{status:302,headers:{location:'https://attacker.example/upload'}});
  if(uploadMode==='invalid-json')return new Response('{not json');
  if(uploadMode==='unsafe-url')return Response.json({url:'http://127.0.0.1/private'});
  if(uploadMode==='foreign-host')return Response.json({url:'https://upload.apimart.ai.attacker.com/f/image/photo.png'});
  return Response.json({url:referenceUrl,filename:'reference.png',content_type:file.type,bytes:file.size,created_at:Math.floor(Date.now()/1000)});
 }
 if(actual===protocol.APIMART_IMAGE_ENDPOINT){
  generations++;assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+secret);lastPayload=JSON.parse(init.body);
  if(generationMode==='network')throw Error(secret);
  if(generationMode==='500')return Response.json({error:{message:secret}},{status:500});
  if(generationMode==='429')return Response.json({error:{message:secret}},{status:429});
  return Response.json({code:200,data:[{task_id:'image_edit_fixture_'+(++taskNumber)}]});
 }
 if(actual.startsWith('https://api.apimart.ai/v1/tasks/')){const id=new URL(actual).pathname.split('/').at(-1);return Response.json({code:200,data:{id,status:'completed',result:{images:[{url:['https://getapib.org/f/image/'+id+'.png']}]}}});}
 if(actual.startsWith('https://getapib.org/f/image/')){assert.equal(init.headers,undefined);assert.equal(init.redirect,'manual');return new Response(resultImage,{headers:{'content-type':'image/png'}});}
 throw Error('Unexpected network request blocked: '+new URL(actual).hostname);
};
function privateOutput(value){const serialized=JSON.stringify(value);assert(!serialized.includes(referenceImage));assert(!serialized.includes(referenceUrl));assert(!serialized.includes(secret));}
const quota=async(id)=>(await credits.eventCreditSummary(id)).quotas.find(row=>row.capability==='image');
const http=(body,options={})=>new Request('http://127.0.0.1:8845/api/media/jobs',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:8845',...options.headers},body:typeof body==='string'?body:JSON.stringify(body),...options});

await check('text-to-image keeps its existing payload and skips upload',async()=>{
 const before=uploads,job=(await jobs.createMediaJob(who('a'),request())).job;assert.equal(uploads,before);assert.equal(lastPayload.image_urls,undefined);assert.equal(lastPayload.model,protocol.APIMART_IMAGE_MODEL);assert.equal(lastPayload.resolution,'2k');assert.equal(lastPayload.quality,'medium');assert.equal(lastPayload.n,1);assert.equal(job.status,'queued');assert.equal((await jobs.pollMediaJob('a',job.id)).status,'succeeded');
});
await check('reference file uploads server-side before one image generation at the original tier',async()=>{
 const before={uploads,generations},body=edit(),job=(await jobs.createMediaJob(who('a'),body)).job;assert.equal(uploads,before.uploads+1);assert.equal(generations,before.generations+1);assert.deepEqual(lastUpload.bytes,referenceBytes);assert.equal(lastUpload.type,'image/png');assert.deepEqual(lastPayload.image_urls,[referenceUrl]);assert.equal(lastPayload.n,1);assert.equal(lastPayload.resolution,'2k');assert.equal(lastPayload.quality,'medium');assert(!JSON.stringify(lastPayload).includes(referenceImage));privateOutput(job);
 const same=await jobs.createMediaJob(who('a'),body);assert.equal(same.job.id,job.id);assert.equal(uploads,before.uploads+1);assert.equal(generations,before.generations+1);assert.equal((await jobs.pollMediaJob('a',job.id)).status,'succeeded');
 privateOutput(await jobs.mediaWorkspace(who('a')));privateOutput(await jobs.ownedMediaJob('a',job.id));assert.equal((await jobs.mediaAsset('a',job.id,0)).status,200);await assert.rejects(jobs.mediaAsset('outsider',job.id,0),error=>error.status===404);
});
await check('concurrent retries share one upload and one upstream generation',async()=>{
 const body=edit(),before={uploads,generations},all=await Promise.all(Array.from({length:8},()=>jobs.createMediaJob(who('a'),body)));assert.equal(new Set(all.map(row=>row.job.id)).size,1);assert.equal(uploads,before.uploads+1);assert.equal(generations,before.generations+1);
});
await check('changed reference under one idempotency key conflicts before another upload',async()=>{
 const body=edit();await jobs.createMediaJob(who('a'),body);const before={uploads,generations};await assert.rejects(jobs.createMediaJob(who('a'),{...body,referenceImage:differentImage}),error=>error.status===409);await assert.rejects(jobs.createMediaJob(who('a'),{...body,referenceImage:undefined}),error=>error.status===409);assert.deepEqual({uploads,generations},before);
});
await check('invalid references, absent consent and video references never reach the provider',async()=>{
 const before={uploads,generations},jobCount=database.prepare('SELECT COUNT(*) AS n FROM media_jobs').get().n;
 const invalid=[{consent:false},{referenceImage:null},{referenceImage:[]},{referenceImage:''},{referenceImage:'https://example.com/photo.png'},{referenceImage:'data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')},{referenceImage:'data:image/jpeg;base64,'+referenceBytes.toString('base64')},{referenceImage:'data:image/png;base64,@@@@'},{referenceImage:'data:image/png;base64,'+Buffer.from('not an image').toString('base64')},{referenceImage:'data:image/png;base64,'+Buffer.alloc(6*1024*1024+1).toString('base64')},{capability:'video',duration:15},{image_urls:[referenceUrl]},{quality:'max'},{n:3}];
 for(const changes of invalid)await assert.rejects(jobs.createMediaJob(who('a'),edit(changes)),error=>[400,413,415].includes(error.status),JSON.stringify(changes).slice(0,100));
 assert.deepEqual({uploads,generations},before);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM media_jobs').get().n,jobCount);
});
await check('unsupported personal image providers are rejected without upload or generation',async()=>{
 const ark=await models.saveModel('a',{name:'Unsupported edit fixture',kind:'ark',capability:'image',endpoint:'https://ark.cn-beijing.volces.com/api/v3/images/generations',model:'fixture-ark',apiKey:'fixture-unrelated-secret',jsonMode:false});
 const before={uploads,generations};await assert.rejects(jobs.createMediaJob(who('a'),edit({modelId:ark})),error=>error.status===400);assert.deepEqual({uploads,generations},before);
});
await check('missing merchant access cannot upload any reference image',async()=>{
 const before={uploads,generations};await assert.rejects(jobs.createMediaJob(who('outsider'),edit()),error=>error.status===403);assert.deepEqual({uploads,generations},before);
});
await check('upload rejection or invalid returned URL never starts a paid generation',async()=>{
 for(const mode of ['401','500','network','redirect','invalid-json','unsafe-url','foreign-host']){
  resetLimits();uploadMode=mode;const body=edit(),before=generations;try{const result=await jobs.createMediaJob(who('a'),body);assert.equal(result.job.status,'failed');privateOutput(result);}catch(error){assert(error.status>=400);assert(!error.message.includes(secret));}
  const stored=database.prepare('SELECT * FROM media_jobs WHERE idempotency_key=?').get(body.idempotencyKey);assert(stored);assert.equal(stored.status,'failed');assert.equal(stored.key_cipher,'');assert.equal(stored.upstream_id,null);privateOutput(stored);assert.equal(generations,before);
 }
 uploadMode='ok';
});
await check('generation uncertainty does not replay upload or generation under the same key',async()=>{
 for(const mode of ['network','500']){resetLimits();generationMode=mode;const body=edit(),job=(await jobs.createMediaJob(who('a'),body)).job;assert.equal(job.status,'unknown');privateOutput(job);const before={uploads,generations};assert.equal((await jobs.createMediaJob(who('a'),body)).job.id,job.id);assert.deepEqual({uploads,generations},before);}
 generationMode='ok';
});
await check('authenticated HTTP with its matching owner accepts a reference larger than the old 12 KB text limit',async()=>{
 globalThis.testWho='a';const image='data:image/png;base64,'+png(128,128,40,true).toString('base64');assert(image.length>12000);const response=await route.POST(http(edit({referenceImage:image}),{headers:{origin:'http://127.0.0.1:8845','content-type':'application/json','x-zdx-media-owner':'a'}}));assert.equal(response.status,201,await response.clone().text());const data=await response.json();privateOutput(data);assert(!JSON.stringify(data).includes(image));
});
await check('HTTP rejects stale owners, unauthenticated, cross-origin, malformed and unapproved fields',async()=>{
 const before={uploads,generations},jobCount=database.prepare('SELECT COUNT(*) AS n FROM media_jobs').get().n;globalThis.testWho=null;assert.equal((await route.POST(http(edit()))).status,401);globalThis.testWho='a';assert.equal((await route.POST(http(edit(),{headers:{origin:'https://attacker.example','content-type':'application/json'}}))).status,403);assert.equal((await route.POST(http(edit(),{headers:{origin:'http://127.0.0.1:8845','content-type':'application/json','x-zdx-media-owner':'b'}}))).status,403);assert.equal((await route.POST(http('{bad json'))).status,400);assert.equal((await route.POST(http(edit({image_urls:[referenceUrl]})))).status,400);assert.deepEqual({uploads,generations},before);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM media_jobs').get().n,jobCount);
});
await check('HTTP enforces the body limit even with chunked input and no content-length',async()=>{
 const before={uploads,generations};const huge=new TextEncoder().encode(JSON.stringify(edit({referenceImage:'data:image/png;base64,'+'A'.repeat(9*1024*1024)})));let offset=0;
 const stream=new ReadableStream({pull(controller){if(offset===huge.length){controller.close();return;}const end=Math.min(offset+65536,huge.length);controller.enqueue(huge.slice(offset,end));offset=end;}});
 const response=await route.POST(new Request('http://127.0.0.1:8845/api/media/jobs',{method:'POST',headers:{origin:'http://127.0.0.1:8845','content-type':'application/json'},body:stream,duplex:'half'}));assert.equal(response.status,413);assert.deepEqual({uploads,generations},before);
});
await check('a stalled reference upload returns 408 before creating a job or calling a provider',async()=>{
 const before={uploads,generations},jobCount=database.prepare('SELECT COUNT(*) AS n FROM media_jobs').get().n,originalTimer=globalThis.setTimeout;let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 globalThis.setTimeout=(callback,delay,...args)=>originalTimer(callback,delay===20000?5:delay,...args);
 try{const response=await route.POST(new Request('http://127.0.0.1:8845/api/media/jobs',{method:'POST',headers:{origin:'http://127.0.0.1:8845','content-type':'application/json'},body:stream,duplex:'half'}));assert.equal(response.status,408);assert(cancelled);}finally{globalThis.setTimeout=originalTimer;}
 assert.deepEqual({uploads,generations},before);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM media_jobs').get().n,jobCount);
});
await check('experience-card editing reserves and settles exactly one existing image credit',async()=>{
 process.env.EVENT_ACTIVATION_ENABLED='1';const issued=await credits.issueEventCodes('admin',{requestId:randomUUID(),count:1,label:'Isolated image edit fixture'});await credits.redeemEventCode('b',issued.codes[0]);const before=await quota('b'),body=edit(),job=(await jobs.createMediaJob(who('b'),body)).job;
 assert.equal((await quota('b')).available,before.available-1);assert.equal((await quota('b')).reserved,1);assert.equal((await quota('b')).used,0);assert.equal((await jobs.pollMediaJob('b',job.id)).status,'succeeded');await jobs.createMediaJob(who('b'),body);assert.equal((await quota('b')).used,1);assert.equal((await quota('b')).reserved,0);
});
await check('upload failure releases the image credit without touching text or video balances',async()=>{
 uploadMode='500';const before=await credits.eventCreditSummary('b'),body=edit(),postsBefore=generations;try{await jobs.createMediaJob(who('b'),body);}catch(error){assert(error.status>=400);}const job=database.prepare('SELECT * FROM media_jobs WHERE idempotency_key=?').get(body.idempotencyKey);assert.equal(job.status,'failed');assert.equal((await credits.eventCreditForRequest('b',job.id)).status,'released');assert.deepEqual((await credits.eventCreditSummary('b')).quotas,before.quotas);assert.equal(generations,postsBefore);uploadMode='ok';
});
await check('unknown paid generation retains one hold and never charges a second retry',async()=>{
 generationMode='network';const before=await quota('b'),body=edit(),job=(await jobs.createMediaJob(who('b'),body)).job;assert.equal(job.status,'unknown');assert.equal((await quota('b')).available,before.available-1);assert.equal((await quota('b')).reserved,1);const calls={uploads,generations};await jobs.createMediaJob(who('b'),body);assert.deepEqual({uploads,generations},calls);assert.equal((await credits.eventCreditForRequest('b',job.id)).status,'unknown');generationMode='ok';
});
await check('an exhausted image allowance cannot upload, while existing records stay readable',async()=>{
 while((await quota('b')).available>0){resetLimits();const job=(await jobs.createMediaJob(who('b'),edit())).job;await jobs.pollMediaJob('b',job.id);}
 resetLimits();const before={uploads,generations};await assert.rejects(jobs.createMediaJob(who('b'),edit()),error=>error.status===402);assert.deepEqual({uploads,generations},before);privateOutput(await jobs.mediaWorkspace(who('b')));
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
const report={at:new Date().toISOString(),scope:'Isolated SQLite, generated non-customer reference fixtures, mocked upload/generation and authenticated route handlers; no real API calls or production writes',passed:results.length,uploads,generations,results};
const reportPath=path.join(process.env.ZDX_DATA_DIR,'results.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`PASS: ${results.length} image-edit groups. ${reportPath}`);

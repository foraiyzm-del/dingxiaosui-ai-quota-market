// Production build, disposable SQLite and a fully blocked/mocked provider.
// No real key, existing card, production data or external model is used.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
assert.equal(fs.readFileSync(path.join(root,'public/event-access.js'),'utf8'),fs.readFileSync(path.join(root,'event-access.js'),'utf8'),'The build must preserve event entry route logic without rewriting index.html in JavaScript');
const port=8847,origin=`http://127.0.0.1:${port}`,folder=path.resolve('.ecs-test','event-direct-'+Date.now()),app=path.join(folder,'app'),dataDir=path.join(folder,'data');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
for(const key of Object.keys(process.env))if(/^(?:AI_|OPENAI_|APIMART_|ARK_|DASHSCOPE_|DEEPSEEK_|LOCAL_|ZLG_|PLATFORM_ADMIN_|MEDIA_)/.test(key))delete process.env[key];
Object.assign(process.env,{ZDX_DATA_DIR:dataDir,APP_ENV:'production',PASSWORD_AUTH_ENABLED:'1',APP_ORIGIN:origin,AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),EVENT_ACTIVATION_ENABLED:'1',ZLG_GATEWAY_REQUIRED:'0',MEDIA_BACKGROUND_ENABLED:'1',NEXT_TELEMETRY_DISABLED:'1'});
await import('./migrate-ecs.mjs');const {sqlite}=await import('../runtime/node-env.mjs');
const standalone=path.join(root,'.next/standalone');
fs.cpSync(standalone,app,{recursive:true,filter:source=>!/^\.env(?:\.|$)|^\.dev\.vars/.test(path.basename(source))&&(process.platform!=='win32'||!['node_modules','public',path.join('.next','static')].includes(path.relative(standalone,source)))});
// pnpm dependency links require elevated symlink privileges when copied on Windows.
// Only dependencies are shared; the server build, data and provider mocks stay isolated.
if(process.platform==='win32'){
 for(const directory of ['node_modules','public',path.join('.next','static')])fs.symlinkSync(path.join(root,directory),path.join(app,directory),'junction');
}else{
 fs.cpSync(path.join(root,'public'),path.join(app,'public'),{recursive:true});fs.cpSync(path.join(root,'.next/static'),path.join(app,'.next/static'),{recursive:true});
}
const control=path.join(folder,'mock-control.json'),callsFile=path.join(folder,'mock-calls.jsonl'),preload=path.join(folder,'mock-upstream.mjs');
const textPayloadsFile=path.join(folder,'mock-text-payloads.jsonl');
fs.writeFileSync(control,JSON.stringify({text:'ok'}),{mode:0o600});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/LsAAAAASUVORK5CYII=';
const referenceImage='data:image/png;base64,'+png,referenceUrl='https://upload.apimart.ai/f/image/fixture-reference.png';
fs.writeFileSync(path.join(folder,'reference-fixture.png'),Buffer.from(png,'base64'));
const mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
fs.writeFileSync(preload,`import fs from 'node:fs';import {randomUUID} from 'node:crypto';
const original=globalThis.fetch;globalThis.fetch=async(url,init={})=>{const actual=String(url),u=new URL(actual);const log=kind=>fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify({kind,method:init.method||'GET'})+'\\n');
if(actual==='https://api.apimart.ai/v1/chat/completions'){log('text');const payload=JSON.parse(init.body);fs.appendFileSync(${JSON.stringify(textPayloadsFile)},JSON.stringify({messages:payload.messages})+'\\n',{mode:0o600});if(payload.model!=='deepseek-v4.1-flash'||payload.stream!==false)throw Error('Unexpected text protocol');const mode=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8')).text;if(mode==='fail')return Response.json({error:{code:'payment_required'}},{status:402});if(mode==='unknown')throw Error('Mock network interruption');return Response.json({code:200,data:{choices:[{message:{content:JSON.stringify({answer:'【隔离模拟验收】山西小米品牌故事：从真实产地与产品资料出发，讲清一碗小米的日常风味。此内容来自测试服务，不是真实模型生成。',title:'山西小米品牌故事'})}}]}});}
if(actual==='https://api.apimart.ai/v1/uploads/images'){
 if(init.method!=='POST'||init.redirect!=='manual'||new Headers(init.headers).get('authorization')!=='Bearer isolated-fake-provider-key'||new Headers(init.headers).has('content-type')||!(init.body instanceof FormData))throw Error('Unexpected reference upload protocol');
 const file=init.body.get('file');if(!(file instanceof Blob)||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<12||file.size>6*1024*1024)throw Error('Invalid reference upload fixture');
 const bytes=Buffer.from(await file.arrayBuffer());if(file.type==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Reference bytes do not match the declared type');
 log('reference-upload');return Response.json({url:${JSON.stringify(referenceUrl)},filename:file.name,content_type:file.type,bytes:file.size,created_at:Math.floor(Date.now()/1000)});
}
if(actual==='https://api.apimart.ai/v1/images/generations'&&init.method==='POST'){log('image-submit');const p=JSON.parse(init.body);if(p.n!==1||p.model!=='gpt-image-2.5-flare'||p.quality!=='medium'||p.resolution!=='2k')throw Error('Unexpected image protocol');if(p.image_urls!==undefined){if(JSON.stringify(p.image_urls)!==JSON.stringify([${JSON.stringify(referenceUrl)}]))throw Error('Unexpected reference URL');log('image-edit-submit');}return Response.json({code:200,data:[{task_id:'fixture_'+randomUUID()}]});}
if(actual==='https://api.apimart.ai/v1/videos/generations'&&init.method==='POST'){log('video-submit');const p=JSON.parse(init.body);if(p.model!=='seedance-2.0-mini'||p.duration!==15||p.resolution!=='720p'||p.generate_audio!==true||p.size!=='16:9')throw Error('Unexpected video protocol');return Response.json({code:200,data:[{task_id:'fixture_video_'+randomUUID()}]});}
if(actual.startsWith('https://api.apimart.ai/v1/tasks/')){const id=u.pathname.split('/').at(-1),video=id.startsWith('fixture_video_');log(video?'video-poll':'image-poll');return Response.json({code:200,data:{id,status:'completed',result:video?{videos:[{url:['https://getapib.org/f/video/fixture.mp4']}]}:{images:[{url:['https://upload.apimart.ai/f/image/fixture.png']}]}}});}
if(actual==='https://getapib.org/f/video/fixture.mp4'){log('video-download');if(init.headers||init.redirect!=='manual')throw Error('Private video download must omit credentials and refuse redirects');return new Response(Buffer.from(${JSON.stringify(mp4.toString('base64'))},'base64'),{headers:{'content-type':'video/mp4'}});}
if(actual==='https://upload.apimart.ai/f/image/fixture.png'){log('image-download');if(init.headers)throw Error('No credential may reach asset host');return new Response(Buffer.from(${JSON.stringify(png)},'base64'),{headers:{'content-type':'image/png'}});}
if(u.hostname==='127.0.0.1'||u.hostname==='localhost')return original(url,init);throw Error('External network blocked in acceptance fixture');};`,{mode:0o600});
let server,checks=0;const results=[];
async function start(){server=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(app,'server.js')],{cwd:app,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1'},stdio:['ignore','pipe','pipe']});let logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{logs=(logs+chunk.toString()).slice(-10000)});for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error('Acceptance server stopped: '+logs);try{if((await fetch(origin+'/api/event/session')).status===200)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Acceptance server did not start: '+logs);}
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill('SIGTERM');await ended;}}
async function request(route,{cookie='',method='GET',body,from=origin,contentType='application/json',headers={}}={}){const response=await fetch(origin+route,{method,headers:{origin:from,'content-type':contentType,...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});let data;try{data=await response.json()}catch{data=null}const jar=new Map(cookie.split(';').map(x=>x.trim().split('=')));for(const item of response.headers.getSetCookie()){const [name,value]=item.split(';')[0].split('=');if(value)jar.set(name,value);else jar.delete(name);}return {status:response.status,data,cookie:[...jar].filter(([k,v])=>k&&v).map(([k,v])=>k+'='+v).join('; '),setCookies:response.headers.getSetCookie()};}
function expect(response,status=200){assert.equal(response.status,status,JSON.stringify(response.data));checks++;return response.data;}
async function check(name,work){await work();results.push({name,passed:true});console.log('PASS',name);}
const stats=()=>fs.existsSync(callsFile)?fs.readFileSync(callsFile,'utf8').trim().split('\n').filter(Boolean).map(row=>JSON.parse(row)):[];
const quota=async guest=>expect(await request('/api/account/event-credits',guest));
const textCount=summary=>summary.quotas.find(q=>q.capability==='text');
let admin,issued,guests;
try{
 await start();
 await check('anonymous activation requires no registration and rejects unsafe requests',async()=>{
  const initial=expect(await request('/api/event/session'));assert.equal(initial.enabled,true);assert.equal(initial.authenticated,false);
  expect(await request('/api/me'),401);expect(await request('/api/dialogue',{method:'POST',body:{message:'test',consent:true}}),401);
  expect(await request('/api/event/session',{method:'POST',body:{code:'invalid'},from:'https://untrusted.invalid'}),403);
  expect(await request('/api/event/session',{method:'POST',body:{code:'invalid'},contentType:'text/plain'}),415);
  expect(await request('/api/event/session',{method:'POST',body:{code:'invalid'}}),400);
 });
 const setup=randomBytes(32).toString('hex');sqlite().prepare('INSERT INTO setup_tokens VALUES (?,?,0)').run(createHash('sha256').update(setup).digest('hex'),Date.now()+3600000);
 admin=await request('/api/auth',{method:'POST',body:{action:'setup',username:'isolated-event-admin',password:randomBytes(20).toString('hex'),displayName:'隔离验收管理员',setupToken:setup}});expect(admin);
 issued=expect(await request('/api/platform/event-codes',{...admin,method:'POST',body:{action:'issue',requestId:randomUUID(),count:50,label:'隔离验收50张卡'}}));
 assert.equal(issued.codes.length,50);
 // A publicly documented test code is valid only in this newly created fixture.
 const browserCode='ZDXE-00000000-11111111-22222222-33333333';
 sqlite().prepare('UPDATE event_activation_codes SET code_hash=? WHERE code_hash=?').run(createHash('sha256').update(browserCode.replaceAll('-','')).digest('hex'),createHash('sha256').update(issued.codes[49].replaceAll('-','')).digest('hex'));
 issued.codes[49]=browserCode;
 await check('50 guests on one network activate directly with isolated sessions and one grant each',async()=>{
  guests=await Promise.all(issued.codes.map(code=>request('/api/event/session',{method:'POST',body:{code}})));
  for(const guest of guests){const data=expect(guest);assert(data.authenticated);assert(data.activated);assert(data.user?.id);guest.id=data.user.id;assert(guest.setCookies.some(cookie=>cookie.includes('HttpOnly')));const w=await quota(guest);assert.equal(textCount(w).available,10);assert.equal(w.quotas.find(q=>q.capability==='image').available,5);assert.equal(w.quotas.find(q=>q.capability==='video').available,2);}
  assert.equal(new Set(guests.map(g=>g.id)).size,50);assert.equal(sqlite().prepare('SELECT count(*) n FROM password_accounts').get().n,1);
  const same=await Promise.all(Array.from({length:6},()=>request('/api/event/session',{method:'POST',body:{code:issued.codes[0]}})));for(const response of same)assert.equal(expect(response).user.id,guests[0].id);
  assert.equal(textCount(await quota(guests[0])).total,10);
  expect(await request('/api/platform/event-codes',guests[0]),403);
  expect(await request('/api/platform/ai-settings',{...guests[0],method:'PUT',body:{}}),403);
 });
 await check('workspace save is private and restored by reentering the same code',async()=>{
  const entries=expect(await request('/api/workspace',guests[0]));entries.entries['zidingxiang-workspace-v1']=JSON.stringify({products:[{id:'fixture-product',name:'仅第一张卡的小米'}],campaigns:[],drafts:[],plans:[],conversations:[]});
  expect(await request('/api/workspace',{...guests[0],method:'PUT',headers:{'x-zdx-workspace-owner':guests[0].id},body:{revision:entries.revision,entries:entries.entries}}));
  assert.equal(expect(await request('/api/workspace',guests[1])).entries['zidingxiang-workspace-v1'],null);
  const restored=await request('/api/event/session',{method:'POST',body:{code:issued.codes[0]}});assert.equal(expect(restored).user.id,guests[0].id);assert(expect(await request('/api/workspace',restored)).entries['zidingxiang-workspace-v1'].includes('仅第一张卡'));
 });
 await check('missing real model configuration is reported honestly without spending guest rights',async()=>{
  assert.equal(expect(await request('/api/dialogue',guests[2])).connected,false);
  const workspace=expect(await request('/api/workspace',guests[2]));
  expect(await request('/api/dialogue',{...guests[2],method:'POST',headers:{'x-zdx-workspace-owner':guests[2].id},body:{message:'给测试小米写品牌故事',taskId:'brand',requestId:randomUUID(),revision:workspace.revision,consent:true}}),503);
  expect(await request('/api/media/jobs',{...guests[2],method:'POST',body:{capability:'image',modelId:null,prompt:'隔离测试农产品宣传图',ratio:'1:1',consent:true,idempotencyKey:randomUUID()}}),503);
  expect(await request('/api/media/jobs',{...guests[2],method:'POST',body:{capability:'video',modelId:null,prompt:'隔离测试农产品15秒宣传片',ratio:'16:9',duration:15,consent:true,idempotencyKey:randomUUID()}}),503);
  const w=await quota(guests[2]);assert.equal(textCount(w).available,10);assert.equal(w.quotas.find(q=>q.capability==='image').available,5);assert.equal(w.quotas.find(q=>q.capability==='video').available,2);assert.equal(stats().length,0);
 });
 await check('saved fake provider configuration never exposes a secret to guests',async()=>{
  const common={apiKey:'isolated-fake-provider-key',enabled:true,clearKey:false,revision:0};
  expect(await request('/api/platform/ai-settings',{...admin,method:'PUT',body:{...common,kind:'openai-compatible',endpoint:'https://api.apimart.ai/v1/chat/completions',model:'deepseek-v4.1-flash',jsonMode:true}}));
  expect(await request('/api/platform/media-settings',{...admin,method:'PUT',body:{...common,kind:'apimart',capability:'image',endpoint:'https://api.apimart.ai/v1/images/generations',model:'gpt-image-2.5-flare'}}));
  expect(await request('/api/platform/media-settings',{...admin,method:'PUT',body:{...common,kind:'apimart',capability:'video',endpoint:'https://api.apimart.ai/v1/videos/generations',model:'seedance-2.0-mini'}}));
  const listing=expect(await request('/api/media/jobs',guests[0]));assert(!JSON.stringify(listing).includes(common.apiKey));
 });
 await check('real HTTP text succeeds, charges once, replays once and definite failure releases',async()=>{
  const workspace=expect(await request('/api/workspace',guests[0])),body={message:'给山西小米写品牌故事',taskId:'brand',requestId:randomUUID(),revision:workspace.revision,consent:true};
  const options={...guests[0],method:'POST',headers:{'x-zdx-workspace-owner':guests[0].id},body};
  const result=expect(await request('/api/dialogue',options));assert(result.answer.includes('隔离模拟'));expect(await request('/api/dialogue',options));assert.equal(stats().filter(row=>row.kind==='text').length,1);assert.equal(textCount(await quota(guests[0])).available,9);
  fs.writeFileSync(control,JSON.stringify({text:'fail'}));expect(await request('/api/dialogue',{...options,body:{...body,requestId:randomUUID()}}),502);assert.equal(textCount(await quota(guests[0])).available,9);assert.equal(textCount(await quota(guests[0])).reserved,0);fs.writeFileSync(control,JSON.stringify({text:'ok'}));
 });
 await check('brand knowledge persists per guest and only relevant enabled materials reach the model',async()=>{
  const a=guests[3],b=guests[4];
  const save=async(guest,knowledge)=>{
   const current=expect(await request('/api/workspace',guest));
   const entries={...current.entries,'zidingxiang-workspace-v1':JSON.stringify({products:[],campaigns:[],drafts:[],plans:[],knowledge})};
   return expect(await request('/api/workspace',{...guest,method:'PUT',headers:{'x-zdx-workspace-owner':guest.id},body:{revision:current.revision,entries}}));
  };
  const aWorkspace=await save(a,[
   {id:'a-pear',title:'青禾梨园玉露香梨资料',brand:'青禾梨园',productName:'玉露香梨',kind:'产品资料',content:'青禾梨园玉露香梨采用六枚礼盒。A_OWNER_PEAR_FACT_ONLY',verified:true,autoReference:true},
   {id:'a-apple',title:'青禾梨园苹果介绍',brand:'青禾梨园',productName:'红富士苹果',kind:'产品资料',content:'青禾梨园苹果采用四枚纸盒。UNRELATED_APPLE_FACT',verified:true},
   {id:'a-other-brand',title:'红谷果业产品资料',brand:'红谷果业',content:'OTHER_BRAND_FACT_ONLY',verified:true},
   {id:'a-disabled',title:'青禾梨园玉露香梨旧介绍',brand:'青禾梨园',content:'DISABLED_KNOWLEDGE_SECRET',autoReference:false},
   {id:'a-archived',title:'青禾梨园玉露香梨历史介绍',brand:'青禾梨园',content:'ARCHIVED_KNOWLEDGE_SECRET',archived:true},
   {id:'a-unverified',title:'青禾梨园品牌故事草稿',brand:'青禾梨园',content:'青禾梨园品牌故事尚待确认。A_UNVERIFIED_DRAFT',verified:false}
  ]);
  const bWorkspace=await save(b,[{id:'b-pear',title:'青禾梨园玉露香梨私有资料',brand:'青禾梨园',content:'B_OWNER_PEAR_FACT_ONLY',verified:true}]);
  const restored=expect(await request('/api/workspace',a));assert.equal(restored.entries['zidingxiang-workspace-v1'],aWorkspace.entries['zidingxiang-workspace-v1']);
  assert(!restored.entries['zidingxiang-workspace-v1'].includes('B_OWNER_PEAR_FACT_ONLY'));checks+=2;
  const ask=async(guest,revision,message,taskId='moments',extras={})=>request('/api/dialogue',{...guest,method:'POST',headers:{'x-zdx-workspace-owner':guest.id},body:{message,taskId,revision,requestId:randomUUID(),consent:true,...extras}});
  const latestPayload=()=>JSON.parse(fs.readFileSync(textPayloadsFile,'utf8').trim().split('\n').at(-1));
  const result=expect(await ask(a,aWorkspace.revision,'为青禾梨园玉露香梨写朋友圈文案'));
  assert.equal(result.knowledge.status,'referenced');assert(result.knowledge.sources.some(s=>s.id==='a-pear'));
  let payload=JSON.stringify(latestPayload());assert(payload.includes('A_OWNER_PEAR_FACT_ONLY'));
  for(const hidden of ['B_OWNER_PEAR_FACT_ONLY','UNRELATED_APPLE_FACT','OTHER_BRAND_FACT_ONLY','DISABLED_KNOWLEDGE_SECRET','ARCHIVED_KNOWLEDGE_SECRET'])assert(!payload.includes(hidden),hidden+' leaked into model context');
  const unverified=result.knowledge.sources.find(s=>s.id==='a-unverified');if(unverified)assert.equal(unverified.verified,false);checks+=7;
  const noReference=expect(await ask(a,aWorkspace.revision,'为青禾梨园玉露香梨写朋友圈文案，这次不要参考知识库。'));
  assert.equal(noReference.knowledge.status,'skipped');assert.equal(noReference.knowledge.sources.length,0);assert(!JSON.stringify(latestPayload()).includes('A_OWNER_PEAR_FACT_ONLY'));checks+=3;
  const translation=expect(await ask(a,aWorkspace.revision,'翻译这句话：青禾梨园欢迎你。','translate'));
  assert.equal(translation.knowledge.sources.length,0);assert(!JSON.stringify(latestPayload()).includes('A_OWNER_PEAR_FACT_ONLY'));checks+=2;
  const bResult=expect(await ask(b,bWorkspace.revision,'为青禾梨园玉露香梨写朋友圈文案'));
  assert.deepEqual(bResult.knowledge.sources.map(s=>s.id),['b-pear']);payload=JSON.stringify(latestPayload());assert(payload.includes('B_OWNER_PEAR_FACT_ONLY'));assert(!payload.includes('A_OWNER_PEAR_FACT_ONLY'));checks+=3;
  const before=stats().filter(row=>row.kind==='text').length;
  expect(await ask(a,aWorkspace.revision-1,'为青禾梨园玉露香梨写朋友圈文案'),409);
  expect(await request('/api/dialogue',{...b,method:'POST',headers:{'x-zdx-workspace-owner':a.id},body:{message:'写文案',taskId:'moments',revision:aWorkspace.revision,requestId:randomUUID(),consent:true}}),403);
  expect(await request('/api/workspace',{...b,headers:{'x-zdx-workspace-owner':a.id}}),403);
  assert.equal(stats().filter(row=>row.kind==='text').length,before);checks++;
 });
 let image;
 await check('instrumented server saves a submitted image without any browser polling and debits once',async()=>{
  const body={capability:'image',modelId:null,prompt:'隔离验收：山西小米农产品宣传图',ratio:'1:1',consent:true,idempotencyKey:randomUUID()};
  image=expect(await request('/api/media/jobs',{...guests[0],method:'POST',body}),201).job;
  for(let i=0;i<200;i++){if(sqlite().prepare('SELECT status FROM media_jobs WHERE id=?').get(image.id).status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(sqlite().prepare('SELECT status FROM media_jobs WHERE id=?').get(image.id).status,'succeeded','Node instrumentation must start its worker in the production build');
  expect(await request('/api/media/jobs',{...guests[0],method:'POST',body}));assert.equal(stats().filter(row=>row.kind==='image-submit').length,1);
  const w=await quota(guests[0]);assert.equal(w.quotas.find(q=>q.capability==='image').used,1);assert.equal(w.quotas.find(q=>q.capability==='image').reserved,0);
  const own=await fetch(origin+'/api/media/assets/'+image.id+'?index=0',{headers:{cookie:guests[0].cookie}});assert.equal(own.status,200);assert.deepEqual(Buffer.from(await own.arrayBuffer()),Buffer.from(png,'base64'));checks++;
  expect(await request('/api/media/assets/'+image.id+'?index=0',guests[1]),404);
 });
 let editedImage;
 await check('image editing uploads privately, persists in the background and spends one image credit idempotently',async()=>{
  const guest=guests[5],other=guests[6],before=await quota(guest),uploads=stats().filter(row=>row.kind==='reference-upload').length,submits=stats().filter(row=>row.kind==='image-submit').length,edits=stats().filter(row=>row.kind==='image-edit-submit').length;
  const body={capability:'image',modelId:null,prompt:'隔离图生图验收：保留产品主体，优化米白背景和光线。',ratio:'1:1',consent:true,referenceImage,idempotencyKey:randomUUID()};
  editedImage=expect(await request('/api/media/jobs',{...guest,method:'POST',body}),201).job;
  for(let i=0;i<200;i++){if(sqlite().prepare('SELECT status FROM media_jobs WHERE id=?').get(editedImage.id).status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(sqlite().prepare('SELECT status FROM media_jobs WHERE id=?').get(editedImage.id).status,'succeeded','Image editing must finish without browser polling');
  const replay=expect(await request('/api/media/jobs',{...guest,method:'POST',body})).job;assert.equal(replay.id,editedImage.id);assert.equal(stats().filter(row=>row.kind==='reference-upload').length,uploads+1);assert.equal(stats().filter(row=>row.kind==='image-submit').length,submits+1);assert.equal(stats().filter(row=>row.kind==='image-edit-submit').length,edits+1);
  const delivered=expect(await request('/api/media/jobs?id='+editedImage.id,guest)).job;assert.equal(delivered.status,'succeeded');assert.equal(delivered.outputs[0].persisted,true);for(const hidden of [referenceImage,referenceUrl,'isolated-fake-provider-key'])assert(!JSON.stringify(delivered).includes(hidden));
  const after=await quota(guest),beforeImage=before.quotas.find(q=>q.capability==='image'),afterImage=after.quotas.find(q=>q.capability==='image');assert.equal(afterImage.used,beforeImage.used+1);assert.equal(afterImage.available,beforeImage.available-1);assert.equal(afterImage.reserved,0);assert.deepEqual(after.quotas.filter(q=>q.capability!=='image'),before.quotas.filter(q=>q.capability!=='image'));
  const own=await fetch(origin+'/api/media/assets/'+editedImage.id+'?index=0',{headers:{cookie:guest.cookie}});assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await own.arrayBuffer()),Buffer.from(png,'base64'));
  expect(await request('/api/media/assets/'+editedImage.id+'?index=0',other),404);expect(await request('/api/media/jobs?id='+editedImage.id,other),404);
  expect(await request('/api/media/jobs',{...guest,method:'POST',body:{...body,prompt:'同一任务改为另一种包装'}}),409);assert.equal(stats().filter(row=>row.kind==='reference-upload').length,uploads+1);checks+=17;
 });
 let video;
 await check('15-second video completes in the background, remains private and charges video once only',async()=>{
  const before=await quota(guests[0]),priorSubmits=stats().filter(row=>row.kind==='video-submit').length;
  const body={capability:'video',modelId:null,prompt:'隔离验收：玉露香梨品牌15秒广告片',duration:15,ratio:'16:9',consent:true,idempotencyKey:randomUUID()};
  expect(await request('/api/media/jobs',{...guests[0],method:'POST',body:{...body,duration:10}}),400);
  assert.equal(stats().filter(row=>row.kind==='video-submit').length,priorSubmits,'Invalid duration must never reach the paid provider');
  video=expect(await request('/api/media/jobs',{...guests[0],method:'POST',body}),201).job;
  for(let i=0;i<200;i++){if(sqlite().prepare('SELECT status FROM media_jobs WHERE id=?').get(video.id).status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(sqlite().prepare('SELECT status FROM media_jobs WHERE id=?').get(video.id).status,'succeeded','Video must finish without browser status polling');
  const delivered=expect(await request('/api/media/jobs?id='+video.id,guests[0])).job;assert.equal(delivered.status,'succeeded');assert.equal(delivered.outputs[0].persisted,true);
  expect(await request('/api/media/jobs',{...guests[0],method:'POST',body}));expect(await request('/api/media/jobs?id='+video.id,guests[0]));
  assert.equal(stats().filter(row=>row.kind==='video-submit').length,priorSubmits+1);
  const after=await quota(guests[0]),remaining=after.quotas.find(q=>q.capability==='video');assert.equal(remaining.total,2);assert.equal(remaining.used,1);assert.equal(remaining.available,1);assert.equal(remaining.reserved,0);
  assert.deepEqual(after.quotas.filter(q=>q.capability!=='video'),before.quotas.filter(q=>q.capability!=='video'));
  assert.equal(sqlite().prepare('SELECT count(*) n FROM event_credit_ledger e JOIN event_credit_usage u ON u.id=e.usage_id WHERE u.request_key=?').get(video.id).n,1);
  const own=await fetch(origin+'/api/media/assets/'+video.id+'?index=0',{headers:{cookie:guests[0].cookie}});assert.equal(own.status,200);assert.equal(own.headers.get('content-type'),'video/mp4');assert.equal(own.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await own.arrayBuffer()),mp4);checks++;
  expect(await request('/api/media/assets/'+video.id+'?index=0',guests[1]),404);
 });
 await check('restart preserves the guest session, workspace, generated image/video and quota',async()=>{
  const before=await quota(guests[0]);await stop();await start();assert.equal(expect(await request('/api/me',guests[0])).user.id,guests[0].id);assert.deepEqual(await quota(guests[0]),before);assert(expect(await request('/api/workspace',guests[0])).entries['zidingxiang-workspace-v1'].includes('仅第一张卡'));
  for(const [job,guest] of [[image,guests[0]],[video,guests[0]],[editedImage,guests[5]]]){const output=await fetch(origin+'/api/media/assets/'+job.id+'?index=0',{headers:{cookie:guest.cookie}});assert.equal(output.status,200);checks++;}
 });
 await check('logout clears the session and the code restores existing work without new rights',async()=>{
  const exited=await request('/api/event/session',{...guests[0],method:'DELETE'});expect(exited);expect(await request('/api/me',exited),401);
  const restored=await request('/api/event/session',{method:'POST',body:{code:issued.codes[0]}});assert.equal(expect(restored).user.id,guests[0].id);assert.equal(textCount(await quota(restored)).total,10);assert.equal(textCount(await quota(restored)).available,9);
 });
 await check('administrator explicitly switches to a card guest and the old administrator cookie loses access',async()=>{
  expect(await request('/api/event/session',{...admin,method:'POST',body:{code:issued.codes[49]}}),409);
  expect(await request('/api/event/session',{...admin,method:'POST',body:{code:issued.codes[49],switchFromAdmin:'yes'}}),400);
  expect(await request('/api/event/session',{...admin,method:'POST',body:{code:'ZDXE-invalid',switchFromAdmin:true}}),400);
  assert.equal(expect(await request('/api/me',admin)).platformAdmin,true);
  const switched=await request('/api/event/session',{...admin,method:'POST',body:{code:issued.codes[49],switchFromAdmin:true}});
  assert.equal(expect(switched).user.id,guests[49].id);assert.equal(switched.data.platformAdmin,false);
  expect(await request('/api/me',admin),401);expect(await request('/api/platform/event-codes',switched),403);
 });
 assert.equal(sqlite().prepare('PRAGMA foreign_key_check').all().length,0);
 const browserQuota=await quota(guests[49]);assert.equal(browserQuota.quotas.find(q=>q.capability==='image').available,5);assert.equal(browserQuota.quotas.find(q=>q.capability==='text').available,10);assert.equal(browserQuota.quotas.find(q=>q.capability==='video').available,2);
 fs.writeFileSync(path.join(folder,'browser-fixture.json'),JSON.stringify({origin,activationCode:browserCode,referenceFile:path.join(folder,'reference-fixture.png'),scope:'Disposable local fixture only; all external requests blocked or mocked',imageCredits:5},null,2),{mode:0o600});
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify({scope:'Production Next standalone + real HTTP, 50 code-only guest sessions, controlled fake image-edit/image/text/15-second video provider, separate 5/10/2 quotas, private uploads and outputs, background completion without browser, restart persistence; zero real model calls or production changes',passed:true,checks,results},null,2));
 console.log('PASS',checks,'HTTP assertions; evidence:',path.join(folder,'results.json'));
 if(process.argv.includes('--serve')||process.argv.includes('--keep-open')){console.log('Disposable browser acceptance is running:',origin,'(known fixture code documented in test source; no production card)');console.log('Browser fixture:',path.join(folder,'browser-fixture.json'));await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});}
}finally{await stop();sqlite().close();}

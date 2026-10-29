// Isolated real ledger + mock APIMart; never loads .env or sends paid requests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
Object.assign(process.env,{ZDX_DATA_DIR:path.resolve('.ecs-test',`event-text-${Date.now()}`),AI_CONFIG_ENCRYPTION_KEY:randomBytes(32).toString('hex'),EVENT_ACTIVATION_ENABLED:'1',ZLG_GATEWAY_REQUIRED:'0'});
for(const key of ['OPENAI_API_KEY','ARK_API_KEY','DEEPSEEK_API_KEY','DASHSCOPE_API_KEY','AI_GENERATION_PAUSED_REASON','OPENAI_GENERATION_PAUSED_REASON'])delete process.env[key];
await import('./migrate-ecs.mjs');
const {sqlite}=await import('../runtime/node-env.mjs'),database=sqlite(),dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
globalThis.eventTextIdentity=new AsyncLocalStorage();
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=who=>who.userId==='admin';");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>{const id=globalThis.eventTextIdentity.getStore();return id?{userId:id,provider:'password',displayName:id}:null};");
for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','zlg-gateway','request-body','tenancy','ai-config','media-config','user-models','credits','shanxi-knowledge','ding-persona','agriculture-policy','ai']){
 let source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace("import catalog from '../credit-plans.json';",'const catalog='+fs.readFileSync('credit-plans.json','utf8')+';').replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");
 fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const get=name=>import(pathToFileURL(path.join(dir,name+'.mjs')).href),ai=await get('ai'),credits=await get('event-credits'),config=await get('ai-config');
const users=['admin','empty',...Array.from({length:30},(_,i)=>'guest-'+i)];
for(const id of users){database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,new Date().toISOString());database.prepare("INSERT INTO auth_identities VALUES (?,?,'password',?,?)").run(id,id,id,new Date().toISOString());}
await config.saveConfig({revision:0,kind:'openai-compatible',endpoint:'https://api.apimart.ai/v1/chat/completions',model:'deepseek-v4.1-flash',apiKey:'isolated-fake-key',enabled:true,jsonMode:true,clearKey:false},'admin');
let calls=0,active=0,peak=0,mode='ok',releaseInitialWave;
// Hold the initial thirty mock requests until all have arrived. A 10 ms timer
// made the concurrency assertion depend on unrelated build/CI machine load.
const initialWave=new Promise(resolve=>{releaseInitialWave=resolve;});
globalThis.fetch=async(url,init)=>{
 assert.equal(url,'https://api.apimart.ai/v1/chat/completions');assert.equal(init.redirect,'manual');const payload=JSON.parse(init.body);assert.equal(payload.model,'deepseek-v4.1-flash');assert.equal(payload.stream,false);calls++;active++;peak=Math.max(peak,active);
 try{if(calls<=30){if(calls===30)releaseInitialWave();await initialWave;}else await new Promise(resolve=>setTimeout(resolve,10));if(mode==='network')throw Error('mock transport');if(mode==='denied')return Response.json({error:{code:'payment_required'}},{status:402});return Response.json({choices:[{message:{content:mode==='invalid'?'{}':'{"answer":"模拟山西小米品牌故事","title":"品牌故事"}'}}]});}finally{active--;}
};
const as=(id,work)=>globalThis.eventTextIdentity.run(id,work),ask=(id,key=randomUUID(),body={})=>as(id,()=>ai.askModel('写农品文案',{product:'山西小米'},200,{requestId:key,...body},{units:3,validate:out=>typeof out.answer==='string'}));
const balance=async id=>(await credits.eventCreditSummary(id)).quotas.find(q=>q.capability==='text');
const results=[];async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
await check('legacy points and missing card cannot pay for event calls',async()=>{
 database.prepare("INSERT INTO text_credit_ledger VALUES ('legacy','empty',99,'welcome',NULL,NULL,'legacy fixture',?)").run(new Date().toISOString());
 await assert.rejects(ask('empty'),e=>e.status===402);assert.equal(calls,0);assert.equal((await balance('empty')).total,0);
});
const batch=await credits.issueEventCodes('admin',{requestId:randomUUID(),count:50});
await Promise.all(Array.from({length:30},(_,i)=>credits.redeemEventCode('guest-'+i,batch.codes[i])));
await check('30 simultaneous text creators each spend one text use, image quota unchanged',async()=>{
 await Promise.all(Array.from({length:30},(_,i)=>ask('guest-'+i)));
 assert.equal(calls,30);assert.equal(peak,30);
 for(let i=0;i<30;i++){const s=await credits.eventCreditSummary('guest-'+i);assert.equal(s.quotas.find(q=>q.capability==='text').available,9);assert.equal(s.quotas.find(q=>q.capability==='image').available,5);}
});
await check('concurrent duplicate request charges and POSTs once; completed response replays',async()=>{
 const key=randomUUID(),before=calls,attempts=await Promise.allSettled(Array.from({length:10},()=>ask('guest-0',key)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,before+1);const cached=await ask('guest-0',key);assert(cached.output.answer);assert.equal(calls,before+1);
 await assert.rejects(as('guest-0',()=>ai.askModel('不同输入',{},200,{requestId:key})),e=>e.status===409);
});
await check('definitive failure and invalid output release card usage',async()=>{
 for(const state of ['denied','invalid']){mode=state;const before=await balance('guest-1');await assert.rejects(ask('guest-1'));assert.deepEqual(await balance('guest-1'),before);}mode='ok';
});
await check('unknown transport outcome stays reserved and cannot be resubmitted',async()=>{
 mode='network';const key=randomUUID(),before=calls;await assert.rejects(ask('guest-2',key),e=>e instanceof config.ModelOutcomeUnknownError);assert.equal((await balance('guest-2')).reserved,1);assert.equal((await credits.eventCreditForRequest('guest-2','text:'+key)).status,'unknown');mode='ok';await assert.rejects(ask('guest-2',key),e=>e.status===409);assert.equal(calls,before+1);
});
await check('no profile escalation, expired quota, missing request id or wrong model',async()=>{
 const before=calls;await assert.rejects(ask('guest-3',randomUUID(),{profile:'premium'}),e=>e.status===403);
 await assert.rejects(as('guest-3',()=>ai.askModel('文案',{},200,{})),e=>e.status===400);
 database.prepare("UPDATE event_credit_lots SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id='guest-4'").run();await assert.rejects(ask('guest-4'),e=>e.status===402);
 database.prepare("UPDATE ai_settings SET model='unpriced-premium'").run();await assert.rejects(ask('guest-3'),e=>e.status===503);database.prepare("UPDATE ai_settings SET model='deepseek-v4.1-flash'").run();assert.equal(calls,before);
});
await check('old OpenAI pause does not pause APIMart; global pause still blocks',async()=>{
 process.env.OPENAI_GENERATION_PAUSED_REASON='old OpenAI only';await ask('guest-5');assert.equal((await as('guest-5',()=>ai.aiStatus())).mode,'model');process.env.AI_GENERATION_PAUSED_REASON='event maintenance';const before=calls;await assert.rejects(ask('guest-5'),e=>e.status===503);assert.equal(calls,before);delete process.env.AI_GENERATION_PAUSED_REASON;delete process.env.OPENAI_GENERATION_PAUSED_REASON;
});
await check('administrator test bypasses card but is an explicit upstream request',async()=>{const before=calls;await ask('admin');assert.equal(calls,before+1);assert.equal((await balance('admin')).total,0);});
await check('interrupted text request becomes reviewable without auto-refunding',async()=>{
 const hold=await credits.reserveEventCredit('guest-6',{capability:'text',profile:'standard',requestKey:'interrupted-text',requestHash:'fixture'});
 database.prepare("UPDATE event_credit_usage SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(hold.id);
 assert.equal((await balance('guest-6')).reserved,1);assert.equal((await credits.eventCreditForRequest('guest-6','interrupted-text')).status,'unknown');
 assert((await credits.eventActivationOverview()).usage.some(row=>row.id===hold.id));
 await credits.resolveUnknownEventCredit('admin',{holdId:hold.id,outcome:'refunded',reason:'isolated operator confirmed no delivery'});assert.equal((await balance('guest-6')).reserved,0);
});
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
fs.writeFileSync(path.join(process.env.ZDX_DATA_DIR,'results.json'),JSON.stringify({scope:'real isolated ledger and 30 mock APIMart requests; not live provider load testing',peakMockConcurrency:peak,passed:results.length,results},null,2));
database.close();console.log('PASS event text:',results.length,'groups; evidence:',path.join(process.env.ZDX_DATA_DIR,'results.json'));

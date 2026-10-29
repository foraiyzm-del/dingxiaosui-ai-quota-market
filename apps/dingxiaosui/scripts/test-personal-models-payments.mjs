import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import ts from 'typescript';
process.env.ZDX_DATA_DIR=path.resolve('.ecs-test','models-'+Date.now());
process.env.AI_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
await import('./migrate-ecs.mjs');
const {sqlite}=await import('../runtime/node-env.mjs');const database=sqlite();
for(const id of ['a','b']){database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES (?,?,'active',?)").run(id,id,new Date().toISOString());database.prepare("INSERT INTO auth_identities(id,user_id,provider,subject,verified_at) VALUES (?,?,'password',?,?)").run(id,id,id,new Date().toISOString());}
const dir=path.join(process.env.ZDX_DATA_DIR,'modules');fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=()=>false;");
fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>globalThis.testWho?{userId:globalThis.testWho,provider:'password',displayName:globalThis.testWho}:null;");
for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','zlg-gateway','request-body','tenancy','ai-config','media-config','user-models','credits','shanxi-knowledge','ding-persona','agriculture-policy','ai','payments']){
 let source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace("import catalog from '../credit-plans.json';",'const catalog='+fs.readFileSync('credit-plans.json','utf8')+';').replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");
 fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const m=await import(pathToFileURL(path.join(dir,'user-models.mjs')).href),ai=await import(pathToFileURL(path.join(dir,'ai.mjs')).href),p=await import(pathToFileURL(path.join(dir,'payments.mjs')).href);
const secret=randomBytes(20).toString('hex');const body={name:'QA model',kind:'openai-compatible',endpoint:'https://api.deepseek.com/chat/completions',model:'fixture-model',apiKey:secret,jsonMode:true};
const id=await m.saveModel('a',body);assert.equal((await m.listModels('b')).models.length,0);assert(!JSON.stringify(await m.listModels('a')).includes(secret));assert.notEqual(database.prepare('SELECT key_cipher FROM user_models WHERE id=?').get(id).key_cipher,secret);
for(const fn of [()=>m.ownedModel('b',id),()=>m.selectModel('b',id),()=>m.deleteModel('b',id),()=>m.saveModel('b',{...body,id,revision:1})])await assert.rejects(fn,e=>e.status===404);
await assert.rejects(()=>m.saveModel('a',{...body,endpoint:'https://127.0.0.1/chat/completions'}),e=>e.status===400);
await assert.rejects(()=>m.saveModel('a',{...body,id,revision:1,apiKey:'',endpoint:'https://api.openai.com/v1/chat/completions'}),e=>e.status===400);
await m.selectModel('a',id);globalThis.testWho='a';assert.equal((await ai.aiStatus()).access,'personal');
const input=await ai.readAiRequest(new Request('https://test.invalid/api/assist',{method:'POST',body:JSON.stringify({consent:true})}),1000);assert.equal(input.consent,true);
let observed;globalThis.fetch=async(url,init)=>{observed={url,init};return Response.json({choices:[{message:{content:'{"body":"fixture response"}'}}]})};
const result=await ai.askModel('test',{},60);assert.equal(result.output.body,'fixture response');assert.equal(JSON.parse(observed.init.body).model,'fixture-model');assert.equal(observed.init.headers.authorization,`Bearer ${secret}`);
globalThis.testWho='b';assert.notEqual((await ai.aiStatus()).access,'personal');
await m.saveModel('a',{...body,id,revision:1,apiKey:'',model:'changed'});await assert.rejects(()=>m.saveModel('a',{...body,id,revision:1}),e=>e.status===409);
await m.deleteModel('a',id);assert.equal((await m.listModels('a')).defaultModelId,null);
for(let i=0;i<20;i++)await m.reservePersonalCall('b');await assert.rejects(()=>m.reservePersonalCall('b'),e=>e.status===429);
assert.equal(p.paymentCapabilities().enabled,false);await assert.rejects(()=>p.createOrder('a',{channel:'wechat',productId:'x',idempotencyKey:'x'}),e=>e.status===503);
// Test adapter exists only in this isolated process, never production code.
p.paymentProducts.push({id:'fixture',title:'fixture',amountMinor:100,currency:'CNY'});p.paymentAdapters.fixture={createCheckout:async()=>({url:'https://payments.invalid/checkout'})};
const order=await p.createOrder('a',{channel:'fixture',productId:'fixture',idempotencyKey:'one'});assert.equal((await p.createOrder('a',{channel:'fixture',productId:'fixture',idempotencyKey:'one'})).orderId,order.orderId);assert.equal((await p.ownOrders('b')).length,0);
const event={eventId:'event1',orderId:order.orderId,transactionId:'tx1',amountMinor:100,currency:'CNY'};await assert.rejects(()=>p.recordPaid('fixture',{...event,amountMinor:1}),e=>e.status===400);await p.recordPaid('fixture',event);await p.recordPaid('fixture',event);assert.equal(database.prepare('SELECT count(*) n FROM payment_events').get().n,1);assert.equal((await p.ownOrders('a'))[0].status,'paid');
assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
console.log('PASS: encrypted secrets, owner isolation, SSRF deny, endpoint rekey, model selection and actual routing (mock upstream), revision conflicts, delete default, personal limits, disabled payments, server pricing, idempotency, order isolation, callback amount validation and replay, foreign keys. No real AI or payment called.');

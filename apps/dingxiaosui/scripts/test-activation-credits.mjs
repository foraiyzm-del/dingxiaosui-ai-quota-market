import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import ts from 'typescript';
const folder=path.resolve('.ecs-test','credits-'+Date.now());process.env.ZDX_DATA_DIR=folder;process.env.AI_CONFIG_ENCRYPTION_KEY=randomBytes(32).toString('hex');
await import('./migrate-ecs.mjs');const {sqlite}=await import('../runtime/node-env.mjs');const database=sqlite();let fetchCalls=0,mode='ok';
try{
 for(const id of ['admin','a','b','c']){database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES (?,?,'active',?)").run(id,id,new Date().toISOString());database.prepare("INSERT INTO auth_identities(id,user_id,provider,subject,verified_at) VALUES (?,?,'password',?,?)").run(id,id,id,new Date().toISOString());}
 const dir=path.join(folder,'modules');fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'identity.mjs'),"export const localAuthEnabled=()=>false;export const identityReady=()=>true;export const platformIdentity=()=>false;");
 fs.writeFileSync(path.join(dir,'chatgpt-auth.mjs'),"export const getChatGPTUser=async()=>globalThis.testWho?{userId:globalThis.testWho,provider:'password',displayName:globalThis.testWho}:null;");
 for(const name of ['quota-center','quota-generation','apimart-protocol','event-plans','event-credits','zlg-gateway','request-body','tenancy','ai-config','media-config','user-models','credits','shanxi-knowledge','ding-persona','agriculture-policy','ai']){let s=fs.readFileSync(`lib/${name}.ts`,'utf8').replace("import knowledge from '../shanxi-knowledge.json';",'const knowledge='+fs.readFileSync('shanxi-knowledge.json','utf8')+';').replace("import catalog from '../credit-plans.json';",'const catalog='+fs.readFileSync('credit-plans.json','utf8')+';').replace(/(['"])cloudflare:workers\1/g,JSON.stringify(pathToFileURL(path.resolve('runtime/node-env.mjs')).href)).replace(/(['"])@\/app\/chatgpt-auth\1/g,"'./chatgpt-auth.mjs'").replace(/(['"])\.\/([\w-]+)\1/g,"'./$2.mjs'");fs.writeFileSync(path.join(dir,name+'.mjs'),ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
 const c=await import(pathToFileURL(path.join(dir,'credits.mjs'))),ai=await import(pathToFileURL(path.join(dir,'ai.mjs'))),config=await import(pathToFileURL(path.join(dir,'ai-config.mjs')));
 const issue=(credits=3,count=1,extra={})=>c.issueCodes('admin',{label:'隔离测试',kind:'gift',credits,count,requestId:crypto.randomUUID(),...extra});
 await Promise.all(Array.from({length:12},()=>c.ensureWelcomeCredit('a')));assert.equal((await c.creditSummary('a')).available,5);assert.equal(database.prepare("SELECT COUNT(*) AS n FROM text_credit_ledger WHERE user_id='a' AND kind='welcome'").get().n,1);
 const first=await issue(8);await c.redeemCode('a',first.codes[0]);assert.equal((await c.creditBalance('a')).available,13);assert.equal((await c.redeemCode('a',first.codes[0].toLowerCase().replaceAll('-',' '))).credited,0);assert.equal((await c.creditBalance('a')).available,13);await assert.rejects(()=>c.redeemCode('b',first.codes[0]),e=>e.status===409);
 assert(!JSON.stringify(database.prepare('SELECT * FROM activation_codes').all()).includes(first.codes[0]));
 const paid=await issue(5,1,{kind:'paid',amountMinor:9900});await c.redeemCode('a',paid.codes[0]);assert.equal((await c.creditBalance('a')).available,18);
 const raced=await issue(6);const race=await Promise.allSettled(['b','c'].map(id=>c.redeemCode(id,raced.codes[0])));assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal((await c.creditBalance('b')).balance+(await c.creditBalance('c')).balance,16);
 const expired=await issue();database.prepare('UPDATE activation_batches SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',expired.batchId);await assert.rejects(()=>c.redeemCode('a',expired.codes[0]),e=>e.status===400);
 const revoked=await issue();await c.revokeCodes({batchId:revoked.batchId});await assert.rejects(()=>c.redeemCode('a',revoked.codes[0]),e=>e.status===400);assert.equal((await c.revokeCodes({batchId:first.batchId})).revoked,0);
 await assert.rejects(()=>issue(0),e=>e.status===400);await assert.rejects(()=>issue(2,101),e=>e.status===400);
 const once=crypto.randomUUID();const batch=await issue(2,1,{requestId:once});assert.equal((await issue(2,1,{requestId:once})).batchId,batch.batchId);
 await assert.rejects(()=>issue(3,1,{requestId:once}),e=>e.status===409);
 const issueRaceKey=crypto.randomUUID(),issueRace=await Promise.all([issue(2,1,{requestId:issueRaceKey}),issue(2,1,{requestId:issueRaceKey})]);assert.equal(issueRace[0].batchId,issueRace[1].batchId);assert.equal(issueRace.reduce((n,row)=>n+row.codes.length,0),1);
 const batchCount=database.prepare('SELECT COUNT(*) AS n FROM activation_batches').get().n;
 database.exec("CREATE TEMP TRIGGER reject_test_code BEFORE INSERT ON activation_codes BEGIN SELECT RAISE(ABORT,'controlled insert failure'); END");
 await assert.rejects(()=>issue(7));database.exec('DROP TRIGGER reject_test_code');assert.equal(database.prepare('SELECT COUNT(*) AS n FROM activation_batches').get().n,batchCount);
 const holds=await Promise.allSettled(Array.from({length:19},(_,i)=>c.reserveTextCredit('a','parallel-'+i,'same',1)));assert.equal(holds.filter(x=>x.status==='fulfilled').length,18);assert.equal((await c.creditBalance('a')).available,0);
 const successful=holds.filter(x=>x.status==='fulfilled').map(x=>x.value);const result={output:{answer:'已验证正文'},provider:'controlled',model:'controlled'};
 await c.completeTextCredit('a',successful[0].id,result);await c.completeTextCredit('a',successful[0].id,result);assert.equal((await c.creditBalance('a')).balance,17);
 await Promise.all(successful.slice(1).map(x=>c.releaseTextCredit('a',x.id)));assert.equal((await c.creditBalance('a')).available,17);
 const replay=await c.reserveTextCredit('a','parallel-0','same',1);assert.deepEqual(replay.cached,result);
 await assert.rejects(()=>c.reserveTextCredit('a','parallel-0','changed',1),e=>e.status===409);
 const stale=await c.reserveTextCredit('a','stale','same',1);database.prepare("UPDATE text_credit_usage SET expires_at='2020-01-01T00:00:00Z' WHERE id=?").run(stale.id);assert.equal((await c.creditBalance('a')).available,17);await assert.rejects(()=>c.completeTextCredit('a',stale.id,result),e=>e.status===409);
 const multiple=await c.reserveTextCredit('a','three-channels','three',3);assert.equal((await c.creditBalance('a')).available,14);await c.completeTextCredit('a',multiple.id,result);assert.equal((await c.creditBalance('a')).balance,14);
 const rollback=await c.reserveTextCredit('a','rollback','one',1);database.exec("CREATE TEMP TRIGGER reject_test_usage BEFORE INSERT ON text_credit_ledger WHEN NEW.kind='usage' BEGIN SELECT RAISE(ABORT,'controlled ledger failure'); END");
 await assert.rejects(()=>c.completeTextCredit('a',rollback.id,result));database.exec('DROP TRIGGER reject_test_usage');assert.equal(database.prepare('SELECT status FROM text_credit_usage WHERE id=?').get(rollback.id).status,'held');assert.equal((await c.creditBalance('a')).balance,14);await c.releaseTextCredit('a',rollback.id);
 for(let i=0;i<10;i++)await assert.rejects(()=>c.redeemCode('admin','invalid'),e=>e.status===400);await assert.rejects(()=>c.redeemCode('admin','invalid'),e=>e.status===429);
 globalThis.testWho='a';await config.saveConfig({revision:0,kind:'openai-compatible',endpoint:'https://api.deepseek.com/chat/completions',model:'controlled',apiKey:'controlled-test-secret',enabled:true,jsonMode:true,clearKey:false},'admin');
 globalThis.fetch=async(_url,init)=>{const sent=JSON.parse(init.body);assert(sent.messages[0].content.includes('更懂山西农产品')&&sent.messages[0].content.includes('更懂农业品牌'));assert(JSON.parse(sent.messages[1].content).agricultureContext.version);fetchCalls++;return mode==='fail'?Response.json({error:{code:'credit_balance_exhausted'}},{status:429}):Response.json({choices:[{message:{content:mode==='invalid'?'{}':'{"answer":"成功的受控文字"}'}}]});};
 const request={requestId:'integration-success'};const validate=output=>typeof output.answer==='string'&&!!output.answer.trim();
 const before=(await c.creditBalance('a')).available;
 await ai.askModel('返回 JSON',{},300,request,{validate});assert.equal((await c.creditBalance('a')).available,before-1);const called=fetchCalls;await ai.askModel('返回 JSON',{},300,request,{validate});assert.equal(fetchCalls,called);
 for(const state of ['invalid','fail']){mode=state;const balance=(await c.creditBalance('a')).available;await assert.rejects(()=>ai.askModel('返回 JSON',{},300,{requestId:'failure-'+state},{validate}));assert.equal((await c.creditBalance('a')).available,balance);}
 const adminGift=await c.reserveTextCredit('admin','consume-admin-trial','trial',5);await c.completeTextCredit('admin',adminGift.id,result);globalThis.testWho='admin';const noCreditCalls=fetchCalls;await assert.rejects(()=>ai.askModel('返回 JSON',{},300,{requestId:'no-credit'},{validate}),e=>e.status===402);assert.equal(fetchCalls,noCreditCalls);
 assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
 const ledger=database.prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM text_credit_ledger WHERE user_id=?').get('a');assert.equal(ledger.balance,(await c.creditBalance('a')).balance);
 const fixed=await c.issueCodes('admin',{planId:'daily-80',kind:'gift',credits:9999,amountMinor:1,count:1,requestId:crypto.randomUUID()});
 const fixedRow=database.prepare('SELECT kind,credits,amount_minor,plan_id FROM activation_batches WHERE id=?').get(fixed.batchId);assert.deepEqual({...fixedRow},{kind:'paid',credits:80,amount_minor:9900,plan_id:'daily-80'});
 await assert.rejects(()=>c.issueCodes('admin',{planId:'unknown',count:1,requestId:crypto.randomUUID()}),e=>e.status===400);
 const trial=await c.issueCodes('admin',{planId:'trial-5',count:1,requestId:crypto.randomUUID()}),event=await c.issueCodes('admin',{planId:'event-10',count:1,requestId:crypto.randomUUID()});
 const trialRace=await Promise.allSettled([c.redeemCode('b',trial.codes[0]),c.redeemCode('b',event.codes[0])]);assert.equal(trialRace.filter(r=>r.status==='fulfilled').length,1);assert.equal(trialRace.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
 // A legacy code recipient is never gifted a second automatic trial.
 database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES ('legacy','legacy','active',?)").run(new Date().toISOString());const legacy=await c.issueCodes('admin',{planId:'trial-5',count:1,requestId:crypto.randomUUID()});await c.redeemCode('legacy',legacy.codes[0]);assert.equal((await c.creditBalance('legacy')).balance,5);assert.equal(database.prepare("SELECT COUNT(*) AS n FROM text_credit_ledger WHERE user_id='legacy' AND kind='welcome'").get().n,0);
 const allowance=await c.promotionBudget();assert.equal(allowance.limit,500);await issue(allowance.remaining-1);
 const promotionRace=await Promise.allSettled([issue(1),issue(1)]);assert.equal(promotionRace.filter(r=>r.status==='fulfilled').length,1);assert.equal((await c.promotionBudget()).remaining,0);
 database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES ('late','late','active',?)").run(new Date().toISOString());const limited=await c.creditSummary('late');assert.equal(limited.balance,0);assert.equal(limited.welcome.status,'budget_limited');
 const budgetWinner=promotionRace.find(r=>r.status==='fulfilled').value;await c.revokeCodes({batchId:budgetWinner.batchId});assert.equal((await c.promotionBudget()).remaining,1);await issue(1);assert.equal((await c.promotionBudget()).remaining,0);
 await c.issueCodes('admin',{planId:'light-20',count:1,requestId:crypto.randomUUID()});
 assert.equal((await c.creditSummary('a')).ownerId,'a');
 console.log('PASS: activation issuance, paid/gift records, hashed codes, repeat redemption, concurrent redemption, expiry, revocation, duplicate issue request, concurrent credit reservation, replay, stale recovery, success-only deduction, invalid-output/upstream-failure release, no-credit block, ledger consistency and foreign keys. Controlled model only; no live API or payment.');
}finally{database.close();console.log('Isolated fixture preserved:',folder);}

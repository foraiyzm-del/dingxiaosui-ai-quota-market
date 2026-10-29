// Only an in-memory database and synthetic data; no env files, network or real codes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),database=new DatabaseSync(':memory:');
class Statement {
 constructor(sql,values=[]){this.sql=sql;this.values=values;}
 bind(...values){return new Statement(this.sql,values);}
 execute(){const stmt=database.prepare(this.sql);if(stmt.columns().length)return {results:stmt.all(...this.values),meta:{changes:0}};const result=stmt.run(...this.values);return {results:[],meta:{changes:Number(result.changes)}};}
 async run(){return this.execute();}
 async all(){return this.execute();}
 async first(){return database.prepare(this.sql).get(...this.values)||null;}
}
globalThis.eventCreditTestDb={prepare(sql){return new Statement(sql)},async batch(statements){database.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
const jsUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const tsUrl=source=>jsUrl(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const tenancyUrl=jsUrl("export class ApiError extends Error{constructor(status,message){super(message);this.status=status}};export const db=()=>globalThis.eventCreditTestDb;export function field(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,'invalid input');return value.trim()}");
const envUrl=jsUrl("export const env={EVENT_ACTIVATION_ENABLED:'1'}");
const protocolUrl=tsUrl(fs.readFileSync(path.join(root,'lib/apimart-protocol.ts'),'utf8'));
const plansUrl=tsUrl(fs.readFileSync(path.join(root,'lib/event-plans.ts'),'utf8').replace("'./apimart-protocol'",JSON.stringify(protocolUrl)));
const creditSource=fs.readFileSync(path.join(root,'lib/event-credits.ts'),'utf8').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)).replace("'./event-plans'",JSON.stringify(plansUrl));
try{
 database.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
  database.exec('BEGIN IMMEDIATE');try{database.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
 }
 for(const id of ['admin','a','b','c','d','empty','disabled'])database.prepare('INSERT INTO users VALUES (?,?,?,?)').run(id,id,id==='disabled'?'disabled':'active',new Date().toISOString());
 database.prepare("INSERT INTO text_credit_ledger(id,user_id,delta,kind,note,created_at) VALUES ('legacy-test','a',42,'welcome','untouched fixture',?)").run(new Date().toISOString());
 const legacy=database.prepare('SELECT * FROM text_credit_ledger').all();
 const c=await import(tsUrl(creditSource));
 assert.equal(c.eventActivationEnabled(),true);
 const issue=(count=1,extras={})=>c.issueEventCodes('admin',{requestId:crypto.randomUUID(),count,...extras});
 const empty=await c.eventCreditSummary('empty');assert.equal(empty.activated,false);assert(empty.quotas.every(q=>q.available===0));
 const requestId=crypto.randomUUID(),batch=await issue(4,{requestId});
 assert.equal(batch.codes.length,4);assert.equal(new Set(batch.codes).size,4);
 assert(batch.codes.every(code=>/^ZDXE-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(code)));
 assert(!JSON.stringify(database.prepare('SELECT * FROM event_activation_codes').all()).includes(batch.codes[0]));
 const replay=await issue(4,{requestId});assert.equal(replay.batchId,batch.batchId);assert.deepEqual(replay.codes,[]);
 await assert.rejects(()=>issue(3,{requestId}),e=>e.status===409);
 const concurrentId=crypto.randomUUID(),issuedRace=await Promise.all([issue(1,{requestId:concurrentId}),issue(1,{requestId:concurrentId})]);
 assert.equal(issuedRace[0].batchId,issuedRace[1].batchId);assert.equal(issuedRace.reduce((n,r)=>n+r.codes.length,0),1);
 const batchesBefore=database.prepare('SELECT count(*) n FROM event_activation_batches').get().n;
 database.exec("CREATE TEMP TRIGGER reject_event_code BEFORE INSERT ON event_activation_codes BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 await assert.rejects(()=>issue());database.exec('DROP TRIGGER reject_event_code');assert.equal(database.prepare('SELECT count(*) n FROM event_activation_batches').get().n,batchesBefore);
 const redeemed=await Promise.all([c.redeemEventCode('a',batch.codes[0]),c.redeemEventCode('a',batch.codes[0].toLowerCase().replaceAll('-',' '))]);
 assert.equal(redeemed.filter(r=>!r.alreadyRedeemed).length,1);assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='image').available,5);
 assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='text').available,10);
 const dates=database.prepare("SELECT redeemed_at,expires_at FROM event_activation_codes WHERE redeemed_by='a'").get();assert.equal(Date.parse(dates.expires_at)-Date.parse(dates.redeemed_at),7*86400000);
 await assert.rejects(()=>c.redeemEventCode('b',batch.codes[0]),e=>e.status===409);
 const redeemers=await Promise.allSettled(['b','c'].map(id=>c.redeemEventCode(id,batch.codes[1])));assert.equal(redeemers.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await c.revokeEventCodes({batchId:batch.batchId,reason:'隔离测试作废未兑换卡'},'admin')).revoked,2);
 assert.equal((await c.revokeEventCodes({batchId:batch.batchId},'admin')).revoked,0);
 assert.equal(database.prepare("SELECT count(*) n FROM event_admin_audit WHERE action='revoke_codes'").get().n,1);
 await assert.rejects(()=>c.redeemEventCode('d',batch.codes[2]),e=>e.status===400);
 const expired=await issue();await c.selectEventBatch('admin',expired.batchId,'Select expiry boundary fixture');database.prepare("UPDATE event_activation_batches SET redeem_before='2000-01-01T00:00:00.000Z' WHERE id=?").run(expired.batchId);
 await assert.rejects(()=>c.redeemEventCode('d',expired.codes[0]),e=>e.status===400);
 const disabled=await issue();await c.selectEventBatch('admin',disabled.batchId,'Select disabled account fixture');await assert.rejects(()=>c.redeemEventCode('disabled',disabled.codes[0]),e=>e.status===409);
 assert.equal(database.prepare("SELECT status FROM event_activation_codes WHERE batch_id=?").get(disabled.batchId).status,'active');
 await c.selectEventBatch('admin',batch.batchId,'Return to original reservation fixture');

 const reserve=(capability,i,who='a')=>c.reserveEventCredit(who,{capability,profile:'standard',requestKey:capability+'-'+i,requestHash:'hash-'+i});
 const originalImageText=(await c.eventCreditSummary('a')).quotas.filter(q=>q.capability!=='video');
 const videos=await Promise.allSettled(Array.from({length:3},(_,i)=>reserve('video',i)));
 const videoHolds=videos.filter(r=>r.status==='fulfilled').map(r=>r.value);assert.equal(videoHolds.length,2);assert.equal(videos.filter(r=>r.status==='rejected')[0].reason.status,402);
 await c.completeEventCredit('a',videoHolds[0].id,{url:'/fixture/video.mp4'});await c.completeEventCredit('a',videoHolds[0].id,{url:'/fixture/ignored.mp4'});
 await c.releaseEventCredit('a',videoHolds[1].id);assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='video').available,1);
 const retryVideo=await reserve('video','after-failure');await c.markEventCreditUnknown('a',retryVideo.id);assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='video').reserved,1);
 await c.completeEventCredit('a',retryVideo.id,{url:'/fixture/video2.mp4'});assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='video').used,2);
 await assert.rejects(()=>reserve('video','exhausted'),e=>e.status===402);
 assert.deepEqual((await c.eventCreditSummary('a')).quotas.filter(q=>q.capability!=='video'),originalImageText);
 const images=await Promise.allSettled(Array.from({length:6},(_,i)=>reserve('image',i)));
 const texts=await Promise.allSettled(Array.from({length:11},(_,i)=>reserve('text',i)));
 const imageHolds=images.filter(r=>r.status==='fulfilled').map(r=>r.value),textHolds=texts.filter(r=>r.status==='fulfilled').map(r=>r.value);
 assert.equal(imageHolds.length,5);assert.equal(textHolds.length,10);
 assert.equal(await c.hasEventActivation('a'),true);assert.equal(await c.hasActiveEventEntitlement('a','image'),true);assert.equal(await c.hasEventCredit('a','image'),false);
 await assert.rejects(()=>c.reserveEventCredit('a',{capability:'image',profile:'premium',requestKey:'premium',requestHash:'premium'}),e=>e.status===403);
 await assert.rejects(()=>reserve('image',0),e=>e.status===409);
 await assert.rejects(()=>c.completeEventCredit('d',imageHolds[0].id,{}),e=>e.status===409);
 assert.equal(await c.eventCreditForRequest('d','image-0'),null);
 const result={output:{url:'/fixture/image.png'}};
 await c.completeEventCredit('a',imageHolds[0].id,result);await c.completeEventCredit('a',imageHolds[0].id,{output:'must not overwrite'});
 assert.deepEqual((await reserve('image',0)).cached,result);
 assert.equal(database.prepare('SELECT count(*) n FROM event_credit_ledger WHERE usage_id=?').get(imageHolds[0].id).n,1);
 await assert.rejects(()=>c.reserveEventCredit('a',{capability:'image',profile:'standard',requestKey:'image-0',requestHash:'changed'}),e=>e.status===409);
 await c.releaseEventCredit('a',imageHolds[1].id);await c.releaseEventCredit('a',imageHolds[1].id);
 await assert.rejects(()=>c.completeEventCredit('a',imageHolds[1].id,{}),e=>e.status===409);
 await c.markEventCreditUnknown('a',imageHolds[2].id);
 database.prepare("UPDATE event_credit_usage SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(imageHolds[2].id);
 assert.equal((await c.eventCreditForRequest('a','image-2')).status,'unknown');
 assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='image').reserved,3);
 await c.completeEventCredit('a',imageHolds[2].id,result); // Late provider success settles the same hold.
 database.prepare("UPDATE event_credit_lots SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id='a' AND capability='image'").run();
 assert.equal(await c.hasActiveEventEntitlement('a','image'),false);assert.equal(await c.hasEventCredit('a','image'),false);
 await assert.rejects(()=>reserve('image','expired'),e=>e.status===402);
 await c.completeEventCredit('a',imageHolds[3].id,result); // A pre-existing hold survives card expiry.
 await c.markEventCreditUnknown('a',imageHolds[4].id);await c.releaseEventCredit('a',imageHolds[4].id);
 const imageSummary=(await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='image');assert.equal(imageSummary.available,0);assert.equal(imageSummary.used,3);assert.equal(imageSummary.reserved,0);
 assert.equal(await c.hasActiveEventEntitlement('a','text'),true);
 // A ledger write failure must not leave a task marked successful without a debit.
 database.exec("CREATE TEMP TRIGGER reject_event_debit BEFORE INSERT ON event_credit_ledger WHEN NEW.kind='usage' BEGIN SELECT RAISE(ABORT,'fixture debit failure'); END");
 await assert.rejects(()=>c.completeEventCredit('a',textHolds[0].id,{answer:'test'}));database.exec('DROP TRIGGER reject_event_debit');
 assert.equal((await c.eventCreditForRequest('a','text-0')).status,'held');
 await c.completeEventCredit('a',textHolds[0].id,{answer:'test'});
 await Promise.all(textHolds.slice(1).map(hold=>c.releaseEventCredit('a',hold.id)));
 assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='text').available,9);
 const manualPending=await reserve('text','manual-pending');
 await assert.rejects(()=>c.resolveUnknownEventCredit('admin',{holdId:manualPending.id,outcome:'refunded',reason:'已核实服务商未执行'}),e=>e.status===409);
 assert.equal((await c.eventCreditForRequest('a','text-manual-pending')).status,'held');
 await c.markEventCreditUnknown('a',manualPending.id);
 const manualRefund=await c.resolveUnknownEventCredit('admin',{holdId:manualPending.id,outcome:'refunded',reason:'已核实服务商未执行'});assert.equal(manualRefund.status,'released');
 assert.equal((await c.resolveUnknownEventCredit('admin',{holdId:manualPending.id,outcome:'refunded',reason:'重复提交同一核查结论'})).alreadyResolved,true);
 await assert.rejects(()=>c.resolveUnknownEventCredit('admin',{holdId:manualPending.id,outcome:'succeeded',reason:'禁止反向结算同一任务'}),e=>e.status===409);
 const manualSuccess=await reserve('text','manual-success');await c.markEventCreditUnknown('a',manualSuccess.id);
 database.exec("CREATE TEMP TRIGGER reject_manual_debit BEFORE INSERT ON event_credit_ledger WHEN NEW.note='管理员核实成功交付' BEGIN SELECT RAISE(ABORT,'fixture manual failure'); END");
 await assert.rejects(()=>c.resolveUnknownEventCredit('admin',{holdId:manualSuccess.id,outcome:'succeeded',reason:'服务商结果已人工核实'}));database.exec('DROP TRIGGER reject_manual_debit');
 assert.equal((await c.eventCreditForRequest('a','text-manual-success')).status,'unknown');
 assert.equal(database.prepare('SELECT count(*) n FROM event_credit_resolutions WHERE usage_id=?').get(manualSuccess.id).n,0);
 const resolved=await Promise.all([1,2].map(()=>c.resolveUnknownEventCredit('admin',{holdId:manualSuccess.id,outcome:'succeeded',reason:'服务商结果已人工核实'})));
 assert.equal(resolved.filter(r=>!r.alreadyResolved).length,1);
 assert.equal(database.prepare('SELECT count(*) n FROM event_credit_ledger WHERE usage_id=?').get(manualSuccess.id).n,1);
 const overview=await c.eventActivationOverview(batch.batchId);assert.equal(overview.codes.length,4);assert(!JSON.stringify(overview).includes(batch.codes[0]));assert.equal(overview.resolutions.length,2);
 assert.equal((await c.eventCreditSummary('a')).quotas.find(q=>q.capability==='text').available,8);
 assert.deepEqual(database.prepare('SELECT * FROM text_credit_ledger').all(),legacy,'Event operations must never change legacy or welcome points');
 assert.equal(database.prepare('SELECT count(*) n FROM text_credit_usage').get().n,0);
 assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 const fifty=await issue(50);assert.equal(fifty.codes.length,50);assert.equal(new Set(fifty.codes).size,50);
 assert.equal(database.prepare("SELECT count(*) n FROM event_activation_codes WHERE batch_id=? AND status='active'").get(fifty.batchId).n,50);
 const oldSnapshot=JSON.parse(database.prepare('SELECT plan_snapshot FROM event_activation_batches WHERE id=?').get(fifty.batchId).plan_snapshot);oldSnapshot.id='zdx-launch-50-v1';oldSnapshot.grants=oldSnapshot.grants.filter(row=>row.unit!=='video');
 database.prepare('UPDATE event_activation_batches SET plan_id=?,plan_snapshot=? WHERE id=?').run(oldSnapshot.id,JSON.stringify(oldSnapshot),fifty.batchId);await c.selectEventBatch('admin',fifty.batchId,'Select legacy unredeemed card fixture');
 const oldRequest=database.prepare('SELECT request_key FROM event_activation_batches WHERE id=?').get(fifty.batchId).request_key;assert.deepEqual((await issue(50,{requestId:oldRequest})).codes,[]);
 const legacyCard=await c.redeemEventCode('empty',fifty.codes[0]);assert.deepEqual(legacyCard.credited,{image:5,text:10,video:2});assert.equal(legacyCard.quotas.find(row=>row.capability==='video').available,2);
 assert.equal((await c.redeemEventCode('empty',fifty.codes[0])).credited.video,0);
 console.log('PASS: isolated event issuance/redemption, 50 unique hashed codes, 5 images + 10 texts + 2 videos, video exhaustion/release/idempotency, seven days from redemption, concurrent reservations, separate quotas, success-only debit, cached replay, explicit release, unknown retention, late settlement, transaction rollback and legacy isolation. In-memory test only; no deliverable codes printed or saved.');
}finally{database.close();delete globalThis.eventCreditTestDb;}

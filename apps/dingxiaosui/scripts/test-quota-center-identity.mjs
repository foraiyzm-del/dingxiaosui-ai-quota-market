// Real migrations and identity/session functions, isolated SQLite and a stubbed
// center transport. Never uses an existing card, real credentials or paid API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),database=new DatabaseSync(':memory:');
const origin='https://ding.test',centerOrigin='https://center.test';
const env={APP_ENV:'production',APP_ORIGIN:origin,EVENT_ACTIVATION_ENABLED:'1',PASSWORD_AUTH_ENABLED:'1',QUOTA_CENTER_URL:centerOrigin,QUOTA_PLATFORM_KEY:'isolated-test-only-key',AI_CONFIG_ENCRYPTION_KEY:'e'.repeat(64),SHOP_PRODUCT_URL:centerOrigin+'/?service=dingxiaosui-creator'};
class Statement{
 constructor(sql,values=[]){this.sql=sql;this.values=values;}
 bind(...values){return new Statement(this.sql,values);}
 execute(){const statement=database.prepare(this.sql);if(statement.columns().length)return {results:statement.all(...this.values),meta:{changes:0}};const result=statement.run(...this.values);return {results:[],meta:{changes:Number(result.changes)}};}
 async first(){return database.prepare(this.sql).get(...this.values)||null;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
env.DB={prepare:sql=>new Statement(sql),async batch(statements){database.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
globalThis.__quotaIdentityTestEnv=env;
const jsUrl=value=>'data:text/javascript;base64,'+Buffer.from(value).toString('base64');
const tsUrl=value=>jsUrl(ts.transpileModule(value,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const envUrl=jsUrl('export const env=globalThis.__quotaIdentityTestEnv;');
const tenancyUrl=jsUrl(`export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}};export const db=()=>globalThis.__quotaIdentityTestEnv.DB;export function field(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,'invalid input');return value.trim();}export function strictOrigin(request){if(request.headers.get('origin')!==globalThis.__quotaIdentityTestEnv.APP_ORIGIN)throw new ApiError(403,'invalid origin');}`);
const gatewayUrl=jsUrl('export const centerRequired=()=>false;');
const source=name=>fs.readFileSync(path.join(root,'lib',name+'.ts'),'utf8');
const protocolUrl=tsUrl(source('apimart-protocol'));
const plansUrl=tsUrl(source('event-plans').replace("'./apimart-protocol'",JSON.stringify(protocolUrl)));
const creditsUrl=tsUrl(source('event-credits').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)).replace("'./event-plans'",JSON.stringify(plansUrl)));
const passwordUrl=tsUrl(source('password-auth').replace("'cloudflare:workers'",JSON.stringify(envUrl)));
const quotaUrl=tsUrl(source('quota-center').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)));
const sessionUrl=tsUrl(source('event-session').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)).replace("'./zlg-gateway'",JSON.stringify(gatewayUrl)).replace("'./password-auth'",JSON.stringify(passwordUrl)).replace("'./event-credits'",JSON.stringify(creditsUrl)).replace("'./quota-center'",JSON.stringify(quotaUrl)));
const sessions=await import(sessionUrl),quota=await import(quotaUrl),password=await import(passwordUrl);
const originalFetch=globalThis.fetch,records=new Map(),balances=new Map(),attempts=[],dropped=new Set();
const card=(n)=>'QTA-'+n.toString(16).toUpperCase().padStart(36,'0');
const bucket=n=>({granted:n,available:n,reserved:0,consumed:0});
const balance=userId=>({projectId:'dingxiaosui',userId,...bucket(5),shared:bucket(0),byCapability:{text:bucket(3),image:bucket(1),video:bucket(1)}});
globalThis.fetch=async(url,options)=>{
 const target=new URL(url);assert.equal(target.origin,centerOrigin);assert.equal(options.headers.Authorization,'Bearer '+env.QUOTA_PLATFORM_KEY);assert.equal(options.redirect,'error');
 if(target.pathname==='/api/v1/redeem'){
  const body=JSON.parse(options.body);assert.equal(body.idempotent,true);assert.equal(body.code,body.code.trim().toUpperCase());attempts.push(body);
  if(body.code===card(9))return Response.json({error:'invalid credential'},{status:401});
  if(body.code===card(8))return Response.json({error:'此卡已被其他用户兑换'},{status:409});
  const existing=records.get(body.code);
  if(existing&&existing.userId!==body.userId)return Response.json({error:'other owner'},{status:409});
  const receipt=existing||{codeId:'code-'+records.size,userId:body.userId};
  records.set(body.code,receipt);if(!balances.has(body.userId))balances.set(body.userId,balance(body.userId));
  if(body.code===card(2)&&!dropped.has(body.code)){dropped.add(body.code);throw new Error('simulated lost response after the center committed');}
  return Response.json({...receipt,quota:{text:3,image:1,video:1},units:5,balance:balances.get(body.userId)});
 }
 if(target.pathname==='/api/v1/balance')return Response.json(balances.get(target.searchParams.get('userId')));
 throw new Error('unexpected test request');
};
const request=(cookie='',site=origin)=>new Request(origin+'/api/event/session',{method:'POST',headers:{origin:site,'content-type':'application/json',...(cookie?{cookie}:{})}});
const login=async(code,cookie='',options={})=>{const response=await sessions.startEventSession(request(cookie),code,options);return {response,data:await response.json(),cookie:response.headers.getSetCookie().find(value=>value.startsWith('zdx_event_session=')).split(';')[0]};};
const checks=[];
try{
 database.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())database.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 const anonymous=await sessions.eventSessionStatus(new Headers());assert.equal(anonymous.quotaCenterEnabled,true);assert.equal(anonymous.shopProductUrl,env.SHOP_PRODUCT_URL);assert(!JSON.stringify(anonymous).includes(env.QUOTA_PLATFORM_KEY));
 await assert.rejects(()=>login('QTA-123'),error=>error.status===400);await assert.rejects(()=>sessions.startEventSession(request('','https://foreign.test'),card(1)),error=>error.status===403);
 env.SHOP_PRODUCT_URL='javascript:alert(1)';assert.equal(quota.quotaShopProductUrl(),'');env.SHOP_PRODUCT_URL=centerOrigin+'/?service=dingxiaosui-creator';
 checks.push('public purchase configuration excludes secrets, malformed cards and cross-site login rejected');
 const parallel=await Promise.allSettled(Array.from({length:12},()=>login(card(1))));const successful=parallel.filter(item=>item.status==='fulfilled');assert(successful.length>=1);for(const item of parallel.filter(item=>item.status==='rejected'))assert.equal(item.reason.status,409);
 const first=successful[0].value;assert.equal(first.data.creditSource,'quota_center');assert.equal(first.data.platformAdmin,false);assert.equal(attempts.filter(value=>value.code===card(1)).length,1);
 assert.equal(database.prepare('SELECT count(*) n FROM quota_center_accounts').get().n,1);assert.equal(database.prepare('SELECT count(*) n FROM users').get().n,1);assert.equal(database.prepare('SELECT count(*) n FROM event_activation_codes').get().n,0);
 assert(first.response.headers.getSetCookie()[0].includes('HttpOnly'));assert(first.response.headers.getSetCookie()[0].includes('Secure'));
 const summary=first.data.wallet;assert.equal(summary.quotas.find(value=>value.capability==='text').available,3);assert.equal(summary.quotas.find(value=>value.capability==='image').available,1);assert.equal(summary.quotas.find(value=>value.capability==='video').available,1);assert(summary.quotas.every(value=>value.expiresAt===null));
 checks.push('concurrent first activation issues one persistent owner and redeems once, with exact 3/1/1 quotas');
 const repeated=await login(' '+card(1).toLowerCase()+' ');assert.equal(repeated.data.user.id,first.data.user.id);assert.equal(attempts.filter(value=>value.code===card(1)).length,1);
 const user=await sessions.eventIdentity(new Headers({cookie:repeated.cookie}));assert.equal(user.provider,'quota_center');assert.equal(user.userId,first.data.user.id);assert.equal(user.platformAdmin,false);
 assert(!JSON.stringify(database.prepare('SELECT * FROM quota_center_accounts').all()).includes(card(1)));assert(!JSON.stringify(database.prepare('SELECT * FROM quota_center_sessions').all()).includes(repeated.cookie.split('=')[1]));
 checks.push('same code across sessions restores its owner without recharge; only card HMAC and token hashes stored');
 await assert.rejects(()=>login(card(2)),error=>error.status===503);assert.equal(database.prepare("SELECT count(*) n FROM quota_center_accounts WHERE status='pending'").get().n,1);
 const restored=await login(card(2));const calls=attempts.filter(value=>value.code===card(2));assert.equal(calls.length,2);assert.equal(calls[0].userId,calls[1].userId);assert.equal(records.size,2);assert.notEqual(restored.data.user.id,first.data.user.id);assert.equal(database.prepare("SELECT count(*) n FROM quota_center_accounts WHERE status='active'").get().n,2);
 checks.push('lost redeem response safely replays the same center owner, never creates a second grant');
 const centerUser=(await quota.quotaAccount(first.data.user.id)).centerUserId;const current=balances.get(centerUser);current.byCapability.text={granted:3,available:0,reserved:0,consumed:3};current.available=2;current.consumed=3;
 const depleted=await quota.quotaCreditSummary(first.data.user.id);assert.equal(depleted.quotas.find(value=>value.capability==='text').available,0);assert.equal(depleted.quotas.find(value=>value.capability==='image').available,1);
 current.shared=bucket(2);const shared=await quota.quotaCreditSummary(first.data.user.id);assert.equal(shared.shared.available,2);assert.equal(shared.quotas.find(value=>value.capability==='text').available,2);assert.equal(shared.quotas.find(value=>value.capability==='image').available,3);
 checks.push('depleted text cannot borrow image/video quotas; shared legacy balance is explicitly separate');
 await assert.rejects(()=>login(card(8)),error=>error.status===409);const beforeReview=attempts.length;await assert.rejects(()=>login(card(8)),error=>error.status===409);assert.equal(attempts.length,beforeReview);assert.equal(database.prepare("SELECT count(*) n FROM quota_center_accounts WHERE status='review'").get().n,1);
 await assert.rejects(()=>login(card(9)),error=>error.status===503);assert.equal(database.prepare("SELECT count(*) n FROM quota_center_sessions WHERE user_id IN (SELECT user_id FROM quota_center_accounts WHERE status<>'active')").get().n,0);
 checks.push('a different owner or invalid center credential cannot acquire a customer session');
 const stamp=new Date().toISOString();database.prepare("INSERT INTO users VALUES ('admin','Admin','active',?)").run(stamp);database.prepare('INSERT INTO password_accounts VALUES (?,?,?,?,?,?,?)').run('admin-account','admin-name','test-only','test-only','Admin',1,stamp);database.prepare("INSERT INTO auth_identities VALUES ('admin-identity','admin','password','admin-account',?)").run(stamp);
 const adminToken=password.randomToken(),otherToken=password.randomToken();for(const token of [adminToken,otherToken])database.prepare('INSERT INTO password_sessions VALUES (?,?,?)').run(await password.digest(token),'admin-account',Date.now()+3600000);
 const adminCookie='zdx_session='+adminToken;await assert.rejects(()=>login(card(3),adminCookie),error=>error.status===409);await assert.rejects(()=>login('QTA-123',adminCookie,{switchFromAdmin:true}),error=>error.status===400);assert(await password.passwordIdentity(new Headers({cookie:adminCookie})));
 const switched=await login(card(3),adminCookie,{switchFromAdmin:true});assert.equal(switched.data.platformAdmin,false);assert.equal(await password.passwordIdentity(new Headers({cookie:adminCookie})),null);assert(await password.passwordIdentity(new Headers({cookie:'zdx_session='+otherToken})));
 checks.push('administrator switch validates card first, drops only current admin session and never grants admin rights');
 await sessions.endEventSession(new Request(origin+'/api/event/session',{method:'DELETE',headers:{origin,cookie:repeated.cookie}}));assert.equal(await sessions.eventIdentity(new Headers({cookie:repeated.cookie})),null);assert(await sessions.eventIdentity(new Headers({cookie:restored.cookie})));
 database.prepare("UPDATE users SET status='disabled' WHERE id=?").run(restored.data.user.id);assert.equal(await sessions.eventIdentity(new Headers({cookie:restored.cookie})),null);await assert.rejects(()=>login(card(2)),error=>error.status===403);
 assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);checks.push('logout and disabled-account checks preserve session isolation and all foreign keys');
 console.log(JSON.stringify({passed:true,checks,scope:'in-memory SQLite and stubbed center; no live model/payment calls'},null,2));
}finally{globalThis.fetch=originalFetch;database.close();delete globalThis.__quotaIdentityTestEnv;}

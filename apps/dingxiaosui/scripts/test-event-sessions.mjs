// In-memory only. No existing cards, account database, network or paid requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),database=new DatabaseSync(':memory:');
const origin='https://event.local.test';
const env={APP_ENV:'production',APP_ORIGIN:origin,EVENT_ACTIVATION_ENABLED:'1',PASSWORD_AUTH_ENABLED:'1'};
class Statement{
 constructor(sql,values=[]){this.sql=sql;this.values=values;}
 bind(...values){return new Statement(this.sql,values);}
 execute(){const statement=database.prepare(this.sql);if(statement.columns().length)return {results:statement.all(...this.values),meta:{changes:0}};const result=statement.run(...this.values);return {results:[],meta:{changes:Number(result.changes)}};}
 async first(){return database.prepare(this.sql).get(...this.values)||null;}
 async all(){return this.execute();}
 async run(){return this.execute();}
}
env.DB={prepare:sql=>new Statement(sql),async batch(statements){database.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
globalThis.__eventSessionTestEnv=env;
const jsUrl=value=>'data:text/javascript;base64,'+Buffer.from(value).toString('base64');
const tsUrl=value=>jsUrl(ts.transpileModule(value,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const envUrl=jsUrl('export const env=globalThis.__eventSessionTestEnv;');
const tenancyUrl=jsUrl(`export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}};export const db=()=>globalThis.__eventSessionTestEnv.DB;export function field(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,'invalid input');return value.trim();}export function strictOrigin(request){if(request.headers.get('origin')!==globalThis.__eventSessionTestEnv.APP_ORIGIN)throw new ApiError(403,'invalid origin');}`);
const gatewayUrl=jsUrl('export const centerRequired=()=>false;');
const moduleSource=name=>fs.readFileSync(path.join(root,'lib',name+'.ts'),'utf8');
const protocolUrl=tsUrl(moduleSource('apimart-protocol'));
const plansUrl=tsUrl(moduleSource('event-plans').replace("'./apimart-protocol'",JSON.stringify(protocolUrl)));
const creditsUrl=tsUrl(moduleSource('event-credits').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)).replace("'./event-plans'",JSON.stringify(plansUrl)));
const passwordUrl=tsUrl(moduleSource('password-auth').replace("'cloudflare:workers'",JSON.stringify(envUrl)));
const quotaUrl=tsUrl(moduleSource('quota-center').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)));
const sessionUrl=tsUrl(moduleSource('event-session').replace("'cloudflare:workers'",JSON.stringify(envUrl)).replace("'./tenancy'",JSON.stringify(tenancyUrl)).replace("'./zlg-gateway'",JSON.stringify(gatewayUrl)).replace("'./password-auth'",JSON.stringify(passwordUrl)).replace("'./event-credits'",JSON.stringify(creditsUrl)).replace("'./quota-center'",JSON.stringify(quotaUrl)));
const credits=await import(creditsUrl),sessions=await import(sessionUrl),password=await import(passwordUrl);
const checks=[];
const request=(cookie='',site=origin)=>new Request(origin+'/api/event/session',{method:'POST',headers:{origin:site,'content-type':'application/json','x-real-ip':'shared-conference-wifi',...(cookie?{cookie}:{})}});
const login=async(code,cookie='',options={})=>{const response=await sessions.startEventSession(request(cookie),code,options);return {response,data:await response.json(),cookie:response.headers.getSetCookie().find(value=>value.startsWith('zdx_event_session=')).split(';')[0]};};
try{
 database.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(path.join(root,'drizzle')).filter(name=>/^\d+.*\.sql$/.test(name)).sort())database.exec(fs.readFileSync(path.join(root,'drizzle',name),'utf8'));
 for(const id of ['admin','legacy','other'])database.prepare("INSERT INTO users VALUES (?,?,'active',?)").run(id,id,new Date().toISOString());
 const first=await credits.issueEventCodes('admin',{requestId:crypto.randomUUID(),count:50,label:'Official 50'}),second=await credits.issueEventCodes('admin',{requestId:crypto.randomUUID(),count:50,label:'Preparation only'});
 assert.equal(await credits.selectedEventBatch(),first.batchId);
 const anonymous=await sessions.eventSessionStatus(new Headers());assert.equal(anonymous.authenticated,false);assert.equal(anonymous.enabled,true);assert(!('wallet'in anonymous));
 await assert.rejects(()=>sessions.startEventSession(request(),'ZDXE-invalid'),error=>error.status===400);
 await assert.rejects(()=>sessions.startEventSession(request('', 'https://foreign.test'),first.codes[0]),error=>error.status===403);
 await assert.rejects(()=>login(second.codes[0]),error=>error.status===403);checks.push('anonymous status, malformed codes, same-origin and unopened batch rejection');
 const guests=await Promise.all(first.codes.map(code=>login(code)));
 assert.equal(new Set(guests.map(guest=>guest.data.user.id)).size,50);assert.equal(database.prepare('SELECT count(*) n FROM password_accounts').get().n,0);
 for(const guest of guests){assert.equal(guest.data.authenticated,true);assert.equal(guest.data.platformAdmin,false);assert.equal(guest.data.wallet.quotas.find(value=>value.capability==='image').available,5);assert.equal(guest.data.wallet.quotas.find(value=>value.capability==='text').available,10);assert.equal(guest.data.wallet.quotas.find(value=>value.capability==='video').available,2);assert(guest.response.headers.getSetCookie()[0].includes('HttpOnly'));assert(guest.response.headers.getSetCookie()[0].includes('Secure'));}
 assert.equal(database.prepare("SELECT count(*) n FROM event_activation_codes WHERE status='redeemed'").get().n,50);assert.equal(database.prepare('SELECT count(*) n FROM event_credit_ledger').get().n,150);checks.push('50 simultaneous direct activations on one Wi-Fi create 50 separate guests without password accounts');
 const repeated=await Promise.all(Array.from({length:50},()=>login(first.codes[0])));assert(repeated.every(value=>value.data.user.id===guests[0].data.user.id));assert.equal(database.prepare('SELECT count(*) n FROM event_credit_ledger').get().n,150);checks.push('50 concurrent same-code restores preserve one owner and never grant twice');
 const identity=await sessions.eventIdentity(new Headers({cookie:guests[0].cookie}));assert.equal(identity.provider,'event');assert.equal(identity.platformAdmin,false);
 const switched=await login(first.codes[1],guests[0].cookie);assert.equal(switched.data.user.id,guests[1].data.user.id);assert.notEqual(switched.data.user.id,guests[0].data.user.id);
 const rawToken=guests[0].cookie.split('=')[1];assert(!JSON.stringify(database.prepare('SELECT * FROM event_guest_sessions').all()).includes(rawToken));checks.push('cookie identity is isolated, code switching changes user, only session hashes are persisted');
 await sessions.endEventSession(new Request(origin+'/api/event/session',{method:'DELETE',headers:{origin,cookie:guests[0].cookie}}));assert.equal(await sessions.eventIdentity(new Headers({cookie:guests[0].cookie})),null);assert(await sessions.eventIdentity(new Headers({cookie:guests[1].cookie})));checks.push('logout invalidates only the requested event session');
 await assert.rejects(()=>credits.redeemEventCode(guests[0].data.user.id,first.codes[2]),error=>error.status===409);
 await credits.selectEventBatch('admin',second.batchId,'Switch to another controlled test batch');assert.equal((await sessions.eventSessionStatus(new Headers({cookie:guests[1].cookie}))).active,false);assert.equal((await login(first.codes[1])).data.active,false);await assert.rejects(()=>credits.reserveEventCredit(guests[1].data.user.id,{capability:'text',profile:'standard',requestKey:'old-batch-key',requestHash:'test'}),error=>error.status===402);checks.push('batch switch preserves old guest access while blocking new generation');
 const legacy=await credits.redeemEventCode('legacy',second.codes[0]);assert.equal(legacy.activated,true);await assert.rejects(()=>login(second.codes[0]),error=>error.status===409);assert.equal(database.prepare('SELECT count(*) n FROM event_guest_accounts WHERE user_id=?').get('legacy').n,0);await assert.rejects(()=>credits.redeemEventCode('legacy',second.codes[1]),error=>error.status===409);checks.push('legacy redeemed voucher cannot take over its password account; one account cannot accumulate cards');
 const expired=await login(second.codes[1]);database.prepare("UPDATE event_credit_lots SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(expired.data.user.id);assert.equal((await login(second.codes[1])).data.active,false);assert.equal((await sessions.eventSessionStatus(new Headers({cookie:expired.cookie}))).authenticated,true);checks.push('expired guests can recover existing work without renewed allowance');
 database.prepare("UPDATE users SET status='disabled' WHERE id=?").run(expired.data.user.id);await assert.rejects(()=>login(second.codes[1]),error=>error.status===403);assert.equal(await sessions.eventIdentity(new Headers({cookie:expired.cookie})),null);checks.push('disabled accounts cannot restore or use an existing session');
 const adminAccount='session-switch-admin',stamp=new Date().toISOString();
 database.prepare('INSERT INTO password_accounts VALUES (?,?,?,?,?,?,?)').run(adminAccount,'isolated-switch-admin','fixture-only','fixture-only','Fixture administrator',1,stamp);
 database.prepare("INSERT INTO auth_identities VALUES (?,?,'password',?,?)").run('session-switch-admin-identity','admin',adminAccount,stamp);
 const adminToken=password.randomToken(),otherAdminToken=password.randomToken(),adminCookie='zdx_session='+adminToken,otherAdminCookie='zdx_session='+otherAdminToken;
 for(const value of [adminToken,otherAdminToken])database.prepare('INSERT INTO password_sessions VALUES (?,?,?)').run(await password.digest(value),adminAccount,Date.now()+3600000);
 assert.equal((await sessions.eventSessionStatus(new Headers({cookie:adminCookie}))).platformAdmin,true);
 await assert.rejects(()=>login(second.codes[2],adminCookie),error=>error.status===409);
 await assert.rejects(()=>login('ZDXE-invalid',adminCookie,{switchFromAdmin:true}),error=>error.status===400);
 await assert.rejects(()=>sessions.startEventSession(request(adminCookie,'https://foreign.test'),second.codes[2],{switchFromAdmin:true}),error=>error.status===403);
 assert(await password.passwordIdentity(new Headers({cookie:adminCookie})),'invalid code must not end administrator session');
 const asGuest=await login(second.codes[2],adminCookie,{switchFromAdmin:true});
 assert.equal(asGuest.data.platformAdmin,false);assert.notEqual(asGuest.data.user.id,'admin');assert.equal(asGuest.data.wallet.quotas.find(row=>row.capability==='text').available,10);
 assert.equal(await password.passwordIdentity(new Headers({cookie:adminCookie})),null,'old administrator token must be revoked');
 assert.equal((await password.passwordIdentity(new Headers({cookie:otherAdminCookie}))).platformAdmin,true,'other administrator sessions must remain valid');
 assert(asGuest.response.headers.getSetCookie().some(value=>value.startsWith('zdx_session=;')&&value.includes('Max-Age=0')));
 assert.equal(database.prepare('SELECT platform_admin FROM password_accounts WHERE id=?').get(adminAccount).platform_admin,1);
 checks.push('explicit administrator-to-guest switch preserves typed-card flow, revokes only current admin session, and invalid cards keep administrator access');
 assert.equal(database.prepare("SELECT count(*) n FROM event_admin_audit WHERE action='select_batch'").get().n,1);assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log(JSON.stringify({passed:true,checks,scope:'in-memory real SQLite; no existing cards, network, live AI or payment'},null,2));
}catch(error){console.error('FAIL event sessions:',error.message);process.exitCode=1;}finally{database.close();delete globalThis.__eventSessionTestEnv;}

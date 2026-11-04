import {env} from 'cloudflare:workers';
import type {Identity} from './identity';
import {ApiError,db,field,strictOrigin} from './tenancy';
import {centerRequired} from './zlg-gateway';
import {digest,passwordIdentity,randomToken,sessionCookie} from './password-auth';
import {eventActivationEnabled,eventCreditSummary,redeemEventCode,selectedEventBatch} from './event-credits';
import {activateQuotaCard,quotaCenterEnabled,quotaCenterPublicSettings,quotaCreditSummary} from './quota-center';

const cookieName='zdx_event_session';
const sessionSeconds=30*86400;
const vars=()=>env as unknown as Record<string,string|undefined>;
export function eventSessionEnabled(){return (eventActivationEnabled()||quotaCenterEnabled())&&!centerRequired()&&vars().APP_ENV==='production'&&!!vars().APP_ORIGIN;}
function token(headers:Headers){const values=(headers.get('cookie')||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieName+'='));return values.length===1?values[0].slice(cookieName.length+1):'';}
export function eventSessionCookie(value:string,maxAge=sessionSeconds){return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${vars().APP_ORIGIN?.startsWith('https:')?'; Secure':''}`;}
export async function eventIdentity(headers:Headers):Promise<Identity|null>{
 if(!eventSessionEnabled())return null;
 const value=token(headers);if(!/^[a-f0-9]{64}$/.test(value))return null;
 const quota=await db().prepare("SELECT q.user_id,u.display_name FROM quota_center_sessions s JOIN quota_center_accounts q ON q.user_id=s.user_id AND q.status='active' JOIN users u ON u.id=q.user_id AND u.status='active' WHERE s.token_hash=? AND s.expires_at>?").bind(await digest(value),Date.now()).first<{user_id:string;display_name:string}>();
 if(quota)return {provider:'quota_center',userId:quota.user_id,email:'',displayName:quota.display_name,fullName:null,platformAdmin:false};
 const row=await db().prepare("SELECT g.code_id,u.display_name FROM event_guest_sessions s JOIN event_guest_accounts g ON g.code_id=s.code_id JOIN event_activation_codes c ON c.id=g.code_id AND c.status='redeemed' AND c.redeemed_by=g.user_id JOIN users u ON u.id=g.user_id AND u.status='active' WHERE s.token_hash=? AND s.expires_at>?").bind(await digest(value),Date.now()).first<{code_id:string;display_name:string}>();
 return row?{provider:'event',userId:row.code_id,email:'',displayName:row.display_name,fullName:null,platformAdmin:false}:null;
}
export async function eventSessionStatus(headers:Headers){
 const enabled=eventSessionEnabled(),settings=quotaCenterPublicSettings(),identity={service:'dingxiaosui' as const,buildId:vars().DING_BUILD_ID||''},anonymous={enabled,authenticated:false,platformAdmin:false,activated:false,active:false,...identity,...settings};
 if(!enabled)return anonymous;
 const password=await passwordIdentity(headers),who=password||await eventIdentity(headers);if(!who)return anonymous;
 const user=who.provider==='quota_center'
  ?await db().prepare("SELECT u.id,u.display_name FROM quota_center_accounts q JOIN users u ON u.id=q.user_id AND u.status='active' WHERE q.user_id=? AND q.status='active'").bind(who.userId).first<{id:string;display_name:string}>()
  :who.provider==='password'
  ?await db().prepare("SELECT u.id,u.display_name FROM auth_identities i JOIN users u ON u.id=i.user_id AND u.status='active' WHERE i.provider='password' AND i.subject=?").bind(who.userId).first<{id:string;display_name:string}>()
  :await db().prepare("SELECT u.id,u.display_name FROM event_guest_accounts g JOIN users u ON u.id=g.user_id AND u.status='active' WHERE g.code_id=?").bind(who.userId).first<{id:string;display_name:string}>();
 if(!user)return anonymous;
 const platformAdmin=password?.platformAdmin===true;
 const wallet=who.provider==='quota_center'?await quotaCreditSummary(user.id):await eventCreditSummary(user.id);
 return {enabled,authenticated:true,platformAdmin,activated:platformAdmin||wallet.activated,active:platformAdmin||wallet.active,creditSource:who.provider==='quota_center'?'quota_center':'event',user:{id:user.id,displayName:user.display_name},wallet,...identity,...settings};
}
async function limitLogin(request:Request){
 // One shared conference Wi-Fi can activate all 50 guests and tolerate retries.
 const ip=request.headers.get('x-real-ip')||'unknown',period=Math.floor(Date.now()/900000),key='event-login:'+await digest(ip)+':'+period;
 const row=await db().prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<300 RETURNING count').bind(key,Date.now()+900000).first();
 if(!row)throw new ApiError(429,'激活尝试较多，请 15 分钟后再试或联系工作人员');
}
export async function startEventSession(request:Request,code:unknown,options:{switchFromAdmin?:boolean}={}){
 if(!eventSessionEnabled())throw new ApiError(409,'现场体验暂未开放');
 strictOrigin(request);await limitLogin(request);
 const password=await passwordIdentity(request.headers);
 if(password?.platformAdmin&&!options.switchFromAdmin)throw new ApiError(409,'当前是管理员账号，请点击“退出管理员，使用体验码”继续');
 if(typeof code==='string'&&code.trim().toUpperCase().replace(/[\s-]/g,'').startsWith('QTA'))return startQuotaSession(request,code,!!password&&!!options.switchFromAdmin);
 const raw=field(code,100,true).replace(/[\s-]/g,'').toUpperCase();
 if(!/^ZDXE[A-F0-9]{32}$/.test(raw))throw new ApiError(400,'激活码格式不正确，请完整复制工作人员提供的码');
 const row=await db().prepare('SELECT c.id,c.batch_id,c.status,c.redeemed_by,b.redeem_before FROM event_activation_codes c JOIN event_activation_batches b ON b.id=c.batch_id WHERE c.code_hash=?').bind(await digest(raw)).first<{id:string;batch_id:string;status:string;redeemed_by:string|null;redeem_before:string|null}>();
 if(!row||row.status==='revoked')throw new ApiError(400,'激活码无效或已作废，请联系工作人员');
 const existing=await db().prepare('SELECT user_id FROM event_guest_accounts WHERE code_id=?').bind(row.id).first<{user_id:string}>();
 // A previously activated card can recover old work after expiry or a batch switch.
 // Unactivated cards from a preparation/test batch never create an identity.
 if((row.status!=='redeemed'||!existing)&&row.batch_id!==await selectedEventBatch())throw new ApiError(403,'这张卡所属批次尚未开放，请联系工作人员');
 if(row.status==='active'&&row.redeem_before&&row.redeem_before<=new Date().toISOString())throw new ApiError(400,'激活码已超过最晚激活时间');
 const expectedGuestId='event-'+row.id;
 // A redeemed code was historically a credit voucher, not the account's password.
 // Only accounts created by this direct-code flow may be restored with the code.
 if(row.redeemed_by&&row.redeemed_by!==expectedGuestId)throw new ApiError(409,'这张卡已兑换到原账号，请使用原账号登录；如需帮助请联系工作人员');
 const userId=expectedGuestId,time=new Date().toISOString();
 if(row.redeemed_by){
  const owner=await db().prepare("SELECT u.status,EXISTS(SELECT 1 FROM auth_identities i WHERE i.user_id=u.id) AS has_identity FROM users u WHERE u.id=?").bind(userId).first<{status:string;has_identity:number}>();
  if(!owner||owner.status!=='active')throw new ApiError(403,'此体验账号已停用，请联系工作人员');
  if(owner.has_identity)throw new ApiError(403,'此码已绑定原账号，不能作为来宾登录凭据');
 }
 if(existing&&existing.user_id!==userId)throw new ApiError(409,'激活码归属已变化，请联系工作人员核对');
 if(!existing){
  await db().prepare("INSERT INTO users(id,display_name,status,created_at) SELECT ?,?,'active',? WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=?) ON CONFLICT(id) DO NOTHING").bind(userId,'体验来宾 '+row.id.slice(-4).toUpperCase(),time,userId).run();
 }
 if(row.status==='active')await redeemEventCode(userId,raw,{directSession:true});
 await db().prepare("INSERT INTO event_guest_accounts(code_id,user_id,created_at) SELECT id,redeemed_by,? FROM event_activation_codes WHERE id=? AND status='redeemed' AND redeemed_by=? ON CONFLICT(code_id) DO NOTHING").bind(time,row.id,userId).run();
 // Re-read after any concurrent activation; never bind to an unredeemed/stale row.
 const account=await db().prepare("SELECT g.user_id FROM event_guest_accounts g JOIN event_activation_codes c ON c.id=g.code_id AND c.status='redeemed' AND c.redeemed_by=g.user_id JOIN users u ON u.id=g.user_id AND u.status='active' WHERE g.code_id=?").bind(row.id).first<{user_id:string}>();
 if(!account)throw new ApiError(409,'激活未完成，请重新输入原激活码核对');
 const value=randomToken(),created=Date.now();
 const oldSessions=(request.headers.get('cookie')||'').split(';').map(item=>item.trim()).filter(item=>item.startsWith('zdx_session='));
 const oldToken=password&&options.switchFromAdmin&&oldSessions.length===1?oldSessions[0].slice('zdx_session='.length):'';
 const oldHash=/^[a-f0-9]{64}$/.test(oldToken)?await digest(oldToken):'';
 // Validate and redeem the card before touching the administrator session.
 // Only the current browser session is revoked, atomically with the new guest session.
 await db().batch([
  db().prepare('DELETE FROM event_guest_sessions WHERE expires_at<?').bind(created),
  db().prepare('INSERT INTO event_guest_sessions(token_hash,code_id,created_at,expires_at) VALUES (?,?,?,?)').bind(await digest(value),row.id,created,created+sessionSeconds*1000),
  ...(oldHash?[db().prepare('DELETE FROM password_sessions WHERE token_hash=?').bind(oldHash)]:[]),
 ]);
 const headers=new Headers({'cache-control':'no-store'});headers.append('set-cookie',eventSessionCookie(value));headers.append('set-cookie',sessionCookie('',0));
 const identityHeaders=new Headers({cookie:cookieName+'='+value});
 return Response.json(await eventSessionStatus(identityHeaders),{headers});
}
export async function endEventSession(request:Request){
 strictOrigin(request);const value=token(request.headers);
 if(/^[a-f0-9]{64}$/.test(value)&&eventSessionEnabled())await db().batch([
  db().prepare('DELETE FROM event_guest_sessions WHERE token_hash=?').bind(await digest(value)),
  db().prepare('DELETE FROM quota_center_sessions WHERE token_hash=?').bind(await digest(value)),
 ]);
 return Response.json({ok:true},{headers:{'cache-control':'no-store','set-cookie':eventSessionCookie('',0)}});
}
async function startQuotaSession(request:Request,code:string,switchPassword:boolean){
 const account=await activateQuotaCard(code),value=randomToken(),created=Date.now();
 // Read the authenticated balance before issuing a new cookie. A transient
 // failure leaves the durable redemption intact for the same-code retry.
 const wallet=await quotaCreditSummary(account.userId);
 const old=(request.headers.get('cookie')||'').split(';').map(item=>item.trim()).filter(item=>item.startsWith('zdx_session='));
 const previous=switchPassword&&old.length===1?old[0].slice('zdx_session='.length):'';
 const oldHash=/^[a-f0-9]{64}$/.test(previous)?await digest(previous):'';
 await db().batch([
  db().prepare('DELETE FROM quota_center_sessions WHERE expires_at<?').bind(created),
  db().prepare('INSERT INTO quota_center_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').bind(await digest(value),account.userId,created,created+sessionSeconds*1000),
  ...(oldHash?[db().prepare('DELETE FROM password_sessions WHERE token_hash=?').bind(oldHash)]:[]),
 ]);
 const user=await db().prepare('SELECT display_name FROM users WHERE id=?').bind(account.userId).first<{display_name:string}>();
 const headers=new Headers({'cache-control':'no-store'});headers.append('set-cookie',eventSessionCookie(value));headers.append('set-cookie',sessionCookie('',0));
 return Response.json({enabled:true,authenticated:true,platformAdmin:false,activated:true,active:true,creditSource:'quota_center',user:{id:account.userId,displayName:user!.display_name},wallet,...quotaCenterPublicSettings()},{headers});
}

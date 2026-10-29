import {env} from 'cloudflare:workers';
import type {Identity} from './identity';
const vars=()=>env as unknown as Record<string,string>;
export const passwordAuthEnabled=()=>vars().APP_ENV==='production' && vars().PASSWORD_AUTH_ENABLED==='1' && !!vars().APP_ORIGIN;
const cookie='zdx_session';
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function passwordHash(password:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:600000},key,256);return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,'0')).join('');}
function sessionToken(headers:Headers){const values=(headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookie+'='));return values.length===1?values[0].slice(cookie.length+1):'';}
export async function passwordIdentity(headers:Headers):Promise<Identity|null>{
 if(!passwordAuthEnabled()||!env.DB)return null;
 const token=sessionToken(headers);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await env.DB.prepare("SELECT a.id,a.username,a.display_name,a.platform_admin FROM password_sessions s JOIN password_accounts a ON a.id=s.account_id JOIN auth_identities i ON i.provider='password' AND i.subject=a.id JOIN users u ON u.id=i.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").bind(await digest(token),Date.now()).first<{id:string;username:string;display_name:string;platform_admin:number}>();
 return row?{provider:'password',userId:row.id,email:row.username,displayName:row.display_name,fullName:null,platformAdmin:row.platform_admin===1}:null;
}
export function sessionCookie(token:string,maxAge=28800){return `${cookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${vars().APP_ORIGIN?.startsWith('https:')?'; Secure':''}`;}
function authHeaders(token:string,maxAge=28800){const headers=new Headers({'Cache-Control':'no-store'});headers.append('Set-Cookie',sessionCookie(token,maxAge));headers.append('Set-Cookie',`zdx_event_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${vars().APP_ORIGIN?.startsWith('https:')?'; Secure':''}`);return headers;}
async function limit(key:string,max:number,windowMs:number){const now=Date.now();const row=await env.DB!.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count').bind(await digest(key),now+windowMs,now,now).first<{count:number}>();if(row!.count>max)throw new AuthError(429,'尝试次数较多，请稍后再试');}
class AuthError extends Error{constructor(public status:number,message:string){super(message)}}
export async function authAction(request:Request){
 try{
  if(!passwordAuthEnabled()||!env.DB)return Response.json({error:'账号登录未启用'},{status:503});
  if(request.headers.get('origin')!==vars().APP_ORIGIN||request.headers.get('sec-fetch-site')==='cross-site')throw new AuthError(403,'请求来源不允许');
  const text=await request.text();if(text.length>5000)throw new AuthError(413,'提交内容过长');
  let body;try{body=JSON.parse(text)}catch{throw new AuthError(400,'提交格式不正确')}
  if(body.action==='logout'){const token=sessionToken(request.headers);if(token)await env.DB.prepare('DELETE FROM password_sessions WHERE token_hash=?').bind(await digest(token)).run();const eventTokens=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('zdx_event_session='));if((vars().EVENT_ACTIVATION_ENABLED==='1'||vars().QUOTA_CENTER_URL)&&eventTokens.length===1){const eventToken=eventTokens[0].slice('zdx_event_session='.length);if(/^[a-f0-9]{64}$/.test(eventToken))await env.DB.batch([env.DB.prepare('DELETE FROM event_guest_sessions WHERE token_hash=?').bind(await digest(eventToken)),env.DB.prepare('DELETE FROM quota_center_sessions WHERE token_hash=?').bind(await digest(eventToken))]);}return Response.json({ok:true},{headers:authHeaders('',0)});}
  const username=String(body.username||'').trim().toLowerCase(),password=String(body.password||''),displayName=String(body.displayName||username).trim();
  if(!/^[a-z0-9][a-z0-9_.@+-]{2,79}$/.test(username)||password.length<12||password.length>128||displayName.length>60)throw new AuthError(400,'账号需为3–80位英文或数字；密码需12–128位');
  const ip=request.headers.get('x-real-ip')||'unknown';
  const eventMode=vars().EVENT_ACTIVATION_ENABLED==='1';
  await limit('ip:'+ip,eventMode?300:30,15*60_000);await limit('user:'+username,10,15*60_000);
  let account=await env.DB.prepare('SELECT * FROM password_accounts WHERE username=?').bind(username).first<{id:string;password_hash:string;salt:string}>();
  if(body.action==='register'||body.action==='setup'){
   await limit('register:'+ip,eventMode?100:10,3600_000);
   if(account)throw new AuthError(409,'账号已存在，请登录');
   const setup=body.action==='setup',now=new Date().toISOString(),id=crypto.randomUUID(),userId=crypto.randomUUID(),salt=randomToken();
   let tokenHash='';if(setup){tokenHash=await digest(String(body.setupToken||''));const token=await env.DB.prepare('SELECT token_hash FROM setup_tokens WHERE token_hash=? AND consumed=0 AND expires_at>?').bind(tokenHash,Date.now()).first();if(!token)throw new AuthError(403,'管理员开通链接无效或已使用');}
   const hash=await passwordHash(password,salt);
   const statements=[
    env.DB.prepare('INSERT INTO password_accounts(id,username,password_hash,salt,display_name,platform_admin,created_at) VALUES (?,?,?,?,?,?,?)').bind(id,username,hash,salt,displayName,setup?1:0,now),
    env.DB.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES (?,?,'active',?)").bind(userId,displayName,now),
    env.DB.prepare("INSERT INTO auth_identities(id,user_id,provider,subject,verified_at) VALUES (?,?,'password',?,?)").bind(crypto.randomUUID(),userId,id,now)
   ];
   if(setup){
    // Atomic guard: if another request consumed this token, NOT NULL fails and rolls back the complete batch.
    statements.unshift(env.DB.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES ((SELECT token_hash FROM setup_tokens WHERE token_hash=? AND consumed=0 AND expires_at>?),1,?)').bind(tokenHash,Date.now(),Date.now()+86400_000));
    statements.push(env.DB.prepare('UPDATE setup_tokens SET consumed=1 WHERE token_hash=? AND consumed=0').bind(tokenHash));
   }
   await env.DB.batch(statements);account={id,password_hash:hash,salt};
  }else if(body.action==='login'){
   const hash=await passwordHash(password,account?.salt||'invalid-account-dummy-salt');
   if(!account||hash!==account.password_hash)throw new AuthError(401,'账号或密码不正确');
  }else throw new AuthError(400,'操作不支持');
  const valid=await env.DB.prepare("SELECT u.status FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.provider='password' AND i.subject=?").bind(account.id).first<{status:string}>();if(valid?.status!=='active')throw new AuthError(403,'账号已停用');
  const token=randomToken();await env.DB.batch([env.DB.prepare('DELETE FROM password_sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('INSERT INTO password_sessions VALUES (?,?,?)').bind(await digest(token),account.id,Date.now()+28800_000)]);
  const admin=await env.DB.prepare('SELECT platform_admin FROM password_accounts WHERE id=?').bind(account.id).first<{platform_admin:number}>();
  return Response.json({ok:true,redirect:admin?.platform_admin?'/platform':'/merchant'},{headers:authHeaders(token)});
 }catch(e){return Response.json({error:e instanceof AuthError?e.message:'登录服务暂时不可用，请稍后重试'},{status:e instanceof AuthError?e.status:503,headers:{'Cache-Control':'no-store'}})}
}

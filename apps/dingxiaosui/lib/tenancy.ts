import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { identityReady, platformIdentity, type Identity } from "./identity";
import { discardRequestBody } from "./request-body";

export class ApiError extends Error { constructor(public status:number,message:string){super(message)} }
export function db(){if(!env.DB)throw new ApiError(503,"数据库未就绪");return env.DB;}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
export function strictOrigin(request:Request){const expected=(env as unknown as Record<string,string>).APP_ORIGIN||new URL(request.url).origin;if(request.headers.get('origin')!==expected)throw new ApiError(403,'请从本站页面提交');}
export async function api(request:Request,work:()=>Promise<Response>){
 try{
  if(!["GET","HEAD"].includes(request.method)){
   const origin=request.headers.get("origin");
   const expected=(env as unknown as Record<string,string>).APP_ORIGIN||new URL(request.url).origin;
   if((origin && origin!==expected)||request.headers.get("sec-fetch-site")==="cross-site")throw new ApiError(403,"请求来源不允许");
  }
  return await work();
 }catch(error){
  if(error instanceof ApiError)return json({error:error.message},error.status);
  console.error("Tenant operation failed",error instanceof Error?error.name:"Unknown");
  return json({error:"服务暂时不可用，未确认保存成功"},503);
 }finally{await discardRequestBody(request);}
}
export async function input(request:Request,keys:string[]){
 const text=await request.text();if(text.length>12000)throw new ApiError(413,"提交内容过长");
 let value:unknown;try{value=JSON.parse(text)}catch{throw new ApiError(400,"提交格式不正确")}
 if(!value||typeof value!=="object"||Array.isArray(value))throw new ApiError(400,"提交格式不正确");
 if(Object.keys(value).some(k=>!keys.includes(k)))throw new ApiError(400,"包含不允许修改的字段");
 return value as Record<string,unknown>;
}
export function field(value:unknown,max:number,required=false){if(typeof value!=="string"||value.length>max||(required&&!value.trim()))throw new ApiError(400,"资料缺失或长度不符合要求");return value.trim();}
export async function identity(){if(!identityReady())throw new ApiError(503,"生产登录可信边界尚未确认，暂不可访问");const user=await getChatGPTUser();if(!user)throw new ApiError(401,"请先登录");return user;}
export type Actor={id:string;displayName:string;identity:Identity;platformAdmin:boolean};
export async function actor(register=false):Promise<Actor>{
 const who=await identity();const database=db();
 if(who.provider==='quota_center'){
  const guest=await database.prepare("SELECT u.id,u.display_name,u.status FROM quota_center_accounts q JOIN users u ON u.id=q.user_id WHERE q.user_id=? AND q.status='active'").bind(who.userId).first<{id:string;display_name:string;status:string}>();
  if(!guest)throw new ApiError(401,'激活码登录已失效，请重新输入原激活码');
  if(guest.status!=='active')throw new ApiError(403,'当前账号已停用');
  return {id:guest.id,displayName:guest.display_name,identity:who,platformAdmin:false};
 }
 if(who.provider==='event'){
  const guest=await database.prepare("SELECT u.id,u.display_name,u.status FROM event_guest_accounts g JOIN users u ON u.id=g.user_id JOIN event_activation_codes c ON c.id=g.code_id AND c.redeemed_by=u.id AND c.status='redeemed' WHERE g.code_id=?").bind(who.userId).first<{id:string;display_name:string;status:string}>();
  if(!guest)throw new ApiError(401,'体验登录已失效，请重新输入激活码');
  if(guest.status!=='active')throw new ApiError(403,'当前账号已停用');
  return {id:guest.id,displayName:guest.display_name,identity:who,platformAdmin:false};
 }
 let user=await database.prepare("SELECT u.id,u.display_name,u.status,EXISTS(SELECT 1 FROM auth_identities legacy JOIN password_accounts p ON legacy.provider='password' AND legacy.subject=p.id WHERE legacy.user_id=u.id AND p.platform_admin=1) AS legacy_admin FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.provider=? AND i.subject=?").bind(who.provider,who.userId).first<{id:string;display_name:string;status:string;legacy_admin:number}>();
 if(!user&&(register||who.provider==='zlg')){
  const id=crypto.randomUUID(),now=new Date().toISOString();
  // One batch is atomic. Concurrent first visits safely fail and can be retried by
  // the caller; no unattached account or arbitrary subject is accepted from JSON.
  try{await database.batch([
   database.prepare("INSERT INTO users(id,display_name,status,created_at) VALUES (?,?,'active',?)").bind(id,who.displayName,now),
   database.prepare("INSERT INTO auth_identities(id,user_id,provider,subject,verified_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(),id,who.provider,who.userId,now),
  ]);}catch(error){const existing=await database.prepare("SELECT user_id FROM auth_identities WHERE provider=? AND subject=?").bind(who.provider,who.userId).first();if(!existing)throw error;}
  user=await database.prepare("SELECT u.id,u.display_name,u.status,EXISTS(SELECT 1 FROM auth_identities legacy JOIN password_accounts p ON legacy.provider='password' AND legacy.subject=p.id WHERE legacy.user_id=u.id AND p.platform_admin=1) AS legacy_admin FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.provider=? AND i.subject=?").bind(who.provider,who.userId).first<{id:string;display_name:string;status:string;legacy_admin:number}>();
 }
 if(!user)throw new ApiError(409,"请先打开商户中心，完成身份登记");
 if(user.status!=="active")throw new ApiError(403,"当前账号已停用");
 return {id:user.id,displayName:user.display_name,identity:who,platformAdmin:platformIdentity(who)||(who.provider==='zlg'&&!!user.legacy_admin)};
}
export async function platform(){const user=await actor();if(!user.platformAdmin)throw new ApiError(403,"仅平台管理员可以操作");return user;}
export async function member(merchantId:string,owner=false){
 const user=await actor();
 const row=await db().prepare("SELECT mm.role FROM merchant_memberships mm JOIN merchants m ON m.id=mm.merchant_id WHERE mm.merchant_id=? AND mm.user_id=? AND mm.status='active' AND m.status='active'").bind(merchantId,user.id).first<{role:string}>();
 if(!row || (owner&&row.role!=="owner"))throw new ApiError(403,"无权访问此商户，或商户/成员已停用");
 return {...user,role:row.role};
}
export async function myMerchants(userId:string){return (await db().prepare("SELECT m.id,m.name,mm.role,s.id AS shopId,s.slug FROM merchants m JOIN merchant_memberships mm ON mm.merchant_id=m.id JOIN merchant_shops s ON s.merchant_id=m.id WHERE mm.user_id=? AND mm.status='active' AND m.status='active' ORDER BY m.created_at,m.id").bind(userId).all()).results;}
export async function readShop(merchantId:string,shopId:string,userId:string){
 const row=await db().prepare("SELECT s.id,s.merchant_id AS merchantId,s.slug,s.name,s.description,s.public_contact AS publicContact,s.updated_at AS updatedAt FROM merchant_shops s JOIN merchants m ON m.id=s.merchant_id JOIN merchant_memberships mm ON mm.merchant_id=m.id JOIN users u ON u.id=mm.user_id WHERE s.id=? AND s.merchant_id=? AND mm.user_id=? AND mm.status='active' AND m.status='active' AND u.status='active'").bind(shopId,merchantId,userId).first();
 if(!row)throw new ApiError(404,"店铺不存在或不可访问");return row;
}

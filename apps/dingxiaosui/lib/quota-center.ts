import {env} from 'cloudflare:workers';
import {ApiError,db,field} from './tenancy';

export type QuotaCapability='text'|'image'|'video';
export type QuotaAccount={userId:string;centerUserId:string;codeId:string;creditSource:'quota_center'};
type AccountRow={card_hash:string;user_id:string;center_user_id:string;code_id:string|null;status:'pending'|'active'|'review';user_status:string;lease_token:string|null;lease_until:number};
type Bucket={granted:number;available:number;reserved:number;consumed:number};
export type CenterBalance=Bucket&{userId:string;projectId:string;shared?:Bucket;byCapability?:Record<QuotaCapability,Bucket>};
const vars=()=>env as unknown as Record<string,string|undefined>;
export const quotaCenterEnabled=()=>!!vars().QUOTA_CENTER_URL?.trim()&&!!vars().QUOTA_PLATFORM_KEY?.trim();
export function quotaShopProductUrl(){
 const value=vars().SHOP_PRODUCT_URL?.trim()||'';
 if(value.startsWith('/')&&!value.startsWith('//')&&!/[\\\r\n]/.test(value))return value;
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
export function quotaCenterPublicSettings(){return {quotaCenterEnabled:quotaCenterEnabled(),shopProductUrl:quotaShopProductUrl(),videoSeconds:5};}
function configuration(){
 if(!quotaCenterEnabled())throw new ApiError(503,'发卡服务尚未配置，请联系管理员');
 let base:URL;try{base=new URL(vars().QUOTA_CENTER_URL!.trim());}catch{throw new ApiError(503,'发卡服务地址配置不正确，请联系管理员');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new ApiError(503,'发卡服务地址配置不正确，请联系管理员');
 base.pathname=base.pathname.replace(/\/$/,'').replace(/\/api\/v1$/,'')+'/api/v1/';
 return {base,key:vars().QUOTA_PLATFORM_KEY!.trim()};
}
async function request(path:string,body:unknown|undefined,timeoutMs:number){
 const {base,key}=configuration();
 if(!path.startsWith('/')||path.startsWith('//')||/[\\\r\n]/.test(path))throw new ApiError(500,'发卡服务请求路径无效');
 const target=new URL(path.slice(1),base);
 if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname))throw new ApiError(500,'发卡服务请求路径无效');
 try{return await fetch(target,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
 catch{throw new ApiError(503,'发卡服务暂时无法连接，请稍后使用原请求重试；请勿重复购买或重新创建任务');}
}
async function failure(response:Response):Promise<never>{
 let reason='';try{const result=await response.json() as {error?:unknown};if(typeof result.error==='string')reason=result.error.slice(0,300);}catch{}
 if(response.status===401||response.status===403)throw new ApiError(503,'发卡服务接入凭证无效或权限不足，请联系管理员');
 throw new ApiError([400,402,404,409,429].includes(response.status)?response.status:503,reason||'发卡服务处理失败，请稍后重试');
}
export function normalizeActivationCode(value:string){
 const compact=value.trim().toUpperCase().replace(/[\s-]+/g,'');
 if(/^QTA[0-9A-F]{36}$/.test(compact))return `QTA-${compact.slice(3)}`;
 if(/^QTA[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{16}$/.test(compact)){const body=compact.slice(3);return `QTA-${body.slice(0,4)}-${body.slice(4,8)}-${body.slice(8,12)}-${body.slice(12)}`;}
 throw new ApiError(400,'激活码格式不正确，请按卡面上的分组核对，横线、空格和大小写都可以');
}
export async function quotaCenterRequest<T=unknown>(path:string,body?:unknown,options:{timeoutMs?:number}={}):Promise<T>{
 const response=await request(path,body,options.timeoutMs||130000);
 if(!response.ok)return failure(response);
 try{return await response.json() as T;}catch{throw new ApiError(503,'发卡服务返回结果不完整，请保留原请求稍后核对');}
}
export async function quotaCenterContent(path:string):Promise<Response>{
 const response=await request(path,undefined,130000);if(!response.ok)return failure(response);return response;
}
export async function quotaAccount(userId:string):Promise<QuotaAccount|null>{
 const row=await db().prepare("SELECT q.user_id,q.center_user_id,q.code_id FROM quota_center_accounts q JOIN users u ON u.id=q.user_id AND u.status='active' WHERE q.user_id=? AND q.status='active'").bind(userId).first<{user_id:string;center_user_id:string;code_id:string}>();
 return row?{userId:row.user_id,centerUserId:row.center_user_id,codeId:row.code_id,creditSource:'quota_center'}:null;
}
const emptyBucket=():Bucket=>({granted:0,available:0,reserved:0,consumed:0});
function checkedBucket(value:Bucket|undefined){
 if(!value)return emptyBucket();
 for(const key of ['granted','available','reserved','consumed'] as const)if(!Number.isSafeInteger(value[key])||value[key]<0)throw new ApiError(503,'发卡服务额度信息不完整，请稍后重试');
 return value;
}
export async function quotaCreditSummary(userId:string){
 const account=await quotaAccount(userId);if(!account)throw new ApiError(401,'激活码登录已失效，请重新输入原激活码');
 const balance=await quotaCenterRequest<CenterBalance>('/balance?userId='+encodeURIComponent(account.centerUserId));
 if(balance.userId!==account.centerUserId)throw new ApiError(503,'发卡服务额度归属不一致，请联系管理员');
 const shared=checkedBucket(balance.byCapability?balance.shared:balance);
 const quotas=(['image','text','video'] as const).map(capability=>{
  const value=checkedBucket(balance.byCapability?.[capability]);
  return {capability,profile:'standard',total:value.granted,used:value.consumed,reserved:value.reserved,available:value.available+shared.available,expiresAt:null};
 });
 return {ownerId:userId,creditSource:'quota_center' as const,activated:true,active:true,quotas,shared:{total:shared.granted,used:shared.consumed,reserved:shared.reserved,available:shared.available},entries:[],shopProductUrl:quotaShopProductUrl(),videoSeconds:5};
}
async function fingerprint(code:string){
 const secret=vars().AI_CONFIG_ENCRYPTION_KEY;
 if(!secret||secret.length<32)throw new ApiError(503,'本地身份密钥尚未配置，请联系管理员');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('quota-card:'+code))),n=>n.toString(16).padStart(2,'0')).join('');
}
async function readAccount(hash:string){return db().prepare('SELECT q.*,u.status AS user_status FROM quota_center_accounts q JOIN users u ON u.id=q.user_id WHERE card_hash=?').bind(hash).first<AccountRow>();}
// This function receives only the pasted card. Identity and all counts come from
// persistent server records and an authenticated center receipt, never the browser.
export async function activateQuotaCard(value:unknown):Promise<QuotaAccount>{
 configuration();const code=normalizeActivationCode(field(value,120,true));
 const hash=await fingerprint(code),time=new Date().toISOString();
 let row=await readAccount(hash);
 if(!row){
  const id='quota-'+crypto.randomUUID(),centerId='ding-'+crypto.randomUUID();
  try{await db().batch([
   db().prepare("INSERT INTO users(id,display_name,status,created_at) VALUES (?,?,'active',?)").bind(id,'创作用户 '+id.slice(-4).toUpperCase(),time),
   db().prepare("INSERT INTO quota_center_accounts(card_hash,user_id,center_user_id,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)").bind(hash,id,centerId,time,time),
  ]);}catch(error){if(!await readAccount(hash))throw error;}
  row=await readAccount(hash);
 }
 if(!row)throw new ApiError(503,'激活信息保存失败，请重试原激活码');
 if(row.user_status!=='active')throw new ApiError(403,'当前账号已停用，请联系管理员');
 if(row.status==='active')return {userId:row.user_id,centerUserId:row.center_user_id,codeId:row.code_id!,creditSource:'quota_center'};
 if(row.status==='review')throw new ApiError(409,'此激活码归属需要核对，请联系管理员；无需再次购买');
 const lease=crypto.randomUUID(),now=Date.now();
 const claimed=await db().prepare("UPDATE quota_center_accounts SET lease_token=?,lease_until=?,updated_at=? WHERE card_hash=? AND status='pending' AND lease_until<=? RETURNING user_id").bind(lease,now+45000,time,hash,now).first();
 if(!claimed)throw new ApiError(409,'激活正在处理中，请稍后重新提交同一个激活码');
 try{
  // Explicit idempotency replays only this exact card + persistent center user.
  // A lost response is recoverable without inventing ownership from a balance.
  const receipt=await quotaCenterRequest<{userId:string;codeId:string}>('/redeem',{userId:row.center_user_id,code,idempotent:true},{timeoutMs:30000});
  if(receipt.userId!==row.center_user_id||typeof receipt.codeId!=='string'||!receipt.codeId)throw new ApiError(503,'发卡服务兑换回执不完整，请重试原激活码');
  const activated=await db().prepare("UPDATE quota_center_accounts SET status='active',code_id=?,activated_at=?,updated_at=?,lease_token=NULL,lease_until=0 WHERE card_hash=? AND lease_token=? AND status='pending' RETURNING user_id").bind(receipt.codeId,time,new Date().toISOString(),hash,lease).first();
  if(!activated)throw new ApiError(409,'激活状态已变化，请重新输入原激活码核对');
  return {userId:row.user_id,centerUserId:row.center_user_id,codeId:receipt.codeId,creditSource:'quota_center'};
 }catch(error){
  const review=error instanceof ApiError&&error.status===409;
  await db().prepare("UPDATE quota_center_accounts SET status=CASE WHEN ? THEN 'review' ELSE status END,lease_token=NULL,lease_until=0,updated_at=? WHERE card_hash=? AND lease_token=? AND status='pending'").bind(review?1:0,new Date().toISOString(),hash,lease).run();
  throw error;
 }
}

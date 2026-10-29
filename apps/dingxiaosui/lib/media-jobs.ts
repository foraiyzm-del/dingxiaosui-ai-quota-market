import {env} from 'cloudflare:workers';
import {ApiError,db,field,type Actor} from './tenancy';
import {listModels,ownedModel} from './user-models';
import {agricultureMediaPrompt} from './agriculture-policy';
import {mediaBucket,mediaCapability,mediaConfig,mediaFetch,uploadMediaReference,platformMediaAllowed,platformMediaProvider,validateMediaEndpoint,validateMediaKind,type MediaCapability,type MediaProvider,type MediaKind} from './media-config';
import {apimartImagePayload,apimartVideoPayload,apimartSubmission,apimartTask,apimartVideoTask,ApimartProtocolError,type ApimartImageProfile} from './apimart-protocol';
import {eventActivationEnabled,reserveEventCredit,completeEventCredit,releaseEventCredit,eventCreditForRequest,markEventCreditUnknown} from './event-credits';
import {quotaAccount,quotaCenterEnabled,quotaCenterRequest,quotaCenterContent} from './quota-center';
import {encryptQuotaPayload,decryptQuotaPayload,verifyQuotaJob,type QuotaJob} from './quota-generation';

type Output={url:string;persisted:boolean;expiresAt?:string;expiresAtSource?:'provider';bucketKey?:string;contentType?:string};
export type MediaJobRow={id:string;user_id:string;capability:MediaCapability;idempotency_key:string;request_hash:string;prompt:string;model_name:string;provider_kind:MediaKind|'quota-center';provider_endpoint:string;provider_model:string;key_cipher:string;status:string;upstream_id:string|null;outputs_json:string;error:string|null;created_at:string;updated_at:string;poll_after:number};
type JobRow=MediaJobRow;
// Only server code may supply this argument. Never spread request JSON into it.
export type TrustedMediaOptions={imageProfile?:ApimartImageProfile};
const vars=()=>env as unknown as Record<string,string|undefined>;
export function publicJob(row:JobRow){let outputs:Output[]=[];try{outputs=JSON.parse(row.outputs_json)}catch{}return {id:row.id,capability:row.capability,status:row.status,prompt:row.prompt,modelName:row.model_name,providerModel:row.provider_model,createdAt:row.created_at,updatedAt:row.updated_at,outputs:outputs.filter(o=>row.status!=='saving'||o.persisted).map(({url,persisted,expiresAt,expiresAtSource})=>({url,persisted,...(expiresAtSource==='provider'&&expiresAt&&Number.isFinite(Date.parse(expiresAt))?{expiresAt,expiresAtSource}:{})})),error:row.error};}
export async function ownedMediaJob(userId:string,id:string){const row=await db().prepare('SELECT * FROM media_jobs WHERE id=? AND user_id=?').bind(id,userId).first<JobRow>();if(!row)throw new ApiError(404,'任务不存在或不可访问');return row;}
async function settleMediaEventCredit(row:JobRow){
 if(row.provider_kind==='quota-center')return;
 if(!eventActivationEnabled())return;
 const hold=await eventCreditForRequest(row.user_id,row.id);
 if(!hold||!['held','unknown'].includes(hold.status))return;
 if(row.status==='succeeded')await completeEventCredit(row.user_id,hold.id,{jobId:row.id,capability:row.capability});
 else if(row.status==='failed')await releaseEventCredit(row.user_id,hold.id);
 else if(row.status==='unknown')await markEventCreditUnknown(row.user_id,hold.id);
}
async function setJob(id:string,status:string,error:string|null=null,outputs?:Output[],upstreamId?:string,submissionCipher?:string){
 // A poll can outlive its lease while a large asset is being saved. Its late queued/running
 // result must never overwrite a terminal result written by another polling client.
 // Only the original submitting handler may resolve its own stale/unknown submission,
 // using its captured encrypted provider snapshot when an upstream ID finally arrives.
 await db().prepare("UPDATE media_jobs SET status=?,error=?,updated_at=?,outputs_json=COALESCE(?,outputs_json),upstream_id=COALESCE(?,upstream_id),key_cipher=CASE WHEN ? IN ('succeeded','failed','unknown') THEN '' ELSE COALESCE(?,key_cipher) END WHERE id=? AND (status IN ('submitting','queued','running') OR (status='saving' AND ? IN ('saving','succeeded')) OR (status='unknown' AND upstream_id IS NULL AND ?=1))").bind(status,error,new Date().toISOString(),outputs?JSON.stringify(outputs):null,upstreamId||null,status,submissionCipher||null,id,status,submissionCipher?1:0).run();
 const row=await db().prepare('SELECT * FROM media_jobs WHERE id=?').bind(id).first<JobRow>();if(row)await settleMediaEventCredit(row);
}
const limit=(key:string,fallback:number,max:number)=>{const n=Number(vars()[key]);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback};
async function reserveLimit(key:string,max:number,expires:number){const row=await db().prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(key,expires,max).first();if(!row)throw new ApiError(429,'媒体试用调用次数已达本时段上限，请稍后重试或联系管理员');}
async function reserveMediaCall(userId:string,shared:boolean){
 const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
 await db().prepare("DELETE FROM auth_limits WHERE key LIKE 'media:%' AND expires_at<?").bind(now).run();
 await reserveLimit(`media:minute:${userId}:${Math.floor(now/60000)}`,4,now+120000);
 await reserveLimit(`media:day:${userId}:${day}`,limit('MEDIA_USER_DAILY_LIMIT',20,200),now+86400000);
 if(shared)await reserveLimit(`media:platform:${day}`,limit('MEDIA_PLATFORM_DAILY_LIMIT',eventActivationEnabled()?300:100,2000),now+86400000);
}
async function providerFor(user:Actor,capability:MediaCapability,modelId:string|null,profile:ApimartImageProfile='standard'):Promise<MediaProvider>{
 if(!modelId)return platformMediaProvider(user,capability,profile);
 const row=await ownedModel(user.id,modelId);if(row.capability!==capability)throw new ApiError(400,'所选模型不支持此创作类型');
 const kind=validateMediaKind(row.kind,capability);return {capability,name:row.name,kind,endpoint:validateMediaEndpoint(row.endpoint,capability,kind),model:row.model,keyCipher:row.key_cipher};
}
export async function mediaWorkspace(user:Actor){
 const quota=await quotaAccount(user.id);
 if(quota){
  const rows=(await db().prepare('SELECT * FROM media_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all<JobRow>()).results;
  const available=quotaCenterEnabled(),option=(capability:MediaCapability)=>({available,authorized:true,unavailableReason:available?null:'service_not_configured',model:'quota-center',kind:'quota-center',name:capability==='image'?'图片生成':'视频生成',...(capability==='video'?{durationSeconds:5}:{referenceImageSupported:true})});
  return {creditSource:'quota_center',jobs:rows.map(publicJob),models:[],defaultModelIds:{image:null,video:null},platform:{image:option('image'),video:option('video')}};
 }
 const all=await listModels(user.id),access={image:await platformMediaAllowed(user,'image'),video:await platformMediaAllowed(user,'video')};
 const configs=await Promise.all(['image','video'].map(c=>mediaConfig(c as MediaCapability)));
 const option=(row:typeof configs[number],capability:MediaCapability)=>{const allowed=access[capability],configured=!!row?.enabled&&!!row?.key_cipher;return {available:allowed&&configured,authorized:allowed,unavailableReason:!allowed?'account_not_authorized':!configured?'service_not_configured':null,model:row?.model||'',kind:row?.kind||'ark',name:capability==='image'?'平台图片模型':'平台视频模型'};};
 // A process may have stopped after recording intent and before receiving the paid upstream result.
 // Never retry that POST automatically: it may already have been billed.
 await db().prepare("UPDATE media_jobs SET status='unknown',key_cipher='',error='提交结果未确认。请先到服务商控制台核对任务和费用，勿重复提交。',updated_at=? WHERE user_id=? AND provider_kind!='quota-center' AND status='submitting' AND created_at<?").bind(new Date().toISOString(),user.id,new Date(Date.now()-180000).toISOString()).run();
 const rows=await db().prepare('SELECT * FROM media_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all<JobRow>();
 for(const row of rows.results)await settleMediaEventCredit(row);
 return {jobs:rows.results.map(publicJob),models:all.models.filter(m=>m.capability!=='text'),defaultModelIds:{image:all.defaultModelIds.image,video:all.defaultModelIds.video},platform:{image:option(configs[0],'image'),video:option(configs[1],'video')}};
}
export function safeMediaUrl(value:unknown){
 if(typeof value!=='string'||value.length>8000)throw new ApiError(502,'媒体服务没有返回有效下载链接');
 let url:URL;try{url=new URL(value)}catch{throw new ApiError(502,'媒体服务返回的下载链接格式不正确')}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||!/[a-z]/i.test(host)||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(host)||/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host))throw new ApiError(502,'媒体服务返回了不安全的下载地址');
 return url.href;
}
function canPersistHost(url:string,providerKind:MediaKind|'quota-center'){const host=new URL(url).hostname;const trusted=['volces.com','volccdn.com','byteimg.com','oaiusercontent.com','oaistatic.com','blob.core.windows.net'];const extra=String(vars().MEDIA_ASSET_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(x));
 // APIMart also returns generated images on this exact CDN host. Keep it scoped
 // to that provider; do not accept arbitrary subdomains or follow redirects.
 return (providerKind==='apimart'&&['upload.apimart.ai','getapib.org'].includes(host))||extra.includes(host)||trusted.some(x=>host===x||host.endsWith('.'+x));}
async function boundedBytes(response:Response,max:number){if(Number(response.headers.get('content-length')||0)>max){await response.body?.cancel();throw new ApiError(502,'媒体文件超过本平台保存上限')}const reader=response.body?.getReader();if(!reader)throw new ApiError(502,'媒体服务响应为空');const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new ApiError(502,'媒体文件超过本平台保存上限');chunks.push(value)}}catch(error){await reader.cancel();throw error}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength}return bytes;}
function imageMime(bytes:Uint8Array){if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';throw new ApiError(502,'媒体服务返回的图片格式不受支持');}
function videoMime(bytes:Uint8Array){if(bytes.length>=12&&new TextDecoder().decode(bytes.slice(4,8))==='ftyp')return 'video/mp4';throw new ApiError(502,'视频已生成，但返回文件不是支持的 MP4；请刷新原任务');}
async function putAsset(job:JobRow,bytes:Uint8Array,contentType:string,index:number):Promise<Output>{const bucketKey=`generated/${job.user_id}/${job.id}/${index}`;await mediaBucket().put(bucketKey,bytes);return {url:`/api/media/assets/${job.id}?index=${index}`,bucketKey,contentType,persisted:true};}
async function remoteOutput(job:JobRow,value:unknown,index:number):Promise<Output>{
 const url=safeMediaUrl(value),temporary={url,persisted:false};
 if(!canPersistHost(url,job.provider_kind))return temporary;
 try{const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(90000)});if(!response.ok){await response.body?.cancel();return temporary}const bytes=await boundedBytes(response,job.capability==='image'?16*1024*1024:100*1024*1024);const contentType=job.capability==='image'?imageMime(bytes):new TextDecoder().decode(bytes.slice(4,8))==='ftyp'?'video/mp4':null;if(!contentType)return temporary;return await putAsset(job,bytes,contentType,index)}catch{return temporary}
}
async function responseObject(response:Response){const bytes=await boundedBytes(response,24*1024*1024);try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body as Record<string,unknown>}catch{throw new ApiError(502,'媒体服务响应格式不兼容，未取得有效结果')}}
function upstreamError(status:number){return status===401||status===403?'媒体服务拒绝密钥或模型权限（401/403），请检查对应模型是否已开通':status===402?'媒体服务余额不足（402），请联系管理员检查服务商余额':status===429?'媒体服务限流或额度不足（429），请检查控制台余额和配额':`媒体服务返回错误（HTTP ${status}），请核对模型能力和参数`}
async function imageOutputs(job:JobRow,data:Record<string,unknown>){
 if(!Array.isArray(data.data)||!data.data.length)throw new ApiError(502,'媒体服务未返回图片，请核对模型能力和响应格式');
 const first=data.data[0];if(!first||typeof first!=='object')throw new ApiError(502,'媒体服务返回的图片格式不兼容');
 if(typeof first.b64_json==='string'){
  const base64=first.b64_json;if(!base64.length||base64.length>23*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new ApiError(502,'媒体服务返回的图片内容无效或过大');
  let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))}catch{throw new ApiError(502,'媒体服务返回的图片编码无效')}
  return [await putAsset(job,bytes,imageMime(bytes),0)];
 }
 return [await remoteOutput(job,first.url,0)];
}
export const MAX_REFERENCE_IMAGE_BYTES=6*1024*1024;
function referencePhoto(value:unknown):{dataUrl:string;bytes:Uint8Array;contentType:string}{
 if(typeof value!=='string'||value.length>MAX_REFERENCE_IMAGE_BYTES/3*4+40)throw new ApiError(413,'参考图片不能超过 6 MB，请缩小图片后重试');
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match||match[2].length%4!==0)throw new ApiError(400,'请上传有效的 JPG、PNG 或 WebP 图片');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))}catch{throw new ApiError(400,'参考图片编码无效，请重新选择图片')}
 if(bytes.length>MAX_REFERENCE_IMAGE_BYTES)throw new ApiError(413,'参考图片不能超过 6 MB，请缩小图片后重试');
 const ascii=(start:number,end:number)=>new TextDecoder().decode(bytes.slice(start,end));
 const png=bytes.length>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&ascii(12,16)==='IHDR';
 const jpeg=bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
 const webp=bytes.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(ascii(12,16));
 if(!(match[1]==='image/png'?png:match[1]==='image/jpeg'?jpeg:webp))throw new ApiError(400,'参考图片内容与格式不匹配，请重新导出为 JPG、PNG 或 WebP');
 return {dataUrl:value,bytes,contentType:match[1]};
}
type CreateOptions={capability:MediaCapability;modelId:string|null;prompt:string;ratio:'1:1'|'3:4'|'4:3'|'16:9'|'9:16';duration:number|null;size:string|null;referenceImage?:string};
function createOptions(body:Record<string,unknown>):CreateOptions{
 if(['model','quality','resolution','profile','imageProfile','n','endpoint','provider','generate_audio','audio','seed','image_urls','video_urls','audio_urls','image_with_roles','return_last_frame','tools','web_search'].some(key=>body[key]!==undefined))throw new ApiError(400,'模型、规格和数量由已开通的服务档位确定');
 if(body.consent!==true)throw new ApiError(400,'请确认将本次提示词发送到所选模型，调用可能产生费用');
 const capability=mediaCapability(body.capability),prompt=field(body.prompt,4000,true),modelId=body.modelId===null?null:field(body.modelId,80,true);
 const ratio=body.ratio===undefined?'1:1':body.ratio;if(!(capability==='image'?['1:1','3:4','4:3','16:9','9:16']:['1:1','16:9','9:16']).includes(String(ratio)))throw new ApiError(400,'画面比例不支持');
 const duration=body.duration===undefined?null:Number(body.duration);if(duration!==null&&(![5,10,15].includes(duration)||capability!=='video'))throw new ApiError(400,'请选择当前视频服务支持的时长');
 if(body.referenceJobId!==undefined)throw new ApiError(400,'请上传本次需要修改的产品图片');
 if(body.referenceImage!==undefined&&capability!=='image')throw new ApiError(400,'参考图片目前仅用于图生图，视频请使用文字描述');
 const referenceImage=body.referenceImage===undefined?undefined:referencePhoto(body.referenceImage).dataUrl;
 const size=body.size===undefined?null:field(body.size,30,true);if(size&&!['2048x2048','2560x1440','1440x2560','1024x1024','1536x1024','1024x1536'].includes(size))throw new ApiError(400,'图片尺寸不支持');
 if(capability==='video'&&size)throw new ApiError(400,'视频请设置比例，不支持图片尺寸');
 return {capability,prompt,modelId,ratio:ratio as CreateOptions['ratio'],duration,size,...(referenceImage?{referenceImage}:{})};
}
function payload(provider:MediaProvider,options:CreateOptions,trusted:TrustedMediaOptions,defaultRatio=false){
 if(options.referenceImage&&(provider.kind!=='apimart'||provider.capability!=='image'||provider.model!=='gpt-image-2.5-flare'))throw new ApiError(400,'当前图片服务暂不支持图生图，请切换到已开通的 APIMart 图片服务');
 const prompt=agricultureMediaPrompt(options.prompt,provider.capability);
 if(provider.kind==='apimart'){
  if(provider.capability==='video'){try{return apimartVideoPayload(provider.model,prompt,defaultRatio?'16:9':options.ratio,options.duration)}catch(error){throw new ApiError(400,error instanceof ApimartProtocolError?error.message:'视频服务档位配置不正确')}}
  if(options.size)throw new ApiError(400,'当前图片规格由服务档位确定，请选择画面比例');
  try{return apimartImagePayload(provider.model,prompt,defaultRatio?'3:4':options.ratio,trusted.imageProfile||'standard')}catch(error){throw new ApiError(400,error instanceof ApimartProtocolError?error.message:'图片服务档位配置不正确')}
 }
 if(provider.capability==='video'&&options.duration===15)throw new ApiError(400,'当前火山方舟视频支持 5 秒或 10 秒');
 if(provider.capability==='video')return {model:provider.model,content:[{type:'text',text:prompt}],ratio:options.ratio,...(options.duration?{duration:options.duration}:{}),watermark:true};
 const sizes=provider.kind==='ark'?{'1:1':'2048x2048','3:4':'1728x2304','4:3':'2304x1728','16:9':'2560x1440','9:16':'1440x2560'}:{'1:1':'1024x1024','3:4':'1024x1536','4:3':'1536x1024','16:9':'1536x1024','9:16':'1024x1536'};
 return {model:provider.model,prompt,size:options.size||sizes[options.ratio],...(provider.kind==='ark'?{response_format:'url',watermark:true}:{n:1})};
}
export async function createMediaJob(user:Actor,body:Record<string,unknown>,trusted:TrustedMediaOptions={}){
 const options=createOptions(body),key=field(body.idempotencyKey,80,true);if(!/^[A-Za-z0-9_-]{16,80}$/.test(key))throw new ApiError(400,'请使用有效的任务幂等标识');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(options))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const existing=await db().prepare('SELECT * FROM media_jobs WHERE user_id=? AND idempotency_key=?').bind(user.id,key).first<JobRow>();
 if(existing){if(existing.request_hash!==hash)throw new ApiError(409,'该任务标识已对应另一份内容，请重新发起创作');await settleMediaEventCredit(existing);return {job:publicJob(existing),created:false};}
 if(await quotaAccount(user.id))return createQuotaMediaJob(user,options,key,hash);
 const profile=trusted.imageProfile||'standard',provider=await providerFor(user,options.capability,options.modelId,profile),requestPayload=payload(provider,options,trusted,body.ratio===undefined);const now=new Date().toISOString(),id=crypto.randomUUID();
 if(eventActivationEnabled()&&!options.modelId&&!user.platformAdmin&&provider.kind!=='apimart')throw new ApiError(503,'体验卡媒体服务尚未配置为本次活动的 APIMart 模型，请联系管理员');
 try{await db().prepare("INSERT INTO media_jobs(id,user_id,capability,idempotency_key,request_hash,prompt,model_name,provider_kind,provider_endpoint,provider_model,key_cipher,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'submitting',?,?)").bind(id,user.id,options.capability,key,hash,options.prompt,provider.name,provider.kind,provider.endpoint,provider.model,provider.keyCipher,now,now).run()}catch(error){const concurrent=await db().prepare('SELECT * FROM media_jobs WHERE user_id=? AND idempotency_key=?').bind(user.id,key).first<JobRow>();if(!concurrent)throw error;if(concurrent.request_hash!==hash)throw new ApiError(409,'该任务标识已对应另一份内容');return {job:publicJob(concurrent),created:false};}
 if(eventActivationEnabled()&&!options.modelId&&!user.platformAdmin){try{if(profile!=='standard')throw new ApiError(403,'当前体验卡不包含高级图片档位');await reserveEventCredit(user.id,{capability:options.capability,profile,requestKey:id,requestHash:hash});}catch(error){await setJob(id,'failed',error instanceof ApiError?error.message:'创作次数暂时不可用');throw error;}}
 try{await reserveMediaCall(user.id,!options.modelId)}catch(error){await setJob(id,'failed',error instanceof ApiError?error.message:'媒体配额暂时不可用');throw error}
 const job=await ownedMediaJob(user.id,id);
 let referenceUrl:string|undefined;
 if(options.referenceImage){
  try{
   const photo=referencePhoto(options.referenceImage),uploaded=await uploadMediaReference(provider,photo.bytes,photo.contentType);
   if(!uploaded.ok){await uploaded.body?.cancel();throw new ApiError(502,uploaded.status===401||uploaded.status===403?'参考图上传被服务商拒绝，请联系管理员检查图片上传权限':uploaded.status===413?'参考图片过大，请缩小后重试':'参考图上传失败，请稍后重新选择图片并提交')}
   const bytes=await boundedBytes(uploaded,16384);let uploadedData:Record<string,unknown>;
   try{uploadedData=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new ApiError(502,'参考图上传响应无效，请稍后重试')}
   const url=safeMediaUrl(uploadedData?.url),parsed=new URL(url);
   if(parsed.hostname!=='upload.apimart.ai'||!parsed.pathname.startsWith('/f/image/')||parsed.hash)throw new ApiError(502,'参考图上传返回了不支持的地址，请联系管理员');
   referenceUrl=url;
  }catch(error){
   // No generation POST has happened. Upload errors never consume an image credit.
   await setJob(id,'failed',(error instanceof ApiError?error.message:'参考图上传未完成，请稍后重试')+'；未提交生图，本次图片额度已释放。');
   return {job:publicJob(await ownedMediaJob(user.id,id)),created:true};
  }
 }
 let response:Response;
 try{response=await mediaFetch(provider,'POST',referenceUrl?{...requestPayload,image_urls:[referenceUrl]}:requestPayload)}catch(error){await setJob(id,'unknown',error instanceof ApiError?error.message:'提交连接失败或超时，是否已计费尚未确认。请先核对服务商控制台，勿重复提交。');return {job:publicJob(await ownedMediaJob(user.id,id)),created:true};}
 if(!response.ok){await response.body?.cancel();const uncertain=provider.kind==='apimart'&&response.status>=500;await setJob(id,uncertain?'unknown':'failed',upstreamError(response.status)+(uncertain?'。提交结果待核对，请勿重复生成。':''),undefined,undefined,provider.keyCipher);return {job:publicJob(await ownedMediaJob(user.id,id)),created:true};}
 try{
  const data=await responseObject(response);
  if(provider.kind==='apimart')await setJob(id,'queued',null,undefined,apimartSubmission(data),provider.keyCipher);
  else if(options.capability==='image')await setJob(id,'succeeded',null,await imageOutputs(job,data),undefined,provider.keyCipher);
  else{if(typeof data.id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(data.id)){await setJob(id,'unknown','视频服务未返回有效任务 ID。请先在服务商控制台核对，勿重复提交。',undefined,undefined,provider.keyCipher)}else await setJob(id,'queued',null,undefined,data.id,provider.keyCipher);}
 }catch(error){await setJob(id,'unknown',`${error instanceof ApiError?error.message:'媒体结果处理失败'}。已调用上游，可能已计费，请先核对服务商控制台，勿重复提交。`,undefined,undefined,provider.keyCipher);}
 return {job:publicJob(await ownedMediaJob(user.id,id)),created:true};
}
function rowProvider(row:JobRow):MediaProvider{if(row.provider_kind==='quota-center')throw new ApiError(500,'创作中心任务不能使用本地供应商凭证');return {capability:row.capability,name:row.model_name,kind:row.provider_kind,endpoint:row.provider_endpoint,model:row.provider_model,keyCipher:row.key_cipher};}

async function createQuotaMediaJob(user:Actor,options:CreateOptions,key:string,hash:string){
 const account=await quotaAccount(user.id);if(!account)throw new ApiError(403,'请先激活创作额度');
 if(options.modelId)throw new ApiError(400,'此激活码使用已开通的创作服务，请选择平台模型');
 const id=crypto.randomUUID(),now=new Date().toISOString(),payload={userId:account.centerUserId,requestId:'media:'+id,capability:options.capability,prompt:agricultureMediaPrompt(options.prompt,options.capability),aspectRatio:options.ratio,...(options.size?{size:options.size}:{}),...(options.capability==='video'?{seconds:options.duration??5}:{}),...(options.referenceImage?{referenceImage:options.referenceImage}:{})};
 const cipher=await encryptQuotaPayload(payload);
 try{await db().prepare("INSERT INTO media_jobs(id,user_id,capability,idempotency_key,request_hash,prompt,model_name,provider_kind,provider_endpoint,provider_model,key_cipher,status,created_at,updated_at,poll_after) VALUES (?,?,?,?,?,?,?,'quota-center','','quota-center',?,'queued',?,?,?)").bind(id,user.id,options.capability,key,hash,options.prompt,options.capability==='image'?'图片生成':'视频生成',cipher,now,now,Date.now()+150000).run();}
 catch(error){const concurrent=await db().prepare('SELECT * FROM media_jobs WHERE user_id=? AND idempotency_key=?').bind(user.id,key).first<JobRow>();if(!concurrent)throw error;if(concurrent.request_hash!==hash)throw new ApiError(409,'该任务标识已对应另一份内容');return {job:publicJob(concurrent),created:false};}
 const row=await ownedMediaJob(user.id,id);
 try{
  const result=verifyQuotaJob(await quotaCenterRequest<QuotaJob>('/generate',payload),account.centerUserId,row.capability);
  await acceptQuotaResult(row,result);
 }catch(error){
  const current=await ownedMediaJob(user.id,id);
  // The center owns the charge. An unknown response is never refunded locally,
  // and a fixed encrypted request can be replayed without another paid call.
  if(current.upstream_id)await quotaJobError(id,'生成已完成或仍在处理中，本站同步暂未完成；稍后刷新原任务即可。');
  else if(error instanceof ApiError&&[400,401,402,403,404,413,429].includes(error.status)){
   await updateQuotaJob(id,'failed',error.message);throw error;
  }else await quotaJobError(id,'正在确认原创作任务，请稍后刷新；不会重复提交付费生成。');
 }finally{await db().prepare('UPDATE media_jobs SET poll_after=? WHERE id=?').bind(Date.now()+5000,id).run();}
 return {job:publicJob(await ownedMediaJob(user.id,id)),created:true};
}
async function quotaJobError(id:string,message:string){await db().prepare("UPDATE media_jobs SET error=?,updated_at=? WHERE id=? AND provider_kind='quota-center' AND status NOT IN ('succeeded','failed')").bind(message,new Date().toISOString(),id).run();}
async function updateQuotaJob(id:string,status:string,error:string|null=null,outputs?:Output[],upstreamId?:string){
 await db().prepare("UPDATE media_jobs SET status=?,error=?,updated_at=?,outputs_json=COALESCE(?,outputs_json),upstream_id=COALESCE(?,upstream_id),key_cipher=CASE WHEN ? IS NOT NULL OR ?='failed' THEN '' ELSE key_cipher END WHERE id=? AND provider_kind='quota-center' AND status NOT IN ('succeeded','failed') AND (status!='saving' OR ? IN ('saving','succeeded'))").bind(status,error,new Date().toISOString(),outputs?JSON.stringify(outputs):null,upstreamId||null,upstreamId||null,status,id,status).run();
}
async function saveQuotaOutput(row:JobRow){
 const account=await quotaAccount(row.user_id);if(!account||!row.upstream_id)throw new ApiError(503,'创作任务暂时无法确认，请联系管理员');
 let outputs:Output[]=[];try{outputs=JSON.parse(row.outputs_json);}catch{}
 if(outputs.length===1&&outputs[0].persisted){await updateQuotaJob(row.id,'succeeded',null,outputs);return;}
 const response=await quotaCenterContent('/generation/'+encodeURIComponent(row.upstream_id)+'/content?userId='+encodeURIComponent(account.centerUserId)+'&index=0');
 if(!response.ok){await response.body?.cancel();throw new ApiError(502,'作品已生成，暂未保存完成；请稍后刷新原任务。');}
 const bytes=await boundedBytes(response,(row.capability==='image'?32:100)*1024*1024);
 const output=await putAsset(row,bytes,row.capability==='image'?imageMime(bytes):videoMime(bytes),0);
 await updateQuotaJob(row.id,'succeeded',null,[output]);
}
async function acceptQuotaResult(row:JobRow,result:QuotaJob){
 if(row.upstream_id&&row.upstream_id!==result.id)throw new ApiError(502,'创作任务标识不一致，请联系管理员核对');
 if(result.status==='succeeded'){
  await updateQuotaJob(row.id,'saving','作品已生成，正在保存',undefined,result.id);
  await saveQuotaOutput(await ownedMediaJob(row.user_id,row.id));
 }else if(result.status==='failed')await updateQuotaJob(row.id,'failed','本次生成失败，创作中心已返还预留次数。',undefined,result.id);
 else if(result.status==='uncertain')await updateQuotaJob(row.id,'unknown','结果待核对，次数仍预留；请保留原任务并联系管理员。',undefined,result.id);
 else await updateQuotaJob(row.id,result.status,null,undefined,result.id);
}
async function pollQuotaMediaJob(row:JobRow){
 if(['succeeded','failed'].includes(row.status))return publicJob(row);
 const lease=Date.now()+150000;
 const claim=await db().prepare("UPDATE media_jobs SET poll_after=? WHERE id=? AND user_id=? AND provider_kind='quota-center' AND status NOT IN ('succeeded','failed') AND poll_after<=? RETURNING id").bind(lease,row.id,row.user_id,Date.now()).first();
 if(!claim)return publicJob(row);
 try{
  row=await ownedMediaJob(row.user_id,row.id);
  const account=await quotaAccount(row.user_id);if(!account)throw new ApiError(403,'创作账户暂时不可用，请联系管理员');
  if(row.status==='saving'){await saveQuotaOutput(row);return publicJob(await ownedMediaJob(row.user_id,row.id));}
  let result:QuotaJob;
  if(row.upstream_id)result=await quotaCenterRequest<QuotaJob>('/generation/'+encodeURIComponent(row.upstream_id)+'?userId='+encodeURIComponent(account.centerUserId));
  else{
   const payload=await decryptQuotaPayload(row.key_cipher);
   if(payload.userId!==account.centerUserId||payload.requestId!=='media:'+row.id||payload.capability!==row.capability)throw new ApiError(409,'原请求身份不一致，请联系管理员核对');
   result=await quotaCenterRequest<QuotaJob>('/generate',payload);
  }
  await acceptQuotaResult(row,verifyQuotaJob(result,account.centerUserId,row.capability));
 }catch(error){
  if(!row.upstream_id&&error instanceof ApiError&&[400,402,413].includes(error.status))await updateQuotaJob(row.id,'failed',error.message);
  else await quotaJobError(row.id,'原任务同步或作品保存暂未完成，请稍后刷新；不会重复生成。');
 }finally{await db().prepare('UPDATE media_jobs SET poll_after=? WHERE id=? AND poll_after=?').bind(Date.now()+5000,row.id,lease).run();}
 return publicJob(await ownedMediaJob(row.user_id,row.id));
}
async function saveApimartOutputs(row:JobRow){
 const label=row.capability==='video'?'视频':'图片';
 let outputs:Output[];try{outputs=JSON.parse(row.outputs_json)}catch{outputs=[]}
 if(outputs.length!==1)throw new ApiError(502,`${label}已生成，结果文件待核对；请刷新原任务，不要重新生成`);
 for(let index=0;index<outputs.length;index++){
  if(outputs[index].persisted)continue;
  const source=outputs[index],url=safeMediaUrl(source.url);
  if(!canPersistHost(url,row.provider_kind))throw new ApiError(502,`${label}已生成，下载域名尚未配置；请联系管理员保存原任务`);
  if(source.expiresAt&&Date.parse(source.expiresAt)<=Date.now())throw new ApiError(502,`${label}已生成，但下载链接已过期；请联系管理员核对原任务`);
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(45000)});
  if(!response.ok){await response.body?.cancel();throw new ApiError(502,`${label}已生成，本站保存暂未完成；稍后刷新将重试下载，不会重新生成`);}
  const bytes=await boundedBytes(response,(row.capability==='video'?100:32)*1024*1024);
  const contentType=row.capability==='image'?imageMime(bytes):videoMime(bytes);
  outputs[index]=await putAsset(row,bytes,contentType,index);
  // Persist each completed file before declaring success; retries only download missing files.
  await setJob(row.id,'saving',null,outputs);
 }
 await setJob(row.id,'succeeded',null,outputs);
}
async function pollApimartJob(row:JobRow){
 const label=row.capability==='video'?'视频':'图片';
 if(!['queued','running','saving'].includes(row.status)||!row.upstream_id)return publicJob(row);
 const lease=Date.now()+120000;
 const claimed=await db().prepare("UPDATE media_jobs SET poll_after=? WHERE id=? AND user_id=? AND status IN ('queued','running','saving') AND poll_after<=? RETURNING id").bind(lease,row.id,row.user_id,Date.now()).first();
 if(!claimed)return publicJob(row);
 try{
  row=await ownedMediaJob(row.user_id,row.id);
  let outputs:Output[]=[];try{outputs=JSON.parse(row.outputs_json)}catch{}
  if(row.status==='saving'&&outputs.length){await saveApimartOutputs(row);return publicJob(await ownedMediaJob(row.user_id,row.id));}
  const response=await mediaFetch(rowProvider(row),'GET',undefined,row.upstream_id!);
  if(!response.ok){await response.body?.cancel();throw new ApiError(502,upstreamError(response.status)+'。原任务已保留，请稍后刷新。');}
  const data=await responseObject(response);
  // Completion must remain durable even if the returned file list cannot yet be parsed.
  const upstream=data.data as Record<string,unknown>|undefined;
  if(data.code===200&&upstream?.id===row.upstream_id&&upstream.status==='completed')await setJob(row.id,'saving',`${label}已生成，正在保存到本站`);
  const task=row.capability==='video'?apimartVideoTask(data,row.upstream_id!):apimartTask(data,row.upstream_id!);
  const files='videos' in task?task.videos:task.images;
  if(task.status==='saving'){
   if(files.length!==1)throw new ApiError(502,`${label}服务返回作品数量与本次请求不符；已保留原任务，请联系管理员`);
   const pending:Output[]=files.map(output=>({url:safeMediaUrl(output.url),persisted:false,...(output.expiresAt?{expiresAt:output.expiresAt,expiresAtSource:'provider' as const}:{})}));
   await setJob(row.id,'saving',`${label}已生成，正在保存到本站`,pending);
   await saveApimartOutputs(await ownedMediaJob(row.user_id,row.id));
  }else if(task.status==='failed')await setJob(row.id,'failed',`${label}生成未完成；服务商返回失败或取消状态，请核对提示后再创建新任务`);
  else await setJob(row.id,task.status);
 }catch(error){
  const message=error instanceof ApiError||error instanceof ApimartProtocolError?error.message:`${label}状态查询或保存暂时失败，原任务已保留；请稍后刷新，不会重新生成`;
  await db().prepare("UPDATE media_jobs SET error=?,updated_at=? WHERE id=? AND status IN ('queued','running','saving')").bind(message,new Date().toISOString(),row.id).run();
 }finally{
  // One bounded GET/download per request. The durable lease also survives process restarts.
  await db().prepare('UPDATE media_jobs SET poll_after=? WHERE id=? AND poll_after=?').bind(Date.now()+5000,row.id,lease).run();
 }
 return publicJob(await ownedMediaJob(row.user_id,row.id));
}
export async function pollMediaJob(userId:string,id:string){
 let row=await ownedMediaJob(userId,id);
 if(row.provider_kind==='quota-center')return pollQuotaMediaJob(row);
 await settleMediaEventCredit(row);
 if(row.provider_kind==='apimart')return pollApimartJob(row);
 if(row.capability!=='video'||!['queued','running'].includes(row.status)||!row.upstream_id)return publicJob(row);
 // One polling client owns the lease for 30 seconds; polling never submits another paid job.
 const claimed=await db().prepare("UPDATE media_jobs SET poll_after=? WHERE id=? AND user_id=? AND status IN ('queued','running') AND poll_after<=? RETURNING id").bind(Date.now()+30000,id,userId,Date.now()).first();if(!claimed)return publicJob(row);
 try{
  const response=await mediaFetch(rowProvider(row),'GET',undefined,row.upstream_id);
  if(!response.ok){await response.body?.cancel();if(response.status===404)await setJob(id,'failed','上游视频任务不存在或已过期，请到服务商控制台核对');else await db().prepare("UPDATE media_jobs SET error=? WHERE id=? AND status IN ('queued','running')").bind(upstreamError(response.status),id).run();return publicJob(await ownedMediaJob(userId,id));}
  const data=await responseObject(response);
  if(data.status==='succeeded'){const content=data.content as {video_url?:unknown}|undefined;try{await setJob(id,'succeeded',null,[await remoteOutput(row,content?.video_url,0)])}catch(error){await setJob(id,'unknown',`${error instanceof ApiError?error.message:'视频结果保存失败'}。上游已完成，请先核对服务商控制台并保存结果，勿重复提交。`);}}
  else if(['failed','cancelled','expired'].includes(String(data.status)))await setJob(id,'failed',data.status==='expired'?'视频任务已超时，请到服务商控制台核对':data.status==='cancelled'?'视频任务已被取消':'视频生成失败，请到服务商控制台检查内容审核、模型权限和配额');
  else if(data.status==='queued'||data.status==='running')await setJob(id,data.status);
  else await db().prepare("UPDATE media_jobs SET error=? WHERE id=? AND status IN ('queued','running')").bind('视频服务返回未知状态，请稍后查询或核对服务商控制台',id).run();
 }catch(error){await db().prepare("UPDATE media_jobs SET error=? WHERE id=? AND status IN ('queued','running')").bind(error instanceof ApiError?error.message:'视频状态查询暂时失败，任务保留，请稍后刷新。',id).run();}
 row=await ownedMediaJob(userId,id);return publicJob(row);
}
// Trusted Node background work only: resume IDs already accepted by APIMart,
// or replay the identical center request under its durable idempotency key.
// It never resubmits an unknown provider POST or changes request ownership.
// The same durable poll lease protects this worker and concurrent browser reads.
export async function reconcilePendingMediaJobs(options:{batchSize?:number;concurrency?:number}={}){
 const bounded=(value:number|undefined,fallback:number,max:number)=>typeof value==='number'&&Number.isInteger(value)&&value>0?Math.min(value,max):fallback;
 const batchSize=bounded(options.batchSize,8,20),concurrency=bounded(options.concurrency,2,4);
 // A process can stop after saving a terminal job but before settling its hold.
 // Reconcile those local records separately; this never retries upstream work.
 let settled=0;
 if(eventActivationEnabled()){
  const terminal=(await db().prepare("SELECT j.* FROM media_jobs j WHERE EXISTS(SELECT 1 FROM event_credit_usage u WHERE u.user_id=j.user_id AND u.request_key=j.id AND ((j.status IN ('succeeded','failed') AND u.status IN ('held','unknown')) OR (j.status='unknown' AND u.status='held'))) ORDER BY j.updated_at,j.id LIMIT ?").bind(batchSize).all<JobRow>()).results;
  for(const row of terminal){await settleMediaEventCredit(row);settled++;}
 }
 const rows=(await db().prepare("SELECT id,user_id FROM media_jobs WHERE capability IN ('image','video') AND ((provider_kind='apimart' AND status IN ('queued','running','saving') AND upstream_id IS NOT NULL) OR (provider_kind='quota-center' AND status IN ('queued','running','saving','unknown'))) AND poll_after<=? ORDER BY poll_after,id LIMIT ?").bind(Date.now(),batchSize).all<{id:string;user_id:string}>()).results;
 let cursor=0,processed=0,failed=0;
 await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async()=>{
  for(;;){const row=rows[cursor++];if(!row)return;
   try{await pollMediaJob(row.user_id,row.id);processed++;}
   catch{failed++;console.error('Media background task could not be reconciled');
    // Give later tasks their turn even when a local settlement/storage error
    // occurred before this task could acquire its upstream polling lease.
    try{await db().prepare('UPDATE media_jobs SET poll_after=? WHERE id=? AND user_id=? AND poll_after<=?').bind(Date.now()+5000,row.id,row.user_id,Date.now()).run();}catch{/* Retry after local storage recovers. */}
   }
  }
 }));
 return {selected:rows.length,processed,failed,settled};
}
export async function mediaAsset(userId:string,id:string,index:number){const job=await ownedMediaJob(userId,id);if(!Number.isInteger(index)||index<0||index>5)throw new ApiError(400,'文件索引不正确');const outputs=JSON.parse(job.outputs_json) as Output[],output=outputs[index];if(!output?.bucketKey||!output.persisted)throw new ApiError(404,'文件尚未保存或不存在');const asset=await mediaBucket().get(output.bucketKey);if(!asset)throw new ApiError(404,'文件不存在或已过期');const ext=output.contentType==='image/jpeg'?'jpg':output.contentType==='image/webp'?'webp':job.capability==='image'?'png':'mp4';return new Response(asset.body,{headers:{'content-type':output.contentType||'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':`inline; filename="${id}.${ext}"`}});}

import {env} from 'cloudflare:workers';
import {ApiError,db,field,type Actor} from './tenancy';
import {allowedHosts,decryptSecret,encryptSecret,encryptionReady} from './ai-config';
import {APIMART_IMAGE_ENDPOINT,APIMART_IMAGE_MODEL,APIMART_VIDEO_ENDPOINT,APIMART_VIDEO_MODEL,apimartTaskUrl,type ApimartImageProfile} from './apimart-protocol';
import {eventActivationEnabled,hasActiveEventEntitlement} from './event-credits';
export type MediaCapability='image'|'video';
export type MediaKind='ark'|'openai-compatible'|'apimart';
export type MediaProvider={capability:MediaCapability;name:string;kind:MediaKind;endpoint:string;model:string;keyCipher:string};
export type MediaConfigRow={capability:MediaCapability;kind:MediaKind;endpoint:string;model:string;key_cipher:string;enabled:number;revision:number;updated_at:string};
export function mediaCapability(value:unknown):MediaCapability{if(value!=='image'&&value!=='video')throw new ApiError(400,'请选择图片或视频能力');return value;}
export function validateMediaKind(value:unknown,capability:MediaCapability):MediaKind{if(!['ark','apimart',...(capability==='image'?['openai-compatible']:[])].includes(String(value)))throw new ApiError(400,capability==='video'?'视频支持 APIMart 或火山方舟任务接口':'图片目前支持火山方舟、APIMart 或 OpenAI Images 兼容接口');return value as MediaKind;}
export function validateMediaEndpoint(value:unknown,capability:MediaCapability,kind:MediaKind){
 const text=field(value,500,true);let url:URL;try{url=new URL(text)}catch{throw new ApiError(400,'请输入完整的 HTTPS 媒体接口地址')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||!allowedHosts().includes(url.hostname))throw new ApiError(400,'服务地址必须为允许域名的 HTTPS 地址，不能含账号、参数或自定义端口');
 if(kind==='apimart'&&url.href!==(capability==='image'?APIMART_IMAGE_ENDPOINT:APIMART_VIDEO_ENDPOINT))throw new ApiError(400,'请使用当前能力对应的 APIMart 官方生成接口');
 if(kind!=='apimart'&&url.hostname==='api.apimart.ai')throw new ApiError(400,'APIMart 媒体使用异步任务，请选择 APIMart 服务类型');
 const expected=capability==='image'?'/images/generations':kind==='apimart'?'/videos/generations':'/contents/generations/tasks';
 if(!url.pathname.endsWith(expected))throw new ApiError(400,`当前能力的地址须以 ${expected} 结尾`);
 if(kind==='ark'&&url.hostname!=='ark.cn-beijing.volces.com')throw new ApiError(400,'火山方舟接口须使用 ark.cn-beijing.volces.com');
 return url.href;
}
export async function mediaConfig(capability:MediaCapability){return db().prepare('SELECT * FROM platform_media_settings WHERE capability=?').bind(capability).first<MediaConfigRow>();}
export function publicMediaConfig(row:MediaConfigRow|null,capability:MediaCapability){return {capability,name:capability==='image'?'平台图片模型':'平台视频模型',kind:row?.kind||'ark',endpoint:row?.endpoint||`https://ark.cn-beijing.volces.com/api/v3/${capability==='image'?'images/generations':'contents/generations/tasks'}`,model:row?.model||'',enabled:!!row?.enabled,hasKey:!!row?.key_cipher,revision:row?.revision||0,updatedAt:row?.updated_at||null,encryptionReady:encryptionReady(),allowedHosts:allowedHosts()};}
export async function saveMediaConfig(body:Record<string,unknown>,userId:string){
 const capability=mediaCapability(body.capability),kind=validateMediaKind(body.kind,capability),endpoint=validateMediaEndpoint(body.endpoint,capability,kind),model=field(body.model,120,true),key=field(body.apiKey,4096),old=await mediaConfig(capability);
 if(kind==='apimart'&&model!==(capability==='image'?APIMART_IMAGE_MODEL:APIMART_VIDEO_MODEL))throw new ApiError(400,'请使用当前能力已开通的 APIMart 模型档位');
 if(body.revision!==(old?.revision||0))throw new ApiError(409,'配置已变化，请刷新后重试');
 if(typeof body.enabled!=='boolean'||typeof body.clearKey!=='boolean'||/[\r\n]/.test(key+model))throw new ApiError(400,'配置格式不正确');
 if(body.clearKey&&key)throw new ApiError(400,'不能同时清除和替换密钥');
 if(old?.key_cipher&&old.endpoint!==endpoint&&!key&&!body.clearKey)throw new ApiError(400,'更换服务地址时必须重新填写对应密钥');
 if(!encryptionReady())throw new ApiError(503,'请先配置服务端 AI 密钥加密主密钥');
 const cipher=body.clearKey?'':key?await encryptSecret(key):old?.key_cipher||'';
 if(body.enabled&&!cipher)throw new ApiError(400,'启用前请填写 API Key');
 const now=new Date().toISOString();
 if(old){const result=await db().prepare('UPDATE platform_media_settings SET kind=?,endpoint=?,model=?,key_cipher=?,enabled=?,revision=revision+1,updated_at=?,updated_by=? WHERE capability=? AND revision=?').bind(kind,endpoint,model,cipher,body.enabled?1:0,now,userId,capability,old.revision).run();if(!result.meta.changes)throw new ApiError(409,'配置已变化，请刷新');}
 else{try{await db().prepare('INSERT INTO platform_media_settings(capability,kind,endpoint,model,key_cipher,enabled,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?)').bind(capability,kind,endpoint,model,cipher,body.enabled?1:0,now,userId).run()}catch(error){if(await mediaConfig(capability))throw new ApiError(409,'配置已变化，请刷新');throw error}}
 return publicMediaConfig(await mediaConfig(capability),capability);
}
export async function platformMediaAllowed(user:Actor,capability:MediaCapability='image',profile:ApimartImageProfile='standard'){
 if(user.platformAdmin)return true;
 if(eventActivationEnabled())return await hasActiveEventEntitlement(user.id,capability,profile);
 return !!await db().prepare("SELECT 1 FROM merchant_memberships mm JOIN merchants m ON m.id=mm.merchant_id WHERE mm.user_id=? AND mm.status='active' AND m.status='active' LIMIT 1").bind(user.id).first();
}
export async function platformMediaProvider(user:Actor,capability:MediaCapability,profile:ApimartImageProfile='standard'):Promise<MediaProvider>{
 if(!await platformMediaAllowed(user,capability,profile))throw new ApiError(403,eventActivationEnabled()?'请先激活包含当前创作能力的有效体验卡':'当前账号没有有效商户归属，不能调用平台媒体模型');
 const row=await mediaConfig(capability);if(!row?.enabled||!row.key_cipher)throw new ApiError(503,`平台${capability==='image'?'图片':'视频'}模型尚未配置或已停用，请联系管理员或配置个人模型`);
 const kind=validateMediaKind(row.kind,capability);return {capability,name:capability==='image'?'平台图片模型':'平台视频模型',kind,endpoint:validateMediaEndpoint(row.endpoint,capability,kind),model:row.model,keyCipher:row.key_cipher};
}
export async function mediaFetch(provider:MediaProvider,method:'GET'|'POST',payload?:unknown,taskId?:string){
 const endpoint=validateMediaEndpoint(provider.endpoint,provider.capability,provider.kind);
 if(taskId&&!/^[a-zA-Z0-9_-]{1,160}$/.test(taskId))throw new ApiError(502,'媒体服务返回的任务标识不正确');
 const url=taskId?(provider.kind==='apimart'?apimartTaskUrl(taskId):`${endpoint}/${encodeURIComponent(taskId)}`):endpoint;
 const init:RequestInit={method,headers:{authorization:`Bearer ${await decryptSecret(provider.keyCipher)}`,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(payload)}:{}),redirect:'manual',signal:AbortSignal.timeout(method==='POST'&&provider.capability==='image'&&provider.kind!=='apimart'?90000:20000)};
 // Tests replace fetch only in their isolated Node process. Production always calls the validated upstream.
 return fetch(url,init);
}
// Reference photos go only to the configured APIMart service, after the job and
// its credit hold exist. Never send the provider key to its public asset CDN.
export async function uploadMediaReference(provider:MediaProvider,bytes:Uint8Array,contentType:string){
 validateMediaEndpoint(provider.endpoint,provider.capability,provider.kind);
 if(provider.kind!=='apimart'||provider.capability!=='image'||provider.model!==APIMART_IMAGE_MODEL)throw new ApiError(400,'当前图片服务暂不支持图生图，请切换到已开通的 APIMart 图片服务');
 const form=new FormData(),extension=contentType==='image/jpeg'?'jpg':contentType==='image/webp'?'webp':'png';
 form.append('file',new Blob([new Uint8Array(bytes)],{type:contentType}),`reference.${extension}`);
 return fetch('https://api.apimart.ai/v1/uploads/images',{method:'POST',headers:{authorization:`Bearer ${await decryptSecret(provider.keyCipher)}`},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});
}
export function mediaBucket(){const bucket=(env as unknown as {BUCKET?:R2Bucket}).BUCKET;if(!bucket)throw new ApiError(503,'媒体文件存储尚未配置');return bucket;}

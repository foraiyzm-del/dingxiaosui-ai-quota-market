import { env } from 'cloudflare:workers';
import { ApiError, db, field } from './tenancy';
import { localAuthEnabled } from './identity';
import { parseUpstreamBody } from './upstream-body';
export type ModelKind='openai-compatible'|'qwen'|'ark';
export type Provider={name:string;model:string;endpoint:string;key:string;kind:ModelKind;jsonMode:boolean};
export class ModelOutcomeUnknownError extends ApiError {constructor(message='模型请求结果待确认，可能已产生费用；请保留原任务，勿重复提交'){super(502,message);}}
export type ConfigRow={id:number;kind:ModelKind;endpoint:string;model:string;key_cipher:string;enabled:number;json_mode:number;revision:number;updated_at:string;updated_by:string};
type Vars={AI_CONFIG_ENCRYPTION_KEY?:string;AI_ALLOWED_HOSTS?:string;AI_TEST_UPSTREAM?:Fetcher};
const vars=()=>env as unknown as Vars;
export function encryptionReady(){return /^[a-f\d]{64}$/i.test(vars().AI_CONFIG_ENCRYPTION_KEY||'')}
async function encryptionKey(){if(!encryptionReady())throw new ApiError(503,'服务端尚未配置 AI 密钥加密主密钥');const bytes=Uint8Array.from(vars().AI_CONFIG_ENCRYPTION_KEY!.match(/../g)!,x=>parseInt(x,16));return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
const encode=(data:Uint8Array)=>btoa(String.fromCharCode(...data));
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function encryptSecret(secret:string){const iv=crypto.getRandomValues(new Uint8Array(12));const value=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('zdx-ai-config-v1')},await encryptionKey(),new TextEncoder().encode(secret));return `v1.${encode(iv)}.${encode(new Uint8Array(value))}`;}
export async function decryptSecret(cipher:string){try{const [version,iv,data,extra]=cipher.split('.');if(version!=='v1'||extra)throw Error();return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:new TextEncoder().encode('zdx-ai-config-v1')},await encryptionKey(),decode(data)));}catch{throw new ApiError(503,'无法解密已保存的 AI 密钥，请检查服务端加密配置或重新设置密钥');}}
const builtInHosts=['api.openai.com','api.deepseek.com','dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','ark.cn-beijing.volces.com','api.siliconflow.cn','api.moonshot.cn','api.apimart.ai'];
export function allowedHosts(){return [...new Set([...builtInHosts,...String(vars().AI_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(x=>/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(x)&&!x.endsWith('.local'))])];}
export function validateEndpoint(value:unknown){
 const endpoint=field(value,500,true);let url:URL;try{url=new URL(endpoint)}catch{throw new ApiError(400,'请输入完整的 HTTPS Chat Completions 接口地址')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||!allowedHosts().includes(url.hostname))throw new ApiError(400,'服务地址必须是允许域名的 HTTPS 地址，不能含账号、查询参数或自定义端口；自定义域名需加入服务端 AI_ALLOWED_HOSTS');
 if(!url.pathname.endsWith('/chat/completions'))throw new ApiError(400,'本轮支持 Chat Completions；地址应以 /chat/completions 结尾');
 return url.href;
}
export async function getConfig(){return db().prepare('SELECT * FROM ai_settings WHERE id=1').first<ConfigRow>();}
export function publicConfig(row:ConfigRow|null){return {kind:row?.kind||'openai-compatible',endpoint:row?.endpoint||'https://api.deepseek.com/chat/completions',model:row?.model||'',enabled:!!row?.enabled,jsonMode:row?!!row.json_mode:true,hasKey:!!row?.key_cipher,revision:row?.revision||0,updatedAt:row?.updated_at||null,encryptionReady:encryptionReady(),allowedHosts:allowedHosts()};}
export async function saveConfig(body:Record<string,unknown>,userId:string){
 const old=await getConfig();if(body.revision!==(old?.revision||0))throw new ApiError(409,'配置已被其他操作修改，请刷新后重试');
 if(!['openai-compatible','qwen','ark'].includes(String(body.kind)))throw new ApiError(400,'接口类型不支持');
 if(typeof body.enabled!=='boolean'||typeof body.jsonMode!=='boolean'||typeof body.clearKey!=='boolean')throw new ApiError(400,'配置格式不正确');
 const endpoint=validateEndpoint(body.endpoint),model=field(body.model,120,true),key=field(body.apiKey,4096);
 if(/[\r\n]/.test(key)||/[\r\n]/.test(model))throw new ApiError(400,'密钥和模型名不能包含换行');
 if(body.clearKey&&key)throw new ApiError(400,'不能同时清除和替换密钥');
 if(old?.endpoint!==endpoint && old?.key_cipher && !key && !body.clearKey)throw new ApiError(400,'更换服务地址时请重新输入对应密钥，避免把原密钥发给另一服务');
 if(!encryptionReady())throw new ApiError(503,'请先配置服务端 AI 密钥加密主密钥');
 const cipher=body.clearKey?'':key?await encryptSecret(key):old?.key_cipher||'';
 if(body.enabled&&!cipher)throw new ApiError(400,'启用前请填写 API Key');
 const now=new Date().toISOString();
 const values=[body.kind,endpoint,model,cipher,body.enabled?1:0,body.jsonMode?1:0,now,userId];
 if(old){const result=await db().prepare('UPDATE ai_settings SET kind=?,endpoint=?,model=?,key_cipher=?,enabled=?,json_mode=?,updated_at=?,updated_by=?,revision=revision+1 WHERE id=1 AND revision=?').bind(...values,old.revision).run();if(!result.meta.changes)throw new ApiError(409,'配置已更新，请刷新');}
 else {try{await db().prepare('INSERT INTO ai_settings(kind,endpoint,model,key_cipher,enabled,json_mode,updated_at,updated_by,id,revision) VALUES (?,?,?,?,?,?,?,?,1,1)').bind(...values).run()}catch(error){if(await getConfig())throw new ApiError(409,'配置已更新，请刷新');throw error}}
 return publicConfig(await getConfig());
}
export async function configProvider(row:ConfigRow):Promise<Provider>{if(!row.key_cipher)throw new ApiError(400,'请先保存 API Key');return {name:'平台配置模型',kind:row.kind,endpoint:validateEndpoint(row.endpoint),model:row.model,key:await decryptSecret(row.key_cipher),jsonMode:!!row.json_mode};}
// Only an explicitly enabled local build may substitute the upstream for tests.
export function usingTestUpstream(){return localAuthEnabled()&&!!vars().AI_TEST_UPSTREAM;}
export async function modelFetch(provider:Provider,payload:unknown){const init:RequestInit={method:'POST',headers:{authorization:`Bearer ${provider.key}`,'content-type':'application/json'},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(60000)};return usingTestUpstream()?vars().AI_TEST_UPSTREAM!.fetch(provider.endpoint,init):fetch(provider.endpoint,init);}
export function modelPayload(provider:Provider,messages:{role:string;content:string}[],limit:number){const payload:Record<string,unknown>={model:provider.model,messages,temperature:.4,stream:false};if(provider.jsonMode)payload.response_format={type:'json_object'};if(provider.kind==='ark'){payload.max_completion_tokens=limit;payload.thinking={type:'disabled'}}else{payload.max_tokens=limit;if(provider.kind==='qwen')payload.enable_thinking=false}return payload;}
export async function requestCompletion(provider:Provider,messages:{role:string;content:string}[],limit:number){
 // Official GPT uses Responses; compatible providers retain their existing protocol.
 const official=provider.endpoint==='https://api.openai.com/v1/chat/completions'&&/^gpt-/.test(provider.model);
 const payload=official?{model:provider.model,input:messages,store:false,max_output_tokens:limit,...(provider.jsonMode?{text:{format:{type:'json_object'}}}:{}),...(/^gpt-[56]/.test(provider.model)?{reasoning:{effort:'low'}}:{})}:modelPayload(provider,messages,limit);
 let response:Response;try{response=await modelFetch(official?{...provider,endpoint:'https://api.openai.com/v1/responses'}:provider,payload)}catch{throw new ModelOutcomeUnknownError()}
 if(response.status>=500){await response.body?.cancel();throw new ModelOutcomeUnknownError(`模型服务返回错误（HTTP ${response.status}），结果待确认；请保留原任务，勿重复提交`);}
 if(!response.ok){const status=response.status;let quota=status===402;try{const data=await response.json() as {error?:{code?:string;type?:string}};quota=quota||['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached','payment_required'].some(code=>data.error?.code===code||data.error?.type===code);}catch{}const service=new URL(provider.endpoint).hostname==='api.apimart.ai'?'APIMart':official?'OpenAI API':'模型服务';throw new ApiError(502,quota?`${service} 额度不足，未生成正文；请联系管理员检查服务商余额。`:status===401||status===403?`${service}拒绝密钥或权限（401/403）`:status===429?`${service}限流或额度不足（429）`:`${service}返回错误（HTTP ${status}）`)}
 if(official){
  const data=await response.json() as {status?:string;output?:{type?:string;content?:{type?:string;text?:string}[]}[]};
  if(data.status==='incomplete')throw new ApiError(502,'GPT 本次输出未完成，未保存为正式初稿；可以缩小任务后重试。');
  const text=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text'&&typeof item.text==='string').map(item=>item.text).join('');
  if(!text.trim())throw new ApiError(502,'GPT 没有返回有效文字内容。');return text;
 }
 try{
  type Completion={choices?:{message?:{content?:string}}[]};
  const data=parseUpstreamBody(await response.text()) as Completion&{code?:number;data?:Completion};
  if(!data||typeof data!=='object'||Array.isArray(data)||data.code!==undefined&&data.code!==200)throw Error();
  // APIMart documents both the standard completion and a code/data envelope.
  // An explicit error envelope must never be mistaken for generated content.
  const completion=data.code===200&&data.data&&typeof data.data==='object'&&!Array.isArray(data.data)?data.data:data;
  const text=completion.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw Error();return text;
 }catch{throw new ApiError(502,'模型响应格式不兼容，未取得有效文字内容')}
}

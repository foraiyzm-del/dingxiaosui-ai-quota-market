import {env} from 'cloudflare:workers';
import {ApiError,actor} from './tenancy';
import {quotaAccount,quotaCenterRequest} from './quota-center';
import {prepareAgricultureText} from './agriculture-policy';

export type QuotaJob={id:string;userId:string;capability:'text'|'image'|'video';status:'queued'|'running'|'succeeded'|'failed'|'uncertain';output?:{text?:string;images?:Array<{url?:string;dataUrl?:string}>;videoUrl?:string;contentAvailable?:boolean}|null;error?:string|null};
export async function currentQuotaAccount(){
 try{return await quotaAccount((await actor()).id);}catch(error){if(error instanceof ApiError&&error.status===401)return null;throw error;}
}
export function verifyQuotaJob(job:QuotaJob,userId:string,capability:QuotaJob['capability']){
 if(!job||typeof job.id!=='string'||!/^[-\w]{1,160}$/.test(job.id)||job.userId!==userId||job.capability!==capability||!['queued','running','succeeded','failed','uncertain'].includes(job.status))throw new ApiError(502,'创作中心任务响应待核对，请保留原任务');
 return job;
}
export async function askQuotaModel(userId:string,instructions:string,input:unknown,outputLimit:number,source:Record<string,unknown>|undefined,rules:{validate?:(output:Record<string,unknown>)=>boolean}={}){
 const account=await quotaAccount(userId);if(!account)throw new ApiError(403,'当前账号未绑定创作额度');
 const requestId=source?.requestId;if(typeof requestId!=='string'||!/^[-\w]{8,80}$/.test(requestId))throw new ApiError(400,'请刷新创作页面后重新提交，当前请求缺少防重复标识');
 const prepared=prepareAgricultureText(instructions,input);
 const job=verifyQuotaJob(await quotaCenterRequest<QuotaJob>('/generate',{
  userId:account.centerUserId,requestId:'text:'+requestId,capability:'text',prompt:'丁小穗文案创作',
  messages:[{role:'system',content:prepared.instructions+'\n仅输出一个有效的 JSON 对象，不要 Markdown 代码块。'},{role:'user',content:JSON.stringify(prepared.input)}],
  responseFormat:'json_object',maxTokens:outputLimit,
 }),account.centerUserId,'text');
 if(job.status==='failed')throw new ApiError(502,'本次文案生成失败，创作中心已返还预留次数。');
 if(job.status!=='succeeded')throw new ApiError(409,job.status==='uncertain'?'本次文案结果待核对，次数仍预留；请保留原请求，不要新建重复生成。':'本次文案仍在处理中，请稍后用原请求重试，不会重复扣次。');
 let output:Record<string,unknown>;try{output=JSON.parse(job.output?.text||'');}catch{throw new ApiError(502,'文案已返回，但内容格式待核对；原任务已保留，请联系管理员，不要重新生成。');}
 if(!output||typeof output!=='object'||Array.isArray(output)||!Object.keys(output).length||rules.validate&&!rules.validate(output))throw new ApiError(502,'文案已返回，但内容不完整；请联系管理员核对原任务，不要重复生成。');
 return {output,provider:'创作中心',model:'quota-center'};
}

// A durable, encrypted request allows safe retry against the center's unique
// (platform, user, requestId) key after an interrupted submission. Reference
// photos and prompts are never logged or exposed through the public job.
const encode=(data:Uint8Array)=>{let result='';for(let i=0;i<data.length;i+=16384)result+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(result);};
const decode=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function payloadKey(){
 const key=(env as unknown as Record<string,string>).AI_CONFIG_ENCRYPTION_KEY;if(!/^[a-f\d]{64}$/i.test(key||''))throw new ApiError(503,'服务端加密配置尚未就绪');
 return crypto.subtle.importKey('raw',Uint8Array.from(key.match(/../g)!,x=>parseInt(x,16)),'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptQuotaPayload(value:Record<string,unknown>){
 const iv=crypto.getRandomValues(new Uint8Array(12)),bytes=new TextEncoder().encode(JSON.stringify(value));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('zdx-quota-request-v1')},await payloadKey(),bytes);
 return 'quota1.'+encode(iv)+'.'+encode(new Uint8Array(cipher));
}
export async function decryptQuotaPayload(value:string):Promise<Record<string,unknown>>{
 try{const [version,iv,cipher,extra]=value.split('.');if(version!=='quota1'||extra)throw Error();const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:new TextEncoder().encode('zdx-quota-request-v1')},await payloadKey(),decode(cipher));return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError(503,'原创作请求暂时无法恢复，请检查服务端加密配置；不会重新扣次。');}
}

import {api,ApiError,json,strictOrigin} from '@/lib/tenancy';
import {endEventSession,eventSessionStatus,startEventSession} from '@/lib/event-session';
export const dynamic='force-dynamic';
export function GET(request:Request){return api(request,async()=>json(await eventSessionStatus(request.headers)));}
export function POST(request:Request){return api(request,async()=>{
 strictOrigin(request);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'请提交 JSON 格式');
 if(Number(request.headers.get('content-length')||0)>512)throw new ApiError(413,'激活信息过长');
 const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'请输入激活码');
 const parts:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512){await reader.cancel();throw new ApiError(413,'激活信息过长');}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 let body:unknown;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError(400,'激活信息格式不正确');}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['code','switchFromAdmin'].includes(key))||!Object.hasOwn(body,'code'))throw new ApiError(400,'激活信息包含不支持的字段');
 const value=body as {code:unknown;switchFromAdmin?:unknown};
 if(value.switchFromAdmin!==undefined&&typeof value.switchFromAdmin!=='boolean')throw new ApiError(400,'请选择有效的身份切换方式');
 return startEventSession(request,value.code,{switchFromAdmin:value.switchFromAdmin===true});
});}
export function DELETE(request:Request){return api(request,()=>endEventSession(request));}

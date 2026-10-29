import {actor,api,field,json,ApiError} from '@/lib/tenancy';
import {createMediaJob,mediaWorkspace,pollMediaJob,MAX_REFERENCE_IMAGE_BYTES} from '@/lib/media-jobs';
export const dynamic='force-dynamic';
// Only this endpoint accepts a bounded reference-photo body. Ordinary workspace
// and configuration JSON limits remain unchanged.
async function mediaInput(request:Request){
 const maximum=MAX_REFERENCE_IMAGE_BYTES/3*4+24000;
 if(Number(request.headers.get('content-length')||0)>maximum)throw new ApiError(413,'参考图片不能超过 6 MB，请缩小图片后重试');
 if(!request.body)throw new ApiError(400,'提交格式不正确');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{})},20000);
 try{for(;;){const {done,value}=await reader.read();if(timedOut)throw new ApiError(408,'图片传输超时，请重新提交');if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new ApiError(413,'参考图片不能超过 6 MB，请缩小图片后重试')}chunks.push(value)}}finally{clearTimeout(timer);reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 const text=new TextDecoder().decode(bytes);let value:unknown;try{value=JSON.parse(text)}catch{throw new ApiError(400,'提交格式不正确')}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'提交格式不正确');
 const body=value as Record<string,unknown>,keys=['capability','modelId','prompt','consent','idempotencyKey','ratio','size','duration','referenceJobId','referenceImage'];
 if(Object.keys(body).some(key=>!keys.includes(key)))throw new ApiError(400,'包含不允许修改的字段');
 if(JSON.stringify({...body,referenceImage:undefined}).length>12000)throw new ApiError(413,'提交文字内容过长');
 return body;
}
export function GET(request:Request){return api(request,async()=>{const user=await actor();const id=new URL(request.url).searchParams.get('id');return json(id?{job:await pollMediaJob(user.id,field(id,80,true))}:await mediaWorkspace(user));});}
export function POST(request:Request){return api(request,async()=>{const user=await actor();const expectedOwner=request.headers.get('x-zdx-media-owner');if(expectedOwner!==null&&expectedOwner!==user.id)throw new ApiError(403,'账号已切换，请刷新后重新选择图片');const body=await mediaInput(request);const result=await createMediaJob(user,body);return json({job:result.job},result.created?201:200);});}

import {actor,api,ApiError,input,json,field} from '@/lib/tenancy';
import {ownedModel,personalProvider,reservePersonalCall} from '@/lib/user-models';
import {requestCompletion} from '@/lib/ai-config';
export const dynamic='force-dynamic';
export function POST(r:Request){return api(r,async()=>{const u=await actor();const b=await input(r,['id','revision','consent']);if(b.consent!==true)throw new ApiError(400,'请确认连接测试');const row=await ownedModel(u.id,field(b.id,80,true));if(row.revision!==b.revision)throw new ApiError(409,'配置已变化，请刷新');if(row.capability!=='text')throw new ApiError(400,'图片和视频请在生图 / 视频工作室提交生成任务验证，提交前会提示额度消耗');await reservePersonalCall(u.id);const reply=await requestCompletion(await personalProvider(row),[{role:'user',content:'Reply with JSON only: {"ok":true}'}],64);let ok=false;try{ok=JSON.parse(reply).ok===true}catch{}if(!ok)throw new ApiError(502,'模型未返回有效 JSON，本工作台需要 JSON 输出');return json({message:'连接及 JSON 格式校验通过'})})}

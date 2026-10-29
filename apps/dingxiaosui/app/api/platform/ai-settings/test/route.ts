import {api,ApiError,input,json,platform} from '@/lib/tenancy';
import {configProvider,getConfig,requestCompletion,usingTestUpstream} from '@/lib/ai-config';
import {reservePilotCall} from '@/lib/ai';
export const dynamic='force-dynamic';
export async function POST(request:Request){return api(request,async()=>{
 await platform();const body=await input(request,['revision','consent']);if(body.consent!==true)throw new ApiError(400,'请确认发送连接测试请求');
 const config=await getConfig();if(!config)throw new ApiError(400,'请先保存配置');if(config.revision!==body.revision)throw new ApiError(409,'配置已变化，请刷新后测试');
 const provider=await configProvider(config);await reservePilotCall();const started=Date.now();
 const reply=await requestCompletion(provider,[{role:'user',content:'Connection check. Reply with the JSON object {"ok":true} only.'}],64);
 let valid=false;try{valid=JSON.parse(reply).ok===true}catch{}
 if(!valid)throw new ApiError(502,'接口已返回内容，但未通过本项目需要的 JSON 格式校验');
 return json({ok:true,model:config.model,latencyMs:Date.now()-started,simulated:usingTestUpstream(),revision:config.revision,message:usingTestUpstream()?'独立本地模拟服务通过；不代表真实模型已连接':'连接及 JSON 响应校验通过'});
})}

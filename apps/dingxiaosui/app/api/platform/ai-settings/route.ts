import {api,input,json,platform} from '@/lib/tenancy';
import {getConfig,publicConfig,saveConfig} from '@/lib/ai-config';
export const dynamic='force-dynamic';
export async function GET(request:Request){return api(request,async()=>{await platform();return json({config:publicConfig(await getConfig())})})}
export async function PUT(request:Request){return api(request,async()=>{const user=await platform();const body=await input(request,['kind','endpoint','model','enabled','jsonMode','apiKey','clearKey','revision']);return json({config:await saveConfig(body,user.id)})})}

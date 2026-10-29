import {api,input,json,platform} from '@/lib/tenancy';
import {mediaConfig,publicMediaConfig,saveMediaConfig} from '@/lib/media-config';
export const dynamic='force-dynamic';
export function GET(request:Request){return api(request,async()=>{await platform();return json({configs:{image:publicMediaConfig(await mediaConfig('image'),'image'),video:publicMediaConfig(await mediaConfig('video'),'video')}});});}
export function PUT(request:Request){return api(request,async()=>{const user=await platform();const body=await input(request,['capability','kind','endpoint','model','apiKey','enabled','clearKey','revision']);return json({config:await saveMediaConfig(body,user.id)});});}

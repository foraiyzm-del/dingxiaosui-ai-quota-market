import {actor,api,field} from '@/lib/tenancy';
import {mediaAsset} from '@/lib/media-jobs';
export const dynamic='force-dynamic';
export function GET(request:Request,context:{params:Promise<{id:string}>}){return api(request,async()=>{const user=await actor();return mediaAsset(user.id,field((await context.params).id,80,true),Number(new URL(request.url).searchParams.get('index')||0));});}

import {actor,api,input,json,field} from '@/lib/tenancy';
import {allowedHosts,encryptionReady} from '@/lib/ai-config';
import {listModels,saveModel,selectModel,deleteModel} from '@/lib/user-models';
export const dynamic='force-dynamic';
export function GET(r:Request){return api(r,async()=>{const u=await actor();return json({...await listModels(u.id),allowedHosts:allowedHosts(),encryptionReady:encryptionReady()})})}
export function POST(r:Request){return api(r,async()=>{const u=await actor();const b=await input(r,['id','name','kind','endpoint','model','apiKey','jsonMode','revision','capability']);return json({id:await saveModel(u.id,b)})})}
export function PUT(r:Request){return api(r,async()=>{const u=await actor();const b=await input(r,['modelId','capability']);await selectModel(u.id,b.modelId===null?null:field(b.modelId,80,true),b.capability);return json({ok:true})})}
export function DELETE(r:Request){return api(r,async()=>{const u=await actor();const b=await input(r,['id']);await deleteModel(u.id,field(b.id,80,true));return json({ok:true})})}

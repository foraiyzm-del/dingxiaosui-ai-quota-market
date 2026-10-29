import { actor,api,json,myMerchants } from "@/lib/tenancy";
export const dynamic="force-dynamic";
export async function GET(request:Request){return api(request,async()=>{const user=await actor(true);return json({user:{id:user.id,displayName:user.displayName},platformAdmin:user.platformAdmin,identityMode:user.identity.provider,merchants:await myMerchants(user.id)})})}

import {api,json,strictOrigin,input,actor} from '@/lib/tenancy';
import {redeemCode} from '@/lib/credits';
import {prepareLegacy} from '@/lib/zlg-legacy';
export async function POST(request:Request){return api(request,async()=>{strictOrigin(request);const body=await input(request,['code']);if(typeof body.code==='string'){const user=await actor();await prepareLegacy(request.headers,true);const redemption=await redeemCode(user.id,body.code);return json({...await prepareLegacy(request.headers,true),redemption:{alreadyRedeemed:redemption.alreadyRedeemed}});}return json(await prepareLegacy(request.headers));});}

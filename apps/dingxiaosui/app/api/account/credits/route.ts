import {centerRequired} from '@/lib/zlg-gateway';
import {actor,api,input,json,ApiError,strictOrigin} from '@/lib/tenancy';
import {creditSummary,redeemCode} from '@/lib/credits';
import {eventActivationEnabled,eventCreditSummary,redeemEventCode} from '@/lib/event-credits';
export const dynamic='force-dynamic';
async function account(request:Request){const user=await actor(),bound=request.headers.get('x-zdx-credit-owner');if(bound&&bound!==user.id)throw new ApiError(403,'账号已改变，请刷新后继续');return user;}
// Preserve the old text balance response while the separate event page exposes
// both buckets and expiry. No automatic welcome grant in event mode.
function compatible(summary:Awaited<ReturnType<typeof eventCreditSummary>>){const text=summary.quotas.find(q=>q.capability==='text')!;return {...summary,mode:'event',available:text.available,reserved:text.reserved,balance:text.available+text.reserved,welcome:{credits:0,status:'not_offered'},entries:summary.entries.filter(row=>row.capability==='text').map(row=>({...row,kind:row.kind==='grant'?'redeem':row.kind}))};}
export function GET(request:Request){return api(request,async()=>{if(centerRequired())throw new ApiError(409,"权益已由智链谷统一中心管理");const user=await account(request);return json(eventActivationEnabled()?compatible(await eventCreditSummary(user.id)):await creditSummary(user.id));});}
export function POST(request:Request){return api(request,async()=>{if(centerRequired())throw new ApiError(409,"权益和激活码已由智链谷统一中心管理，请从统一账户入口操作");const user=await account(request);strictOrigin(request);if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'请提交 JSON 格式');const body=await input(request,['code']);if(eventActivationEnabled()){const result=await redeemEventCode(user.id,body.code);return json({...compatible(result),alreadyRedeemed:result.alreadyRedeemed,credited:result.credited.text,creditedQuotas:result.credited});}return json(await redeemCode(user.id,body.code));});}

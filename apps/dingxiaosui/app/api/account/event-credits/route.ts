import {actor,api,input,json,ApiError,strictOrigin} from '@/lib/tenancy';
import {centerRequired} from '@/lib/zlg-gateway';
import {eventActivationEnabled,eventCreditSummary,redeemEventCode} from '@/lib/event-credits';
import {quotaAccount,quotaCenterEnabled,quotaCreditSummary} from '@/lib/quota-center';
export const dynamic='force-dynamic';
function enabled(){if((!eventActivationEnabled()&&!quotaCenterEnabled())||centerRequired())throw new ApiError(409,'紫丁香独立体验卡尚未启用');}
async function account(request:Request){enabled();const user=await actor(),owner=request.headers.get('x-zdx-credit-owner');if(owner&&owner!==user.id)throw new ApiError(403,'账号已改变，请刷新后继续');return user;}
export function GET(request:Request){return api(request,async()=>{const user=await account(request);return json(await quotaAccount(user.id)?await quotaCreditSummary(user.id):await eventCreditSummary(user.id));});}
export function POST(request:Request){return api(request,async()=>{const user=await account(request);strictOrigin(request);if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'请提交 JSON 格式');const body=await input(request,['code']);if(await quotaAccount(user.id)||typeof body.code==='string'&&body.code.trim().toUpperCase().startsWith('QTA-'))throw new ApiError(409,'请使用“切换激活码”输入购买的卡密，每张卡保留独立的作品空间');return json(await redeemEventCode(user.id,body.code));});}

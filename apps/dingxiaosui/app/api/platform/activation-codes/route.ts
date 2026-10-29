import {centerRequired} from '@/lib/zlg-gateway';
import {platform,api,input,json,ApiError,field,strictOrigin} from '@/lib/tenancy';
import {activationOverview,issueCodes,revokeCodes} from '@/lib/credits';
import {eventActivationEnabled} from '@/lib/event-credits';
export const dynamic='force-dynamic';
export function GET(request:Request){return api(request,async()=>{if(eventActivationEnabled())throw new ApiError(409,"活动体验卡请使用独立体验卡管理 /platform/event-codes");if(centerRequired())throw new ApiError(409,"权益和激活码已由智链谷统一中心管理，请从统一账户入口操作");await platform();return json(await activationOverview(field(new URL(request.url).searchParams.get('batchId')||'',80)));});}
export function POST(request:Request){return api(request,async()=>{if(eventActivationEnabled())throw new ApiError(409,"活动体验卡请使用独立体验卡管理 /platform/event-codes");if(centerRequired())throw new ApiError(409,"权益和激活码已由智链谷统一中心管理，请从统一账户入口操作");const user=await platform();strictOrigin(request);if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'请提交 JSON 格式');const body=await input(request,['action','label','kind','credits','count','amountMinor','expiresAt','requestId','batchId','codeId','planId']);if(body.action==='issue')return json(await issueCodes(user.id,body));if(body.action==='revoke')return json(await revokeCodes(body));throw new ApiError(400,'不支持这项操作');});}

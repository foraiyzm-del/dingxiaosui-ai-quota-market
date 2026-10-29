import {paymentAdapters,recordPaid} from '@/lib/payments';
import {ApiError,json} from '@/lib/tenancy';
export const dynamic='force-dynamic';
// No browser-cookie authorization or origin check: the channel's cryptographic
// verification is mandatory. Unregistered channels always fail closed.
export async function POST(r:Request,context:{params:Promise<{channel:string}>}){
 const {channel}=await context.params;const adapter=paymentAdapters[channel];if(!adapter)return json({error:'支付渠道尚未开通'},503);
 try{if(Number(r.headers.get('content-length')||0)>64000)throw new ApiError(413,'通知过长');const raw=await r.text();if(raw.length>64000)throw new ApiError(413,'通知过长');await recordPaid(channel,await adapter.verifyPaidWebhook(raw,r.headers));return adapter.webhookSuccess();}catch(e){return json({error:e instanceof ApiError?e.message:'支付通知未确认，请由支付渠道重试'},e instanceof ApiError?e.status:503)}
}

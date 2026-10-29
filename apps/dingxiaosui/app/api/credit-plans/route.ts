import catalog from '@/credit-plans.json';
import {api,json} from '@/lib/tenancy';
import {getConfig} from '@/lib/ai-config';
import {env} from 'cloudflare:workers';
import {eventActivationEnabled} from '@/lib/event-credits';
import {launchEventPlan} from '@/lib/event-plans';
import {APIMART_TEXT_ENDPOINT} from '@/lib/apimart-protocol';
export const dynamic='force-dynamic';
export function GET(request:Request){return api(request,async()=>{
 const vars=env as unknown as Record<string,string|undefined>,config=await getConfig();
 const pause=vars.AI_GENERATION_PAUSED_REASON||(config?.endpoint===APIMART_TEXT_ENDPOINT?'':vars.OPENAI_GENERATION_PAUSED_REASON);
 const available=!pause&&(config?!!(config.enabled&&config.key_cipher):!!([vars.OPENAI_API_KEY,vars.ARK_API_KEY,vars.DASHSCOPE_API_KEY,vars.DEEPSEEK_API_KEY].some(value=>value?.trim())));
 const reason=available?'':pause||'平台文字服务暂未开放，请先联系工作人员确认后再使用。';
 if(eventActivationEnabled())return json({plans:[{id:launchEventPlan.id,name:launchEventPlan.label,group:'experience',kind:'gift',credits:10,amountMinor:0,description:'每张含 5 张标准图片和 10 次文案创作，兑换后 7 天有效。'}],mode:'event',eventPlan:launchEventPlan,promotionMonthlyLimit:0,onlinePaymentEnabled:false,service:{available,reason}});
 return json({...catalog,service:{available,reason}});
});}

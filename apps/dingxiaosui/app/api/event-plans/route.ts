import {api,json} from '@/lib/tenancy';
import {eventActivationEnabled} from '@/lib/event-credits';
import {launchEventPlan,eventServiceProfiles} from '@/lib/event-plans';
import {centerRequired} from '@/lib/zlg-gateway';
export const dynamic='force-dynamic';
export function GET(request:Request){return api(request,async()=>json({enabled:eventActivationEnabled()&&!centerRequired(),plan:launchEventPlan,profiles:eventServiceProfiles,onlinePaymentEnabled:false}));}

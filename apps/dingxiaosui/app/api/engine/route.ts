import { aiStatus } from "@/lib/ai";
import {api,json} from '@/lib/tenancy';

export const dynamic = "force-dynamic";
export function GET(request:Request) {return api(request,async()=>{
  const status = await aiStatus();
  return json({ mode: status.mode, provider: status.mode === "model" ? status.provider : null, gated: true, access:status.access });
})}

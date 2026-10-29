import { api,json } from "@/lib/tenancy";
import { publicShop } from "@/lib/public-shop";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{slug:string}>}){return api(request,async()=>{const {slug}=await context.params;const shop=await publicShop(slug);return shop?json({shop}):json({error:"店铺不存在或已停用"},404)})}

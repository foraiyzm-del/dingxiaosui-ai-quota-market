import { api,ApiError,db,field,input,json,member,readShop } from "@/lib/tenancy";
export const dynamic="force-dynamic";
type Context={params:Promise<{merchantId:string;shopId:string}>};
export async function GET(request:Request,context:Context){return api(request,async()=>{const {merchantId,shopId}=await context.params;const user=await member(merchantId);return json({shop:await readShop(merchantId,shopId,user.id),role:user.role})})}
export async function PATCH(request:Request,context:Context){return api(request,async()=>{
 const {merchantId,shopId}=await context.params;const user=await member(merchantId,true);const body=await input(request,["name","description","publicContact"]);
 const name=field(body.name,100,true),description=field(body.description,1200),contact=field(body.publicContact,200);
 const result=await db().prepare(`UPDATE merchant_shops SET name=?,description=?,public_contact=?,updated_at=? WHERE id=? AND merchant_id=? AND EXISTS (
  SELECT 1 FROM merchant_memberships mm JOIN merchants m ON m.id=mm.merchant_id JOIN users u ON u.id=mm.user_id WHERE mm.merchant_id=merchant_shops.merchant_id AND mm.user_id=? AND mm.role='owner' AND mm.status='active' AND m.status='active' AND u.status='active'
 )`).bind(name,description,contact,new Date().toISOString(),shopId,merchantId,user.id).run();
 if(!result.meta.changes)throw new ApiError(403,"店铺不可修改，商户归属或有效状态已变化");return json({ok:true,shop:await readShop(merchantId,shopId,user.id)});
})}

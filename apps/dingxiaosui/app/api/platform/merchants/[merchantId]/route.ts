import { api,ApiError,db,input,json,platform } from "@/lib/tenancy";
export const dynamic="force-dynamic";
export async function PATCH(request:Request,context:{params:Promise<{merchantId:string}>}){return api(request,async()=>{
 await platform();const {merchantId}=await context.params;const body=await input(request,["status"]);
 if(!["active","disabled"].includes(String(body.status)))throw new ApiError(400,"商户状态无效");
 const result=await db().prepare("UPDATE merchants SET status=? WHERE id=?").bind(body.status,merchantId).run();
 if(!result.meta.changes)throw new ApiError(404,"商户不存在");return json({ok:true});
})}

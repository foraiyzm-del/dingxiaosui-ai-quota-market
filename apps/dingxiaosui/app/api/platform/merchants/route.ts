import { api,ApiError,db,field,input,json,platform } from "@/lib/tenancy";
export const dynamic="force-dynamic";
export async function GET(request:Request){return api(request,async()=>{await platform();return json({merchants:(await db().prepare("SELECT m.id,m.name,m.status,s.id AS shopId,s.slug,u.display_name AS ownerName FROM merchants m JOIN merchant_shops s ON s.merchant_id=m.id JOIN merchant_memberships mm ON mm.merchant_id=m.id AND mm.role='owner' JOIN users u ON u.id=mm.user_id ORDER BY m.created_at DESC").all()).results})})}
export async function POST(request:Request){return api(request,async()=>{
 const admin=await platform(),body=await input(request,["name","slug","ownerUserId"]);
 const name=field(body.name,100,true),slug=field(body.slug,64,true),owner=field(body.ownerUserId,80,true);
 if(!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug))throw new ApiError(400,"公开地址需为 3—64 位小写字母、数字或中划线");
 const known=await db().prepare("SELECT u.id FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE u.id=? AND u.status='active' AND i.verified_at<>''").bind(owner).first();
 if(!known)throw new ApiError(400,"负责人必须先完成可信登录，不能手填未知身份绑定");
 if(await db().prepare("SELECT id FROM merchant_shops WHERE slug=?").bind(slug).first())throw new ApiError(409,"店铺公开地址已被使用");
 const id=crypto.randomUUID(),shopId=crypto.randomUUID(),now=new Date().toISOString();
 try{await db().batch([
  db().prepare("INSERT INTO merchants(id,name,status,created_by,created_at) VALUES (?,?,'active',?,?)").bind(id,name,admin.id,now),
  db().prepare("INSERT INTO merchant_memberships(merchant_id,user_id,role,status,created_at) VALUES (?,?,'owner','active',?)").bind(id,owner,now),
  db().prepare("INSERT INTO merchant_shops(id,merchant_id,slug,name,description,public_contact,updated_at) VALUES (?,?,?,?,'','',?)").bind(shopId,id,slug,name,now),
 ]);}catch(error){if(await db().prepare("SELECT id FROM merchant_shops WHERE slug=?").bind(slug).first())throw new ApiError(409,"店铺公开地址已被使用");throw error;}
 return json({id,shopId,slug},201);
})}

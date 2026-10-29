import { api,db,json,platform } from "@/lib/tenancy";
export const dynamic="force-dynamic";
export async function GET(request:Request){return api(request,async()=>{await platform();return json({users:(await db().prepare("SELECT u.id,u.display_name AS displayName,i.provider,i.verified_at AS verifiedAt FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE u.status='active' ORDER BY u.created_at LIMIT 200").all()).results})})}

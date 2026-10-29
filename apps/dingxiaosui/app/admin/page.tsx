import { identityReady, localAuthEnabled, platformIdentity } from "@/lib/identity";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import AdminClient from "./admin-client";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getChatGPTUser();
  if(!identityReady())return <main className="admin-gate"><h1>内容与社群管理中心</h1><p>生产登录可信边界尚未确认，管理入口暂未启用。现有内容和数据保持不变。</p></main>;
  if (!user) return <main className="admin-gate"><div className="gate-mark">✿</div><span>紫丁香计划 / ADMIN</span><h1>内容与社群管理中心</h1><p>请使用已授权的管理员账号登录，管理官网展示和社区内容。</p><a href={localAuthEnabled()?"/local-login":"/login"} target="_top">登录账号</a><small>官网内容可公开浏览；只有平台管理员能够保存后台修改。</small></main>;
  if (!platformIdentity(user)) return <main className="admin-gate"><div className="gate-mark">✿</div><span>紫丁香计划 / ADMIN</span><h1>当前账号暂无管理权限</h1><p>商户角色不包含平台内容管理权限。</p><a href={localAuthEnabled()?"/local-login":"/login"}>登录其他账号</a></main>;
  return <AdminClient email={user.email} localTest={localAuthEnabled()} />;
}

import { getChatGPTUser } from "@/app/chatgpt-auth";
import { identityReady, platformIdentity } from "@/lib/identity";
import { actor } from "@/lib/tenancy";

export async function getAdmin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  if (!platformIdentity(user)) return null;
  // Recheck the local account status for every request, including old sessions.
  await actor(true);
  return user;
}

export function unavailable() {
  return Response.json({ error: "后台存储尚未就绪" }, { status: 503 });
}

export function forbidden() {
  if(!identityReady()) return Response.json({error:"生产登录可信边界尚未确认，管理入口暂未启用"},{status:503});
  return Response.json({ error: "请使用授权管理员账号登录" }, { status: 403 });
}

export function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function safeUrl(value: unknown, max = 500) {
  const url = clean(value, max);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try { return new URL(url).protocol === "https:" ? url : ""; } catch { return ""; }
}

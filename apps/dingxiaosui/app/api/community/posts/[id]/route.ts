import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
async function hashToken(token:string) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function DELETE(request:Request, context:{params:Promise<{id:string}>}) {
  if (!env.DB) return Response.json({ error:"社区暂时无法连接" }, { status:503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error:"帖子编号无效" }, { status:400 });
  let input:Record<string,unknown>;
  try { input=await request.json(); } catch { return Response.json({ error:"提交内容格式不正确" }, { status:400 }); }
  const token=typeof input.ownerToken==="string" ? input.ownerToken.slice(0,100) : "";
  if (token.length<24) return Response.json({ error:"仅原发布浏览器可以删除此帖" }, { status:403 });
  try {
    const row=await env.DB.prepare("SELECT owner_hash FROM community_posts WHERE id=?").bind(id).first<{owner_hash:string}>();
    if (!row) return Response.json({ error:"帖子不存在" }, { status:404 });
    if (!row.owner_hash || row.owner_hash!==await hashToken(token)) return Response.json({ error:"仅原发布浏览器可以删除此帖" }, { status:403 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM community_replies WHERE post_id=?").bind(id),
      env.DB.prepare("DELETE FROM community_posts WHERE id=?").bind(id),
    ]);
    return Response.json({ ok:true });
  } catch {
    return Response.json({ error:"删除失败，请稍后重试" }, { status:503 });
  }
}

import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const clean = (value:unknown, max:number) => typeof value === "string" ? value.trim().slice(0,max) : "";

export async function POST(request:Request, context:{params:Promise<{id:string}>}) {
  if (!env.DB) return Response.json({ error:"社区暂时无法连接" }, { status:503 });
  const { id:postId } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(postId)) return Response.json({ error:"帖子编号无效" }, { status:400 });
  let input:Record<string,unknown>;
  try { input=await request.json(); } catch { return Response.json({ error:"提交内容格式不正确" }, { status:400 }); }
  const author=clean(input.author,24), body=clean(input.body,1200);
  if (!author || body.length<2 || input.ack!==true) return Response.json({ error:"请填写称呼和回复内容" }, { status:400 });
  try {
    const post=await env.DB.prepare("SELECT status FROM community_posts WHERE id=?").bind(postId).first<{status:string}>();
    if (!post || post.status!=="published") return Response.json({ error:"帖子不存在或尚未公开" }, { status:404 });
    const id=crypto.randomUUID(), createdAt=new Date().toISOString();
    await env.DB.prepare("INSERT INTO community_replies (id,post_id,author,body,status,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id,postId,author,body,"published",createdAt).run();
    return Response.json({ reply:{ id,author,body,createdAt } }, { status:201 });
  } catch {
    return Response.json({ error:"回复失败，请稍后重试" }, { status:503 });
  }
}

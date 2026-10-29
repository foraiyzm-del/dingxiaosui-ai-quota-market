import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const categories = new Set(["内容创作","本地营销","OPC 经营","系统使用","山西风物"]);
const kinds = new Set(["discussion","article"]);
const clean = (value:unknown, max:number) => typeof value === "string" ? value.trim().slice(0,max) : "";
async function hashToken(token:string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,"0")).join("");
}

export async function POST(request:Request) {
  if (!env.DB) return Response.json({ error:"社区暂时无法连接" }, { status:503 });
  let input:Record<string,unknown>;
  try { input = await request.json(); } catch { return Response.json({ error:"提交内容格式不正确" }, { status:400 }); }
  const author=clean(input.author,24), province=clean(input.province,24), title=clean(input.title,90), body=clean(input.body,6000);
  const category=clean(input.category,24), kind=clean(input.kind,16), ownerToken=clean(input.ownerToken,100);
  if (!author || !title || body.length<20 || !categories.has(category) || !kinds.has(kind) || ownerToken.length<24 || input.ack!==true) {
    return Response.json({ error:"请填好称呼、标题和至少 20 字正文，并确认资料可分享" }, { status:400 });
  }
  try {
    const id=crypto.randomUUID(), createdAt=new Date().toISOString(), ownerHash=await hashToken(ownerToken);
    await env.DB.prepare("INSERT INTO community_posts (id,kind,author,province,title,body,category,owner_hash,status,is_featured,is_pinned,created_at,reviewed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,kind,author,province,title,body,category,ownerHash,"pending",0,0,createdAt,"").run();
    return Response.json({ post:{ id,kind,author,province,title,body,category,createdAt,status:"pending",replies:[] }, message:"已提交审核，审核通过后公开" }, { status:202 });
  } catch {
    return Response.json({ error:"内容提交失败，请稍后重试" }, { status:503 });
  }
}

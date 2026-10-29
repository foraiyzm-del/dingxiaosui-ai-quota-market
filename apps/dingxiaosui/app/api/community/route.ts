import { env } from "cloudflare:workers";
import seed from "@/public/community-seed.json";

export const dynamic = "force-dynamic";

type PostRow = { id:string; kind:string; category:string; title:string; body:string; author:string; province:string; created_at:string; is_featured:number; is_pinned:number };
type ReplyRow = { id:string; post_id:string; author:string; body:string; created_at:string };

export async function GET() {
  if (!env.DB) return Response.json({ error:"社区暂时无法连接" }, { status:503 });
  try {
    const [postResult, replyResult] = await Promise.all([
      env.DB.prepare("SELECT id,kind,category,title,body,author,province,created_at,is_featured,is_pinned FROM community_posts WHERE status='published' ORDER BY is_pinned DESC,is_featured DESC,created_at DESC LIMIT 120").all<PostRow>(),
      env.DB.prepare("SELECT id,post_id,author,body,created_at FROM community_replies WHERE status='published' ORDER BY created_at ASC LIMIT 1000").all<ReplyRow>(),
    ]);
    const replies = new Map<string, Array<{id:string;author:string;body:string;createdAt:string}>>();
    for (const row of replyResult.results || []) {
      const items = replies.get(row.post_id) || [];
      items.push({ id:row.id, author:row.author, body:row.body, createdAt:row.created_at });
      replies.set(row.post_id, items);
    }
    const published = (postResult.results || []).map(row => ({
      id:row.id, kind:row.kind, category:row.category, title:row.title, body:row.body,
      author:row.author, province:row.province, createdAt:row.created_at,
      featured:!!row.is_featured, pinned:!!row.is_pinned, replies:replies.get(row.id) || [],
    }));
    return Response.json({ posts:[...published, ...seed.posts.slice().reverse()] }, { headers:{ "Cache-Control":"no-store" } });
  } catch {
    return Response.json({ error:"社区暂时无法读取" }, { status:503 });
  }
}

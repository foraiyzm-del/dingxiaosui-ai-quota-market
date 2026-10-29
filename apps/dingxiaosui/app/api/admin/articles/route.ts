import { api } from "@/lib/tenancy";
import { env } from "cloudflare:workers";
import { clean, forbidden, getAdmin, safeUrl, unavailable } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return api(request, async () => {
  const admin = await getAdmin();
  if (!admin) return forbidden();
  if (!env.DB) return unavailable();
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: "内容格式不正确" }, { status: 400 }); }
  const id = clean(input.id, 80) || crypto.randomUUID();
  const type = ["news", "guide", "document"].includes(String(input.type)) ? String(input.type) : "news";
  const title = clean(input.title, 160), body = clean(input.body, 50000);
  if (!title || !body) return Response.json({ error: "标题和正文不能为空" }, { status: 400 });
  const status = input.status === "published" ? "published" : "draft";
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO articles (id,type,title,summary,body,cover_url,source_url,status,created_at,updated_at,published_at,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,summary=excluded.summary,body=excluded.body,cover_url=excluded.cover_url,source_url=excluded.source_url,status=excluded.status,updated_at=excluded.updated_at,published_at=excluded.published_at,updated_by=excluded.updated_by`)
      .bind(id,type,title,clean(input.summary,500),body,safeUrl(input.coverUrl),safeUrl(input.sourceUrl),status,now,now,status === "published" ? now : null,admin.email).run();
    return Response.json({ ok: true, id });
  } catch { return unavailable(); }
  });
}

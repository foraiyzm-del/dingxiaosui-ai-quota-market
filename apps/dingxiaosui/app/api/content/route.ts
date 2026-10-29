import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!env.DB) return Response.json({ settings: {}, articles: [] }, { status: 503 });
  try {
    const [settings, articles] = await Promise.all([
      env.DB.prepare("SELECT key, value FROM site_settings").all(),
      env.DB.prepare("SELECT id, type, title, summary, body, cover_url AS coverUrl, source_url AS sourceUrl, published_at AS publishedAt FROM articles WHERE status = ? ORDER BY published_at DESC LIMIT 60").bind("published").all(),
    ]);
    return Response.json({ settings: Object.fromEntries((settings.results || []).map((x: any) => [x.key, x.value])), articles: articles.results || [] }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch {
    return Response.json({ error: "内容暂时无法读取" }, { status: 503 });
  }
}

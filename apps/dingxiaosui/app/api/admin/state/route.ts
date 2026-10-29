import { api } from "@/lib/tenancy";
import { env } from "cloudflare:workers";
import { forbidden, getAdmin, unavailable } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return api(request, async () => {
  const admin = await getAdmin();
  if (!admin) return forbidden();
  if (!env.DB) return unavailable();
  try {
    const [settings, articles, posts, media] = await Promise.all([
      env.DB.prepare("SELECT key, value, updated_at AS updatedAt FROM site_settings").all(),
      env.DB.prepare("SELECT * FROM articles ORDER BY updated_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT * FROM community_posts ORDER BY created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT id, name, mime, size, created_at AS createdAt FROM media_files ORDER BY created_at DESC LIMIT 100").all(),
    ]);
    return Response.json({ admin: { email: admin.email }, settings: Object.fromEntries((settings.results || []).map((x: any) => [x.key, x.value])), articles: articles.results || [], posts: posts.results || [], media: media.results || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return unavailable(); }
  });
}

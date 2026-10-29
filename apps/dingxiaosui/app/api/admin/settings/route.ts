import { api } from "@/lib/tenancy";
import { env } from "cloudflare:workers";
import { clean, forbidden, getAdmin, safeUrl, unavailable } from "@/lib/admin";

export const dynamic = "force-dynamic";
const keys = new Set(["hero_title", "hero_description", "hero_image", "logo_image", "mission_text", "opc_message"]);

export async function PUT(request: Request) {
  return api(request, async () => {
  const admin = await getAdmin();
  if (!admin) return forbidden();
  if (!env.DB) return unavailable();
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "内容格式不正确" }, { status: 400 }); }
  const rows = Object.entries(input && typeof input === "object" && !Array.isArray(input) ? input : {}).filter(([key]) => keys.has(key));
  if (!rows.length) return Response.json({ error: "没有可保存的内容" }, { status: 400 });
  const now = new Date().toISOString();
  try {
    await env.DB.batch(rows.map(([key, raw]) => env.DB!.prepare("INSERT INTO site_settings (key,value,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(key, key.endsWith("_image") ? safeUrl(raw) : clean(raw, key === "hero_title" ? 80 : 1200), now, admin.email)));
    return Response.json({ ok: true });
  } catch { return unavailable(); }
  });
}

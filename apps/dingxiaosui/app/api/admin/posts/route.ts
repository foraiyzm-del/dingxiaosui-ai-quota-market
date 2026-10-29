import { api } from "@/lib/tenancy";
import { env } from "cloudflare:workers";
import { clean, forbidden, getAdmin, unavailable } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  return api(request, async () => {
  const admin = await getAdmin();
  if (!admin) return forbidden();
  if (!env.DB) return unavailable();
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: "内容格式不正确" }, { status: 400 }); }
  const id = clean(input.id, 80);
  const status = ["pending", "published", "hidden"].includes(String(input.status)) ? String(input.status) : "pending";
  if (!id) return Response.json({ error: "帖子编号缺失" }, { status: 400 });
  try {
    const result = await env.DB.prepare("UPDATE community_posts SET status=?,is_featured=?,is_pinned=?,reviewed_at=?,reviewed_by=? WHERE id=?")
      .bind(status, input.isFeatured === true ? 1 : 0, input.isPinned === true ? 1 : 0, new Date().toISOString(), admin.email, id).run();
    return Response.json({ ok: true, changed: result.meta.changes });
  } catch { return unavailable(); }
  });
}

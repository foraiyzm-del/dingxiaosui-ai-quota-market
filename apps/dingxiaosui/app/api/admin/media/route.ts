import { api } from "@/lib/tenancy";
import { env } from "cloudflare:workers";
import { forbidden, getAdmin, unavailable } from "@/lib/admin";

export const dynamic = "force-dynamic";
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);

export async function POST(request: Request) {
  return api(request, async () => {
  const admin = await getAdmin();
  if (!admin) return forbidden();
  if (!env.BUCKET || !env.DB) return unavailable();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size > (file.type.startsWith("image/") ? 5_000_000 : 20_000_000)) {
    return Response.json({ error: "请选择 5 MB 以下图片或 20 MB 以下 PDF/DOCX 文件" }, { status: 400 });
  }
  const id = crypto.randomUUID(), key = `${file.type.startsWith("image/") ? "images" : "documents"}/${id}`;
  try {
    await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    await env.DB.prepare("INSERT INTO media_files (id,storage_key,name,mime,size,created_at,created_by) VALUES (?,?,?,?,?,?,?)")
      .bind(id,key,file.name.slice(0,180),file.type,file.size,new Date().toISOString(),admin.email).run();
    return Response.json({ id, url: `/media/${id}`, name: file.name });
  } catch {
    await env.BUCKET.delete(key).catch(() => {});
    return unavailable();
  }
  });
}

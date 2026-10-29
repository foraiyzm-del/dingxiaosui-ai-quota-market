import { env } from "cloudflare:workers";
import { getAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!env.DB || !env.BUCKET) return new Response("Unavailable", { status: 503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare("SELECT storage_key AS key,mime,name FROM media_files WHERE id=?").bind(id).first<{key:string;mime:string;name:string}>();
  if (!row) return new Response("Not found", { status: 404 });
  if (!row.mime.startsWith("image/") && !await getAdmin()) return new Response("Forbidden", { status: 403 });
  const object = await env.BUCKET.get(row.key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": row.mime, "Cache-Control": row.mime.startsWith("image/") ? "public, max-age=3600" : "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

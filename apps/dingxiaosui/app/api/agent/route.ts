import { api } from "@/lib/tenancy";
import { askModel, clean, readAiRequest } from "@/lib/ai";

export const dynamic = "force-dynamic";
const kinds = new Set(["daily","video","live","followup","stock"]);
export async function POST(request: Request) { return api(request, async () => {
  const input = await readAiRequest(request, 16000);
  if (input instanceof Response) return input;
  const kind = clean(input.kind,20), context = clean(input.context,600);
  if (!kinds.has(kind) || context.length < 8) return Response.json({ error: "请填写具体经营问题。" }, { status: 400 });
  const product = input.product && typeof input.product === "object" ? input.product as Record<string, unknown> : {};
  if (!clean(product.name,80)) return Response.json({ error: "请先选择真实农品。" }, { status: 400 });
  const facts = Object.fromEntries(["name","origin","abv","supplier","shelfLife","summary","sellingPoints","occasions"].map(key => [key,clean(product[key],600)]));
  const verified = Array.isArray(input.verified) ? input.verified.slice(0,3).map(x => clean(x,500)) : [];
  const steps = Array.isArray(input.steps) ? input.steps.slice(0,5).map(x => clean(x,500)) : [];
  try {
    const answer = await askModel("你是紫丁香计划的农品经营行动助手。依据用户输入的商品资料、库存与已核实知识，把本地三步清单细化成今天可执行的工作方案。用户录入资料不等于官方认证。分清已知事实、缺失信息和待审表达；库存已到提醒线时先稳供货，不建议集中促销。不编造功效、认证、价格、库存、交付时间或客户评价。不要声称自动发布或已联系客户。返回 JSON 对象 {\"body\":\"详细、可编辑的中文行动方案\"}。", { kind, context, product:facts, verified, steps, stock:clean(input.stock,120), review:clean(input.review,600), minutes:Number(input.minutes)||45 }, 2300, input, {validate:output=>typeof output.body==='string'&&!!output.body.trim()});
    const body = clean(answer.output.body,8000);
    if (!body) throw new Error("模型返回方案不完整。");
    return Response.json({ body, provider: answer.provider });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "经营方案生成失败。" }, { status: 502 }); }
});}

import { actor, api } from "@/lib/tenancy";
import { askModel, clean, readAiRequest } from "@/lib/ai";
import { getWorkspace } from "@/lib/workspace";
import { selectPrivateKnowledge, privateKnowledgeRules } from "@/lib/shanxi-knowledge";

export const dynamic = "force-dynamic";
const channels = new Set(["朋友圈","小红书","视频号","知乎","抖音","公众号","线下海报","会客厅导购卡","包装文案"]);
export async function POST(request: Request) { return api(request, async () => {
  const input = await readAiRequest(request, 14000);
  if (input instanceof Response) return input;
  const product = input.product && typeof input.product === "object" ? input.product as Record<string, unknown> : {};
  const brief = input.brief && typeof input.brief === "object" ? input.brief as Record<string, unknown> : {};
  const selected = Array.isArray(input.channels) ? [...new Set(input.channels.filter((x): x is string => typeof x === "string" && channels.has(x)))].slice(0,9) : [];
  if (!clean(product.name,80) || !clean(product.summary,500) || !clean(brief.topic,120) || !selected.length) return Response.json({ error: "请补齐农品、主题和渠道。" }, { status: 400 });
  const facts = Object.fromEntries(["name","category","abv","price","origin","supplier","shelfLife","summary","sellingPoints","occasions"].map(key => [key, clean(product[key], key === "sellingPoints" ? 700 : 500)]));
  const task = Object.fromEntries(["scene","goal","topic","audience","facts","cta","positioning","personality"].map(key => [key, clean(brief[key], key === "facts" ? 1600 : 300)]));
  const workspace=await getWorkspace((await actor()).id);
  const knowledge=selectPrivateKnowledge(workspace.entries,[task.topic,task.goal,task.facts,facts.name,facts.summary].join('\n'),{taskId:'moments',productId:clean(product.id,100),productName:facts.name});
  try {
    const answer = await askModel("你是紫丁香计划的山西农品内容编辑。商品信息来自经营者录入，视为待核实资料。仅使用提供的事实，不捏造价格、产地、认证、功效、库存、优惠、客户评价或销售成果。包装文案需标记法定信息待核实。为每个渠道分别写适合的标题和正文。返回 JSON 对象，格式为 {\"drafts\":[{\"channel\":\"...\",\"title\":\"...\",\"body\":\"...\"}]}，每个指定渠道恰好一条。\n"+privateKnowledgeRules, { product: facts, brief: task, channels: selected, privateKnowledge:knowledge.passages,knowledgeDecision:{status:knowledge.status,reason:knowledge.reason} }, 4800, input, {units:selected.length,validate:output=>Array.isArray(output.drafts)&&output.drafts.length===selected.length&&new Set(output.drafts.map(row=>row?.channel)).size===selected.length&&output.drafts.every(row=>row&&selected.includes(row.channel)&&typeof row.title==='string'&&!!row.title.trim()&&typeof row.body==='string'&&!!row.body.trim())});
    const rows = answer.output.drafts;
    if (!Array.isArray(rows) || rows.length !== selected.length) throw new Error("模型返回的渠道数量不完整。");
    const seen = new Set<string>();
    const drafts = rows.map((row: unknown) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const channel = clean(item.channel,20), title = clean(item.title,150), body = clean(item.body,8000);
      if (!selected.includes(channel) || seen.has(channel) || !title || !body) throw new Error("模型返回内容不完整。");
      seen.add(channel); return { channel, title, body };
    });
    return Response.json({ drafts, provider: answer.provider, model: answer.model,knowledge:{status:knowledge.status,reason:knowledge.reason,sources:knowledge.sources} });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "生成失败。" }, { status: 502 }); }
});}

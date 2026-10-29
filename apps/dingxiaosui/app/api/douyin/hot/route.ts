import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type HotTopic = { title:string; hotLevel:number; activeTime:string; source:"douyin-official" };
let tokenCache: { value:string; until:number } | null = null;
let topicCache: { topics:HotTopic[]; activeTime:string; until:number } | null = null;

const officialDocs = "https://open.douyin.com/platform/resource/docs/openapi/data-open-service/hot-video-data/get-current-hot-words/";
const response = (body:Record<string,unknown>, status=200) => Response.json(body, {
  status,
  headers:{ "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" },
});

async function clientToken(key:string, secret:string) {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.value;
  const body = new FormData();
  body.set("client_key", key);
  body.set("client_secret", secret);
  body.set("grant_type", "client_credential");
  const result = await fetch("https://open.douyin.com/oauth/client_token/", {
    method:"POST", body, signal:AbortSignal.timeout(9000),
  });
  if (!result.ok) throw new Error("抖音授权服务暂时不可用");
  const payload = await result.json() as { data?:{ access_token?:string; expires_in?:number; error_code?:number; description?:string } };
  if (Number(payload.data?.error_code) !== 0 || !payload.data?.access_token) throw new Error("抖音应用授权未通过，请检查应用和权限");
  tokenCache = { value:payload.data.access_token, until:Date.now()+Math.max(60, Number(payload.data.expires_in || 7200)-300)*1000 };
  return tokenCache.value;
}

export async function GET() {
  const key = String(env.DOUYIN_CLIENT_KEY || "").trim();
  const secret = String(env.DOUYIN_CLIENT_SECRET || "").trim();
  if (!key || !secret) return response({ configured:false, topics:[], source:"抖音开放平台", docs:officialDocs, message:"官方热点接口待开通。可从抖音热点榜核对后手动录入。" });
  if (topicCache && topicCache.until > Date.now()) return response({ configured:true, topics:topicCache.topics, activeTime:topicCache.activeTime, source:"抖音开放平台 hotsearch", docs:officialDocs });
  try {
    const token = await clientToken(key, secret);
    const result = await fetch("https://open.douyin.com/hotsearch/sentences/", {
      headers:{ "access-token":token, "Content-Type":"application/json" },
      signal:AbortSignal.timeout(9000),
    });
    if (!result.ok) throw new Error("抖音热点接口暂时不可用");
    const payload = await result.json() as { data?:{ error_code?:number; description?:string; active_time?:string; list?:Array<{ sentence?:string; hot_level?:number }> } };
    if (Number(payload.data?.error_code) !== 0) throw new Error("热点权限尚未开通或调用失败");
    const activeTime = String(payload.data?.active_time || "").slice(0, 30);
    const topics = (payload.data?.list || []).slice(0, 30).map(item => ({
      title:String(item.sentence || "").trim().slice(0, 80),
      hotLevel:Math.max(0, Number(item.hot_level || 0)),
      activeTime,
      source:"douyin-official" as const,
    })).filter(item => item.title);
    topicCache = { topics, activeTime, until:Date.now()+15*60*1000 };
    return response({ configured:true, topics, activeTime, source:"抖音开放平台 hotsearch", docs:officialDocs });
  } catch (error) {
    return response({ configured:true, topics:[], source:"抖音开放平台 hotsearch", docs:officialDocs, message:error instanceof Error?error.message:"热点暂时无法读取" }, 503);
  }
}

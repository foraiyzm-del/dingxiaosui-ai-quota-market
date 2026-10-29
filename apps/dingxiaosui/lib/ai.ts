import {centerRequired,verifiedZlgIdentity,type ZlgIdentity} from './zlg-gateway';
import { env } from "cloudflare:workers";
import { configProvider,getConfig,requestCompletion,ModelOutcomeUnknownError,type Provider } from './ai-config';
import { actor,ApiError,db } from './tenancy';
import {selectedPersonalModel,personalProvider,reservePersonalCall} from './user-models';
import {reserveTextCredit,releaseTextCredit,completeTextCredit,digest} from './credits';
import {prepareAgricultureText} from './agriculture-policy';
import {eventActivationEnabled,reserveEventCredit,completeEventCredit,releaseEventCredit,markEventCreditUnknown} from './event-credits';
import {APIMART_TEXT_ENDPOINT,APIMART_TEXT_MODEL} from './apimart-protocol';
import {quotaCenterEnabled,quotaAccount} from './quota-center';
import {askQuotaModel,currentQuotaAccount} from './quota-generation';

type Vars = Record<string, string | undefined>;
type UsageStatement = { run: () => Promise<unknown>; first: () => Promise<unknown>; bind: (...args: unknown[]) => UsageStatement };
type UsageDb = { prepare: (sql: string) => UsageStatement };
const vars = env as unknown as Vars;
const requestGateway=new WeakMap<object,ZlgIdentity>();
const requestModels=new WeakMap<object,Awaited<ReturnType<typeof selectedPersonalModel>>>();
const clean = (value: unknown, max = 1000) => typeof value === "string" ? value.trim().slice(0, max) : "";
// A historical OpenAI balance pause must not disable the separately configured
// APIMart account. AI_GENERATION_PAUSED_REASON remains a platform-wide stop.
function pauseReason(endpoint?:string){return vars.AI_GENERATION_PAUSED_REASON||(endpoint===APIMART_TEXT_ENDPOINT?'':vars.OPENAI_GENERATION_PAUSED_REASON)||'';}
function localOpenAI():Provider|null {
  if(vars.LOCAL_OPENAI_ENABLED!=='1'||vars.PASSWORD_AUTH_ENABLED!=='1'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(vars.APP_ORIGIN||'')||!vars.OPENAI_API_KEY?.trim())return null;
  return {name:'GPT · '+(vars.OPENAI_MODEL?.trim()||'gpt-6.1-sol'),model:vars.OPENAI_MODEL?.trim()||'gpt-6.1-sol',endpoint:'https://api.openai.com/v1/chat/completions',key:vars.OPENAI_API_KEY.trim(),kind:'openai-compatible',jsonMode:true};
}

function environmentProviders(): Provider[] {
  const local=localOpenAI();if(local)return [local];
  const list: Provider[] = [];
  if (vars.DASHSCOPE_API_KEY?.trim()) list.push({
    name: "千问 Flash", model: vars.QWEN_MODEL?.trim() || "qwen3.7-flash",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    key: vars.DASHSCOPE_API_KEY.trim(), kind: "qwen", jsonMode:true,
  });
  if (vars.ARK_API_KEY?.trim()) list.push({
    name: "豆包 Seed Mini", model: vars.ARK_MODEL?.trim() || "doubao-seed-2-0-mini-260428",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    key: vars.ARK_API_KEY.trim(), kind: "ark", jsonMode:true,
  });
  if (vars.DEEPSEEK_API_KEY?.trim()) list.push({
    name: "DeepSeek Flash", model: vars.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    endpoint: "https://api.deepseek.com/chat/completions",
    key: vars.DEEPSEEK_API_KEY.trim(), kind: "openai-compatible", jsonMode:true,
  });
  const preferred = vars.AI_PROVIDER?.trim()==='deepseek'?'openai-compatible':vars.AI_PROVIDER?.trim();
  const ordered = preferred ? [...list].sort((a,b) => Number(b.kind === preferred) - Number(a.kind === preferred)) : list;
  // 试用阶段绝不在免费额度耗尽时悄悄切换到另一家付费模型。
  return vars.AI_ALLOW_PAID_FALLBACK === "true" ? ordered : ordered.slice(0, 1);
}

export async function aiStatus() {
  const quota=await currentQuotaAccount();
  if(quota){const ready=quotaCenterEnabled()&&!vars.AI_GENERATION_PAUSED_REASON;return {mode:ready?'model':'template',provider:'创作中心',access:'quota_center',creditSource:'quota_center',modelReady:ready,pilotReady:false,reason:vars.AI_GENERATION_PAUSED_REASON||(!ready?'创作中心尚未配置，请联系管理员':'')};}
  const personal=await selectedPersonalModel();
  if(personal)return {mode:'model',provider:personal.row.name,access:'personal',modelReady:true,pilotReady:false};
  // Preserve the platform pause on HTTPS deployments as well as loopback previews.
  const config=await getConfig();
  const paused=pauseReason(config?.endpoint);
  if(paused){await actor();return {mode:'template',provider:null,access:'account',modelReady:false,pilotReady:false,reason:paused};}
  if(config)return {mode:config.enabled&&config.key_cipher?'model':'template',provider:config.enabled?'平台配置模型':null,access:'account',modelReady:!!config.key_cipher,pilotReady:false};
  const local=localOpenAI();if(local){await actor();const reason=vars.OPENAI_GENERATION_PAUSED_REASON||'';return {mode:reason?'template':'model',provider:local.name,access:'local-openai',modelReady:true,pilotReady:false,reason};}
  const list = environmentProviders();
  const pilotReady = (vars.AI_PILOT_CODE?.trim().length || 0) >= 16;
  return { mode: list.length && pilotReady ? "model" : "template", provider: list[0]?.name || null,
    pilotReady, modelReady: Boolean(list.length),access:'pilot' };
}

async function equalSecret(a: string, b: string) {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export async function readAiRequest(request: Request, maxLength: number): Promise<Record<string, unknown> | Response> {
  const personal=await selectedPersonalModel();
  const status=await aiStatus();
  if((status.access==='personal')!==!!personal)throw new ApiError(409,'默认模型刚刚改变，请重试');
  if (status.mode !== "model") return Response.json({ error: ('reason' in status && status.reason) || "在线模型尚未配置或已停用，当前可继续查询和整理资料。" }, { status: 503 });
  if(status.access==='account'||status.access==='quota_center'){
    await actor();
  }else if(status.access==='local-openai'){
    await actor();
  }else if(status.access!=='personal'){
  const provided = request.headers.get("x-zdx-pilot-code") || "";
  if (!provided || provided.length > 120 || !await equalSecret(provided, vars.AI_PILOT_CODE!.trim())) {
    return Response.json({ error: "请输入有效的试用邀请码。" }, { status: 401 });
  }
  }
  if (Number(request.headers.get("content-length") || 0) > maxLength) return Response.json({ error: "输入内容过长。" }, { status: 413 });
  const text = await request.text();
  if (text.length > maxLength) return Response.json({ error: "输入内容过长。" }, { status: 413 });
  let data: unknown;
  try { data = JSON.parse(text); } catch { return Response.json({ error: "请求格式不正确。" }, { status: 400 }); }
  if (!data || typeof data !== "object" || Array.isArray(data) || (data as Record<string, unknown>).consent !== true) {
    return Response.json({ error: "请先确认将本次资料发送至模型服务。" }, { status: 400 });
  }
  if(centerRequired()){const gateway=await verifiedZlgIdentity(request.headers);if(!gateway)throw new ApiError(401,"请先登录智链谷统一账户");requestGateway.set(data,gateway);}
  requestModels.set(data,personal);
  return data as Record<string, unknown>;
}

export async function askModel(instructions: string, input: unknown, outputLimit: number, source?:Record<string,unknown>,rules:{validate?:(output:Record<string,unknown>)=>boolean;units?:number}={}) {
  const quotaUser=await actor(),quota=await quotaAccount(quotaUser.id);
  if(quota){if(vars.AI_GENERATION_PAUSED_REASON)throw new ApiError(503,vars.AI_GENERATION_PAUSED_REASON);return askQuotaModel(quotaUser.id,instructions,input,outputLimit,source,rules);}
  const personal=source&&requestModels.has(source)?requestModels.get(source):await selectedPersonalModel();
  const config=personal?null:await getConfig();
  if(!personal&&pauseReason(config?.endpoint))throw new ApiError(503,pauseReason(config?.endpoint));
  const user=await actor();
  if(config&&!config.enabled)throw new ApiError(503,'平台模型已停用');
  const list=personal?[await personalProvider(personal.row)]:config?[await configProvider(config)]:environmentProviders();
  if(!list.length)throw new ApiError(503,'文字模型尚未配置');
  const prepared=prepareAgricultureText(instructions,input);
  const managed=centerRequired();
  const event=eventActivationEnabled()&&!personal;
  if(event&&managed)throw new ApiError(503,'活动独立账户与统一账户中心不能同时启用，请联系管理员检查配置');
  if(event&&(list[0].endpoint!==APIMART_TEXT_ENDPOINT||list[0].model!==APIMART_TEXT_MODEL))throw new ApiError(503,'请先在平台 AI 服务中启用活动标准文案模型 DeepSeek V4.1 Flash');
  if(event&&source?.profile!==undefined&&source.profile!=='standard')throw new ApiError(403,'本体验卡不包含此模型档位');
  if(managed&&!personal&&(!source||!requestGateway.get(source)?.billingManaged))throw new ApiError(403,"请先通过统一权益中心确认本次费用");
  const requestKey=clean(source?.requestId,80),requestHash=await digest(JSON.stringify({instructions:prepared.instructions,input:prepared.input,model:list[0].model,units:event?1:rules.units||1}));
  if(event&&!user.platformAdmin&&!/^[\w-]{8,80}$/.test(requestKey))throw new ApiError(400,'请刷新创作页面后重新提交，当前请求缺少防重复标识');
  // One requested series is one text creation; its multiple channels are not
  // charged separately. An administrator's explicit test uses provider balance.
  const eventHold=event&&!user.platformAdmin?await reserveEventCredit(user.id,{capability:'text',profile:'standard',requestKey:'text:'+requestKey,requestHash}):null;
  if(eventHold?.cached){const cached=eventHold.cached as {output?:Record<string,unknown>;provider?:string;model?:string};if(!cached.output||typeof cached.provider!=='string'||typeof cached.model!=='string')throw new ApiError(409,'此任务已由管理员核实结算，请联系工作人员获取结果，不会重复生成或扣次');return cached as {output:Record<string,unknown>;provider:string;model:string};}
  const hold=personal||managed||event?null:await reserveTextCredit(user.id,requestKey||crypto.randomUUID(),requestHash,rules.units||1);
  if(hold?.cached)return hold.cached;
  let outcomeUnknown=false;
  try {
  if(personal)await reservePersonalCall(personal.userId);else await reservePilotCall();
  let lastError = "模型服务暂时不可用。";
  for (const provider of list) {
    try {
      const raw=await requestCompletion(provider,[
          { role: "system", content: `${prepared.instructions}\n仅输出一个有效的 JSON 对象，不要 Markdown 代码块。` },
          { role: "user", content: JSON.stringify(prepared.input) },
        ],outputLimit);
      const output = JSON.parse(raw) as Record<string, unknown>;
      if(!output||typeof output!=='object'||Array.isArray(output)||!Object.keys(output).length||rules.validate&&!rules.validate(output))throw new ApiError(502,'模型返回内容不完整，本次未扣创作次数。');
      const result={output,provider:provider.name,model:provider.model};
      if(eventHold){outcomeUnknown=true;await completeEventCredit(user.id,eventHold.id,result);outcomeUnknown=false;return result;}
      return hold?await completeTextCredit(user.id,hold.id,result):result;
    } catch (error) {
      if(error instanceof ModelOutcomeUnknownError){outcomeUnknown=true;throw error;}
      // Once a card reserves a request, never switch silently to a different
      // paid provider after an ambiguous or malformed result.
      if(event)throw error;
      console.error("AI provider request failed", provider.name, error instanceof Error ? error.name : "unknown");
      lastError = error instanceof ApiError ? error.message : "模型返回的内容格式不正确，未生成有效结果。";
    }
  }
  throw new ApiError(502,lastError);
  } catch(error){if(eventHold){if(outcomeUnknown)await markEventCreditUnknown(user.id,eventHold.id);else await releaseEventCredit(user.id,eventHold.id);}if(hold)await releaseTextCredit(user.id,hold.id);throw error;}
}

export async function reservePilotCall() {
  const db = (env as unknown as { DB?: UsageDb }).DB;
  // 没有持久化配额表时不开放计费模型，避免重启后额度归零。
  if (!db) throw new Error("试用配额服务尚未就绪，请稍后重试。");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS ai_pilot_usage (period TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)").run();
    const event=eventActivationEnabled();
    const configured=(name:string,fallback:number,max:number)=>{const value=Number(vars[name]);return Number.isSafeInteger(value)&&value>0&&value<=max?value:fallback;};
    for (const [period, limit] of [[`day:${day}`, configured('AI_PLATFORM_DAILY_LIMIT',event?1000:60,100000)], [`month:${month}`, configured('AI_PLATFORM_MONTHLY_LIMIT',event?10000:1000,1000000)]] as const) {
      const row = await db.prepare("INSERT INTO ai_pilot_usage(period, used) VALUES (?1, 1) ON CONFLICT(period) DO UPDATE SET used = used + 1 WHERE used < ?2 RETURNING used").bind(period, limit).first();
      if (!row) throw new Error("今日或本月试用额度已用完，请联系管理员。");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("额度已用完")) throw error;
    console.error("AI pilot quota unavailable", error instanceof Error ? error.name : "unknown");
    throw new Error("试用配额服务尚未就绪，请稍后重试。");
  }
}

export { clean };

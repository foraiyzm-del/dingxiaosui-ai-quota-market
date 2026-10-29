import {ApiError,db,field} from './tenancy';
import catalog from '../credit-plans.json';

const now=()=>new Date().toISOString();
function promotionWindow(at=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(at),year=Number(parts.find(p=>p.type==='year')!.value),month=Number(parts.find(p=>p.type==='month')!.value);return {period:`${year}-${String(month).padStart(2,'0')}`,start:new Date(Date.UTC(year,month-1,1)-28800000).toISOString(),end:new Date(Date.UTC(year,month,1)-28800000).toISOString()};}
const giftAllocation="COALESCE((SELECT SUM(b.credits) FROM activation_batches b JOIN activation_codes c ON c.batch_id=b.id WHERE b.kind='gift' AND c.status!='revoked' AND b.created_at>=? AND b.created_at<?),0)+COALESCE((SELECT SUM(delta) FROM text_credit_ledger WHERE kind='welcome' AND created_at>=? AND created_at<?),0)";
const experienceIds=catalog.plans.filter(plan=>plan.group==='experience').map(plan=>plan.id);
const experienceQuery=`SELECT 1 FROM activation_codes c JOIN activation_batches b ON b.id=c.batch_id WHERE c.redeemed_by=? AND b.plan_id IN (${experienceIds.map(()=>'?').join(',')})`;
export async function promotionBudget(){const period=promotionWindow();const row=await db().prepare('SELECT '+giftAllocation+' AS allocated').bind(period.start,period.end,period.start,period.end).first<{allocated:number}>();return {period:period.period,limit:catalog.promotionMonthlyLimit,allocated:row?.allocated||0,remaining:Math.max(0,catalog.promotionMonthlyLimit-(row?.allocated||0))};}
export async function ensureWelcomeCredit(userId:string){
 if(await db().prepare('SELECT 1 FROM zlg_legacy_exports WHERE user_id=?').bind(userId).first())return;
 const plan=catalog.plans.find(plan=>plan.id==='trial-5')!;
 const time=now(),period=promotionWindow(new Date(time));
 // The unique partial index and this single INSERT serialize claims across processes/devices.
 // Existing experience-code recipients keep their balance without an extra welcome grant.
 await db().prepare("INSERT INTO text_credit_ledger(id,user_id,delta,kind,note,created_at) SELECT ?,?,?,'welcome',?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM text_credit_ledger WHERE user_id=? AND kind='welcome') AND NOT EXISTS("+experienceQuery+") AND "+giftAllocation+"+?<=? ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),userId,plan.credits,'新客免费体验 · 每账号一次',time,userId,userId,userId,...experienceIds,period.start,period.end,period.start,period.end,plan.credits,catalog.promotionMonthlyLimit).run();
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
const integer=(value:unknown,max:number,min=1)=>{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw new ApiError(400,'次数、数量或金额超出允许范围');return Number(value);};
async function expireHolds(userId:string){await db().prepare("UPDATE text_credit_usage SET status='refunded',completed_at=? WHERE user_id=? AND status='held' AND expires_at<=?").bind(now(),userId,now()).run();}
export async function creditBalance(userId:string){
 await ensureWelcomeCredit(userId);await expireHolds(userId);
 const value=await db().prepare("SELECT COALESCE((SELECT SUM(delta) FROM text_credit_ledger WHERE user_id=?),0) AS balance,COALESCE((SELECT SUM(units) FROM text_credit_usage WHERE user_id=? AND status='held'),0) AS reserved").bind(userId,userId).first<{balance:number;reserved:number}>();
 return {balance:value?.balance||0,reserved:value?.reserved||0,available:(value?.balance||0)-(value?.reserved||0)};
}
export async function creditSummary(userId:string){const balance=await creditBalance(userId);const experienced=await db().prepare("SELECT 1 FROM text_credit_ledger WHERE user_id=? AND kind='welcome' UNION ALL "+experienceQuery).bind(userId,userId,...experienceIds).first();return {ownerId:userId,...balance,welcome:{credits:5,status:experienced?'received':'budget_limited'},entries:(await db().prepare('SELECT id,delta,kind,note,created_at AS createdAt FROM text_credit_ledger WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(userId).all()).results};}
export async function issueCodes(userId:string,body:Record<string,unknown>){
 const planId=field(body.planId||'',80),plan=planId?catalog.plans.find(row=>row.id===planId):null;
 if(planId&&!plan)throw new ApiError(400,'套餐不存在，请重新选择');
 if(plan)body={...body,kind:plan.kind,credits:plan.credits,amountMinor:plan.amountMinor,label:body.label||plan.name};
 const label=field(body.label,80,true),kind=body.kind;if(kind!=='paid'&&kind!=='gift')throw new ApiError(400,'请选择售卖或赠送');
 const credits=integer(body.credits,100000),count=integer(body.count,100),amount=kind==='gift'?0:integer(body.amountMinor,100000000,0);
 const requestKey=field(body.requestId,80,true);if(!/^[\w-]{8,80}$/.test(requestKey))throw new ApiError(400,'请重新打开发码页面');
 let expires:string|null=null;if(body.expiresAt){const value=field(body.expiresAt,40,true),date=new Date(value);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw new ApiError(400,'兑换截止时间须晚于当前时间');expires=date.toISOString();}
 async function previous(){
  const existing=await db().prepare('SELECT id,created_by,label,kind,credits,code_count,amount_minor,expires_at,plan_id FROM activation_batches WHERE request_key=?').bind(requestKey).first<{id:string;created_by:string;label:string;kind:string;credits:number;code_count:number;amount_minor:number;expires_at:string|null;plan_id:string|null}>();
  if(!existing)return null;
  if(existing.created_by!==userId||existing.label!==label||existing.kind!==kind||existing.credits!==credits||existing.code_count!==count||existing.amount_minor!==amount||existing.expires_at!==expires||(existing.plan_id||'')!==planId)throw new ApiError(409,'发码请求标识已用于其他内容，请重新提交');
  return {batchId:existing.id,codes:[] as string[],alreadyCreated:true};
 }
 const existing=await previous();if(existing)return existing;
 const id=crypto.randomUUID(),created=now(),codes:{id:string;code:string;hash:string;hint:string}[]=[];
 for(let i=0;i<count;i++){const raw=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();const code='ZDX-'+raw.match(/.{8}/g)!.join('-');codes.push({id:crypto.randomUUID(),code,hash:await digest('ZDX'+raw),hint:raw.slice(-6)});}
 const period=promotionWindow(new Date(created));
 try{const issued=await db().batch([
  db().prepare("INSERT INTO activation_batches(id,request_key,label,kind,credits,code_count,amount_minor,expires_at,created_by,created_at,plan_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ?='paid' OR "+giftAllocation+"+?<=?").bind(id,requestKey,label,kind,credits,count,amount,expires,userId,created,planId||null,kind,period.start,period.end,period.start,period.end,credits*count,catalog.promotionMonthlyLimit),
  ...codes.map(code=>db().prepare('INSERT INTO activation_codes(id,batch_id,code_hash,code_hint) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM activation_batches WHERE id=?)').bind(code.id,id,code.hash,code.hint,id)),
 ]);if(!issued[0].meta.changes)throw new ApiError(400,`本月赠点预算不足，最多发放 ${catalog.promotionMonthlyLimit} 点。请减少数量或先作废本月未兑换码。`);}catch(error){const replay=await previous();if(replay)return replay;throw error;}
 return {batchId:id,codes:codes.map(({code})=>code),alreadyCreated:false};
}
export async function activationOverview(batchId=''){
 const batches=(await db().prepare("SELECT b.id,b.label,b.kind,b.credits,b.code_count AS codeCount,b.amount_minor AS amountMinor,b.expires_at AS expiresAt,b.created_at AS createdAt,SUM(CASE WHEN c.status='redeemed' THEN 1 ELSE 0 END) AS redeemed,SUM(CASE WHEN c.status='revoked' THEN 1 ELSE 0 END) AS revoked FROM activation_batches b JOIN activation_codes c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC LIMIT 50").all()).results;
 const codes=batchId?(await db().prepare('SELECT c.id,c.code_hint AS hint,c.status,c.redeemed_at AS redeemedAt,u.display_name AS redeemedBy FROM activation_codes c LEFT JOIN users u ON u.id=c.redeemed_by WHERE c.batch_id=? ORDER BY c.id').bind(batchId).all()).results:[];
 return {batches,codes,promotion:await promotionBudget()};
}
export async function revokeCodes(body:Record<string,unknown>){
 const batchId=field(body.batchId||'',80),codeId=field(body.codeId||'',80);if(!batchId&&!codeId)throw new ApiError(400,'请选择需要作废的未兑换码');
 const result=await db().prepare("UPDATE activation_codes SET status='revoked' WHERE status='active' AND "+(codeId?'id=?':'batch_id=?')).bind(codeId||batchId).run();
 return {revoked:result.meta.changes};
}
export async function redeemCode(userId:string,value:unknown){
 const raw=field(value,100,true).replace(/[\s-]/g,'').toUpperCase();
 const window=Math.floor(Date.now()/900000),key=`code-redeem:${userId}:${window}`;
 const attempt=await db().prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<10 RETURNING count').bind(key,Date.now()+900000).first();
 if(!attempt)throw new ApiError(429,'兑换尝试较多，请 15 分钟后再试');
 if(!/^ZDX[A-F0-9]{32}$/.test(raw))throw new ApiError(400,'激活码格式不正确，请完整复制后再试');
 const hash=await digest(raw),code=await db().prepare('SELECT c.id,c.status,c.redeemed_by,b.expires_at,b.credits,b.plan_id FROM activation_codes c JOIN activation_batches b ON b.id=c.batch_id WHERE c.code_hash=?').bind(hash).first<{id:string;status:string;redeemed_by:string|null;expires_at:string|null;credits:number;plan_id:string|null}>();
 if(!code)throw new ApiError(400,'激活码不存在，请核对后再试');
 if(code.status==='redeemed'){if(code.redeemed_by===userId)return {alreadyRedeemed:true,credited:0,...await creditSummary(userId)};throw new ApiError(409,'这个激活码已被兑换');}
 if(code.status==='revoked'||(code.expires_at&&code.expires_at<=now()))throw new ApiError(400,'这个激活码已作废或超过兑换期限');
 const basic=code.plan_id==='trial-5';
 const experiences=basic?experienceIds:experienceIds.filter(id=>id!=='trial-5'),experience=experienceIds.includes(code.plan_id||'');
 const claimQuery=(basic?"SELECT 1 FROM text_credit_ledger WHERE user_id=? AND kind='welcome' UNION ALL ":'')+`SELECT 1 FROM activation_codes c JOIN activation_batches b ON b.id=c.batch_id WHERE c.redeemed_by=? AND b.plan_id IN (${experiences.map(()=>'?').join(',')})`;
 if(experience&&await db().prepare(claimQuery).bind(...(basic?[userId]:[]),userId,...experiences).first())throw new ApiError(409,'当前账号已领取过这类体验点，不能重复领取。活动与合作体验每账号限兑一种。');
 const receipt=crypto.randomUUID(),time=now();
 const result=await db().batch([
  db().prepare("UPDATE activation_codes SET status='redeemed',redeemed_by=?,redeemed_at=?,receipt_id=? WHERE id=? AND status='active' AND EXISTS (SELECT 1 FROM activation_batches b WHERE b.id=activation_codes.batch_id AND (b.expires_at IS NULL OR b.expires_at>?)) AND (?=0 OR NOT EXISTS ("+claimQuery+"))").bind(userId,time,receipt,code.id,time,experience?1:0,...(basic?[userId]:[]),userId,...experiences),
  db().prepare("INSERT INTO text_credit_ledger(id,user_id,delta,kind,code_id,note,created_at) SELECT ?,?,b.credits,'redeem',c.id,b.label,? FROM activation_codes c JOIN activation_batches b ON b.id=c.batch_id WHERE c.id=? AND c.receipt_id=? AND c.redeemed_by=?").bind(crypto.randomUUID(),userId,time,code.id,receipt,userId),
 ]);
 if(!result[0].meta.changes){const current=await db().prepare('SELECT redeemed_by FROM activation_codes WHERE id=?').bind(code.id).first<{redeemed_by:string|null}>();if(current?.redeemed_by===userId)return {alreadyRedeemed:true,credited:0,...await creditSummary(userId)};throw new ApiError(409,'激活码状态已改变，未重复入账');}
 return {alreadyRedeemed:false,credited:code.credits,...await creditSummary(userId)};
}
type GenerationResult={output:Record<string,unknown>;provider:string;model:string};
type Usage={id:string;request_hash:string;status:string;result_json:string|null};
export async function reserveTextCredit(userId:string,requestKey:string,hash:string,units=1):Promise<{id:string;cached?:GenerationResult}>{
 integer(units,9);await ensureWelcomeCredit(userId);await expireHolds(userId);
 const old=await db().prepare('SELECT id,request_hash,status,result_json FROM text_credit_usage WHERE user_id=? AND request_key=?').bind(userId,requestKey).first<Usage>();
 if(old){if(old.request_hash!==hash)throw new ApiError(409,'本次请求标识已用于其他内容');if(old.status==='succeeded'&&old.result_json)return {id:old.id,cached:JSON.parse(old.result_json)};throw new ApiError(409,old.status==='held'?'这份内容正在生成，请勿重复提交':'上次生成未完成且未扣点，请重新发送需求');}
 const id=crypto.randomUUID(),time=now(),expires=new Date(Date.now()+600000).toISOString();
 const held=await db().prepare("INSERT INTO text_credit_usage(id,user_id,request_key,request_hash,units,status,created_at,expires_at) SELECT ?,?,?,?,?,'held',?,? WHERE COALESCE((SELECT SUM(delta) FROM text_credit_ledger WHERE user_id=?),0)-COALESCE((SELECT SUM(units) FROM text_credit_usage WHERE user_id=? AND status='held'),0)>=? ON CONFLICT(user_id,request_key) DO NOTHING RETURNING id").bind(id,userId,requestKey,hash,units,time,expires,userId,userId,units).first();
 if(!held){if(await db().prepare('SELECT 1 FROM text_credit_usage WHERE user_id=? AND request_key=?').bind(userId,requestKey).first())throw new ApiError(409,'这份内容正在处理，请勿重复提交');throw new ApiError(402,`创作点不足，本次需要 ${units} 点。请先兑换激活码。`);}
 return {id};
}
export async function releaseTextCredit(userId:string,id:string){await db().prepare("UPDATE text_credit_usage SET status='refunded',completed_at=? WHERE id=? AND user_id=? AND status='held'").bind(now(),id,userId).run();}
export async function completeTextCredit(userId:string,id:string,result:GenerationResult):Promise<GenerationResult>{
 const time=now();
 const rawTitle=result.output.title||result.output.answer||result.output.body;
 const note=typeof rawTitle==='string'?'文字创作 · '+rawTitle.trim().replace(/\s+/g,' ').slice(0,60):'文字创作';
 const values=await db().batch([
  db().prepare("UPDATE text_credit_usage SET status='succeeded',completed_at=?,result_json=? WHERE id=? AND user_id=? AND status='held' AND expires_at>?").bind(time,JSON.stringify(result),id,userId,time),
  db().prepare("INSERT INTO text_credit_ledger(id,user_id,delta,kind,usage_id,note,created_at) SELECT ?,?,-units,'usage',id,?,? FROM text_credit_usage WHERE id=? AND user_id=? AND status='succeeded' ON CONFLICT(usage_id) DO NOTHING").bind(crypto.randomUUID(),userId,note,time,id,userId),
 ]);
 if(!values[0].meta.changes){const row=await db().prepare('SELECT status,result_json FROM text_credit_usage WHERE id=? AND user_id=?').bind(id,userId).first<Usage>();if(row?.status==='succeeded'&&row.result_json)return JSON.parse(row.result_json);throw new ApiError(409,'本次生成已超时，未扣创作点，请重新发送需求');}
 return result;
}

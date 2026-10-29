import {env} from 'cloudflare:workers';
import {ApiError, db, field} from './tenancy';
import {eventExpiry, eventGrant, eventVideoUnits, launchEventPlan} from './event-plans';

export type EventCreditCapability = 'image' | 'text' | 'video';
export type EventCreditProfile = 'standard';
type UsageRow = {id:string;request_key:string;request_hash:string;capability:EventCreditCapability;profile:string;status:'held'|'unknown'|'succeeded'|'released';result_json:string|null};
export type EventCreditRequest = {capability:EventCreditCapability;profile:EventCreditProfile;requestKey:string;requestHash:string};
export type IssueEventCodeBody = {requestId:string;label?:string;count?:number;redeemBefore?:string|null};
const now = () => new Date().toISOString();
const hashCode = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
const heldStatuses = "('held','unknown')";
const remaining = "l.units-(SELECT count(*) FROM event_credit_usage u WHERE u.lot_id=l.id AND u.status IN ('held','unknown','succeeded'))";
const selectedLot = "EXISTS(SELECT 1 FROM event_activation_codes selected_code JOIN event_activation_settings selected_settings ON selected_settings.singleton=1 AND selected_settings.batch_id=selected_code.batch_id WHERE selected_code.id=l.code_id)";
function bucket(capability:unknown,profile:unknown){if((capability!=='image'&&capability!=='text'&&capability!=='video')||profile!=='standard')throw new ApiError(403,'本体验卡不包含此服务档位，高级服务尚未开放');}
export const eventActivationEnabled = () => (env as unknown as Record<string,string|undefined>).EVENT_ACTIVATION_ENABLED === '1';
export async function selectedEventBatch(){return (await db().prepare('SELECT batch_id AS batchId FROM event_activation_settings WHERE singleton=1').first<{batchId:string}>())?.batchId||null;}
export async function selectEventBatch(adminUserId:string,batchId:unknown,reason:unknown){
 const id=field(batchId,80,true),note=field(reason,500,true);if(note.length<5)throw new ApiError(400,'请填写切换活动批次的原因（至少 5 个字）');
 if(!await db().prepare('SELECT 1 FROM event_activation_batches WHERE id=?').bind(id).first())throw new ApiError(404,'所选活动批次不存在');
 const previous=await selectedEventBatch();if(previous===id)return {selectedBatchId:id,alreadySelected:true};
 const time=now();await db().batch([
  db().prepare('INSERT INTO event_activation_settings(singleton,batch_id,selected_by,updated_at) VALUES (1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET batch_id=excluded.batch_id,selected_by=excluded.selected_by,updated_at=excluded.updated_at').bind(id,adminUserId,time),
  db().prepare("INSERT INTO event_admin_audit(id,admin_id,action,target_id,affected_count,reason,created_at) VALUES (?,?,'select_batch',?,1,?,?)").bind(crypto.randomUUID(),adminUserId,id,note,time),
 ]);return {selectedBatchId:id,alreadySelected:false};
}
async function recoverInterruptedText(userId?:string){
 // A process can stop after sending a paid request but before recording its
 // response. Keep the reservation; expose it for explicit administrator review.
 const cutoff=new Date(Date.now()-10*60000).toISOString();
 await db().prepare("UPDATE event_credit_usage SET status='unknown',updated_at=? WHERE capability='text' AND status='held' AND created_at<?"+(userId?' AND user_id=?':'')).bind(now(),cutoff,...(userId?[userId]:[])).run();
}

// Caller must authenticate a platform administrator. Full codes are returned once.
export async function issueEventCodes(adminUserId:string,body:IssueEventCodeBody){
 const requestId=field(body.requestId,80,true),label=field(body.label||launchEventPlan.label,80,true),count=body.count??launchEventPlan.cardCount;
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)||!Number.isSafeInteger(count)||count<1||count>50)throw new ApiError(400,'发卡请求标识或数量不正确，每批最多 50 张');
 let redeemBefore:string|null=null;
 if(body.redeemBefore){const parsed=Date.parse(field(body.redeemBefore,40,true));if(!Number.isFinite(parsed)||parsed<=Date.now())throw new ApiError(400,'最晚兑换时间须晚于当前时间');redeemBefore=new Date(parsed).toISOString();}
 const planSnapshot=JSON.stringify(launchEventPlan);
 async function previous(){
  const row=await db().prepare('SELECT id,created_by,label,code_count,redeem_before,plan_snapshot FROM event_activation_batches WHERE request_key=?').bind(requestId).first<{id:string;created_by:string;label:string;code_count:number;redeem_before:string|null;plan_snapshot:string}>();
  if(!row)return null;
  // The server-side plan may gain capabilities after issuance. An unchanged
  // issuer request still returns its original batch, never replacement codes.
  if(row.created_by!==adminUserId||row.label!==label||row.code_count!==count||row.redeem_before!==redeemBefore)throw new ApiError(409,'该发卡请求标识已用于其他内容');
  return {batchId:row.id,codes:[] as string[],alreadyCreated:true};
 }
 const old=await previous();if(old)return old;
 const batchId=crypto.randomUUID(),time=now(),codes=[];
 for(let index=0;index<count;index++){
  const raw=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();
  codes.push({id:crypto.randomUUID(),value:'ZDXE-'+raw.match(/.{8}/g)!.join('-'),hash:await hashCode('ZDXE'+raw),hint:raw.slice(-6)});
 }
 try{await db().batch([
  db().prepare('INSERT INTO event_activation_batches(id,request_key,label,plan_id,plan_snapshot,code_count,redeem_before,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(batchId,requestId,label,launchEventPlan.id,planSnapshot,count,redeemBefore,adminUserId,time),
  ...codes.map(code=>db().prepare('INSERT INTO event_activation_codes(id,batch_id,code_hash,code_hint) VALUES (?,?,?,?)').bind(code.id,batchId,code.hash,code.hint)),
  db().prepare('INSERT INTO event_activation_settings(singleton,batch_id,selected_by,updated_at) SELECT 1,id,NULL,created_at FROM event_activation_batches ORDER BY created_at,id LIMIT 1 ON CONFLICT(singleton) DO NOTHING'),
 ]);}catch(error){const replay=await previous();if(replay)return replay;throw error;}
 return {batchId,codes:codes.map(code=>code.value),alreadyCreated:false};
}

export async function hasEventActivation(userId:string){return !!await db().prepare("SELECT 1 FROM event_activation_codes WHERE redeemed_by=? AND status='redeemed' LIMIT 1").bind(userId).first();}
export async function hasActiveEventEntitlement(userId:string,capability:EventCreditCapability,profile:string='standard'){
 bucket(capability,profile);return !!await db().prepare(`SELECT 1 FROM event_credit_lots l WHERE user_id=? AND capability=? AND profile=? AND expires_at>? AND ${selectedLot} LIMIT 1`).bind(userId,capability,profile,now()).first();
}
export async function hasEventCredit(userId:string,capability:EventCreditCapability,profile:string='standard'){
 bucket(capability,profile);return !!await db().prepare(`SELECT 1 FROM event_credit_lots l WHERE user_id=? AND capability=? AND profile=? AND expires_at>? AND ${selectedLot} AND ${remaining}>0 LIMIT 1`).bind(userId,capability,profile,now()).first();
}
export async function eventCreditSummary(userId:string){
 await recoverInterruptedText(userId);
 const time=now();
 const rows=(await db().prepare(`SELECT l.capability,l.profile,SUM(l.units) AS total,
 COALESCE(SUM((SELECT count(*) FROM event_credit_usage u WHERE u.lot_id=l.id AND u.status='succeeded')),0) AS used,
 COALESCE(SUM((SELECT count(*) FROM event_credit_usage u WHERE u.lot_id=l.id AND u.status IN ${heldStatuses})),0) AS reserved,
 COALESCE(SUM(CASE WHEN l.expires_at>? AND ${selectedLot} THEN ${remaining} ELSE 0 END),0) AS available,
 MIN(CASE WHEN l.expires_at>? AND ${selectedLot} THEN l.expires_at ELSE NULL END) AS expiresAt
 FROM event_credit_lots l WHERE l.user_id=? GROUP BY l.capability,l.profile`).bind(time,time,userId).all<{capability:EventCreditCapability;profile:string;total:number;used:number;reserved:number;available:number;expiresAt:string|null}>()).results;
 const quotas=(['image','text','video'] as const).map(capability=>rows.find(row=>row.capability===capability&&row.profile==='standard')||{capability,profile:'standard',total:0,used:0,reserved:0,available:0,expiresAt:null});
 const entries=(await db().prepare('SELECT e.id,e.kind,e.delta,e.note,e.created_at AS createdAt,l.capability,l.profile FROM event_credit_ledger e JOIN event_credit_lots l ON l.id=e.lot_id WHERE e.user_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 50').bind(userId).all()).results;
 return {ownerId:userId,activated:await hasEventActivation(userId),active:quotas.some(row=>row.expiresAt!==null),quotas,entries};
}

export async function redeemEventCode(userId:string,value:unknown,options:{directSession?:boolean}={}){
 const raw=field(value,100,true).replace(/[\s-]/g,'').toUpperCase();
 if(!options.directSession){
 const window=Math.floor(Date.now()/900000),key=`event-code-redeem:${userId}:${window}`;
 const attempt=await db().prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<10 RETURNING count').bind(key,Date.now()+900000).first();
 if(!attempt)throw new ApiError(429,'兑换尝试较多，请 15 分钟后再试');
 }
 if(!/^ZDXE[A-F0-9]{32}$/.test(raw))throw new ApiError(400,'体验卡格式不正确，请完整复制后重试');
 const code=await db().prepare('SELECT c.id,c.status,c.redeemed_by,b.redeem_before,b.plan_snapshot FROM event_activation_codes c JOIN event_activation_batches b ON b.id=c.batch_id WHERE c.code_hash=?').bind(await hashCode(raw)).first<{id:string;status:string;redeemed_by:string|null;redeem_before:string|null;plan_snapshot:string}>();
 if(!code)throw new ApiError(400,'体验卡不存在，请核对后重试');
 if(code.status==='redeemed'){if(code.redeemed_by===userId)return {alreadyRedeemed:true,credited:{image:0,text:0,video:0},...await eventCreditSummary(userId)};throw new ApiError(409,'这张体验卡已被其他账号兑换');}
 if(!await db().prepare('SELECT 1 FROM event_activation_codes c JOIN event_activation_settings s ON s.singleton=1 AND s.batch_id=c.batch_id WHERE c.id=?').bind(code.id).first())throw new ApiError(403,'这张卡所属批次尚未开放，请联系工作人员');
 if(await db().prepare("SELECT 1 FROM event_activation_codes WHERE redeemed_by=? AND status='redeemed' AND id<>? LIMIT 1").bind(userId,code.id).first())throw new ApiError(409,'每个体验账号仅能激活一张卡，请勿重复兑换其他卡');
 const time=now();if(code.status!=='active'||code.redeem_before&&code.redeem_before<=time)throw new ApiError(400,'体验卡已作废或超过最晚兑换时间');
 const plan=JSON.parse(code.plan_snapshot) as typeof launchEventPlan;
 const expiresAt=eventExpiry(time,plan),imageUnits=eventGrant('image.generate.standard',plan).units,textUnits=eventGrant('text.generate.standard',plan).units,videoUnits=eventVideoUnits(plan);
 const receipt=crypto.randomUUID();
 const statements=[db().prepare("UPDATE event_activation_codes SET status='redeemed',redeemed_by=?,redeemed_at=?,expires_at=?,receipt_id=? WHERE id=? AND status='active' AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AND EXISTS(SELECT 1 FROM event_activation_batches b JOIN event_activation_settings s ON s.singleton=1 AND s.batch_id=b.id WHERE b.id=event_activation_codes.batch_id AND (b.redeem_before IS NULL OR b.redeem_before>?)) AND NOT EXISTS(SELECT 1 FROM event_activation_codes other WHERE other.redeemed_by=? AND other.status='redeemed' AND other.id<>event_activation_codes.id)").bind(userId,time,expiresAt,receipt,code.id,userId,time,userId)];
 for(const [capability,units] of [['image',imageUnits],['text',textUnits],['video',videoUnits]] as const){
  const lotId=crypto.randomUUID();
  statements.push(db().prepare("INSERT INTO event_credit_lots(id,code_id,user_id,capability,profile,units,created_at,expires_at) SELECT ?,id,?,?, 'standard',?,?,? FROM event_activation_codes WHERE id=? AND receipt_id=? AND redeemed_by=?").bind(lotId,userId,capability,units,time,expiresAt,code.id,receipt,userId));
  statements.push(db().prepare("INSERT INTO event_credit_ledger(id,user_id,lot_id,kind,delta,note,created_at) SELECT ?,user_id,id,'grant',units,?,? FROM event_credit_lots WHERE id=?").bind(crypto.randomUUID(),plan.label,time,lotId));
 }
 const result=await db().batch(statements);
 if(!result[0].meta.changes){const current=await db().prepare('SELECT redeemed_by FROM event_activation_codes WHERE id=?').bind(code.id).first<{redeemed_by:string|null}>();if(current?.redeemed_by===userId)return {alreadyRedeemed:true,credited:{image:0,text:0,video:0},...await eventCreditSummary(userId)};throw new ApiError(409,'体验卡状态已变化，未重复入账');}
 return {alreadyRedeemed:false,credited:{image:imageUnits,text:textUnits,video:videoUnits},...await eventCreditSummary(userId)};
}

export async function eventCreditForRequest(userId:string,requestKey:string){
 const row=await db().prepare('SELECT id,request_key,request_hash,capability,profile,status,result_json FROM event_credit_usage WHERE user_id=? AND request_key=?').bind(userId,requestKey).first<UsageRow>();
 return row?{id:row.id,requestKey:row.request_key,requestHash:row.request_hash,capability:row.capability,profile:row.profile,status:row.status,...(row.result_json!==null?{result:JSON.parse(row.result_json)}:{})}:null;
}
export async function reserveEventCredit(userId:string,request:EventCreditRequest):Promise<{id:string;cached?:unknown}>{
 await recoverInterruptedText(userId);
 bucket(request.capability,request.profile);const requestKey=field(request.requestKey,160,true),requestHash=field(request.requestHash,200,true);
 const previous=await eventCreditForRequest(userId,requestKey);
 if(previous){
  if(previous.requestHash!==requestHash||previous.capability!==request.capability||previous.profile!==request.profile)throw new ApiError(409,'该请求标识已用于其他内容或服务档位');
  if(previous.status==='succeeded')return {id:previous.id,cached:previous.result??{}};
  throw new ApiError(409,previous.status==='released'?'上次生成已释放额度，请重新发送需求':'这份内容正在处理或结果待确认，请勿重复提交');
 }
 const id=crypto.randomUUID(),time=now();
 const hold=await db().prepare(`INSERT INTO event_credit_usage(id,user_id,lot_id,capability,profile,request_key,request_hash,status,created_at,updated_at)
 SELECT ?,l.user_id,l.id,l.capability,l.profile,?,?,'held',?,? FROM event_credit_lots l
 WHERE l.user_id=? AND l.capability=? AND l.profile=? AND l.expires_at>? AND ${selectedLot} AND ${remaining}>0
 AND EXISTS(SELECT 1 FROM users WHERE id=l.user_id AND status='active')
 ORDER BY l.expires_at,l.id LIMIT 1 ON CONFLICT(user_id,request_key) DO NOTHING RETURNING id`).bind(id,requestKey,requestHash,time,time,userId,request.capability,request.profile,time).first<{id:string}>();
 if(!hold){if(await eventCreditForRequest(userId,requestKey))throw new ApiError(409,'这份内容正在处理，请勿重复提交');throw new ApiError(402,request.capability==='image'?'标准图片次数不足或体验已到期，请兑换有效体验卡':request.capability==='video'?'15 秒视频次数不足或体验已到期，请兑换有效体验卡':'标准文案次数不足或体验已到期，请兑换有效体验卡');}
 return {id};
}

// Unknown requests remain reserved until an explicit delivery/failure decision.
export async function markEventCreditUnknown(userId:string,holdId:string){await db().prepare("UPDATE event_credit_usage SET status='unknown',updated_at=? WHERE id=? AND user_id=? AND status='held'").bind(now(),holdId,userId).run();}
export async function releaseEventCredit(userId:string,holdId:string){await db().prepare("UPDATE event_credit_usage SET status='released',updated_at=? WHERE id=? AND user_id=? AND status IN ('held','unknown')").bind(now(),holdId,userId).run();}
export async function completeEventCredit(userId:string,holdId:string,result:unknown=null):Promise<unknown>{
 const serialized=JSON.stringify(result??null);if(typeof serialized!=='string'||serialized.length>2*1024*1024)throw new ApiError(413,'生成结果过大或格式不正确，暂未结算');
 const time=now();
 const values=await db().batch([
  db().prepare("UPDATE event_credit_usage SET status='succeeded',result_json=?,updated_at=? WHERE id=? AND user_id=? AND status IN ('held','unknown')").bind(serialized,time,holdId,userId),
  db().prepare("INSERT INTO event_credit_ledger(id,user_id,lot_id,usage_id,kind,delta,note,created_at) SELECT ?,user_id,lot_id,id,'usage',-1,CASE WHEN capability='image' THEN '标准图片 · 成功交付' WHEN capability='video' THEN '15 秒视频 · 成功交付' ELSE '标准文案 · 成功交付' END,? FROM event_credit_usage WHERE id=? AND user_id=? AND status='succeeded' ON CONFLICT(usage_id) DO NOTHING").bind(crypto.randomUUID(),time,holdId,userId),
 ]);
 if(!values[0].meta.changes){const old=await db().prepare('SELECT status,result_json FROM event_credit_usage WHERE id=? AND user_id=?').bind(holdId,userId).first<{status:string;result_json:string|null}>();if(old?.status==='succeeded')return JSON.parse(old.result_json||'null');throw new ApiError(409,'该任务未持有有效额度，无法结算');}
 return result;
}

export async function eventActivationOverview(batchId=''){
 await recoverInterruptedText();
 const batches=(await db().prepare("SELECT b.id,b.label,b.plan_id AS planId,b.code_count AS codeCount,b.redeem_before AS redeemBefore,b.created_at AS createdAt,SUM(CASE WHEN c.status='redeemed' THEN 1 ELSE 0 END) AS redeemed,SUM(CASE WHEN c.status='revoked' THEN 1 ELSE 0 END) AS revoked FROM event_activation_batches b JOIN event_activation_codes c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC LIMIT 100").all()).results;
 const codes=batchId?(await db().prepare('SELECT c.id,c.code_hint AS hint,c.status,c.redeemed_by AS redeemedById,u.display_name AS redeemedBy,c.redeemed_at AS redeemedAt,c.expires_at AS expiresAt FROM event_activation_codes c LEFT JOIN users u ON u.id=c.redeemed_by WHERE c.batch_id=? ORDER BY c.id').bind(field(batchId,80,true)).all()).results:[];
 const usage=(await db().prepare("SELECT e.id,e.user_id AS userId,u.display_name AS displayName,e.capability,e.profile,e.request_key AS requestKey,e.status,e.created_at AS createdAt,e.updated_at AS updatedAt FROM event_credit_usage e JOIN users u ON u.id=e.user_id WHERE e.status='unknown' ORDER BY e.updated_at,e.id LIMIT 100").all()).results;
 const audit=(await db().prepare('SELECT id,admin_id AS adminId,action,target_id AS targetId,affected_count AS affectedCount,reason,created_at AS createdAt FROM event_admin_audit ORDER BY created_at DESC,id DESC LIMIT 50').all()).results;
 const resolutions=(await db().prepare('SELECT id,usage_id AS holdId,admin_id AS adminId,outcome,reason,created_at AS createdAt FROM event_credit_resolutions ORDER BY created_at DESC,id DESC LIMIT 50').all()).results;
 return {batches,codes,usage,audit,resolutions,selectedBatchId:await selectedEventBatch()};
}
export async function revokeEventCodes(body:{batchId?:string;codeId?:string;reason?:string},adminUserId:string){
 const batchId=field(body.batchId||'',80),codeId=field(body.codeId||'',80),reason=field(body.reason||'管理员作废尚未兑换的体验卡',500,true);
 field(adminUserId,80,true);if(!batchId&&!codeId)throw new ApiError(400,'请选择要作废的批次或体验卡');
 const condition=codeId?'id=?':'batch_id=?',target=codeId||batchId;
 const result=await db().batch([
  db().prepare(`INSERT INTO event_admin_audit(id,admin_id,action,target_id,affected_count,reason,created_at) SELECT ?,?,'revoke_codes',?,count(*),?,? FROM event_activation_codes WHERE status='active' AND ${condition} HAVING count(*)>0`).bind(crypto.randomUUID(),adminUserId,target,reason,now(),target),
  db().prepare(`UPDATE event_activation_codes SET status='revoked' WHERE status='active' AND ${condition}`).bind(target),
 ]);
 return {revoked:result[1].meta.changes};
}
export async function resolveUnknownEventCredit(adminUserId:string,body:{holdId:string;outcome:'succeeded'|'refunded';reason:string}){
 const holdId=field(body.holdId,80,true),reason=field(body.reason,1000,true),outcome=body.outcome;
 field(adminUserId,80,true);if(!['succeeded','refunded'].includes(outcome)||reason.length<5)throw new ApiError(400,'请填写核查服务商结果的处理依据（至少 5 个字）');
 const status=outcome==='succeeded'?'succeeded':'released';
 async function previous(){const row=await db().prepare('SELECT outcome FROM event_credit_resolutions WHERE usage_id=?').bind(holdId).first<{outcome:string}>();if(!row)return null;if(row.outcome!==outcome)throw new ApiError(409,'该任务已按另一结论处理，不能重复或反向处理');return {alreadyResolved:true,status};}
 const old=await previous();if(old)return old;
 const id=crypto.randomUUID(),time=now();
 const result=await db().batch([
  db().prepare("INSERT INTO event_credit_resolutions(id,usage_id,admin_id,outcome,reason,created_at) SELECT ?,id,?,?,?,? FROM event_credit_usage WHERE id=? AND status='unknown' ON CONFLICT(usage_id) DO NOTHING").bind(id,adminUserId,outcome,reason,time,holdId),
  db().prepare("UPDATE event_credit_usage SET status=?,result_json=CASE WHEN ?='succeeded' THEN COALESCE(result_json,'{}') ELSE result_json END,updated_at=? WHERE id=? AND status='unknown' AND EXISTS(SELECT 1 FROM event_credit_resolutions r WHERE r.id=? AND r.usage_id=event_credit_usage.id)").bind(status,status,time,holdId,id),
  db().prepare("INSERT INTO event_credit_ledger(id,user_id,lot_id,usage_id,kind,delta,note,created_at) SELECT ?,user_id,lot_id,id,'usage',-1,'管理员核实成功交付',? FROM event_credit_usage WHERE id=? AND status='succeeded' AND EXISTS(SELECT 1 FROM event_credit_resolutions r WHERE r.id=? AND r.usage_id=event_credit_usage.id) ON CONFLICT(usage_id) DO NOTHING").bind(crypto.randomUUID(),time,holdId,id),
 ]);
 if(!result[0].meta.changes){const replay=await previous();if(replay)return replay;throw new ApiError(409,'只能人工处理结果待确认的任务；进行中、已结算或已释放的任务不能修改');}
 return {alreadyResolved:false,status};
}

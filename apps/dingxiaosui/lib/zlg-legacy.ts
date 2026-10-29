import {db,ApiError} from './tenancy';
import {passwordIdentity,digest} from './password-auth';
import {verifiedZlgIdentity,centerRequired} from './zlg-gateway';
export async function prepareLegacy(headers:Headers,allowCentralOwner=false){
 if(!centerRequired())throw new ApiError(409,'统一账户接入尚未启用');
 const central=await verifiedZlgIdentity(headers);if(!central)throw new ApiError(401,'请先登录统一账户');
 const database=db();let exported=await database.prepare('SELECT * FROM zlg_legacy_exports WHERE subject=?').bind(central.sub).first<{user_id:string;exported_total:number;snapshot_id:string;ledger_digest:string}>();
 let userId=exported?.user_id;
 if(!userId){const original=await passwordIdentity(headers);const old=original?await database.prepare("SELECT u.id FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.provider='password' AND i.subject=? AND u.status='active'").bind(original.userId).first<{id:string}>():allowCentralOwner?await database.prepare("SELECT u.id FROM users u JOIN auth_identities i ON i.user_id=u.id WHERE i.provider='zlg' AND i.subject=? AND u.status='active'").bind(central.sub).first<{id:string}>():null;if(!old)throw new ApiError(401,'请先验证原账号');userId=old.id;
  const conflict=await database.prepare("SELECT user_id,subject FROM auth_identities WHERE provider='zlg' AND (subject=? OR user_id=?)").bind(central.sub,userId).first<{user_id:string;subject:string}>();if(conflict&&(conflict.user_id!==userId||conflict.subject!==central.sub))throw new ApiError(409,'统一账户已有资料或原账号已绑定其他账户，请人工核查合并');
 }
 const now=new Date().toISOString();
 // Freeze and link in one SQLite batch. The predicate is evaluated under the same write lock as the freeze.
 await database.batch([
  database.prepare("INSERT INTO zlg_legacy_exports(user_id,subject,snapshot_id,exported_total,ledger_digest,created_at) SELECT ?,?,?,0,?,? WHERE NOT EXISTS(SELECT 1 FROM text_credit_usage WHERE user_id=? AND status='held') ON CONFLICT(user_id) DO NOTHING").bind(userId,central.sub,crypto.randomUUID(),'0'.repeat(64),now,userId),
  database.prepare("INSERT INTO auth_identities(id,user_id,provider,subject,verified_at) SELECT ?,user_id,'zlg',subject,? FROM zlg_legacy_exports WHERE user_id=? AND subject=? ON CONFLICT(provider,subject) DO UPDATE SET user_id=CASE WHEN auth_identities.user_id=excluded.user_id THEN auth_identities.user_id ELSE NULL END").bind(crypto.randomUUID(),now,userId,central.sub),
 ]);
 const frozen=await database.prepare('SELECT user_id FROM zlg_legacy_exports WHERE user_id=? AND subject=?').bind(userId,central.sub).first();if(!frozen)throw new ApiError(409,'原账号存在未确认任务或已绑定其他账户，请处理后重试');
 const entries=(await database.prepare('SELECT id,delta,kind,code_id,created_at FROM text_credit_ledger WHERE user_id=? ORDER BY created_at,id').bind(userId).all()).results as {delta:number}[];
 const total=entries.reduce((sum,row)=>sum+row.delta,0);if(total<0||!Number.isSafeInteger(total))throw new ApiError(409,'原余额异常，请人工核查');
 await database.prepare('UPDATE zlg_legacy_exports SET snapshot_id=?,exported_total=?,ledger_digest=? WHERE user_id=? AND subject=?').bind(crypto.randomUUID(),total,await digest(JSON.stringify(entries)),userId,central.sub).run();
 const saved=await database.prepare('SELECT * FROM zlg_legacy_exports WHERE user_id=? AND subject=?').bind(userId,central.sub).first<{user_id:string;exported_total:number;snapshot_id:string;ledger_digest:string}>();if(!saved)throw new ApiError(409,'原账号已绑定其他账户');
 return{legacyUserId:saved.user_id,snapshotId:saved.snapshot_id,exportedTotal:saved.exported_total,ledgerDigest:saved.ledger_digest};
}

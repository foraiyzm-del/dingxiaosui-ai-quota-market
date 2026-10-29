-- Independent, expiring event rights. No migration or sharing of legacy text points.
CREATE TABLE event_activation_batches (
 id TEXT PRIMARY KEY NOT NULL, request_key TEXT NOT NULL UNIQUE,
 label TEXT NOT NULL, plan_id TEXT NOT NULL, plan_snapshot TEXT NOT NULL,
 code_count INTEGER NOT NULL CHECK(code_count BETWEEN 1 AND 50),
 redeem_before TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE event_activation_codes (
 id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL REFERENCES event_activation_batches(id),
 code_hash TEXT NOT NULL UNIQUE, code_hint TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','redeemed','revoked')),
 redeemed_by TEXT REFERENCES users(id), redeemed_at TEXT, expires_at TEXT, receipt_id TEXT UNIQUE,
 CHECK((status='redeemed' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL AND expires_at IS NOT NULL AND receipt_id IS NOT NULL)
 OR (status!='redeemed' AND redeemed_by IS NULL AND redeemed_at IS NULL AND expires_at IS NULL AND receipt_id IS NULL))
);
CREATE INDEX event_activation_code_batch ON event_activation_codes(batch_id,status);
CREATE INDEX event_activation_code_owner ON event_activation_codes(redeemed_by);
CREATE TABLE event_credit_lots (
 id TEXT PRIMARY KEY NOT NULL, code_id TEXT NOT NULL REFERENCES event_activation_codes(id),
 user_id TEXT NOT NULL REFERENCES users(id), capability TEXT NOT NULL CHECK(capability IN ('image','text')),
 profile TEXT NOT NULL CHECK(length(profile) BETWEEN 1 AND 40 AND profile NOT GLOB '*[^a-z0-9-]*'),
 units INTEGER NOT NULL CHECK(units>0), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(code_id,capability,profile)
);
CREATE INDEX event_credit_lot_owner ON event_credit_lots(user_id,capability,profile,expires_at);
CREATE TABLE event_credit_usage (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lot_id TEXT NOT NULL REFERENCES event_credit_lots(id),
 capability TEXT NOT NULL CHECK(capability IN ('image','text')),
 profile TEXT NOT NULL CHECK(length(profile) BETWEEN 1 AND 40 AND profile NOT GLOB '*[^a-z0-9-]*'),
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('held','unknown','succeeded','released')),
 result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE INDEX event_credit_usage_lot ON event_credit_usage(lot_id,status);
CREATE INDEX event_credit_usage_owner ON event_credit_usage(user_id,created_at);
CREATE TABLE event_credit_ledger (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lot_id TEXT NOT NULL REFERENCES event_credit_lots(id),
 usage_id TEXT UNIQUE REFERENCES event_credit_usage(id),
 kind TEXT NOT NULL CHECK(kind IN ('grant','usage')), delta INTEGER NOT NULL,
 note TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((kind='grant' AND delta>0 AND usage_id IS NULL) OR (kind='usage' AND delta=-1 AND usage_id IS NOT NULL))
);
CREATE UNIQUE INDEX event_credit_grant_once ON event_credit_ledger(lot_id) WHERE kind='grant';
CREATE INDEX event_credit_ledger_owner ON event_credit_ledger(user_id,created_at);
CREATE TABLE event_credit_resolutions (
 id TEXT PRIMARY KEY NOT NULL, usage_id TEXT NOT NULL UNIQUE REFERENCES event_credit_usage(id),
 admin_id TEXT NOT NULL REFERENCES users(id), outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','refunded')),
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE event_admin_audit (
 id TEXT PRIMARY KEY NOT NULL, admin_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, target_id TEXT NOT NULL, affected_count INTEGER NOT NULL CHECK(affected_count>0),
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);

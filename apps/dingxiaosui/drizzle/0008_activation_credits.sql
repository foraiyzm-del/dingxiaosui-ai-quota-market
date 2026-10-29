CREATE TABLE activation_batches (
 id TEXT PRIMARY KEY NOT NULL, request_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('paid','gift')), credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 100000),
 code_count INTEGER NOT NULL CHECK(code_count BETWEEN 1 AND 100), amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
 expires_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE activation_codes (
 id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL REFERENCES activation_batches(id),
 code_hash TEXT NOT NULL UNIQUE, code_hint TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','redeemed','revoked')),
 redeemed_by TEXT REFERENCES users(id), redeemed_at TEXT, receipt_id TEXT UNIQUE,
 CHECK((status='redeemed' AND redeemed_by IS NOT NULL AND receipt_id IS NOT NULL) OR (status!='redeemed' AND redeemed_by IS NULL AND receipt_id IS NULL))
);
CREATE INDEX activation_code_batch ON activation_codes(batch_id,status);
CREATE INDEX activation_code_owner ON activation_codes(redeemed_by);
CREATE TABLE text_credit_usage (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL, units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 9),
 status TEXT NOT NULL CHECK(status IN ('held','succeeded','refunded')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT, result_json TEXT,
 UNIQUE(user_id,request_key)
);
CREATE INDEX text_credit_usage_owner ON text_credit_usage(user_id,status,expires_at);
CREATE TABLE text_credit_ledger (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL CHECK(delta!=0),
 kind TEXT NOT NULL CHECK(kind IN ('redeem','usage')), code_id TEXT UNIQUE REFERENCES activation_codes(id),
 usage_id TEXT UNIQUE REFERENCES text_credit_usage(id), note TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((kind='redeem' AND delta>0 AND code_id IS NOT NULL AND usage_id IS NULL) OR (kind='usage' AND delta<0 AND usage_id IS NOT NULL AND code_id IS NULL))
);
CREATE INDEX text_credit_ledger_owner ON text_credit_ledger(user_id,created_at);

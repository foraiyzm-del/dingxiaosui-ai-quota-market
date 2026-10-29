-- External shop cards have independent identities and never alter legacy event cards.
CREATE TABLE quota_center_accounts (
 card_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 center_user_id TEXT NOT NULL UNIQUE,
 code_id TEXT UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('pending','active','review')),
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 activated_at TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE quota_center_sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES quota_center_accounts(user_id),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX quota_center_session_expiry ON quota_center_sessions(expires_at);

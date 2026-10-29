CREATE TABLE auth_identities_new (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL CHECK(provider IN ('sites','local-test','password')), subject TEXT NOT NULL, verified_at TEXT NOT NULL
);
INSERT INTO auth_identities_new SELECT * FROM auth_identities;
DROP TABLE auth_identities;
ALTER TABLE auth_identities_new RENAME TO auth_identities;
CREATE UNIQUE INDEX identity_provider_subject ON auth_identities(provider,subject);
CREATE UNIQUE INDEX identity_user_provider ON auth_identities(user_id,provider);
CREATE TABLE password_accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, display_name TEXT NOT NULL, platform_admin INTEGER NOT NULL DEFAULT 0 CHECK(platform_admin IN (0,1)), created_at TEXT NOT NULL);
CREATE TABLE password_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES password_accounts(id), expires_at INTEGER NOT NULL);
CREATE INDEX password_session_expiry ON password_sessions(expires_at);
CREATE TABLE auth_limits (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE setup_tokens (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);

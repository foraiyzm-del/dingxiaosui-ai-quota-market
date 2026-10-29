ALTER TABLE user_models ADD COLUMN capability TEXT NOT NULL DEFAULT 'text' CHECK(capability IN ('text','image','video'));
CREATE TABLE user_media_preferences (
 user_id TEXT NOT NULL REFERENCES users(id), capability TEXT NOT NULL CHECK(capability IN ('image','video')),
 model_id TEXT REFERENCES user_models(id) ON DELETE SET NULL, PRIMARY KEY(user_id,capability)
);
CREATE TABLE platform_media_settings (
 capability TEXT PRIMARY KEY CHECK(capability IN ('image','video')), kind TEXT NOT NULL CHECK(kind IN ('ark','openai-compatible')),
 endpoint TEXT NOT NULL, model TEXT NOT NULL, key_cipher TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE media_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), capability TEXT NOT NULL CHECK(capability IN ('image','video')),
 idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, prompt TEXT NOT NULL, model_name TEXT NOT NULL,
 provider_kind TEXT NOT NULL, provider_endpoint TEXT NOT NULL, provider_model TEXT NOT NULL, key_cipher TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitting','queued','running','succeeded','failed','unknown')),
 upstream_id TEXT, outputs_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 poll_after INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,idempotency_key)
);
CREATE INDEX media_jobs_owner ON media_jobs(user_id,created_at DESC);

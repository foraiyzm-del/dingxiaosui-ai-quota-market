-- Extend the existing media settings and task lifecycle without touching accounts,
-- credentials, balances, model preferences or previously generated media.
-- Run through the normal migration runner: it wraps this whole file in a transaction.
-- Neither table has inbound foreign keys in migrations 0000-0012.
CREATE TABLE platform_media_settings_apimart (
 capability TEXT PRIMARY KEY CHECK(capability IN ('image','video')),
 kind TEXT NOT NULL CHECK(kind IN ('ark','openai-compatible','apimart')),
 endpoint TEXT NOT NULL, model TEXT NOT NULL, key_cipher TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id)
);
INSERT INTO platform_media_settings_apimart
 (capability,kind,endpoint,model,key_cipher,enabled,revision,updated_at,updated_by)
 SELECT capability,kind,endpoint,model,key_cipher,enabled,revision,updated_at,updated_by
 FROM platform_media_settings;
DROP TABLE platform_media_settings;
ALTER TABLE platform_media_settings_apimart RENAME TO platform_media_settings;

CREATE TABLE media_jobs_apimart (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 capability TEXT NOT NULL CHECK(capability IN ('image','video')),
 idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, prompt TEXT NOT NULL,
 model_name TEXT NOT NULL, provider_kind TEXT NOT NULL, provider_endpoint TEXT NOT NULL,
 provider_model TEXT NOT NULL, key_cipher TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitting','queued','running','saving','succeeded','failed','unknown')),
 upstream_id TEXT, outputs_json TEXT NOT NULL DEFAULT '[]', error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 poll_after INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,idempotency_key)
);
INSERT INTO media_jobs_apimart
 (id,user_id,capability,idempotency_key,request_hash,prompt,model_name,provider_kind,
  provider_endpoint,provider_model,key_cipher,status,upstream_id,outputs_json,error,
  created_at,updated_at,poll_after)
 SELECT id,user_id,capability,idempotency_key,request_hash,prompt,model_name,provider_kind,
  provider_endpoint,provider_model,key_cipher,status,upstream_id,outputs_json,error,
  created_at,updated_at,poll_after
 FROM media_jobs;
DROP TABLE media_jobs;
ALTER TABLE media_jobs_apimart RENAME TO media_jobs;
CREATE INDEX media_jobs_owner ON media_jobs(user_id,created_at DESC);

-- user_models deliberately retains its original kind constraint. APIMart personal
-- image settings use openai-compatible storage and an exact-endpoint adapter;
-- rebuilding user_models could otherwise clear ON DELETE SET NULL preferences.

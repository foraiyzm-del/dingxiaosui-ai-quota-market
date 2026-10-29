CREATE TABLE user_models (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('openai-compatible','qwen','ark')),
 endpoint TEXT NOT NULL, model TEXT NOT NULL, key_cipher TEXT NOT NULL,
 json_mode INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE INDEX user_models_owner ON user_models(user_id);
CREATE TABLE user_model_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id), model_id TEXT REFERENCES user_models(id) ON DELETE SET NULL
);
CREATE TABLE payment_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL DEFAULT 'CNY',
 channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','closed')),
 idempotency_key TEXT NOT NULL, provider_transaction_id TEXT, created_at TEXT NOT NULL, paid_at TEXT,
 UNIQUE(user_id,idempotency_key), UNIQUE(channel,provider_transaction_id)
);
CREATE TABLE payment_events (
 channel TEXT NOT NULL, event_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES payment_orders(id),
 received_at TEXT NOT NULL, PRIMARY KEY(channel,event_id)
);

-- Direct activation-code sessions. Existing accounts, cards and ledgers stay intact.
CREATE TABLE event_activation_settings (
 singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
 batch_id TEXT NOT NULL REFERENCES event_activation_batches(id),
 selected_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL
);
INSERT INTO event_activation_settings(singleton,batch_id,selected_by,updated_at)
 SELECT 1,id,NULL,created_at FROM event_activation_batches ORDER BY created_at,id LIMIT 1;
CREATE TABLE event_guest_accounts (
 code_id TEXT PRIMARY KEY NOT NULL REFERENCES event_activation_codes(id),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE event_guest_sessions (
 token_hash TEXT PRIMARY KEY NOT NULL,
 code_id TEXT NOT NULL REFERENCES event_guest_accounts(code_id),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX event_guest_session_expiry ON event_guest_sessions(expires_at);

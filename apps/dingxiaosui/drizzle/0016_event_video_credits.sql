-- Add two independent 15-second video credits without resetting image/text rights.
-- The migration runner wraps the whole file in one transaction. Foreign keys stay
-- enabled: copy the complete related graph, drop old children before their parents,
-- then rename parents first so SQLite updates the new child references.
CREATE TABLE event_credit_lots_video (
 id TEXT PRIMARY KEY NOT NULL, code_id TEXT NOT NULL REFERENCES event_activation_codes(id),
 user_id TEXT NOT NULL REFERENCES users(id), capability TEXT NOT NULL CHECK(capability IN ('image','text','video')),
 profile TEXT NOT NULL CHECK(length(profile) BETWEEN 1 AND 40 AND profile NOT GLOB '*[^a-z0-9-]*'),
 units INTEGER NOT NULL CHECK(units>0), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(code_id,capability,profile)
);
CREATE TABLE event_credit_usage_video (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lot_id TEXT NOT NULL REFERENCES event_credit_lots_video(id),
 capability TEXT NOT NULL CHECK(capability IN ('image','text','video')),
 profile TEXT NOT NULL CHECK(length(profile) BETWEEN 1 AND 40 AND profile NOT GLOB '*[^a-z0-9-]*'),
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('held','unknown','succeeded','released')),
 result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE TABLE event_credit_ledger_video (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 lot_id TEXT NOT NULL REFERENCES event_credit_lots_video(id),
 usage_id TEXT UNIQUE REFERENCES event_credit_usage_video(id),
 kind TEXT NOT NULL CHECK(kind IN ('grant','usage')), delta INTEGER NOT NULL,
 note TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((kind='grant' AND delta>0 AND usage_id IS NULL) OR (kind='usage' AND delta=-1 AND usage_id IS NOT NULL))
);
CREATE TABLE event_credit_resolutions_video (
 id TEXT PRIMARY KEY NOT NULL, usage_id TEXT NOT NULL UNIQUE REFERENCES event_credit_usage_video(id),
 admin_id TEXT NOT NULL REFERENCES users(id), outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','refunded')),
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);

INSERT INTO event_credit_lots_video (id,code_id,user_id,capability,profile,units,created_at,expires_at) SELECT id,code_id,user_id,capability,profile,units,created_at,expires_at FROM event_credit_lots;
INSERT INTO event_credit_usage_video (id,user_id,lot_id,capability,profile,request_key,request_hash,status,result_json,created_at,updated_at) SELECT id,user_id,lot_id,capability,profile,request_key,request_hash,status,result_json,created_at,updated_at FROM event_credit_usage;
INSERT INTO event_credit_ledger_video (id,user_id,lot_id,usage_id,kind,delta,note,created_at) SELECT id,user_id,lot_id,usage_id,kind,delta,note,created_at FROM event_credit_ledger;
INSERT INTO event_credit_resolutions_video (id,usage_id,admin_id,outcome,reason,created_at) SELECT id,usage_id,admin_id,outcome,reason,created_at FROM event_credit_resolutions;

DROP TABLE event_credit_resolutions;
DROP TABLE event_credit_ledger;
DROP TABLE event_credit_usage;
DROP TABLE event_credit_lots;
ALTER TABLE event_credit_lots_video RENAME TO event_credit_lots;
ALTER TABLE event_credit_usage_video RENAME TO event_credit_usage;
ALTER TABLE event_credit_ledger_video RENAME TO event_credit_ledger;
ALTER TABLE event_credit_resolutions_video RENAME TO event_credit_resolutions;

CREATE INDEX event_credit_lot_owner ON event_credit_lots(user_id,capability,profile,expires_at);
CREATE INDEX event_credit_usage_lot ON event_credit_usage(lot_id,status);
CREATE INDEX event_credit_usage_owner ON event_credit_usage(user_id,created_at);
CREATE UNIQUE INDEX event_credit_grant_once ON event_credit_ledger(lot_id) WHERE kind='grant';
CREATE INDEX event_credit_ledger_owner ON event_credit_ledger(user_id,created_at);

-- Historical batch snapshots are retained as issued. Only the established v1
-- launch plan is upgraded here. Original expiry is copied even for expired cards;
-- no expired card is reactivated, and consumed image/text balances are untouched.
INSERT INTO event_credit_lots(id,code_id,user_id,capability,profile,units,created_at,expires_at)
 SELECT 'event-video-v1-'||c.id,c.id,c.redeemed_by,'video','standard',2,c.redeemed_at,c.expires_at
 FROM event_activation_codes c JOIN event_activation_batches b ON b.id=c.batch_id
 WHERE c.status='redeemed' AND b.plan_id='zdx-launch-50-v1'
 ON CONFLICT(code_id,capability,profile) DO NOTHING;
INSERT INTO event_credit_ledger(id,user_id,lot_id,kind,delta,note,created_at)
 SELECT 'event-video-grant-v1-'||l.code_id,l.user_id,l.id,'grant',l.units,'体验升级 · 2 条 15 秒视频',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM event_credit_lots l
 WHERE l.capability='video' AND l.id='event-video-v1-'||l.code_id
 AND NOT EXISTS(SELECT 1 FROM event_credit_ledger e WHERE e.lot_id=l.id AND e.kind='grant');

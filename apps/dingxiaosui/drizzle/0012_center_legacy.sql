-- Dual-verified links keep original user IDs, memberships and all ledger history.
CREATE TABLE zlg_legacy_exports (
 user_id TEXT PRIMARY KEY REFERENCES users(id), subject TEXT NOT NULL UNIQUE,
 snapshot_id TEXT NOT NULL, exported_total INTEGER NOT NULL CHECK(exported_total>=0),
 ledger_digest TEXT NOT NULL, created_at TEXT NOT NULL
);
-- A linked balance can only be consumed in the center. Existing journals stay intact.
CREATE TRIGGER zlg_block_legacy_reserve BEFORE INSERT ON text_credit_usage
WHEN EXISTS(SELECT 1 FROM zlg_legacy_exports WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Legacy balance is managed by unified center'); END;

CREATE TRIGGER zlg_block_legacy_complete BEFORE UPDATE OF status ON text_credit_usage
WHEN NEW.status='succeeded' AND EXISTS(SELECT 1 FROM zlg_legacy_exports WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Legacy balance is managed by unified center'); END;
CREATE TRIGGER zlg_block_legacy_charge BEFORE INSERT ON text_credit_ledger
WHEN NEW.kind='usage' AND EXISTS(SELECT 1 FROM zlg_legacy_exports WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Legacy balance is managed by unified center'); END;

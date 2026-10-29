-- Preserve all existing balances and add an account-bound, once-only welcome grant.
ALTER TABLE text_credit_ledger RENAME TO text_credit_ledger_old;
CREATE TABLE text_credit_ledger (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL CHECK(delta!=0),
 kind TEXT NOT NULL CHECK(kind IN ('redeem','usage','welcome')), code_id TEXT UNIQUE REFERENCES activation_codes(id),
 usage_id TEXT UNIQUE REFERENCES text_credit_usage(id), note TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK((kind='redeem' AND delta>0 AND code_id IS NOT NULL AND usage_id IS NULL)
 OR (kind='usage' AND delta<0 AND usage_id IS NOT NULL AND code_id IS NULL)
 OR (kind='welcome' AND delta>0 AND usage_id IS NULL AND code_id IS NULL))
);
INSERT INTO text_credit_ledger SELECT * FROM text_credit_ledger_old;
DROP TABLE text_credit_ledger_old;
CREATE INDEX text_credit_ledger_owner ON text_credit_ledger(user_id,created_at);
CREATE UNIQUE INDEX text_credit_welcome_once ON text_credit_ledger(user_id) WHERE kind='welcome';

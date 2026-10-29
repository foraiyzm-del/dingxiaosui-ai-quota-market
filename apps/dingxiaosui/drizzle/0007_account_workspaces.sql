CREATE TABLE account_workspaces (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  entries_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

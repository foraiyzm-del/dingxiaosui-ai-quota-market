CREATE TABLE auth_identities_center (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL CHECK(provider IN ('sites','local-test','password','zlg')),
 subject TEXT NOT NULL,
 verified_at TEXT NOT NULL
);
INSERT INTO auth_identities_center SELECT * FROM auth_identities;
DROP TABLE auth_identities;
ALTER TABLE auth_identities_center RENAME TO auth_identities;
CREATE UNIQUE INDEX identity_provider_subject ON auth_identities(provider,subject);
CREATE UNIQUE INDEX identity_user_provider ON auth_identities(user_id,provider);

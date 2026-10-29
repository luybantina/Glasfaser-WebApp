CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, commit_id TEXT NOT NULL DEFAULT '');
INSERT INTO meta(id) VALUES(1);
CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(collection,id));
CREATE UNIQUE INDEX unique_login ON records(lower(json_extract(payload,'$.login'))) WHERE collection='users';
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, credential_hash TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE login_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);

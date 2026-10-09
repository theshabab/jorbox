PRAGMA foreign_keys = ON;
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  has_categories INTEGER NOT NULL CHECK (has_categories IN (0, 1))
);
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (length(trim(name)) > 0 OR length(trim(description)) > 0)
);
CREATE INDEX cards_game ON cards(game_id, deleted_at);
CREATE TABLE votes (
  card_id TEXT NOT NULL REFERENCES cards(id),
  actor TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (card_id, actor)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  github_id TEXT NOT NULL,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Ephemeral preconditions used inside an atomic D1 batch to reject stale bulk edits.
CREATE TABLE write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK (valid = 1));

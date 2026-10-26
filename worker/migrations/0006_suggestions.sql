-- Card ideas sent by players, waiting for an administrator to accept or reject.
-- The submitter identity is kept only for rate limiting; reports show the
-- GitHub login when the player was signed in.
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  login TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  reviewed_at INTEGER,
  card_id TEXT,
  CHECK (length(trim(name)) > 0 OR length(trim(description)) > 0)
);
CREATE INDEX suggestions_status ON suggestions(status, created_at);
CREATE INDEX suggestions_actor ON suggestions(actor, status);

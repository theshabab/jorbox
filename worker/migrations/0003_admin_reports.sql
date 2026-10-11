-- Supports category review revisions and per-game activity pagination.
CREATE INDEX audit_log_game ON audit_log(game_id);

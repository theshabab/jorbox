-- Records the administrator's GitHub login at the time of each change so the
-- activity history is readable. Older entries keep an empty login.
ALTER TABLE audit_log ADD COLUMN login TEXT NOT NULL DEFAULT '';

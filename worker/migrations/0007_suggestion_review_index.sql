-- Reviewed history is paginated by review time, independently of submission time.
CREATE INDEX suggestions_reviewed ON suggestions(status, reviewed_at);

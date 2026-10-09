ALTER TABLE games ADD COLUMN card_format TEXT NOT NULL DEFAULT 'flexible'
  CHECK (card_format IN ('flexible', 'name', 'description', 'name-description'));
ALTER TABLE games ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN deleted_at INTEGER;
-- Match single-field legacy decks; mixed decks retain their existing flexibility.
UPDATE games SET card_format='name'
WHERE EXISTS (SELECT 1 FROM cards WHERE game_id=games.id)
  AND NOT EXISTS (SELECT 1 FROM cards WHERE game_id=games.id AND (length(trim(name))=0 OR length(trim(description))>0));
UPDATE games SET card_format='description'
WHERE EXISTS (SELECT 1 FROM cards WHERE game_id=games.id)
  AND NOT EXISTS (SELECT 1 FROM cards WHERE game_id=games.id AND (length(trim(description))=0 OR length(trim(name))>0));

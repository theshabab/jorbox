-- Games whose description is an answer (such as Trivia) can hide it until a
-- player taps to reveal. Administrators change this per game.
ALTER TABLE games ADD COLUMN reveal_description INTEGER NOT NULL DEFAULT 0 CHECK (reveal_description IN (0, 1));
-- The original Trivia deck stores each answer in the description.
UPDATE games SET reveal_description = 1 WHERE id = 'game9';

-- Tareekhi is played like the physical card: the front names the item and the
-- position or value is on the back, so hide the description until the card is
-- flipped (Reveal answer). Administrators can still change this per game.
UPDATE games SET reveal_description = 1 WHERE id = 'game15';

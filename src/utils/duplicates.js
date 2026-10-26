const normalize = (value) =>
  (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function findDuplicateGroups(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = JSON.stringify([
      normalize(card.Name),
      normalize(card.Description),
      normalize(card.Category),
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  // Keep the copy with the most feedback by default (it holds the most player
  // data), then the oldest by natural ID order, so game1-9 comes before game1-10.
  const votes = (card) => (card.likes || 0) + (card.dislikes || 0);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      [...group].sort(
        (a, b) =>
          votes(b) - votes(a) ||
          a.id.localeCompare(b.id, undefined, { numeric: true }),
      ),
    );
}

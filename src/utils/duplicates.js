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
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => a.id.localeCompare(b.id)));
}

import Papa from 'papaparse';

export function parseCardCsv(text, game, mode) {
  const parsed = Papa.parse(text, { header: true, delimiter: ',', skipEmptyLines: 'greedy', transformHeader: header => header.trim().replace(/^\uFEFF/, '') });
  const errors = parsed.errors.map(error => `CSV ${error.row === undefined ? '' : `row ${error.row + 2}: `}${error.message}`);
  const fields = parsed.meta.fields || [];
  const allowed = ['id', 'version', 'Name', 'Description', 'Category', 'likes', 'dislikes', 'myVote'];
  for (const field of fields) if (!allowed.includes(field)) errors.push(`Unknown column: ${field}. Use Name, Description, Category, id, and version.`);
  if (!fields.includes('Name') && !fields.includes('Description')) errors.push('CSV must include Name or Description.');
  if (!parsed.data.length) errors.push('The file contains no cards.');
  if (parsed.data.length > 100) errors.push('Import at most 100 rows at a time. Split larger files before uploading.');
  const ids = new Set();
  const cards = parsed.data.map((row, index) => {
    const card = { Name: row.Name?.trim() || '', Description: row.Description?.trim() || '', Category: row.Category?.trim() || '' };
    if (!card.Name && !card.Description) errors.push(`Row ${index + 2}: a name or description is required.`);
    for (const [key, limit] of [['Name', 500], ['Description', 10000], ['Category', 200]]) {
      if (card[key].length > limit) errors.push(`Row ${index + 2}: ${key} exceeds ${limit} characters.`);
    }
    if (game.hasCategories && !card.Category) errors.push(`Row ${index + 2}: a category is required.`);
    if (!game.hasCategories && card.Category) errors.push(`Row ${index + 2}: this game does not have categories.`);
    if (mode === 'edit') {
      card.id = row.id?.trim();
      card.version = Number(row.version);
      if (!card.id || !Number.isSafeInteger(card.version) || card.version < 1) errors.push(`Row ${index + 2}: editing requires the exported id and version.`);
      if (ids.has(card.id)) errors.push(`Row ${index + 2}: duplicate card ID.`);
      ids.add(card.id);
    }
    return card;
  });
  return { cards, errors };
}

export function exportCardCsv(cards) {
  return Papa.unparse(cards.map(({ id, version, Name, Description, Category, likes, dislikes }) => ({ id, version, Name, Description, Category, likes, dislikes })), { escapeFormulae: true });
}

import Papa from 'papaparse';
import { cardErrors, MAX_BULK_ROWS } from './cardFormats.js';

// Export protects spreadsheet users by prefixing formula-like cells with an apostrophe.
// Remove that prefix on import so an export/edit/import round trip keeps text such as "-40".
const unescapeFormula = (value) => value.replace(/^'(?=[=+\-@\t\r])/, '');
const cell = (value) => unescapeFormula(value?.trim() || '').trim();

export function parseCardCsv(text, game, mode) {
  const parsed = Papa.parse(text, {
    header: true,
    delimiter: ',',
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, ''),
  });
  const errors = parsed.errors.map(
    (error) =>
      `CSV ${error.row === undefined ? '' : `row ${error.row + 2}: `}${error.message}`,
  );
  const fields = parsed.meta.fields || [];
  const allowed = [
    'id',
    'version',
    'Name',
    'Description',
    'Category',
    'likes',
    'dislikes',
    'myVote',
  ];
  for (const field of fields)
    if (!allowed.includes(field))
      errors.push(
        `Unknown column: ${field}. Use Name, Description, Category, id, and version.`,
      );
  if (
    mode !== 'feedback' &&
    !fields.includes('Name') &&
    !fields.includes('Description')
  )
    errors.push('CSV must include Name or Description.');
  if (mode === 'feedback' && !fields.includes('myVote'))
    errors.push(
      'Feedback CSV must include myVote (1 = like, -1 = dislike, 0 = clear).',
    );
  if (!parsed.data.length) errors.push('The file contains no cards.');
  if (parsed.data.length > MAX_BULK_ROWS)
    errors.push(
      `Import at most ${MAX_BULK_ROWS} rows at a time. Split larger files before uploading.`,
    );
  const ids = new Set();
  const cards = parsed.data.map((row, index) => {
    const card = {
      Name: cell(row.Name),
      Description: cell(row.Description),
      Category: cell(row.Category),
    };
    if (mode !== 'feedback')
      errors.push(
        ...cardErrors(card, game).map((error) => `Row ${index + 2}: ${error}`),
      );
    if (mode === 'edit' || mode === 'feedback') {
      card.id = row.id?.trim();
      card.version = Number(row.version);
      if (!card.id || !Number.isSafeInteger(card.version) || card.version < 1)
        errors.push(
          `Row ${index + 2}: editing requires the exported id and version.`,
        );
      if (ids.has(card.id)) errors.push(`Row ${index + 2}: duplicate card ID.`);
      ids.add(card.id);
    }
    if (mode === 'feedback') {
      card.value = Number(row.myVote);
      if (!row.myVote?.trim() || ![1, -1, 0].includes(card.value))
        errors.push(`Row ${index + 2}: myVote must be 1, -1, or 0.`);
    }
    return card;
  });
  return { cards, errors };
}

export function exportCardCsv(cards) {
  return Papa.unparse(
    cards.map(
      ({
        id,
        version,
        Name,
        Description,
        Category,
        likes,
        dislikes,
        myVote = 0,
      }) => ({
        id,
        version,
        Name,
        Description,
        Category,
        likes,
        dislikes,
        myVote,
      }),
    ),
    { escapeFormulae: true },
  );
}

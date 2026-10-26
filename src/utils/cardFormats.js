// Shared by the frontend and the Worker so client and server rules cannot drift.
export const CARD_LIMITS = { Name: 500, Description: 10000, Category: 200 };
export const MAX_BULK_ROWS = 100;
export const MAX_BODY_BYTES = 512 * 1024;

export const CARD_FORMATS = [
  {
    value: 'flexible',
    label: 'Name or description',
    help: 'Each card needs a name, a description, or both.',
  },
  {
    value: 'name',
    label: 'Name only',
    help: 'Each card needs a name. Description is not used.',
  },
  {
    value: 'description',
    label: 'Description only',
    help: 'Each card needs a description. Name is not used.',
  },
  {
    value: 'name-description',
    label: 'Name and description',
    help: 'Each card needs both a name and a description.',
  },
];

export function cardErrors(card, game) {
  const errors = [];
  if (!card.Name?.trim() && !card.Description?.trim())
    errors.push('a name or description is required.');
  if (
    game.cardFormat === 'name' &&
    (!card.Name?.trim() || card.Description?.trim())
  )
    errors.push('this game requires name-only cards.');
  if (
    game.cardFormat === 'description' &&
    (!card.Description?.trim() || card.Name?.trim())
  )
    errors.push('this game requires description-only cards.');
  if (
    game.cardFormat === 'name-description' &&
    (!card.Name?.trim() || !card.Description?.trim())
  )
    errors.push('this game requires both a name and description.');
  for (const [key, limit] of Object.entries(CARD_LIMITS)) {
    if ((card[key] || '').length > limit)
      errors.push(`${key} exceeds ${limit} characters.`);
  }
  if (game.hasCategories && !card.Category?.trim())
    errors.push('a category is required.');
  if (!game.hasCategories && card.Category?.trim())
    errors.push('this game does not have categories.');
  return errors;
}

// Decks store structure in plain text. These helpers recognise the common
// shapes so cards can be laid out for play instead of shown as raw text.

// "city | Pakistan | Sindh" (banned words, word lists) -> ['city', 'Pakistan', 'Sindh']
export function splitList(text) {
  if (!text?.includes('|')) return null;
  const items = text
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length >= 2 ? items : null;
}

// "NOT LIKELY <---> VERY LIKELY" -> ['NOT LIKELY', 'VERY LIKELY']
export function splitSpectrum(text) {
  const match = text?.match(/^(.+?)\s*<-{2,}>\s*(.+)$/);
  return match ? [match[1].trim(), match[2].trim()] : null;
}

// "I called my teacher ____." -> ['I called my teacher ', '____', '.']
export const splitBlanks = (text) => text.split(/(_{3,})/);
export const isBlank = (part) => /^_{3,}$/.test(part);

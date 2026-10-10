import { useState } from 'react';
import CardFields from './CardFields';
import { cardErrors } from '../utils/cardFormats';

export default function BulkCardEditor({
  cards,
  game,
  onReview,
  onCancel,
  onDraftChange,
}) {
  const [rows, setRows] = useState(() => cards.map((card) => ({ ...card })));
  const [changes, setChanges] = useState({});
  const fields = [
    'Name',
    'Description',
    ...(game.hasCategories ? ['Category'] : []),
  ].filter(
    (field) =>
      !(field === 'Name' && game.cardFormat === 'description') &&
      !(field === 'Description' && game.cardFormat === 'name'),
  );
  const errors = rows.flatMap((card, index) =>
    cardErrors(card, game).map((error) => `Card ${index + 1}: ${error}`),
  );
  function apply() {
    onDraftChange();
    setRows((previous) =>
      previous.map((card) => ({
        ...card,
        ...Object.fromEntries(
          fields
            .filter((field) => changes[field]?.enabled)
            .map((field) => [field, changes[field].value || '']),
        ),
      })),
    );
  }
  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        onReview(rows);
      }}
    >
      <h3>Edit {rows.length} selected cards</h3>
      <p className="muted">
        Edit each card below, or choose fields to replace across the selection.
        Unchecked fields keep their current content.
      </p>
      <div className="bulk-replacements">
        {fields.map((field) => (
          <div key={field}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={Boolean(changes[field]?.enabled)}
                onChange={(event) =>
                  setChanges({
                    ...changes,
                    [field]: {
                      ...changes[field],
                      enabled: event.target.checked,
                    },
                  })
                }
              />
              Replace {field.toLowerCase()} on every selected card
            </label>
            {changes[field]?.enabled && (
              <label>
                New {field.toLowerCase()}
                <textarea
                  rows={2}
                  maxLength={
                    field === 'Name'
                      ? 500
                      : field === 'Description'
                        ? 10000
                        : 200
                  }
                  value={changes[field].value || ''}
                  onChange={(event) =>
                    setChanges({
                      ...changes,
                      [field]: { ...changes[field], value: event.target.value },
                    })
                  }
                />
                <span className="muted">An empty value clears this field.</span>
              </label>
            )}
          </div>
        ))}
        <button
          className="btn-secondary"
          type="button"
          disabled={!fields.some((field) => changes[field]?.enabled)}
          onClick={apply}
        >
          Apply replacements to draft
        </button>
      </div>
      <div className="bulk-card-drafts">
        {rows.map((card, index) => (
          <div className="bulk-card-draft" key={card.id}>
            <h4>
              Card {index + 1}:{' '}
              {cards[index].Name || cards[index].Description.slice(0, 60)}
            </h4>
            <CardFields
              card={card}
              game={game}
              onChange={(updated) => {
                onDraftChange();
                setRows((previous) =>
                  previous.map((row) =>
                    row.id === updated.id ? updated : row,
                  ),
                );
              }}
            />
          </div>
        ))}
      </div>
      {errors.length > 0 && (
        <ul className="error">
          {errors.slice(0, 10).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button
          className="btn-primary"
          type="submit"
          disabled={errors.length > 0}
        >
          Review all edits
        </button>
        <button className="btn-secondary" type="button" onClick={onCancel}>
          Cancel bulk edit
        </button>
      </div>
    </form>
  );
}

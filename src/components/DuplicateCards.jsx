import { useMemo } from 'react';
import { findDuplicateGroups } from '../utils/duplicates';

export default function DuplicateCards({ cards, onSelect }) {
  const groups = useMemo(() => findDuplicateGroups(cards), [cards]);
  const extras = groups.flatMap((group) => group.slice(1));
  return (
    <div className="editor" aria-label="Duplicate card detection">
      <h3>Duplicate card detection</h3>
      <p className="muted">
        Matches name, description, and category while ignoring capitalization
        and extra whitespace. Review each match before removing anything.
        Different categories remain distinct.
      </p>
      {!groups.length ? (
        <p role="status">No duplicate cards found.</p>
      ) : (
        <>
          <p>
            {groups.length} duplicate groups · {extras.length} extra copies
          </p>
          <button
            className="btn-secondary"
            onClick={() =>
              onSelect(extras.slice(0, 100).map((card) => card.id))
            }
          >
            Select {Math.min(100, extras.length)} extra copies
          </button>
          <div className="duplicate-groups">
            {groups.slice(0, 50).map((group) => (
              <div className="bulk-card-draft" key={group[0].id}>
                <strong>
                  {group[0].Name || group[0].Description.slice(0, 100)}
                </strong>
                <p className="muted">
                  {group.length} copies
                  {group[0].Category && ` · ${group[0].Category}`}
                </p>
                <ul>
                  {group.map((card, index) => (
                    <li key={card.id}>
                      {index === 0 ? 'Keep by default' : 'Extra copy'} ·{' '}
                      {card.id} · +{card.likes} / −{card.dislikes}
                    </li>
                  ))}
                </ul>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    onSelect(group.map((card) => card.id).slice(0, 100))
                  }
                >
                  Select this group
                </button>
              </div>
            ))}
          </div>
          {groups.length > 50 && (
            <p className="muted">
              Showing the first 50 groups. Extra-copy selection includes all
              groups, up to 100 cards at a time.
            </p>
          )}
        </>
      )}
    </div>
  );
}

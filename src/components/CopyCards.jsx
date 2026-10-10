import { useState } from 'react';
import { DataManager } from '../utils/DataManager';
import { cardErrors } from '../utils/cardFormats';

export default function CopyCards({
  sourceGame,
  cards,
  games,
  onCopied,
  onCancel,
}) {
  const [targetId, setTargetId] = useState('');
  const [category, setCategory] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = games.find((game) => game.id === targetId);
  const copies = target
    ? cards.map((card) => ({
        ...card,
        Category: target.hasCategories ? category.trim() || card.Category : '',
      }))
    : [];
  const errors = target
    ? copies.flatMap((card, index) =>
        cardErrors(card, target).map((error) => `Card ${index + 1}: ${error}`),
      )
    : [];
  async function save() {
    setBusy(true);
    setError('');
    try {
      await DataManager.copyCards(sourceGame.id, {
        cards: cards.map(({ id, version }) => ({ id, version })),
        targetId,
        targetVersion: target.version,
        category: category.trim(),
      });
      onCopied(`${cards.length} cards copied to ${target.name}.`);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="editor" aria-label="Copy selected cards">
      <h3>Copy {cards.length} cards to another game</h3>
      <p className="muted">
        Copies get new IDs and start with no votes. The source cards and their
        feedback stay as they are.
      </p>
      {error && (
        <p className="error notice" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <label>
          Destination game
          <select
            aria-label="Destination game"
            value={targetId}
            onChange={(event) => {
              setTargetId(event.target.value);
              setCategory('');
              setReviewing(false);
            }}
          >
            <option value="">Choose a game…</option>
            {games
              .filter((game) => game.id !== sourceGame.id)
              .map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
          </select>
        </label>
        {target?.hasCategories && (
          <label>
            Category for copies
            <input
              maxLength={200}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setReviewing(false);
              }}
            />
            <span className="muted">
              Leave blank to preserve source categories. A category is required
              for uncategorized source cards.
            </span>
          </label>
        )}
        {target && !target.hasCategories && (
          <p className="muted">
            The destination has no categories, so category text is omitted from
            the new copies.
          </p>
        )}
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
            disabled={!target || errors.length > 0}
            onClick={() => setReviewing(true)}
          >
            Review copies
          </button>
          <button className="btn-secondary" onClick={onCancel}>
            Cancel copy
          </button>
        </div>
      </fieldset>
      {reviewing && (
        <div className="review-panel" aria-label="Review copies">
          <h3>
            Confirm {cards.length} new cards in {target.name}
          </h3>
          <ul className="review-items">
            {copies.map((card) => (
              <li key={card.id}>
                <strong>{card.Name || 'Description-only card'}</strong>
                <p>{card.Description}</p>
                {card.Category && <span>{card.Category}</span>}
              </li>
            ))}
          </ul>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Copying…' : 'Confirm copies'}
          </button>
        </div>
      )}
    </div>
  );
}

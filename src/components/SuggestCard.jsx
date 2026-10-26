import { useState } from 'react';
import { DataManager } from '../utils/DataManager';
import { cardErrors } from '../utils/cardFormats';
import CardFields from './CardFields';
import Dialog from './Dialog';

// Lets a player propose a card for the open deck. Administrators review every
// suggestion before it can become a card, so nothing here changes the deck.
export default function SuggestCard({ game, categories, onClose }) {
  const [card, setCard] = useState({ Name: '', Description: '', Category: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // The category is optional for players; an administrator picks one on accepting.
  const errors = cardErrors(
    { ...card, Category: '' },
    { cardFormat: game.cardFormat, hasCategories: false },
  );
  async function send(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await DataManager.suggest(game.id, card);
      setSent(true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Suggest a card for ${game.name}`}
      onClose={() => !busy && onClose()}
    >
      {sent ? (
        <div className="editor">
          <p role="status" className="notice success">
            Thanks! An administrator will review your card before it joins the
            deck.
          </p>
          <div className="button-row">
            <button
              className="btn-primary"
              onClick={() => {
                setCard({ Name: '', Description: '', Category: '' });
                setSent(false);
              }}
            >
              Suggest another
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="editor" onSubmit={send}>
          <p className="muted">
            Write a card in the same style as this deck. Keep it family
            friendly. An administrator reviews every suggestion.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy}>
            <CardFields
              card={card}
              game={game}
              onChange={setCard}
              categoryList="suggest-categories"
              categoryRequired={false}
            />
          </fieldset>
          <datalist id="suggest-categories">
            {categories.map((category) => (
              <option key={category.name} value={category.name} />
            ))}
          </datalist>
          <div className="button-row">
            <button
              className="btn-primary"
              type="submit"
              disabled={busy || errors.length > 0}
            >
              {busy ? 'Sending…' : 'Send suggestion'}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

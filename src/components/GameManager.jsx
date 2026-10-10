import { useEffect, useState } from 'react';
import { DataManager } from '../utils/DataManager';
import { CARD_FORMATS } from '../utils/cardFormats';

const newGame = {
  name: '',
  cardFormat: 'flexible',
  hasCategories: false,
  defaultCategory: '',
  clearCategories: false,
};

export default function GameManager({ games, onChanged }) {
  const [editor, setEditor] = useState(null);
  const [pending, setPending] = useState(null);
  const [removed, setRemoved] = useState(false);
  const [trash, setTrash] = useState([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!removed) return;
    let active = true;
    DataManager.fetchGames(true)
      .then((rows) => {
        if (active) setTrash(rows);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [removed, revision]);
  function review(action, game) {
    setPending({ action, game });
    setError('');
    setMessage('');
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await DataManager.manageGame(pending.action, pending.game);
      setMessage(
        `Game ${pending.action === 'create' ? 'created' : pending.action === 'edit' ? 'updated' : pending.action === 'restore' ? 'restored' : 'removed'}.`,
      );
      setPending(null);
      setEditor(null);
      if (removed) {
        setLoading(true);
        setRevision((value) => value + 1);
      }
      await onChanged();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const source = removed ? trash : games;
  return (
    <section className="glass-panel manager" aria-label="Game management">
      <div className="manager-heading">
        <div>
          <h2>Manage games & card formats</h2>
          <p className="muted">
            Create decks, choose their card fields, and restore removed games.
          </p>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <fieldset disabled={busy || loading}>
        <div className="button-row toolbar">
          <button
            className="btn-primary"
            onClick={() => {
              setEditor({ ...newGame });
              setPending(null);
            }}
          >
            Add a game
          </button>
          <button
            className="btn-secondary"
            aria-pressed={removed}
            onClick={() => {
              setRemoved(!removed);
              setLoading(!removed);
              setEditor(null);
              setPending(null);
            }}
          >
            {removed ? 'Show active games' : 'Show removed games'}
          </button>
        </div>
        {loading && <p role="status">Loading games…</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Game</th>
                <th>Card format</th>
                <th>Cards</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {source.map((game) => (
                <tr key={game.id}>
                  <td>
                    <strong>{game.name}</strong>
                    {game.hasCategories && (
                      <p className="muted">With categories</p>
                    )}
                  </td>
                  <td>
                    {
                      CARD_FORMATS.find(
                        (format) => format.value === game.cardFormat,
                      )?.label
                    }
                  </td>
                  <td>{game.cardCount}</td>
                  <td>
                    <div className="button-row">
                      {!removed && (
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setEditor({
                              ...game,
                              defaultCategory: '',
                              clearCategories: false,
                            });
                            setPending(null);
                          }}
                        >
                          Edit game
                        </button>
                      )}
                      <button
                        className={removed ? 'btn-secondary' : 'btn-danger'}
                        onClick={() =>
                          review(removed ? 'restore' : 'remove', game)
                        }
                      >
                        {removed ? 'Restore' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!source.length && !loading && (
          <p className="empty-state">
            No {removed ? 'removed' : 'active'} games.
          </p>
        )}
        {editor && (
          <form
            className="editor"
            onSubmit={(event) => {
              event.preventDefault();
              review(editor.id ? 'edit' : 'create', editor);
            }}
          >
            <h3>{editor.id ? 'Edit game' : 'New game'}</h3>
            <label>
              Game name
              <input
                required
                maxLength={200}
                value={editor.name}
                onChange={(event) => {
                  setEditor({ ...editor, name: event.target.value });
                  setPending(null);
                }}
              />
            </label>
            <label>
              Card format
              <select
                aria-label="Card format"
                value={editor.cardFormat}
                onChange={(event) => {
                  setEditor({ ...editor, cardFormat: event.target.value });
                  setPending(null);
                }}
              >
                {CARD_FORMATS.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              {
                CARD_FORMATS.find(
                  (format) => format.value === editor.cardFormat,
                )?.help
              }{' '}
              Existing cards, including removed cards, must fit the new format.
              Content is never silently discarded.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editor.hasCategories}
                onChange={(event) => {
                  setEditor({ ...editor, hasCategories: event.target.checked });
                  setPending(null);
                }}
              />
              Use categories
            </label>
            {editor.hasCategories && editor.id && (
              <label>
                Default category for uncategorized cards
                <input
                  maxLength={200}
                  value={editor.defaultCategory}
                  onChange={(event) => {
                    setEditor({
                      ...editor,
                      defaultCategory: event.target.value,
                    });
                    setPending(null);
                  }}
                />
                <span className="muted">
                  Required when adding categories to an existing deck. Existing
                  categories stay as they are.
                </span>
              </label>
            )}
            {!editor.hasCategories && editor.id && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editor.clearCategories}
                  onChange={(event) => {
                    setEditor({
                      ...editor,
                      clearCategories: event.target.checked,
                    });
                    setPending(null);
                  }}
                />
                Clear categories from all cards, including removed cards
              </label>
            )}
            {!editor.hasCategories && editor.id && (
              <p className="muted">
                If cards have categories, explicitly choose to clear them before
                disabling this field. Export cards first to keep a copy.
              </p>
            )}
            <div className="button-row">
              <button
                className="btn-primary"
                type="submit"
                disabled={!editor.name.trim()}
              >
                Review game
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  setEditor(null);
                  setPending(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </fieldset>
      {pending && (
        <div className="review-panel" aria-label="Review game changes">
          <h3>
            Confirm{' '}
            {pending.action === 'create'
              ? 'new game'
              : `${pending.action} game`}
            : {pending.game.name}
          </h3>
          {['create', 'edit'].includes(pending.action) ? (
            <>
              <p>
                {
                  CARD_FORMATS.find(
                    (format) => format.value === pending.game.cardFormat,
                  )?.label
                }{' '}
                ·{' '}
                {pending.game.hasCategories
                  ? 'With categories'
                  : 'Without categories'}
              </p>
              {pending.game.hasCategories && pending.game.defaultCategory && (
                <p>
                  Uncategorized cards, including removed cards, will move to “
                  {pending.game.defaultCategory.trim()}”.
                </p>
              )}
              {!pending.game.hasCategories && pending.game.clearCategories && (
                <p className="error">
                  Category text will be cleared from every card in this game,
                  including removed cards. This cannot be undone automatically.
                </p>
              )}
            </>
          ) : (
            <p>
              {pending.action === 'remove'
                ? `This hides the game and its ${pending.game.cardCount} active cards from players. Cards and feedback are retained so you can restore the game later.`
                : 'This returns the game to players. Individually removed cards stay in card trash.'}
            </p>
          )}
          <div className="button-row">
            <button
              className={
                pending.action === 'remove' ? 'btn-danger' : 'btn-primary'
              }
              disabled={busy || loading}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Confirm game changes'}
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

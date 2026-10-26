import { useEffect, useEffectEvent, useState } from 'react';
import { DataManager } from '../utils/DataManager';
import { CARD_FORMATS, cardErrors } from '../utils/cardFormats';
import CardFields from './CardFields';
import Dialog from './Dialog';

const STATUSES = [
  ['pending', 'Waiting for review'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
];
const time = (value) => new Date(value * 1000).toLocaleString();

// Review queue for cards suggested by players. Accepting lets the
// administrator edit the card first; it then joins the deck as a new card.
export default function SuggestionsReview({
  games,
  onPendingChange,
  onOpenCards,
}) {
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [before, setBefore] = useState(null);
  const [cursors, setCursors] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [accepting, setAccepting] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState(false);
  const reportPending = useEffectEvent((count) => onPendingChange(count));
  useEffect(() => {
    let active = true;
    DataManager.fetchSuggestions(status, before)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError('');
        reportPending(result.pending);
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
  }, [status, before, revision]);
  const gameOf = (suggestion) =>
    games.find((game) => game.id === suggestion.gameId);
  function refresh() {
    setBefore(null);
    setCursors([]);
    setData(null);
    setError('');
    setLoading(true);
    setRevision((value) => value + 1);
  }
  async function review(suggestion, data) {
    setBusy(true);
    setError('');
    try {
      await DataManager.reviewSuggestion(suggestion.id, data);
      setMessage(
        data.action === 'accept'
          ? `Card added to ${suggestion.gameName}.`
          : 'Suggestion rejected.',
      );
      setAccepting(null);
      setRejecting(null);
      refresh();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const acceptingGame = accepting && gameOf(accepting.suggestion);
  const acceptanceErrors = acceptingGame
    ? cardErrors(accepting.card, acceptingGame)
    : [];
  const unusedFields = acceptingGame
    ? [
        ...(acceptingGame.cardFormat === 'description' ? ['Name'] : []),
        ...(acceptingGame.cardFormat === 'name' ? ['Description'] : []),
        ...(!acceptingGame.hasCategories ? ['Category'] : []),
      ].filter((field) => accepting.card[field]?.trim())
    : [];
  return (
    <section
      className="glass-panel manager"
      aria-label="Card suggestions"
      aria-busy={loading}
    >
      <div className="manager-heading">
        <div>
          <h2>Card suggestions</h2>
          <p className="muted">
            Ideas sent by players. Nothing joins a deck until you accept it, and
            you can edit a card before accepting.
          </p>
        </div>
        <button className="btn-secondary" disabled={loading} onClick={refresh}>
          Refresh
        </button>
      </div>
      <div className="notices">
        {error && !accepting && !rejecting && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
      </div>
      <label className="status-filter">
        Show
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setMessage('');
            refresh();
          }}
        >
          {STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p role="status">Loading suggestions…</p>
      ) : !data ? null : !data.suggestions.length ? (
        <p className="empty-state">
          {status === 'pending'
            ? 'No suggestions are waiting. Players can suggest cards from the play screen.'
            : `No ${status} suggestions yet.`}
        </p>
      ) : (
        <ul className="suggestion-list">
          {data.suggestions.map((suggestion) => (
            <li key={suggestion.id} className="suggestion">
              <div className="suggestion-meta muted">
                <strong>{suggestion.gameName}</strong> ·{' '}
                {suggestion.login || 'Anonymous player'} ·{' '}
                <time
                  dateTime={new Date(suggestion.createdAt * 1000).toISOString()}
                >
                  {time(suggestion.createdAt)}
                </time>
              </div>
              {suggestion.Name && (
                <p className="suggestion-name">{suggestion.Name}</p>
              )}
              {suggestion.Description && (
                <p className="table-description">{suggestion.Description}</p>
              )}
              {suggestion.Category && (
                <span className="category-badge">{suggestion.Category}</span>
              )}
              <div className="row-actions">
                {status === 'pending' && (
                  <>
                    <button
                      className="btn-primary"
                      disabled={!gameOf(suggestion)}
                      onClick={() => {
                        setError('');
                        setAccepting({
                          suggestion,
                          card: {
                            Name: suggestion.Name,
                            Description: suggestion.Description,
                            Category: suggestion.Category,
                          },
                        });
                      }}
                    >
                      Review & accept
                    </button>
                    <button
                      className="btn-danger-quiet"
                      onClick={() => {
                        setError('');
                        setRejecting(suggestion);
                      }}
                    >
                      Reject
                    </button>
                    {!gameOf(suggestion) && (
                      <p className="muted">
                        Restore this game before accepting its suggestions.
                      </p>
                    )}
                  </>
                )}
                {status === 'accepted' &&
                  suggestion.cardId &&
                  gameOf(suggestion) && (
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        onOpenCards(gameOf(suggestion), suggestion.cardId)
                      }
                    >
                      View card
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && !loading && (
        <div className="button-row pagination" aria-label="Suggestion pages">
          <button
            className="btn-secondary"
            disabled={!cursors.length}
            onClick={() => {
              setBefore(cursors.at(-1));
              setCursors((values) => values.slice(0, -1));
              setData(null);
              setError('');
              setLoading(true);
            }}
          >
            Previous suggestions
          </button>
          <span>Page {cursors.length + 1}</span>
          <button
            className="btn-secondary"
            disabled={!data.nextCursor}
            onClick={() => {
              setCursors((values) => [...values, before]);
              setBefore(data.nextCursor);
              setData(null);
              setError('');
              setLoading(true);
            }}
          >
            Next suggestions
          </button>
        </div>
      )}
      {accepting && acceptingGame && (
        <Dialog
          title={`Accept into ${acceptingGame.name}`}
          onClose={() => !busy && setAccepting(null)}
        >
          <form
            className="editor"
            onSubmit={(event) => {
              event.preventDefault();
              review(accepting.suggestion, {
                action: 'accept',
                card: accepting.card,
              });
            }}
          >
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <p className="muted">
              Edit the card if needed. It is added as a new card with no votes.{' '}
              {
                CARD_FORMATS.find(
                  (format) => format.value === acceptingGame.cardFormat,
                )?.help
              }
            </p>
            <fieldset disabled={busy}>
              {unusedFields.map((field) => (
                <div className="notice" key={field}>
                  <p>
                    This game's current format does not use{' '}
                    {field.toLowerCase()}. Copy any text you want to keep into a
                    supported field before clearing it.
                  </p>
                  <p>{accepting.card[field]}</p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      setAccepting({
                        ...accepting,
                        card: { ...accepting.card, [field]: '' },
                      })
                    }
                  >
                    Clear unused {field.toLowerCase()}
                  </button>
                </div>
              ))}
              <CardFields
                card={accepting.card}
                game={acceptingGame}
                onChange={(card) => setAccepting({ ...accepting, card })}
              />
            </fieldset>
            {acceptanceErrors.length > 0 && (
              <ul className="error">
                {acceptanceErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
            <div className="button-row">
              <button
                className="btn-primary"
                type="submit"
                disabled={busy || acceptanceErrors.length > 0}
              >
                {busy ? 'Adding…' : 'Add card to deck'}
              </button>
              <button
                className="btn-secondary"
                type="button"
                disabled={busy}
                onClick={() => setAccepting(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {rejecting && (
        <Dialog
          title="Reject this suggestion?"
          onClose={() => !busy && setRejecting(null)}
        >
          <div className="review-panel">
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <p>
              “{rejecting.Name || rejecting.Description}” will not be added to{' '}
              {rejecting.gameName}. It stays in the rejected list.
            </p>
            <div className="button-row">
              <button
                className="btn-danger"
                disabled={busy}
                onClick={() => review(rejecting, { action: 'reject' })}
              >
                {busy ? 'Rejecting…' : 'Reject suggestion'}
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setRejecting(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { DataManager } from '../utils/DataManager';

const actionLabels = {
  import: 'Cards added',
  edit: 'Cards edited',
  remove: 'Cards removed',
  restore: 'Cards restored',
  feedback: 'Personal feedback changed',
  copy: 'Cards copied',
  'category:rename': 'Category renamed / merged',
  'game:create': 'Game created',
  'game:edit': 'Game updated',
  'game:remove': 'Game removed',
  'game:restore': 'Game restored',
};
const ratedShare = ({ ratedCards, cards }) => {
  const percent = (ratedCards / Math.max(1, cards)) * 100;
  return `${ratedCards && percent < 1 ? '<1' : Math.round(percent)}% of cards`;
};
const time = (value) => new Date(value * 1000).toLocaleString();

export default function AdminReports({ games, onOpenCards }) {
  const [tab, setTab] = useState('feedback');
  const [game, setGame] = useState('');
  const [archived, setArchived] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [before, setBefore] = useState(null);
  const [cursors, setCursors] = useState([]);
  useEffect(() => {
    let active = true;
    DataManager.fetchGames(true)
      .then((rows) => {
        if (active) setArchived(rows);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const request =
      tab === 'feedback'
        ? DataManager.fetchFeedbackOverview(game)
        : DataManager.fetchActivity(game, before);
    request
      .then((result) => {
        if (active) {
          setData(result);
          setError('');
        }
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
  }, [tab, game, before, revision]);
  function reset(update) {
    update();
    setBefore(null);
    setCursors([]);
    setData(null);
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function refresh() {
    setLoading(true);
    setRevision((value) => value + 1);
  }
  function open(card) {
    const target = games.find((game) => game.id === card.gameId);
    if (target) onOpenCards(target, card.id);
  }
  const availableGames = tab === 'activity' ? [...games, ...archived] : games;
  return (
    <section className="glass-panel manager" aria-label="Administrator reports">
      <div className="manager-heading">
        <div>
          <h2>Administrator reports</h2>
          <p className="muted">
            See deck feedback and the history of administrator changes.
          </p>
        </div>
        <button className="btn-secondary" onClick={refresh}>
          Refresh reports
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row toolbar">
        <button
          className="btn-secondary"
          aria-pressed={tab === 'feedback'}
          onClick={() =>
            reset(() => {
              setTab('feedback');
              setGame('');
            })
          }
        >
          Feedback overview
        </button>
        <button
          className="btn-secondary"
          aria-pressed={tab === 'activity'}
          onClick={() => reset(() => setTab('activity'))}
        >
          Activity log
        </button>
      </div>
      <label>
        Report game
        <select
          aria-label="Report game"
          value={game}
          onChange={(event) => reset(() => setGame(event.target.value))}
        >
          <option value="">All games</option>
          {availableGames.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {archived.some((old) => old.id === item.id) ? ' (removed)' : ''}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p role="status">Loading report…</p>
      ) : data && tab === 'feedback' ? (
        <>
          <p className="muted">
            Counts include active cards in active games. Anonymous feedback
            represents browser identities, not verified people.
          </p>
          {data.summary.likes + data.summary.dislikes === 0 ? (
            <p className="empty-state">
              No feedback yet across {data.summary.cards.toLocaleString()}{' '}
              cards. Likes and dislikes appear here once players start rating
              cards.
            </p>
          ) : (
            <>
              <div className="report-stats">
                {[
                  ['Cards', data.summary.cards],
                  [
                    'Rated cards',
                    data.summary.ratedCards,
                    ratedShare(data.summary),
                  ],
                  ['Likes', data.summary.likes],
                  ['Dislikes', data.summary.dislikes],
                ].map(([label, value, note]) => (
                  <div key={label}>
                    <strong>{value.toLocaleString()}</strong>
                    <span>{label}</span>
                    {note && <span className="muted">{note}</span>}
                  </div>
                ))}
              </div>
              {[
                ['Most disliked', data.disliked],
                ['Most liked', data.liked],
              ].map(([title, cards]) => (
                <div className="editor" key={title}>
                  <h3>{title}</h3>
                  {cards.length ? (
                    <div className="table-scroll">
                      <table className="stack-table">
                        <thead>
                          <tr>
                            <th>Card</th>
                            <th>Game</th>
                            <th>Likes</th>
                            <th>Dislikes</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cards.map((card) => (
                            <tr key={card.id}>
                              <td>
                                <strong>{card.Name}</strong>
                                <p className="table-description">
                                  {card.Description}
                                </p>
                              </td>
                              <td data-label="Game">{card.gameName}</td>
                              <td data-label="Likes">{card.likes}</td>
                              <td data-label="Dislikes">{card.dislikes}</td>
                              <td>
                                <button
                                  className="btn-secondary"
                                  onClick={() => open(card)}
                                >
                                  Review this card
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">
                      No {title === 'Most liked' ? 'likes' : 'dislikes'} yet.
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      ) : data && tab === 'activity' ? (
        <>
          <p className="muted">
            Administrator operations only. Individual player votes and
            login/session records are not shown.
          </p>
          {!data.entries.length ? (
            <p className="empty-state">No activity yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="stack-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Change</th>
                    <th>Game</th>
                    <th>Items</th>
                    <th>Administrator ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <time
                          dateTime={new Date(
                            entry.createdAt * 1000,
                          ).toISOString()}
                        >
                          {time(entry.createdAt)}
                        </time>
                      </td>
                      <td>
                        {actionLabels[entry.action] || entry.action}
                        {entry.from && (
                          <p className="muted">
                            {entry.from} → {entry.to}
                          </p>
                        )}
                      </td>
                      <td data-label="Game">
                        {entry.gameName || entry.gameId}
                      </td>
                      <td data-label="Items">{entry.changed}</td>
                      <td data-label="Administrator">{entry.actorId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="button-row pagination">
            <button
              className="btn-secondary"
              disabled={!cursors.length}
              onClick={() => {
                setBefore(cursors.at(-1));
                setCursors((values) => values.slice(0, -1));
                setLoading(true);
              }}
            >
              Newer activity
            </button>
            <button
              className="btn-secondary"
              disabled={!data.nextCursor}
              onClick={() => {
                setCursors((values) => [...values, before]);
                setBefore(data.nextCursor);
                setLoading(true);
              }}
            >
              Older activity
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

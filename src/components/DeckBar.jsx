import { ArrowLeft, Maximize, Minimize, Shuffle, Timer } from 'lucide-react';

// Compact controls shown once a game is open: switch game, filter, reshuffle.
export default function DeckBar({
  games,
  game,
  onSelectGame,
  onHome,
  categories = [],
  category = null,
  onCategory,
  onReshuffle,
  onTimer,
  timerOpen = false,
  onPresent,
  presenting = false,
}) {
  return (
    <div className="deck-bar">
      <button className="btn-secondary" onClick={onHome} aria-label="All games">
        <ArrowLeft size={18} aria-hidden="true" />
        <span className="label-text">All games</span>
      </button>
      <label className="deck-field">
        <span className="sr-only">Select Game</span>
        <select
          id="game-select"
          value={game.id}
          onChange={(event) =>
            onSelectGame(games.find((item) => item.id === event.target.value))
          }
        >
          {games.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {onCategory && categories.length > 0 && (
        <label className="deck-field">
          <span className="sr-only">Filter by Category</span>
          <select
            id="category-select"
            value={category || ''}
            onChange={(event) => onCategory(event.target.value || null)}
          >
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count.toLocaleString()})
              </option>
            ))}
          </select>
        </label>
      )}
      {onReshuffle && (
        <button
          className="btn-secondary"
          onClick={onReshuffle}
          aria-label="Reshuffle"
        >
          <Shuffle size={18} aria-hidden="true" />
          <span className="label-text">Reshuffle</span>
        </button>
      )}
      {onTimer && (
        <button
          className="btn-secondary timer-toggle"
          onClick={onTimer}
          aria-pressed={timerOpen}
          aria-label="Timer"
        >
          <Timer size={18} aria-hidden="true" />
          <span className="label-text">Timer</span>
        </button>
      )}
      {onPresent && (
        <button
          className="btn-secondary present-toggle"
          onClick={onPresent}
          aria-pressed={presenting}
          aria-label={presenting ? 'Exit full screen' : 'Full screen'}
        >
          {presenting ? (
            <Minimize size={18} aria-hidden="true" />
          ) : (
            <Maximize size={18} aria-hidden="true" />
          )}
          <span className="label-text">
            {presenting ? 'Exit full screen' : 'Full screen'}
          </span>
        </button>
      )}
    </div>
  );
}

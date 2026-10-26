import { ArrowLeft, Shuffle, Timer } from 'lucide-react';

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
}) {
  return (
    <div className="deck-bar">
      <button className="btn-secondary" onClick={onHome}>
        <ArrowLeft size={18} aria-hidden="true" /> All games
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
              <option key={item} value={item}>
                {item}
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
          className="btn-secondary"
          onClick={onTimer}
          aria-pressed={timerOpen}
          aria-label="Timer"
        >
          <Timer size={18} aria-hidden="true" />
          <span className="label-text">Timer</span>
        </button>
      )}
    </div>
  );
}

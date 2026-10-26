import { useState } from 'react';
import { ArrowUpRight, Layers, Play, Search, X } from 'lucide-react';

// Home screen: every game as a tile with its size, so players can pick at a glance.
export default function GameSelector({
  games,
  onSelectGame,
  heading,
  continueGame = null,
  intro = '',
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visible = games.filter((game) =>
    game.name.toLocaleLowerCase().includes(search),
  );
  if (!games.length)
    return <p className="empty-state">No games are available yet.</p>;
  return (
    <section className="game-picker" aria-labelledby="game-picker-heading">
      {continueGame && (
        <button
          className="btn-primary continue-game"
          onClick={() => onSelectGame(continueGame)}
        >
          <Play size={18} aria-hidden="true" /> Continue {continueGame.name}
        </button>
      )}
      <h2 id="game-picker-heading">{heading}</h2>
      {intro && <p className="game-picker-intro muted">{intro}</p>}
      <div className="game-discovery">
        <div className="game-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Find a game"
            placeholder="Find your next game…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="Clear game search" onClick={() => setQuery('')}>
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="game-results muted" role="status">
          {search ? `${visible.length} of ${games.length}` : games.length}{' '}
          {games.length === 1 ? 'game' : 'games'}
          {!search && ' · A deck for every mood'}
        </p>
      </div>
      {!visible.length && (
        <div className="empty-state glass-panel">
          <p>No games match “{query.trim()}”.</p>
          <button className="btn-secondary" onClick={() => setQuery('')}>
            Show all games
          </button>
        </div>
      )}
      <ul className="game-tiles">
        {visible.map((game) => (
          <li key={game.id}>
            <button
              className="game-tile glass-panel"
              onClick={() => onSelectGame(game)}
            >
              <span className="game-tile-top" aria-hidden="true">
                <span className="game-tile-icon">
                  <Layers size={22} />
                </span>
                <ArrowUpRight className="game-tile-arrow" size={18} />
              </span>
              <span className="game-tile-name">{game.name}</span>
              <span className="game-tile-meta">
                {game.cardCount.toLocaleString()} cards
                {game.hasCategories && ' · Categories'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

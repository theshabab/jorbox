import { Layers } from 'lucide-react';

// Home screen: every game as a tile with its size, so players can pick at a glance.
export default function GameSelector({ games, onSelectGame, heading }) {
  if (!games.length)
    return <p className="empty-state">No games are available yet.</p>;
  return (
    <section className="game-picker" aria-labelledby="game-picker-heading">
      <h2 id="game-picker-heading">{heading}</h2>
      <ul className="game-tiles">
        {games.map((game) => (
          <li key={game.id}>
            <button
              className="game-tile glass-panel"
              onClick={() => onSelectGame(game)}
            >
              <Layers size={22} aria-hidden="true" />
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

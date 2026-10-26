import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle } from 'lucide-react';
import CardFeedback from './CardFeedback';
import { loadPosition, savePosition } from '../utils/deckOrder';

const SWIPE_DISTANCE = 50;
const typing = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
// Tilt only follows a real mouse, and never when the user asked for less motion.
const canTilt = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(hover: hover) and (pointer: fine)').matches &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function CardViewer({
  cards,
  gameId,
  filter,
  session,
  onVote,
  onReshuffle,
}) {
  const [index, setIndex] = useState(() => {
    const saved = loadPosition(gameId, filter);
    return Math.max(
      0,
      cards.findIndex((card) => card.id === saved),
    );
  });
  const [finished, setFinished] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [tiltEnabled] = useState(canTilt);
  const cardRef = useRef(null);
  const swipe = useRef(null);
  const current = Math.min(index, Math.max(0, cards.length - 1));
  const card = cards[current];
  const next = () =>
    current + 1 < cards.length ? setIndex(current + 1) : setFinished(true);
  const previous = () => {
    if (finished) setFinished(false);
    else if (current > 0) setIndex(current - 1);
  };
  const onKey = useEffectEvent((event) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      typing(event.target) ||
      document.querySelector('dialog[open]')
    )
      return;
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
    else return;
    event.preventDefault();
  });

  useEffect(() => {
    if (card) savePosition(gameId, filter, card.id);
  }, [gameId, filter, card]);

  useEffect(() => {
    const listener = (event) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (!card)
    return <p className="empty-state">No cards available in this category.</p>;

  function handleMouseMove(event) {
    if (!tiltEnabled) return;
    const rect = cardRef.current.getBoundingClientRect();
    setTilt({
      x:
        ((event.clientY - rect.top - rect.height / 2) / (rect.height / 2)) *
        -10,
      y: ((event.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 10,
    });
  }
  function endSwipe(event) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) next();
    else previous();
  }
  const length = card.Description.length;
  return (
    <div className="card-viewer">
      <p className="sr-only" aria-live="polite">
        {finished
          ? `End of deck. You have seen all ${cards.length} cards.`
          : `Card ${current + 1} of ${cards.length}: ${card.Name || card.Description.slice(0, 120)}`}
      </p>
      {finished ? (
        <div className="glass-panel playing-card deck-end">
          <h2>That’s the whole deck</h2>
          <p className="card-description">
            You’ve been through all {cards.length.toLocaleString()} cards.
          </p>
          <div className="button-row">
            <button
              className="btn-secondary"
              onClick={() => {
                setIndex(0);
                setFinished(false);
              }}
            >
              <RotateCcw size={18} aria-hidden="true" /> Start over
            </button>
            <button className="btn-primary" onClick={onReshuffle}>
              <Shuffle size={18} aria-hidden="true" /> Reshuffle
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTilt({ x: 0, y: 0 })}
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={endSwipe}
          onPointerCancel={() => {
            swipe.current = null;
          }}
          className="glass-panel playing-card"
          style={
            tiltEnabled
              ? {
                  transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                }
              : undefined
          }
        >
          {card.Name && (
            <h2 className={card.Name.length > 40 ? 'long-name' : undefined}>
              {card.Name}
            </h2>
          )}
          {card.Description && (
            <p
              className={`card-description${length > 900 ? ' very-long' : length > 280 ? ' long' : ''}`}
              tabIndex={length > 280 ? 0 : undefined}
            >
              {card.Description}
            </p>
          )}
          {card.Category && (
            <span className="category-badge">{card.Category}</span>
          )}
          <span className="card-position" aria-hidden="true">
            {current + 1} / {cards.length.toLocaleString()}
          </span>
        </div>
      )}
      <div className="viewer-controls">
        <button
          className="btn-secondary"
          disabled={current === 0 && !finished}
          onClick={previous}
        >
          <ChevronLeft size={20} aria-hidden="true" /> Previous
        </button>
        {!finished && (
          <CardFeedback
            key={card.id}
            card={card}
            session={session}
            onVote={onVote}
          />
        )}
        <button className="btn-primary" disabled={finished} onClick={next}>
          Next <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="viewer-hint muted">
        Tip: use the ← → keys or swipe the card.
      </p>
    </div>
  );
}

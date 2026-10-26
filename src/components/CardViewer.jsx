import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
  Shuffle,
  SkipForward,
} from 'lucide-react';
import CardFeedback from './CardFeedback';
import { CardDescription, CardTitle } from './CardText';
import { loadPosition, savePosition } from '../utils/deckOrder';
import { useWakeLock } from '../utils/useWakeLock';

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
  revealDescription = false,
  round = null,
}) {
  const [index, setIndex] = useState(() => {
    const saved = loadPosition(gameId, filter);
    return Math.max(
      0,
      cards.findIndex((card) => card.id === saved),
    );
  });
  const [finished, setFinished] = useState(false);
  const [revealedId, setRevealedId] = useState(null);
  const [direction, setDirection] = useState('forward');
  useWakeLock();
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [tiltEnabled] = useState(canTilt);
  const cardRef = useRef(null);
  const swipe = useRef(null);
  const current = Math.min(index, Math.max(0, cards.length - 1));
  const card = cards[current];
  const next = () => {
    setRevealedId(null);
    setDirection('forward');
    if (current + 1 < cards.length) setIndex(current + 1);
    else setFinished(true);
  };
  const previous = () => {
    setRevealedId(null);
    setDirection('back');
    if (finished) setFinished(false);
    else if (current > 0) setIndex(current - 1);
  };
  // During a timed round the forward/back actions score the card instead.
  const scoring = Boolean(round?.running) && !finished;
  const score = (got) => {
    if (round.record(card, got)) next();
  };
  const forward = () => (scoring ? score(true) : next());
  const back = () => (scoring ? score(false) : previous());
  // Answers stay hidden only when there is a question to show above them.
  const hidden =
    revealDescription &&
    Boolean(card?.Name && card?.Description) &&
    revealedId !== card?.id;
  const reveal = () => setRevealedId(card.id);
  const onKey = useEffectEvent((event) => {
    if (
      !card ||
      event.repeat ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      typing(event.target) ||
      document.querySelector('dialog[open]')
    )
      return;
    if (event.key === 'ArrowRight') forward();
    else if (event.key === 'ArrowLeft') back();
    else if (
      hidden &&
      (event.key === ' ' || event.key === 'Enter') &&
      !(event.target instanceof HTMLButtonElement)
    )
      reveal();
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
    return (
      <p className="empty-state">
        {filter
          ? 'No cards in this category yet.'
          : 'This game has no cards yet.'}
      </p>
    );

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
    if (dx < 0) forward();
    else back();
  }
  const descriptionId = `card-description-${card.id}`;
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
                setRevealedId(null);
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
          key={card.id}
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
          className={`glass-panel playing-card card-enter-${direction}`}
          style={
            tiltEnabled
              ? {
                  transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                }
              : undefined
          }
        >
          {card.Name && <CardTitle text={card.Name} />}
          {card.Description &&
            (hidden ? (
              <button
                className="btn-secondary reveal-button"
                aria-expanded="false"
                aria-controls={descriptionId}
                onClick={reveal}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Eye size={18} aria-hidden="true" /> Reveal answer
              </button>
            ) : (
              <CardDescription text={card.Description} id={descriptionId} />
            ))}
          {card.Category && (
            <span className="category-badge">{card.Category}</span>
          )}
          <span className="card-position" aria-hidden="true">
            {current + 1} / {cards.length.toLocaleString()}
          </span>
          <span
            className="card-progress"
            aria-hidden="true"
            style={{ width: `${((current + 1) / cards.length) * 100}%` }}
          />
        </div>
      )}
      {scoring ? (
        <div className="viewer-controls round-controls">
          <button className="btn-secondary" onClick={() => score(false)}>
            <SkipForward size={20} aria-hidden="true" /> Skip
          </button>
          <button className="btn-primary got-it" onClick={() => score(true)}>
            <Check size={20} aria-hidden="true" /> Got it
          </button>
        </div>
      ) : (
        <div className="viewer-controls">
          <button
            className="btn-secondary"
            aria-label="Previous"
            disabled={current === 0 && !finished}
            onClick={previous}
          >
            <ChevronLeft size={20} aria-hidden="true" />{' '}
            <span className="card-nav-label">Previous</span>
          </button>
          {!finished && (
            <CardFeedback
              key={card.id}
              card={card}
              session={session}
              onVote={onVote}
            />
          )}
          <button
            className="btn-primary"
            aria-label="Next"
            disabled={finished}
            onClick={next}
          >
            <span className="card-nav-label">Next</span>{' '}
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      <p className="viewer-hint muted">
        {scoring
          ? 'Tip: → or swipe left for Got it, ← or swipe right to skip.'
          : hidden
            ? 'Tip: press Space to reveal; use ← → or swipe to move.'
            : 'Tip: use the ← → keys or swipe the card.'}
      </p>
    </div>
  );
}

import { useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { ROUND_LENGTHS } from '../utils/useRound';

const format = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Timer, round summary and two-team scoreboard for timed party games.
// The round state lives in App so the card view can record Got it / Skip.
export default function RoundTimer({ round, scoreboard, onClose }) {
  // Which round's points were already added, so a tally is not counted twice.
  const [awarded, setAwarded] = useState(null);
  const got = round.results.filter((result) => result.got);
  const skipped = round.results.length - got.length;
  const finished = round.done && round.results.length > 0;
  return (
    <section
      className={`round-timer glass-panel${round.done ? ' done' : round.remaining <= 10 && round.running ? ' warning' : ''}`}
      aria-label="Round timer"
    >
      <div className="timer-row">
        <span className="timer-display" role="timer" aria-live="off">
          {round.done ? 'Time’s up!' : format(round.remaining)}
        </span>
        <p className="sr-only" aria-live="assertive">
          {round.done ? 'Time’s up!' : ''}
        </p>
        <div className="timer-controls">
          <button
            className="btn-primary"
            onClick={round.toggle}
            aria-label={round.running ? 'Pause timer' : 'Start timer'}
          >
            {round.running ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
          </button>
          <button
            className="btn-secondary"
            onClick={round.reset}
            aria-label="Reset timer"
          >
            <RotateCcw size={18} aria-hidden="true" />
          </button>
          <label>
            <span className="sr-only">Round length</span>
            <select
              value={round.duration}
              onChange={(event) => round.choose(Number(event.target.value))}
            >
              {ROUND_LENGTHS.map((value) => (
                <option key={value} value={value}>
                  {format(value)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-secondary"
            onClick={onClose}
            aria-label="Close timer"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {!round.running && !finished && round.remaining === round.duration && (
        <p className="timer-help muted">
          Start the timer, then tap <strong>Got it</strong> or{' '}
          <strong>Skip</strong> for each card.
        </p>
      )}
      {(round.running || finished) && round.results.length > 0 && (
        <p className="round-tally" aria-live="polite">
          {got.length} got it · {skipped} skipped
        </p>
      )}
      {finished && (
        <div className="round-summary">
          <details>
            <summary>Cards this round</summary>
            <ul>
              {round.results.map((result, index) => (
                <li key={index} className={result.got ? 'got' : 'skipped'}>
                  {result.got ? '✓' : '–'} {result.label}
                </li>
              ))}
            </ul>
          </details>
          {got.length > 0 && (
            <div className="button-row award">
              {awarded === round.number ? (
                <span className="muted">Points added.</span>
              ) : (
                scoreboard.teams.map((team, index) => (
                  <button
                    key={index}
                    className="btn-secondary"
                    onClick={() => {
                      scoreboard.add(index, got.length);
                      setAwarded(round.number);
                    }}
                  >
                    +{got.length} to {team.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      <div className="scoreboard" aria-label="Scores">
        {scoreboard.teams.map((team, index) => (
          <label key={index} className="team">
            <span className="sr-only">Team {index + 1} name</span>
            <input
              value={team.name}
              maxLength={20}
              onChange={(event) => scoreboard.rename(index, event.target.value)}
            />
            <strong aria-label={`${team.name} score`}>{team.score}</strong>
          </label>
        ))}
        <button
          className="btn-secondary reset-scores"
          onClick={scoreboard.reset}
        >
          Reset scores
        </button>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';

const PRESETS = [30, 60, 90, 120];
const STORAGE_KEY = 'jorbox:timer';
const format = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
function storedDuration() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return PRESETS.includes(value) ? value : 60;
  } catch {
    return 60;
  }
}

// Round timer for timed games such as charades. It counts from a fixed end time,
// so it stays accurate even if the browser slows timers in the background.
export default function RoundTimer({ onClose }) {
  const [duration, setDuration] = useState(storedDuration);
  const [remaining, setRemaining] = useState(duration);
  const [running, setRunning] = useState(false);
  const endAt = useRef(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setRunning(false);
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 250);
    return () => clearInterval(id);
  }, [running]);
  function choose(value) {
    setDuration(value);
    setRemaining(value);
    setRunning(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // The choice just will not be remembered.
    }
  }
  function toggle() {
    if (running) return setRunning(false);
    const start = remaining === 0 ? duration : remaining;
    endAt.current = Date.now() + start * 1000;
    setRemaining(start);
    setRunning(true);
  }
  const done = remaining === 0;
  return (
    <section
      className={`round-timer glass-panel${done ? ' done' : remaining <= 10 && running ? ' warning' : ''}`}
      aria-label="Round timer"
    >
      <span className="timer-display" role="timer" aria-live="off">
        {done ? 'Time’s up!' : format(remaining)}
      </span>
      <p className="sr-only" aria-live="assertive">
        {done ? 'Time’s up!' : ''}
      </p>
      <div className="timer-controls">
        <button
          className="btn-primary"
          onClick={toggle}
          aria-label={running ? 'Pause timer' : 'Start timer'}
        >
          {running ? (
            <Pause size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
        </button>
        <button
          className="btn-secondary"
          onClick={() => choose(duration)}
          aria-label="Reset timer"
        >
          <RotateCcw size={18} aria-hidden="true" />
        </button>
        <label>
          <span className="sr-only">Round length</span>
          <select
            value={duration}
            onChange={(event) => choose(Number(event.target.value))}
          >
            {PRESETS.map((value) => (
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
    </section>
  );
}

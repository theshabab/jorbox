import { useEffect, useRef, useState } from 'react';

export const ROUND_LENGTHS = [30, 60, 90, 120];
const LENGTH_KEY = 'jorbox:timer';
const SCORES_KEY = 'jorbox:scores';
const DEFAULT_TEAMS = [
  { name: 'Team 1', score: 0 },
  { name: 'Team 2', score: 0 },
];

function readLength() {
  try {
    const value = Number(localStorage.getItem(LENGTH_KEY));
    return ROUND_LENGTHS.includes(value) ? value : 60;
  } catch {
    return 60;
  }
}

// A timed round: counts down from a fixed end time (accurate even if the
// browser slows timers) and tallies cards the team got or skipped.
export function useRound() {
  const [duration, setDuration] = useState(readLength);
  const [remaining, setRemaining] = useState(duration);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  // Identifies a round, so its points can be awarded only once.
  const [number, setNumber] = useState(0);
  // The round whose points were added. Kept with the round, not the timer panel,
  // so hiding and reopening the panel cannot award the same round twice.
  const [awardedRound, setAwardedRound] = useState(null);
  const endAt = useRef(0);
  const remainingMs = useRef(duration * 1000);
  const active = useRef(false);
  function finish() {
    active.current = false;
    remainingMs.current = 0;
    setRemaining(0);
    setRunning(false);
  }
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        finish();
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 250);
    return () => clearInterval(id);
  }, [running]);
  function reset(length = duration) {
    active.current = false;
    remainingMs.current = length * 1000;
    setRunning(false);
    setRemaining(length);
    setResults([]);
    setNumber((value) => value + 1);
  }
  return {
    duration,
    remaining,
    running,
    done: remaining === 0,
    results,
    number,
    awarded: awardedRound === number,
    markAwarded: () => setAwardedRound(number),
    choose(length) {
      if (!ROUND_LENGTHS.includes(length)) return;
      setDuration(length);
      reset(length);
      try {
        localStorage.setItem(LENGTH_KEY, String(length));
      } catch {
        // The choice just will not be remembered.
      }
    },
    toggle() {
      if (active.current) {
        // Preserve milliseconds when paused. Rounding every resume up to a
        // whole second lets repeated pauses extend a round indefinitely.
        remainingMs.current = Math.max(0, endAt.current - Date.now());
        active.current = false;
        setRemaining(Math.ceil(remainingMs.current / 1000));
        setRunning(false);
        return;
      }
      const fresh = remainingMs.current === 0;
      if (fresh) {
        remainingMs.current = duration * 1000;
        setResults([]);
        setNumber((value) => value + 1);
      }
      endAt.current = Date.now() + remainingMs.current;
      active.current = true;
      setRemaining(Math.ceil(remainingMs.current / 1000));
      setRunning(true);
    },
    reset: () => reset(),
    record(card, got) {
      if (!active.current || !card) return false;
      // A delayed browser tick must never permit scoring after the deadline.
      if (Date.now() >= endAt.current) {
        finish();
        return false;
      }
      setResults((previous) => [
        ...previous,
        { id: card.id, label: card.Name || card.Description, got },
      ]);
      return true;
    },
  };
}

function readTeams() {
  try {
    const teams = JSON.parse(sessionStorage.getItem(SCORES_KEY));
    return Array.isArray(teams) &&
      teams.length === 2 &&
      teams.every(
        (team) =>
          team &&
          typeof team.name === 'string' &&
          team.name.length <= 20 &&
          Number.isSafeInteger(team.score) &&
          team.score >= 0,
      )
      ? teams
      : DEFAULT_TEAMS;
  } catch {
    return DEFAULT_TEAMS;
  }
}

// Two-team scoreboard for the evening, kept for the browser tab.
export function useScoreboard() {
  const [teams, setTeams] = useState(readTeams);
  function save(next) {
    setTeams(next);
    try {
      sessionStorage.setItem(SCORES_KEY, JSON.stringify(next));
    } catch {
      // Scores still work for this page view.
    }
  }
  return {
    teams,
    add: (index, points) =>
      save(
        teams.map((team, i) =>
          i === index ? { ...team, score: team.score + points } : team,
        ),
      ),
    rename: (index, name) =>
      save(teams.map((team, i) => (i === index ? { ...team, name } : team))),
    reset: () => save(teams.map((team) => ({ ...team, score: 0 }))),
  };
}

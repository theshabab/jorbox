import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { DataManager } from '../utils/DataManager';

// Counts appear only after the player votes, so earlier votes do not sway them.
export default function CardFeedback({ card, session, onVote }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requiresLogin = session?.feedbackRequiresLogin && !session?.user;
  const unavailable = !requiresLogin && session?.feedbackEnabled === false;
  const voted = card.myVote !== 0;
  async function vote(value) {
    setBusy(true);
    setError('');
    try {
      const result = await DataManager.vote(
        card.id,
        card.myVote === value ? 0 : value,
      );
      onVote(card.id, result);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || requiresLogin || unavailable;
  return (
    <div className="feedback">
      <div className="feedback-buttons">
        <button
          className="btn-secondary"
          aria-label={voted ? `Like (${card.likes} likes)` : 'Like'}
          aria-pressed={card.myVote === 1}
          disabled={disabled}
          onClick={() => vote(1)}
        >
          <ThumbsUp size={18} aria-hidden="true" />
          {voted && <span aria-hidden="true">{card.likes}</span>}
        </button>
        <button
          className="btn-secondary"
          aria-label={voted ? `Dislike (${card.dislikes} dislikes)` : 'Dislike'}
          aria-pressed={card.myVote === -1}
          disabled={disabled}
          onClick={() => vote(-1)}
        >
          <ThumbsDown size={18} aria-hidden="true" />
          {voted && <span aria-hidden="true">{card.dislikes}</span>}
        </button>
      </div>
      <p className="feedback-note muted">
        {requiresLogin
          ? 'Sign in with GitHub to leave feedback.'
          : unavailable
            ? 'Feedback is unavailable right now. Reload to try again.'
            : voted
              ? 'Thanks! Tap again to undo.'
              : 'Good card?'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { DataManager } from '../utils/DataManager';

export default function CardFeedback({ card, session, onVote }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requiresLogin = session?.feedbackRequiresLogin && !session?.user;
  async function vote(value) {
    setBusy(true);
    setError('');
    try {
      const result = await DataManager.vote(card.id, card.myVote === value ? 0 : value);
      onVote(card.id, result);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <div className="feedback">
    <div className="button-row">
      <button className="btn-secondary" aria-label={`Like card (${card.likes})`} aria-pressed={card.myVote === 1} disabled={busy || requiresLogin} onClick={() => vote(1)}><ThumbsUp size={18} /> {card.likes}</button>
      <button className="btn-secondary" aria-label={`Dislike card (${card.dislikes})`} aria-pressed={card.myVote === -1} disabled={busy || requiresLogin} onClick={() => vote(-1)}><ThumbsDown size={18} /> {card.dislikes}</button>
    </div>
    <p className="muted">{requiresLogin ? 'Sign in with GitHub to leave feedback.' : 'Was this a good card? Click again to undo your vote.'}</p>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

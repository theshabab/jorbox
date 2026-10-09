import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CardFeedback from './CardFeedback';

export default function CardViewer({ cards, session, onVote }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef(null);
  const index = Math.min(currentIndex, Math.max(0, cards.length - 1));
  const card = cards[index];
  if (!card) return <p className="empty-state">No cards available in this category.</p>;
  function handleMouseMove(event) {
    const rect = cardRef.current.getBoundingClientRect();
    setTilt({ x: ((event.clientY - rect.top - rect.height / 2) / (rect.height / 2)) * -10, y: ((event.clientX - rect.left - rect.width / 2) / (rect.width / 2)) * 10 });
  }
  return <div className="card-viewer">
    <div ref={cardRef} onMouseMove={handleMouseMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })} className="glass-panel playing-card" style={{ transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
      {card.Name && <h2>{card.Name}</h2>}
      {card.Description && <p className="card-description">{card.Description}</p>}
      {card.Category && <span className="category-badge">{card.Category}</span>}
      <span className="card-position">{index + 1} / {cards.length}</span>
    </div>
    <CardFeedback key={card.id} card={card} session={session} onVote={onVote} />
    <div className="button-row">
      <button className="btn-secondary" onClick={() => setCurrentIndex((index - 1 + cards.length) % cards.length)}><ChevronLeft size={20} /> Previous</button>
      <button className="btn-primary" onClick={() => setCurrentIndex((index + 1) % cards.length)}>Next <ChevronRight size={20} /></button>
    </div>
  </div>;
}

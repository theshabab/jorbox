import React, { useState, useRef } from 'react';
import { ChevronRight } from 'lucide-react';

const CardViewer = ({ cards }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);

    // Tilt state
    const [tilt, setTilt] = useState({ x: 0, y: 0 });
    const cardRef = useRef(null);

    // Cards arrive pre-shuffled from App. Reset position when the deck changes
    // by adjusting state during render (React docs: "You Might Not Need an Effect").
    const [prevCards, setPrevCards] = useState(cards);
    if (cards !== prevCards) {
        setPrevCards(cards);
        setCurrentIndex(0);
    }

    const handleMouseMove = (e) => {
        if (!cardRef.current) return;

        const rect = cardRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left; // x position within the element.
        const y = e.clientY - rect.top;  // y position within the element.

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -10; // Max rotation deg
        const rotateY = ((x - centerX) / centerX) * 10;

        setTilt({ x: rotateX, y: rotateY });
    };

    const handleMouseLeave = () => {
        setTilt({ x: 0, y: 0 });
    };

    if (!cards || cards.length === 0) {
        return <div style={{ textAlign: 'center', padding: '2rem' }}>No cards available.</div>;
    }

    const currentCard = cards[currentIndex];

    const handleNext = () => {
        if (isAnimating) return;
        setIsAnimating(true);
        setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % cards.length);
            setIsAnimating(false);
        }, 300); // Match transition duration
    };

    return (
        <div className="card-viewer" style={{ maxWidth: '600px', margin: '0 auto', padding: '0 1rem', perspective: '1000px' }}>
            <div
                ref={cardRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className="glass-panel"
                style={{
                    padding: '3rem 2rem',
                    minHeight: '400px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    textAlign: 'center',
                    position: 'relative',
                    transition: 'opacity 0.3s ease, transform 0.1s ease-out, box-shadow 0.3s ease', // Fast transform for tilt
                    opacity: isAnimating ? 0 : 1,
                    transform: isAnimating
                        ? 'translateZ(-50px) rotateX(0) rotateY(0)'
                        : `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(1.02, 1.02, 1.02)`,
                    transformStyle: 'preserve-3d',
                    boxShadow: Math.abs(tilt.x) + Math.abs(tilt.y) > 0
                        ? '0 20px 40px rgba(0,0,0,0.3)'
                        : '0 8px 32px rgba(0,0,0,0.2)'
                }}
            >
                <div style={{ transform: 'translateZ(30px)' }}> {/* Floating text effect */}
                    <h2 style={{
                        fontSize: '2.5rem',
                        marginBottom: '1.5rem',
                        background: 'linear-gradient(120deg, #ffffff 0%, #cbd5e1 55%, var(--accent-primary) 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        fontWeight: '800'
                    }}>
                        {currentCard.Name}
                    </h2>
                    {currentCard.Description && (
                        <p style={{
                            fontSize: '1.2rem',
                            color: 'var(--text-primary)',
                            lineHeight: '1.8',
                            maxWidth: '100%',
                            overflowWrap: 'break-word',
                            wordBreak: 'break-word'
                        }}>
                            {currentCard.Description}
                        </p>
                    )}

                    {currentCard.Category && (
                        <span style={{
                            display: 'inline-block',
                            marginTop: '2rem',
                            padding: '6px 12px',
                            borderRadius: '20px',
                            background: 'rgba(255,255,255,0.1)',
                            fontSize: '0.9rem',
                            color: 'var(--accent-primary)',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                        }}>
                            {currentCard.Category}
                        </span>
                    )}
                </div>

                <div style={{
                    position: 'absolute',
                    bottom: '1rem',
                    right: '1rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    transform: 'translateZ(10px)'
                }}>
                    {currentIndex + 1} / {cards.length}
                </div>
            </div>

            <div className="controls" style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
                <button onClick={handleNext} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', padding: '14px 32px' }}>
                    Next <ChevronRight size={24} />
                </button>
            </div>
        </div>
    );
};

export default CardViewer;

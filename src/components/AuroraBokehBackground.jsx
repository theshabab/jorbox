import React from 'react';

// Royal Crimson aurora — violet-dominant, crimson as a quiet accent (per Shabab usage).
const BLOBS = [
    { color: 'rgba(225, 29, 72, 0.12)', size: '55vmax', top: '-15%', left: '-10%', animation: 'auroraDrift1 28s ease-in-out infinite' },
    { color: 'rgba(34, 1, 126, 0.40)', size: '50vmax', top: '30%', left: '55%', animation: 'auroraDrift2 34s ease-in-out infinite' },
    { color: 'rgba(185, 133, 229, 0.14)', size: '40vmax', top: '60%', left: '5%', animation: 'auroraDrift3 24s ease-in-out infinite' }
];

// Suits, symbols and geometric shapes floating upward like bokeh lights.
// `delay` is negative so the field is already populated on first paint.
const BOKEH = [
    { glyph: '♠', size: 180, left: '8%', delay: 0, duration: 26, opacity: 0.06 },
    { glyph: '♥', size: 120, left: '28%', delay: -8, duration: 32, opacity: 0.05 },
    { glyph: '♦', size: 220, left: '48%', delay: -16, duration: 38, opacity: 0.045 },
    { glyph: '♣', size: 140, left: '66%', delay: -4, duration: 28, opacity: 0.055 },
    { glyph: '♠', size: 90, left: '82%', delay: -12, duration: 22, opacity: 0.065 },
    { glyph: '★', size: 110, left: '40%', delay: -24, duration: 30, opacity: 0.05 },
    { glyph: '✦', size: 70, left: '55%', delay: -6, duration: 23, opacity: 0.06 },
    { glyph: '☾', size: 130, left: '91%', delay: -18, duration: 33, opacity: 0.05 },
    { glyph: '♛', size: 150, left: '35%', delay: -10, duration: 36, opacity: 0.045 },
    { glyph: null, size: 150, left: '18%', delay: -20, duration: 34, opacity: 0.035 }, // blank card
    { glyph: null, size: 200, left: '72%', delay: -2, duration: 40, opacity: 0.03 },
    { shape: 'glowDot', size: 90, left: '22%', delay: -16, duration: 25, opacity: 0.10 },
    { shape: 'glowDot', size: 140, left: '62%', delay: -3, duration: 31, opacity: 0.08 },
    { shape: 'glowDot', size: 60, left: '86%', delay: -22, duration: 20, opacity: 0.12 },
    { shape: 'ring', size: 110, left: '45%', delay: -28, duration: 29, opacity: 0.04 },
    { shape: 'ring', size: 170, left: '5%', delay: -11, duration: 37, opacity: 0.03 },
    { shape: 'diamond', size: 90, left: '58%', delay: -19, duration: 26, opacity: 0.04 }
];

const AuroraBokehBackground = () => (
    <div className="aurora-bokeh-bg" aria-hidden="true">
        {BLOBS.map((blob, i) => (
            <div
                key={`blob-${i}`}
                className="aurora-blob"
                style={{
                    top: blob.top,
                    left: blob.left,
                    width: blob.size,
                    height: blob.size,
                    background: blob.color,
                    animation: blob.animation
                }}
            />
        ))}

        {BOKEH.map((piece, i) => (
            <div
                key={`bokeh-${i}`}
                className="bokeh-piece"
                style={{
                    left: piece.left,
                    animation: `bokehFloat ${piece.duration}s linear ${piece.delay}s infinite`
                }}
            >
                {piece.glyph ? (
                    <span
                        className="bokeh-glyph"
                        style={{ fontSize: `${piece.size}px`, color: `rgba(148, 163, 184, ${piece.opacity})` }}
                    >
                        {piece.glyph}
                    </span>
                ) : piece.shape === 'glowDot' ? (
                    <div
                        className="bokeh-glow-dot"
                        style={{
                            width: `${piece.size}px`,
                            height: `${piece.size}px`,
                            background: `rgba(185, 133, 229, ${piece.opacity * 0.6})`
                        }}
                    />
                ) : piece.shape === 'ring' ? (
                    <div
                        className="bokeh-ring"
                        style={{
                            width: `${piece.size}px`,
                            height: `${piece.size}px`,
                            borderColor: `rgba(185, 133, 229, ${piece.opacity + 0.04})`
                        }}
                    />
                ) : piece.shape === 'diamond' ? (
                    <div
                        className="bokeh-diamond"
                        style={{
                            width: `${piece.size}px`,
                            height: `${piece.size}px`,
                            borderColor: `rgba(225, 29, 72, ${piece.opacity + 0.03})`
                        }}
                    />
                ) : (
                    <div
                        className="bokeh-card"
                        style={{
                            width: `${piece.size * 0.7}px`,
                            height: `${piece.size}px`,
                            borderColor: `rgba(185, 133, 229, ${piece.opacity + 0.03})`,
                            background: `rgba(148, 163, 184, ${piece.opacity * 0.4})`
                        }}
                    />
                )}
            </div>
        ))}
    </div>
);

export default AuroraBokehBackground;

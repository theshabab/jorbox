import React from 'react';

const BLOBS = [
    { color: 'rgba(56, 189, 248, 0.22)', size: '55vmax', top: '-15%', left: '-10%', animation: 'auroraDrift1 28s ease-in-out infinite' },
    { color: 'rgba(129, 140, 248, 0.18)', size: '50vmax', top: '30%', left: '55%', animation: 'auroraDrift2 34s ease-in-out infinite' },
    { color: 'rgba(52, 211, 153, 0.12)', size: '40vmax', top: '60%', left: '5%', animation: 'auroraDrift3 24s ease-in-out infinite' }
];

// Suits and blank cards floating upward like bokeh lights.
// `delay` is negative so the field is already populated on first paint.
const BOKEH = [
    { glyph: '♠', size: 180, left: '8%', delay: 0, duration: 26, opacity: 0.06 },
    { glyph: '♥', size: 120, left: '28%', delay: -8, duration: 32, opacity: 0.05 },
    { glyph: '♦', size: 220, left: '48%', delay: -16, duration: 38, opacity: 0.045 },
    { glyph: '♣', size: 140, left: '66%', delay: -4, duration: 28, opacity: 0.055 },
    { glyph: '♠', size: 90, left: '82%', delay: -12, duration: 22, opacity: 0.065 },
    { glyph: null, size: 150, left: '18%', delay: -20, duration: 34, opacity: 0.035 },
    { glyph: null, size: 200, left: '72%', delay: -2, duration: 40, opacity: 0.03 }
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
                ) : (
                    <div
                        className="bokeh-card"
                        style={{
                            width: `${piece.size * 0.7}px`,
                            height: `${piece.size}px`,
                            borderColor: `rgba(56, 189, 248, ${piece.opacity + 0.03})`,
                            background: `rgba(148, 163, 184, ${piece.opacity * 0.4})`
                        }}
                    />
                )}
            </div>
        ))}
    </div>
);

export default AuroraBokehBackground;

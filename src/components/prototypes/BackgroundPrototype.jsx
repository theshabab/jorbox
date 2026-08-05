// PROTOTYPE — throwaway.
// Question: what should replace the ParticleBackground canvas effect?
// Four variants (aurora / grid spotlight / card bokeh / grain only),
// switchable via ?variant=A|B|C|D on the existing main route.
import React, { useEffect, useState } from 'react';
import PrototypeSwitcher from './PrototypeSwitcher';

const LAYER = {
    position: 'fixed',
    inset: 0,
    zIndex: -1,
    pointerEvents: 'none',
    overflow: 'hidden'
};

/* ---------- Variant A — Aurora blobs: 3 blurred color orbs drifting, pure CSS ---------- */
export const VariantA = () => (
    <div style={LAYER}>
        <style>{`
            @keyframes aurora1 {
                0%, 100% { transform: translate(0, 0) scale(1); }
                33% { transform: translate(15vw, 10vh) scale(1.2); }
                66% { transform: translate(-8vw, 20vh) scale(0.9); }
            }
            @keyframes aurora2 {
                0%, 100% { transform: translate(0, 0) scale(1); }
                40% { transform: translate(-18vw, -12vh) scale(1.25); }
                70% { transform: translate(10vw, -6vh) scale(0.85); }
            }
            @keyframes aurora3 {
                0%, 100% { transform: translate(0, 0) scale(1); }
                50% { transform: translate(12vw, -15vh) scale(1.15); }
            }
        `}</style>
        {[
            { color: 'rgba(56, 189, 248, 0.22)', size: '55vmax', top: '-15%', left: '-10%', anim: 'aurora1 28s ease-in-out infinite' },
            { color: 'rgba(129, 140, 248, 0.18)', size: '50vmax', top: '30%', left: '55%', anim: 'aurora2 34s ease-in-out infinite' },
            { color: 'rgba(52, 211, 153, 0.12)', size: '40vmax', top: '60%', left: '5%', anim: 'aurora3 24s ease-in-out infinite' }
        ].map((b, i) => (
            <div key={i} style={{
                position: 'absolute',
                top: b.top,
                left: b.left,
                width: b.size,
                height: b.size,
                borderRadius: '50%',
                background: b.color,
                filter: 'blur(90px)',
                animation: b.anim,
                willChange: 'transform'
            }} />
        ))}
    </div>
);

/* ---------- Variant B — Grid spotlight: faint grid revealed near the cursor ---------- */
export const VariantB = () => {
    const [pos, setPos] = useState({ x: -1000, y: -1000 });

    useEffect(() => {
        const handle = (e) => setPos({ x: e.clientX, y: e.clientY });
        window.addEventListener('mousemove', handle);
        return () => window.removeEventListener('mousemove', handle);
    }, []);

    const grid = {
        backgroundImage: `
            linear-gradient(rgba(148, 163, 184, 0.18) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.18) 1px, transparent 1px)
        `,
        backgroundSize: '48px 48px'
    };

    return (
        <div style={LAYER}>
            {/* Faint overall grid */}
            <div style={{ position: 'absolute', inset: 0, ...grid, opacity: 0.25 }} />
            {/* Bright grid revealed near cursor via mask */}
            <div style={{
                position: 'absolute',
                inset: 0,
                ...grid,
                backgroundImage: `
                    linear-gradient(rgba(56, 189, 248, 0.35) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(56, 189, 248, 0.35) 1px, transparent 1px)
                `,
                WebkitMaskImage: `radial-gradient(350px circle at ${pos.x}px ${pos.y}px, black, transparent 80%)`,
                maskImage: `radial-gradient(350px circle at ${pos.x}px ${pos.y}px, black, transparent 80%)`
            }} />
        </div>
    );
};

/* ---------- Variant C — Card bokeh: blurred card shapes & suits floating up ---------- */
export const VariantC = ({ scale = 1 }) => {
    const pieces = [
        { glyph: '♠', size: 180, left: '8%', delay: 0, dur: 26, opacity: 0.10 },
        { glyph: '♥', size: 120, left: '28%', delay: -8, dur: 32, opacity: 0.08 },
        { glyph: '♦', size: 220, left: '48%', delay: -16, dur: 38, opacity: 0.07 },
        { glyph: '♣', size: 140, left: '66%', delay: -4, dur: 28, opacity: 0.09 },
        { glyph: '♠', size: 90, left: '82%', delay: -12, dur: 22, opacity: 0.11 },
        { glyph: null, size: 150, left: '18%', delay: -20, dur: 34, opacity: 0.06 }, // blank card
        { glyph: null, size: 200, left: '72%', delay: -2, dur: 40, opacity: 0.05 }
    ];

    return (
        <div style={LAYER}>
            <style>{`
                @keyframes bokehFloat {
                    from { transform: translateY(110vh) rotate(-12deg); }
                    to { transform: translateY(-40vh) rotate(14deg); }
                }
            `}</style>
            {pieces.map((p, i) => (
                <div key={i} style={{
                    position: 'absolute',
                    left: p.left,
                    top: 0,
                    animation: `bokehFloat ${p.dur}s linear ${p.delay}s infinite`,
                    willChange: 'transform'
                }}>
                    {p.glyph ? (
                        <span style={{
                            fontSize: `${p.size}px`,
                            color: `rgba(148, 163, 184, ${p.opacity * scale})`,
                            filter: 'blur(6px)',
                            display: 'block'
                        }}>{p.glyph}</span>
                    ) : (
                        <div style={{
                            width: `${p.size * 0.7}px`,
                            height: `${p.size}px`,
                            borderRadius: '14px',
                            border: `3px solid rgba(56, 189, 248, ${(p.opacity + 0.05) * scale})`,
                            background: `rgba(148, 163, 184, ${p.opacity * 0.4 * scale})`,
                            filter: 'blur(4px)'
                        }} />
                    )}
                </div>
            ))}
        </div>
    );
};

/* ---------- Variant D — Grain only: static noise texture, zero motion ---------- */
export const VariantD = () => (
    <div style={{
        ...LAYER,
        opacity: 0.05,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat'
    }} />
);

/* ---------- Variant E — Aurora + Bokeh combo: blobs for color, bokeh at half strength ---------- */
export const VariantE = () => (
    <>
        <VariantA />
        <VariantC scale={0.6} />
    </>
);

const VARIANTS = [
    { key: 'A', name: 'Aurora blobs', Component: VariantA },
    { key: 'B', name: 'Grid spotlight', Component: VariantB },
    { key: 'C', name: 'Card bokeh', Component: VariantC },
    { key: 'D', name: 'Grain only', Component: VariantD },
    { key: 'E', name: 'Aurora + Bokeh', Component: VariantE }
];

const BackgroundPrototype = () => {
    const [variant, setVariant] = useState(() =>
        new URLSearchParams(window.location.search).get('variant') ?? 'E'
    );

    const active = VARIANTS.find(v => v.key === variant) ?? VARIANTS[0];

    return (
        <>
            <active.Component />
            <PrototypeSwitcher
                variants={VARIANTS}
                current={active.key}
                onChange={setVariant}
            />
        </>
    );
};

export default BackgroundPrototype;

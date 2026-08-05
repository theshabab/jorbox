// PROTOTYPE — throwaway. Floating bar to flip between ?variant= options.
// Hidden in production builds.
import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PrototypeSwitcher = ({ variants, current, onChange }) => {
    if (import.meta.env.PROD) return null;

    const index = variants.findIndex(v => v.key === current);

    const cycle = (dir) => {
        const next = (index + dir + variants.length) % variants.length;
        const key = variants[next].key;
        const params = new URLSearchParams(window.location.search);
        params.set('variant', key);
        window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
        onChange(key);
    };

    useEffect(() => {
        const handleKey = (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            if (e.key === 'ArrowLeft') cycle(-1);
            if (e.key === 'ArrowRight') cycle(1);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [index]);

    const btnStyle = {
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '8px',
        color: '#f8fafc',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer'
    };

    return (
        <div style={{
            position: 'fixed',
            bottom: '1.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            background: '#0b1220',
            border: '1px solid rgba(56,189,248,0.4)',
            borderRadius: '999px',
            padding: '0.5rem 0.75rem',
            boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
            fontFamily: 'var(--font-heading)',
            fontSize: '0.85rem',
            color: '#f8fafc',
            userSelect: 'none'
        }}>
            <button style={btnStyle} onClick={() => cycle(-1)} aria-label="Previous variant">
                <ChevronLeft size={16} />
            </button>
            <span style={{ minWidth: '170px', textAlign: 'center', letterSpacing: '0.5px' }}>
                <span style={{ color: '#38bdf8', fontWeight: 800 }}>{variants[index].key}</span>
                {' — '}{variants[index].name}
            </span>
            <button style={btnStyle} onClick={() => cycle(1)} aria-label="Next variant">
                <ChevronRight size={16} />
            </button>
        </div>
    );
};

export default PrototypeSwitcher;

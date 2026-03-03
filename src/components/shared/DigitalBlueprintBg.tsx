import React, { useEffect, useState } from 'react';

export const DigitalBlueprintBg = ({ children }: { children?: React.ReactNode }) => {
    const [mousePosition, setMousePosition] = useState({ x: -1000, y: -1000 });

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            setMousePosition({ x: e.clientX, y: e.clientY });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    return (
        <div
            className="fixed inset-0 z-0 bg-deep-space pointer-events-none overflow-hidden"
            style={{ '--mouse-x': `${mousePosition.x}px`, '--mouse-y': `${mousePosition.y}px` } as React.CSSProperties}
        >
            {/* The Strict Glow Grid */}
            <div className="absolute inset-0 glow-grid-overlay mix-blend-screen" />

            {/* Strict Searchlight Flashlight */}
            <div className="searchlight-overlay absolute inset-0 mix-blend-screen pointer-events-none" />

            {children}
        </div>
    );
};

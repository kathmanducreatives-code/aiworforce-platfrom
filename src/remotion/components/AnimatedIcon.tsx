
import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface AnimatedIconProps {
    name: string;
    size: number;
    color: string;
    position: { x: number | string; y: number | string };
    frame?: number;
    animation: 'bounce' | 'pop';
}

const icons: Record<string, string> = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
};

export const AnimatedIcon: React.FC<AnimatedIconProps> = ({
    name,
    size,
    color,
    position,
    frame: frameProp,
    animation,
}) => {
    const currentFrame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const frame = frameProp !== undefined ? frameProp : currentFrame;

    const scale =
        animation === 'bounce'
            ? spring({ frame, fps, from: 0, to: 1, config: { damping: 10, stiffness: 100 } })
            : 1;

    return (
        <div
            style={{
                position: 'absolute',
                width: size,
                height: size,
                color,
                transform: `translate(-50%, -50%) scale(${scale})`,
                left: position.x === 'center' ? '50%' : position.x,
                top: position.y,
            }}
            dangerouslySetInnerHTML={{ __html: icons[name] || icons.search }}
        />
    );
};

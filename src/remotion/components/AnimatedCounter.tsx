
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

interface AnimatedCounterProps {
    from: number;
    to: number;
    fontSize: number;
    color: string;
    position: { x: number | string; y: number | string };
    duration: number; // in frames
    frame?: number;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
    from,
    to,
    fontSize,
    color,
    position,
    duration,
    frame: frameProp,
}) => {
    const currentFrame = useCurrentFrame();
    const frame = frameProp !== undefined ? frameProp : currentFrame;

    const value = Math.round(
        interpolate(frame, [0, duration], [from, to], { extrapolateRight: 'clamp' })
    );

    return (
        <div
            style={{
                position: 'absolute',
                fontSize,
                color,
                fontWeight: 700,
                transform: 'translate(-50%, -50%)',
                left: position.x === 'center' ? '50%' : position.x,
                top: position.y,
                fontVariantNumeric: 'tabular-nums',
            }}
        >
            {value.toLocaleString()}
        </div>
    );
};

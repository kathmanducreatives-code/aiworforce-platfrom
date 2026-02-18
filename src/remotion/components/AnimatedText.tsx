
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface AnimatedTextProps {
    text: string;
    fontSize: number;
    color: string;
    position: { x: number | string; y: number | string };
    frame?: number; // Optional frame override
    animation: 'fadeIn' | 'zoomIn' | 'slideIn';
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({
    text,
    fontSize,
    color,
    position,
    frame: frameProp,
    animation,
}) => {
    const currentFrame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const frame = frameProp !== undefined ? frameProp : currentFrame;

    let style: React.CSSProperties = {
        position: 'absolute',
        fontSize,
        color,
        fontWeight: 700,
        left: position.x === 'center' ? '50%' : position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
    };

    if (animation === 'fadeIn') {
        const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
        style = { ...style, opacity };
    } else if (animation === 'zoomIn') {
        const scale = spring({ frame, fps, from: 0.5, to: 1 });
        style = { ...style, transform: `${style.transform} scale(${scale})` };
    } else if (animation === 'slideIn') {
        const yOffset = interpolate(frame, [0, 20], [50, 0], { extrapolateRight: 'clamp' });
        const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
        style = { ...style, transform: `${style.transform} translateY(${yOffset}px)`, opacity };
    }

    return <div style={style}>{text}</div>;
};

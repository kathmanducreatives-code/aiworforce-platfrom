
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

interface ProgressBarProps {
    width: number;
    height: number;
    color: string;
    progress: number; // 0 to 100
    position: { x: number | string; y: number | string };
    duration: number; // in frames
    frame?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
    width,
    height,
    color,
    progress,
    position,
    duration,
    frame: frameProp,
}) => {
    const currentFrame = useCurrentFrame();
    const frame = frameProp !== undefined ? frameProp : currentFrame;

    const currentProgress = interpolate(frame, [0, duration], [0, progress], {
        extrapolateRight: 'clamp',
    });

    return (
        <div
            style={{
                position: 'absolute',
                width,
                height,
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: height / 2,
                transform: 'translateX(-50%)',
                left: position.x === 'center' ? '50%' : position.x,
                top: position.y,
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    width: `${currentProgress}%`,
                    height: '100%',
                    backgroundColor: color,
                    borderRadius: height / 2,
                }}
            />
        </div>
    );
};


import React from 'react';

interface GradientBackgroundProps {
    colors: string[];
    angle?: number;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({
    colors,
    angle = 135,
}) => {
    return (
        <div
            style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                background: `linear-gradient(${angle}deg, ${colors.join(', ')})`,
            }}
        />
    );
};

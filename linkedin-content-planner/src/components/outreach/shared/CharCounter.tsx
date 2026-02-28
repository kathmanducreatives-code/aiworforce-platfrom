interface CharCounterProps {
    current: number;
    max: number;
}

export default function CharCounter({ current, max }: CharCounterProps) {
    const isNearLimit = current > max * 0.9 && current <= max;
    const isOverLimit = current > max;

    let color = '#666'; // Default dim
    if (isNearLimit) color = '#f5a623'; // Amber warning
    if (isOverLimit) color = '#ef4444'; // Red error

    return (
        <div style={{
            fontSize: '11px',
            fontWeight: 500,
            color: color,
            fontFamily: '"SF Mono", "SFMono-Regular", ui-monospace, monospace',
            textAlign: 'right',
            transition: 'color 0.2s ease',
        }}>
            {current} / {max} chars
        </div>
    );
}

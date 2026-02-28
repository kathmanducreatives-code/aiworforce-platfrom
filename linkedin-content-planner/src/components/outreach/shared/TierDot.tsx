import type { OutreachLead } from '../../../types/outreach';

export const TIER_COLORS: Record<string, string> = {
    'unassigned': '#666',
    'tier_1': '#00e5a0',
    'tier_2': '#f5a623',
    'tier_3': '#888',
};

const TIER_LABELS: Record<string, string> = {
    'unassigned': '-',
    'tier_1': 'T1',
    'tier_2': 'T2',
    'tier_3': 'T3',
};

export default function TierDot({ tier }: { tier: OutreachLead['tier'] }) {
    const color = TIER_COLORS[tier] || TIER_COLORS['unassigned'];
    const label = TIER_LABELS[tier] || TIER_LABELS['unassigned'];

    return (
        <span
            title={`Tier: ${label}`}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#fff',
            }}
        >
            <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: color,
                boxShadow: `0 0 8px ${color}40`,
            }} />
            {label}
        </span>
    );
}

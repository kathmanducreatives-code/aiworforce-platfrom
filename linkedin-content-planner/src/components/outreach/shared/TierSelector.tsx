type LeadTier = 'unassigned' | 'tier_1' | 'tier_2' | 'tier_3';

const TIER_CONFIG: Record<LeadTier, { label: string; color: string }> = {
    'unassigned': { label: '-', color: '#666' },
    'tier_1': { label: 'Tier 1', color: '#00e5a0' },
    'tier_2': { label: 'Tier 2', color: '#a855f7' },
    'tier_3': { label: 'Tier 3', color: '#3b82f6' },
};

interface TierSelectorProps {
    tier: string;
    onChange: (newTier: LeadTier) => void;
}

export default function TierSelector({ tier, onChange }: TierSelectorProps) {
    const current = TIER_CONFIG[tier as LeadTier] || TIER_CONFIG['unassigned'];

    return (
        <select
            value={tier}
            onChange={(e) => onChange(e.target.value as LeadTier)}
            style={{
                background: "transparent",
                border: "1px solid #333",
                color: current.color,
                fontSize: "12px",
                fontWeight: 600,
                padding: "4px 8px",
                borderRadius: "6px",
                cursor: "pointer",
                outline: "none",
                appearance: "none",
                WebkitAppearance: "none",
            }}
        >
            {Object.entries(TIER_CONFIG).map(([key, config]) => (
                <option key={key} value={key} style={{ background: "#1a1a1a", color: "#fff" }}>
                    {config.label}
                </option>
            ))}
        </select>
    );
}

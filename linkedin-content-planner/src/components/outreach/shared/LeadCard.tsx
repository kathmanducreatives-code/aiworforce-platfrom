import React from 'react';
import { Linkedin, Clock } from 'lucide-react';


export interface LeadCardProps {
    name: string;
    company?: string;
    title?: string;
    avatarInitials?: string;
    tier?: 'Tier 1' | 'Tier 2' | 'Tier 3' | 'In Sequence' | 'Accepted' | 'Replied';
    lastInteraction?: string;      // e.g. "Sent DM · 2d ago"
    warmth?: number;               // 0–100
    onOpen?: () => void;
    className?: string;
}

/**
 * Warmth Meter — SVG circular progress ring.
 * Colour interpolates cold (#3b82f6) → warm (#ef4444) based on 0–100 value.
 */
function WarmthMeter({ value }: { value: number }) {
    const size = 44;
    const strokeWidth = 3.5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;

    // Blue (0) → Amber (50) → Red (100)
    const getColor = (v: number) => {
        if (v < 50) {
            // blue → amber
            const t = v / 50;
            const r = Math.round(59 + (245 - 59) * t);
            const g = Math.round(130 + (158 - 130) * t);
            const b = Math.round(246 + (11 - 246) * t);
            return `rgb(${r},${g},${b})`;
        } else {
            // amber → red
            const t = (v - 50) / 50;
            const r = Math.round(245 + (239 - 245) * t);
            const g = Math.round(158 + (68 - 158) * t);
            const b = Math.round(11 + (68 - 11) * t);
            return `rgb(${r},${g},${b})`;
        }
    };

    const color = getColor(value);

    return (
        <div className="flex flex-col items-center gap-0.5 shrink-0">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {/* Track */}
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    fill="none" stroke="rgba(255,255,255,0.07)"
                    strokeWidth={strokeWidth}
                />
                {/* Ring */}
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="warmth-ring"
                    style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
                />
                {/* Center label */}
                <text
                    x="50%" y="52%"
                    dominantBaseline="middle"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill={color}
                >
                    {value}
                </text>
            </svg>
            <span className="text-[9px] text-slate-600 font-semibold tracking-wide">WARMTH</span>
        </div>
    );
}

const TIER_STYLES: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    'Tier 1': { label: 'Tier 1', bg: 'rgba(239,68,68,0.14)', text: '#f87171', dot: '#ef4444' },
    'Tier 2': { label: 'Tier 2', bg: 'rgba(245,158,11,0.14)', text: '#fbbf24', dot: '#f59e0b' },
    'Tier 3': { label: 'Tier 3', bg: 'rgba(59,130,246,0.14)', text: '#60a5fa', dot: '#3b82f6' },
    'In Sequence': { label: 'In Sequence', bg: 'rgba(139,92,246,0.14)', text: '#a78bfa', dot: '#8b5cf6' },
    'Accepted': { label: 'Accepted', bg: 'rgba(16,185,129,0.14)', text: '#34d399', dot: '#10b981' },
    'Replied': { label: 'Replied', bg: 'rgba(6,182,212,0.14)', text: '#22d3ee', dot: '#06b6d4' },
};

const LeadCard: React.FC<LeadCardProps> = ({
    name,
    company,
    title,
    avatarInitials,
    tier = 'Tier 3',
    lastInteraction,
    warmth = 0,
    onOpen,
    className = '',
}) => {
    const tierStyle = TIER_STYLES[tier] || TIER_STYLES['Tier 3'];
    const initials = avatarInitials || name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

    return (
        <div
            className={`glass-card rounded-2xl p-4 flex items-start gap-4 cursor-pointer group transition-all duration-200 hover:-translate-y-0.5 ${className}`}
            onClick={onOpen}
            role={onOpen ? 'button' : undefined}
        >
            {/* Avatar */}
            <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 relative"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}
            >
                {initials}
                {/* LinkedIn icon overlay */}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center border border-[#08080a]">
                    <Linkedin size={8} className="text-white" />
                </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[13.5px] font-semibold text-white truncate group-hover:text-blue-300 transition-colors">
                        {name}
                    </p>
                    {/* Tier badge */}
                    <span
                        className="shrink-0 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                        style={{ background: tierStyle.bg, color: tierStyle.text }}
                    >
                        <span className="w-1 h-1 rounded-full" style={{ background: tierStyle.dot }} />
                        {tierStyle.label}
                    </span>
                </div>

                {(title || company) && (
                    <p className="text-[11.5px] text-slate-500 truncate">
                        {title}{title && company ? ' · ' : ''}{company}
                    </p>
                )}

                {lastInteraction && (
                    <div className="flex items-center gap-1 mt-2">
                        <Clock size={10} className="text-slate-600 shrink-0" />
                        <span className="text-[11px] text-slate-600">{lastInteraction}</span>
                    </div>
                )}
            </div>

            {/* Warmth Meter */}
            <WarmthMeter value={warmth} />
        </div>
    );
};

export default LeadCard;

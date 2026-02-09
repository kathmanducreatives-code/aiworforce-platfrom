/**
 * Shared match badge configuration for consistent scoring display across ICP components.
 */

export interface MatchBadgeConfig {
    emoji: string;
    label: string;
    color: string;
    gradient: string;
}

export const getMatchBadge = (score: number): MatchBadgeConfig => {
    if (score >= 75) return {
        emoji: '💪',
        label: 'Strong Match',
        color: 'text-emerald-300',
        gradient: 'bg-gradient-to-r from-emerald-500/20 to-green-500/20 border-emerald-500/50 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]',
    };
    if (score >= 60) return {
        emoji: '👍',
        label: 'Good Match',
        color: 'text-blue-300',
        gradient: 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20 border-blue-500/50 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.2)]',
    };
    if (score >= 50) return {
        emoji: '👌',
        label: 'Potential Match',
        color: 'text-amber-300',
        gradient: 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-amber-500/50 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]',
    };
    if (score >= 40) return {
        emoji: '🤝',
        label: 'Fair Match',
        color: 'text-gray-300',
        gradient: 'bg-gradient-to-r from-gray-500/20 to-slate-500/20 border-gray-500/50 text-gray-300 shadow-[0_0_10px_rgba(156,163,175,0.15)]',
    };
    return {
        emoji: '🤔',
        label: 'Weak Match',
        color: 'text-gray-500',
        gradient: 'bg-gray-500/10 border-gray-600/40 text-gray-500',
    };
};

/** Score color for plain text display */
export const getScoreColor = (score: number): string => {
    if (score >= 75) return "text-emerald-400";
    if (score >= 60) return "text-blue-400";
    if (score >= 50) return "text-amber-400";
    if (score >= 40) return "text-gray-300";
    return "text-muted-foreground";
};

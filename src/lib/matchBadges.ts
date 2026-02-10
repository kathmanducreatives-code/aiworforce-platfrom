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
    if (score >= 30) return {
        emoji: '🏆',
        label: 'Excellent Match',
        color: 'text-white',
        gradient: 'bg-[#059652] border-[#059652]/50 text-white shadow-[0_0_15px_rgba(5,150,82,0.2)]',
    };
    if (score >= 20) return {
        emoji: '💪',
        label: 'Strong Match',
        color: 'text-gray-900',
        gradient: 'bg-[#6DDBA6] border-[#6DDBA6]/50 text-gray-900 shadow-[0_0_15px_rgba(109,219,166,0.2)]',
    };
    if (score >= 10) return {
        emoji: '👍',
        label: 'Good Match',
        color: 'text-[#148C6E]',
        gradient: 'bg-[#E8FDF5] border-[#E8FDF5]/50 text-[#148C6E] shadow-[0_0_10px_rgba(20,140,110,0.1)]',
    };
    return {
        emoji: '🤔',
        label: 'Weak Match',
        color: 'text-gray-900',
        gradient: 'bg-[#A1A1A1] border-[#A1A1A1]/40 text-gray-900',
    };
};

/** Score color for plain text display */
export const getScoreColor = (score: number): string => {
    if (score >= 30) return "text-[#059652]";
    if (score >= 20) return "text-[#6DDBA6]";
    if (score >= 10) return "text-[#148C6E]";
    return "text-muted-foreground";
};

/**
 * Shared match badge configuration for consistent scoring display across ICP components.
 */

export interface MatchBadgeConfig {
    emoji: string;
    label: string;
    color: string;
    gradient: string;
    glow: string;
    textHex: string;
}

export const getMatchBadge = (score: number): MatchBadgeConfig => {
    if (score >= 30) return {
        emoji: '🏆',
        label: 'Excellent Match',
        color: 'text-white',
        gradient: 'linear-gradient(135deg, #059652 0%, #14b8a5 100%)',
        glow: '0 0 16px rgba(5,150,82,0.35)',
        textHex: '#ffffff',
    };
    if (score >= 20) return {
        emoji: '💪',
        label: 'Strong Match',
        color: 'text-gray-900',
        gradient: 'linear-gradient(135deg, #6DDBA6 0%, #34D399 100%)',
        glow: '0 0 12px rgba(109,219,166,0.25)',
        textHex: '#171717',
    };
    if (score >= 10) return {
        emoji: '👍',
        label: 'Good Match',
        color: 'text-[#148C6E]',
        gradient: 'linear-gradient(135deg, #E8FDF5 0%, #6DDBA6 50%, #14b8a5 100%)',
        glow: '0 0 10px rgba(20,140,110,0.15)',
        textHex: '#148C6E',
    };
    return {
        emoji: '🤔',
        label: 'Weak Match',
        color: 'text-gray-900',
        gradient: 'linear-gradient(135deg, #A1A1A1 0%, #D4D4D4 100%)',
        glow: 'none',
        textHex: '#171717',
    };
};

/** Score color for plain text display */
export const getScoreColor = (score: number): string => {
    if (score >= 30) return "text-[#059652]";
    if (score >= 20) return "text-[#6DDBA6]";
    if (score >= 10) return "text-[#148C6E]";
    return "text-muted-foreground";
};

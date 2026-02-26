import { cn } from '@/lib/utils';

interface ScorePillProps {
    score: number;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
    className?: string;
}

const ScorePill = ({ score, size = 'md', showLabel = false, className }: ScorePillProps) => {
    const getColor = () => {
        if (score >= 80) return { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', label: 'Excellent' };
        if (score >= 60) return { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', label: 'Good' };
        return { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/20', label: 'Low' };
    };

    const color = getColor();
    const sizes = {
        sm: 'text-xs px-1.5 py-0.5',
        md: 'text-sm px-2 py-0.5',
        lg: 'text-base px-3 py-1',
    };

    return (
        <span className={cn(
            'inline-flex items-center gap-1 font-semibold rounded-full border tabular-nums',
            color.bg, color.text, color.border,
            sizes[size],
            className
        )}>
            {score}%
            {showLabel && <span className="font-normal text-xs opacity-70">{color.label}</span>}
        </span>
    );
};

export default ScorePill;

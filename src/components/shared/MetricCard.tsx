import { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
    label: string;
    value: string | number | null;
    icon?: ReactNode;
    trend?: {
        value: number;
        label?: string;
    };
    className?: string;
}

const MetricCard = ({ label, value, icon, trend, className }: MetricCardProps) => {
    const trendColor = trend
        ? trend.value > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : trend.value < 0
                ? 'text-red-500 dark:text-red-400'
                : 'text-muted-foreground'
        : '';

    const TrendIcon = trend
        ? trend.value > 0 ? TrendingUp : trend.value < 0 ? TrendingDown : Minus
        : null;

    return (
        <div className={cn(
            'rounded-2xl border border-border bg-card/50 p-5 sm:p-6 transition-all duration-200',
            'hover:border-primary/20 hover:shadow-sm',
            className
        )}>
            {/* Label row */}
            <div className="flex items-center gap-2.5 mb-3 sm:mb-4">
                {icon && (
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/10">
                        {icon}
                    </div>
                )}
                <span className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    {label}
                </span>
            </div>

            {/* Value */}
            {value === null ? (
                <div className="h-10 skeleton-glass rounded-lg mb-1" />
            ) : (
                <div className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight tabular-nums">
                    {value}
                </div>
            )}

            {/* Trend */}
            {trend && (
                <div className={cn('flex items-center gap-1 mt-1.5 text-xs font-medium', trendColor)}>
                    {TrendIcon && <TrendIcon className="h-3 w-3" />}
                    <span>{trend.value > 0 ? '+' : ''}{trend.value}%</span>
                    {trend.label && <span className="text-muted-foreground ml-1">{trend.label}</span>}
                </div>
            )}
        </div>
    );
};

export default MetricCard;

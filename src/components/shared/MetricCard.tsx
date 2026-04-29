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

interface ExtendedProps extends MetricCardProps {
    valueColor?: 'default' | 'primary';
}

const MetricCard = ({ label, value, icon, trend, className, valueColor = 'default' }: ExtendedProps) => {
    const trendColor = trend
        ? trend.value > 0
            ? 'text-emerald-400'
            : trend.value < 0
                ? 'text-rose-400'
                : 'text-text-tertiary'
        : '';

    const TrendIcon = trend
        ? trend.value > 0 ? TrendingUp : trend.value < 0 ? TrendingDown : Minus
        : null;

    return (
        <div className={cn(
            'rounded-xl border border-border-subtle bg-card p-5 transition-colors',
            'hover:border-border',
            className,
        )}>
            <div className="flex items-start justify-between mb-3">
                <span className="font-label">{label}</span>
                {icon && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/[0.04]">
                        {icon}
                    </div>
                )}
            </div>

            {value === null ? (
                <div className="h-8 bg-white/[0.04] animate-pulse rounded mb-1" />
            ) : (
                <div className={cn(
                    'text-[32px] leading-none font-semibold tracking-tight tabular-nums',
                    valueColor === 'primary' ? 'text-primary' : 'text-foreground',
                )}>
                    {value}
                </div>
            )}

            {trend && (
                <div className={cn('flex items-center gap-1 mt-3 text-[12px]', trendColor)}>
                    {TrendIcon && <TrendIcon className="h-3 w-3" />}
                    <span className="font-medium">{trend.value > 0 ? '+' : ''}{trend.value}%</span>
                    {trend.label && <span className="text-text-tertiary ml-1">{trend.label}</span>}
                </div>
            )}
        </div>
    );
};

export default MetricCard;

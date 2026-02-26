import { cn } from '@/lib/utils';

interface SkeletonCardProps {
    variant?: 'metric' | 'table-row' | 'card' | 'list-item';
    count?: number;
    className?: string;
}

const SkeletonPulse = ({ className }: { className?: string }) => (
    <div className={cn('skeleton-glass rounded-md', className)} />
);

const MetricSkeleton = () => (
    <div className="rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
            <SkeletonPulse className="w-10 h-10 rounded-xl" />
            <SkeletonPulse className="h-3 w-20" />
        </div>
        <SkeletonPulse className="h-9 w-24 mb-2" />
        <SkeletonPulse className="h-3 w-16" />
    </div>
);

const TableRowSkeleton = () => (
    <div className="flex items-center gap-4 py-3 px-4 border-b border-border/50">
        <SkeletonPulse className="w-4 h-4 rounded" />
        <SkeletonPulse className="w-8 h-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
            <SkeletonPulse className="h-3.5 w-32" />
            <SkeletonPulse className="h-3 w-24" />
        </div>
        <SkeletonPulse className="h-5 w-12 rounded-full" />
        <SkeletonPulse className="h-5 w-16 rounded-full" />
        <SkeletonPulse className="h-3 w-20" />
    </div>
);

const CardSkeleton = () => (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
        <div className="flex items-start justify-between mb-4">
            <div className="space-y-2">
                <SkeletonPulse className="h-4 w-36" />
                <SkeletonPulse className="h-3 w-24" />
            </div>
            <SkeletonPulse className="w-6 h-6 rounded" />
        </div>
        <div className="space-y-2">
            <SkeletonPulse className="h-3 w-full" />
            <SkeletonPulse className="h-3 w-3/4" />
        </div>
        <div className="flex gap-2 mt-4">
            <SkeletonPulse className="h-5 w-14 rounded-full" />
            <SkeletonPulse className="h-5 w-14 rounded-full" />
            <SkeletonPulse className="h-5 w-14 rounded-full" />
        </div>
    </div>
);

const ListItemSkeleton = () => (
    <div className="flex items-center gap-3 py-2.5 px-4">
        <SkeletonPulse className="w-9 h-9 rounded-xl" />
        <div className="flex-1 space-y-1.5">
            <SkeletonPulse className="h-3.5 w-40" />
            <SkeletonPulse className="h-3 w-28" />
        </div>
        <SkeletonPulse className="h-3 w-16" />
    </div>
);

const variants = {
    metric: MetricSkeleton,
    'table-row': TableRowSkeleton,
    card: CardSkeleton,
    'list-item': ListItemSkeleton,
};

const SkeletonCard = ({ variant = 'card', count = 1, className }: SkeletonCardProps) => {
    const Component = variants[variant];
    return (
        <div className={cn('animate-in fade-in-0 duration-300', className)}>
            {Array.from({ length: count }).map((_, i) => (
                <Component key={i} />
            ))}
        </div>
    );
};

export default SkeletonCard;

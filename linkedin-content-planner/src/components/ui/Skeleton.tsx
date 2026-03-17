import React from 'react';

interface SkeletonProps {
    className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
    <div className={`skeleton ${className}`} />
);

export const SkeletonText: React.FC<{ lines?: number }> = ({ lines = 3 }) => (
    <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
                key={i}
                className={`h-3 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
            />
        ))}
    </div>
);

export const SkeletonCard: React.FC = () => (
    <div className="rounded-2xl border border-white/[0.07] bg-[#111113] p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-16" />
            </div>
        </div>
        <SkeletonText lines={2} />
    </div>
);

export const SkeletonRow: React.FC = () => (
    <div className="flex items-center gap-4 py-3 border-b border-white/[0.05]">
        <Skeleton className="w-8 h-8 rounded-full shrink-0" />
        <div className="flex-1 flex flex-col gap-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-28" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
    </div>
);

export default Skeleton;

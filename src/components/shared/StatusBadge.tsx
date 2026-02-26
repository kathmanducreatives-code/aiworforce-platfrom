import { cn } from '@/lib/utils';

type StatusType = 'active' | 'open' | 'closed' | 'paused' | 'draft' | 'pending' | 'error' | 'sent' | 'completed' | 'scheduled';

interface StatusBadgeProps {
    status: StatusType | string;
    className?: string;
}

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
    active: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
    open: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
    completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
    sent: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
    scheduled: { bg: 'bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
    pending: { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
    draft: { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-400', dot: 'bg-slate-400' },
    paused: { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-400', dot: 'bg-slate-400' },
    closed: { bg: 'bg-slate-500/10', text: 'text-slate-500 dark:text-slate-500', dot: 'bg-slate-400' },
    error: { bg: 'bg-red-500/10', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
};

const StatusBadge = ({ status, className }: StatusBadgeProps) => {
    const key = status.toLowerCase();
    const config = statusConfig[key] || statusConfig.draft;
    const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

    return (
        <span className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full',
            config.bg, config.text,
            className
        )}>
            <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
            {label}
        </span>
    );
};

export default StatusBadge;

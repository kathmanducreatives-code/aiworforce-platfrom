import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusConfig: Record<string, { label: string; className: string }> = {
  pending_assignment: {
    label: 'Pending Expert Assignment',
    className: 'border-amber-500/30 text-amber-600 bg-amber-500/10',
  },
  scheduled: {
    label: 'Scheduled',
    className: 'border-blue-500/30 text-blue-600 bg-blue-500/10',
  },
  in_progress: {
    label: 'In Progress',
    className: 'border-purple-500/30 text-purple-600 bg-purple-500/10',
  },
  recorded: {
    label: 'Interview Recorded',
    className: 'border-cyan-500/30 text-cyan-600 bg-cyan-500/10',
  },
  verified_paid: {
    label: 'Verified & Paid',
    className: 'border-emerald-500/30 text-emerald-600 bg-emerald-500/10',
  },
};

interface StatusBadgeMarketplaceProps {
  status: string;
}

const StatusBadgeMarketplace = ({ status }: StatusBadgeMarketplaceProps) => {
  const config = statusConfig[status] || { label: status, className: '' };
  return (
    <Badge variant="outline" className={cn('text-xs', config.className)}>
      {config.label}
    </Badge>
  );
};

export default StatusBadgeMarketplace;

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompetitorSignal {
  id: string;
  competitor_name: string | null;
  signal_type: string;
  signal_title: string;
  signal_summary: string | null;
  signal_source_url: string | null;
  signal_date: string | null;
  importance: string;
  is_read: boolean;
  created_at: string;
}

const IMPORTANCE_STYLES: Record<string, string> = {
  HIGH: 'bg-destructive/10 text-destructive border-destructive/20',
  MEDIUM: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  LOW: 'bg-muted text-muted-foreground border-border',
};

interface Props {
  signal: CompetitorSignal;
  onMarkRead: (id: string) => void;
}

const CompetitorIntelSignalCard = ({ signal, onMarkRead }: Props) => {
  const timeSince = getTimeSince(signal.signal_date || signal.created_at);
  const initials = (signal.competitor_name || '?').slice(0, 2).toUpperCase();

  return (
    <div className={cn(
      'rounded-xl border border-border bg-card/50 p-4 transition-all hover:border-primary/20',
      !signal.is_read && 'border-l-4 border-l-primary'
    )}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
            {initials}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{signal.competitor_name}</p>
            <p className="text-xs text-muted-foreground">{timeSince}</p>
          </div>
        </div>
        <Badge variant="outline" className={cn('text-[10px] font-semibold', IMPORTANCE_STYLES[signal.importance])}>
          {signal.importance}
        </Badge>
      </div>

      <p className="text-sm font-semibold text-foreground mb-1">{signal.signal_title}</p>
      {signal.signal_summary && (
        <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{signal.signal_summary}</p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        {signal.signal_source_url ? (
          <a href={signal.signal_source_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1">
            View Source <ExternalLink className="h-3 w-3" />
          </a>
        ) : <span />}
        {!signal.is_read && (
          <Button size="sm" variant="ghost" className="text-xs gap-1 rounded-lg" onClick={() => onMarkRead(signal.id)}>
            <Check className="h-3 w-3" /> Mark as Read
          </Button>
        )}
      </div>
    </div>
  );
};

function getTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default CompetitorIntelSignalCard;

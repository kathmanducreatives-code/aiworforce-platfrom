import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, UserPlus, Target, X, MapPin, Building } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TalentSignal {
  id: string;
  candidate_name: string | null;
  candidate_linkedin_url: string | null;
  candidate_title: string | null;
  candidate_company: string | null;
  candidate_location: string | null;
  candidate_photo_url: string | null;
  signal_type: string;
  signal_title: string;
  signal_summary: string | null;
  signal_source_url: string | null;
  signal_score: number;
  tier: string;
  is_actioned: boolean;
  action_type: string | null;
  matched_job_id: string | null;
  role_match_score: number | null;
  signal_detected_at: string;
}

const SIGNAL_COLORS: Record<string, string> = {
  open_to_work: 'border-l-emerald-500',
  layoff_victim: 'border-l-destructive',
  published_content: 'border-l-blue-500',
  spoke_at_event: 'border-l-purple-500',
  company_acquired: 'border-l-yellow-500',
};

const SIGNAL_LABELS: Record<string, string> = {
  open_to_work: '🔴 Open to Work',
  layoff_victim: '📉 Layoff',
  published_content: '✍️ Published',
  spoke_at_event: '🎤 Speaker',
  company_acquired: '🔄 Acquired',
};

const TIER_VARIANTS: Record<string, string> = {
  HOT: 'bg-destructive/10 text-destructive border-destructive/20',
  WARM: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  COLD: 'bg-muted text-muted-foreground border-border',
};

interface Props {
  signal: TalentSignal;
  onDismiss: (id: string) => void;
  onAction: (id: string, actionType: string) => void;
}

const TalentSignalCard = ({ signal, onDismiss, onAction }: Props) => {
  const initials = (signal.candidate_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const timeSince = getTimeSince(signal.signal_detected_at);

  return (
    <div className={cn(
      'rounded-2xl border border-border bg-card/50 p-5 transition-all hover:border-primary/20 hover:shadow-sm border-l-4',
      SIGNAL_COLORS[signal.signal_type] || 'border-l-muted-foreground',
      signal.is_actioned && 'opacity-60'
    )}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {signal.candidate_photo_url ? (
            <img src={signal.candidate_photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
              {initials}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">{signal.candidate_name || 'Unknown'}</p>
            {signal.candidate_title && (
              <p className="text-xs text-muted-foreground">{signal.candidate_title}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              {signal.candidate_company && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building className="h-3 w-3" /> {signal.candidate_company}
                </span>
              )}
              {signal.candidate_location && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {signal.candidate_location}
                </span>
              )}
            </div>
          </div>
        </div>
        <Badge variant="outline" className={cn('text-[10px] font-semibold', TIER_VARIANTS[signal.tier])}>
          {signal.tier}
        </Badge>
      </div>

      {/* Signal block */}
      <div className="mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          {SIGNAL_LABELS[signal.signal_type] || signal.signal_type}
        </p>
        <p className="text-sm text-foreground">{signal.signal_title}</p>
        {signal.signal_summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{signal.signal_summary}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-muted-foreground">{timeSince}</span>
          {signal.signal_source_url && (
            <a href={signal.signal_source_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-0.5">
              View Source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Role match */}
      {signal.matched_job_id && signal.role_match_score && (
        <div className="bg-primary/5 border border-primary/10 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-primary font-medium">
            ✦ Role match score: {signal.role_match_score}%
          </p>
        </div>
      )}

      {/* Actions */}
      {!signal.is_actioned && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button size="sm" variant="outline" className="gap-1 text-xs rounded-lg flex-1"
            onClick={() => onAction(signal.id, 'add_to_icp')}>
            <Target className="h-3 w-3" /> Add to ICP
          </Button>
          <Button size="sm" variant="outline" className="gap-1 text-xs rounded-lg flex-1"
            onClick={() => onAction(signal.id, 'add_to_outreach')}>
            <UserPlus className="h-3 w-3" /> Add to Outreach
          </Button>
          <Button size="sm" variant="ghost" className="text-xs rounded-lg px-2"
            onClick={() => onDismiss(signal.id)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
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

export default TalentSignalCard;

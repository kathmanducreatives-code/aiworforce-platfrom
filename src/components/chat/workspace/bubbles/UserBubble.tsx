import { useAuth } from '@/hooks/useAuth';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import MentionPill from '../MentionPill';

interface Props {
  text: string;
  ts: string;
}

export default function UserBubble({ text, ts }: Props) {
  const { user } = useAuth();
  const initial = (user?.email ?? 'You').charAt(0).toUpperCase();
  const rel = useRelativeTime(ts);

  return (
    <div className="flex items-start gap-3 justify-end group">
      <div className="max-w-[70%]">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="bg-surface-elevated border border-white/[0.08] px-4 py-3 text-[14px] text-foreground leading-relaxed"
              style={{ borderRadius: '12px 12px 2px 12px' }}
            >
              <MentionPill text={text} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">{new Date(ts).toLocaleString()}</TooltipContent>
        </Tooltip>
        <div className="text-[10px] text-text-tertiary text-right mt-1">{rel}</div>
      </div>
      <div className="h-7 w-7 shrink-0 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center text-[11px] font-medium text-primary">
        {initial}
      </div>
    </div>
  );
}

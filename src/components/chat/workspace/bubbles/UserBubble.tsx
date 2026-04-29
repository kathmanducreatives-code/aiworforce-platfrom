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
      <div className="max-w-[78%]">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="rounded-2xl rounded-br-sm bg-card border border-border/70 px-4 py-2.5 text-sm text-foreground/95 leading-relaxed">
              <MentionPill text={text} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">{new Date(ts).toLocaleString()}</TooltipContent>
        </Tooltip>
        <div className="text-[10px] text-muted-foreground/70 text-right mt-1">{rel}</div>
      </div>
      <div className="h-8 w-8 shrink-0 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center text-xs font-semibold text-primary">
        {initial}
      </div>
    </div>
  );
}

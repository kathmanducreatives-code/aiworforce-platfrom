import { cn } from '@/lib/utils';
import { AGENT_BY_NAME, deptRing, deptText, type AgentProfile } from '@/data/agentProfiles';
import { User } from 'lucide-react';

interface Props {
  role: 'user' | 'agent' | 'system';
  agentName?: string;
  text: string;
  timestamp?: string;
  nested?: boolean;
}

export default function ChatBubble({ role, agentName, text, timestamp, nested }: Props) {
  const agent: AgentProfile | undefined = agentName ? AGENT_BY_NAME[agentName.toLowerCase()] : undefined;
  const isUser = role === 'user';
  const isSystem = role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70 px-3 py-1 rounded-full border border-border/40 bg-background/40">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 group', isUser && 'flex-row-reverse', nested && 'pl-10')}>
      {/* Avatar */}
      <div className="shrink-0">
        {isUser ? (
          <div className="h-8 w-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
            <User className="h-4 w-4 text-primary" />
          </div>
        ) : agent ? (
          <img
            src={agent.image}
            alt={agent.name}
            className={cn('h-8 w-8 rounded-full object-cover ring-2', deptRing[agent.department])}
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted border border-border" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        <div className="flex items-baseline gap-2 mb-1">
          {!isUser && agent && (
            <>
              <span className="text-xs font-semibold text-foreground">{agent.name}</span>
              <span className={cn('text-[10px] uppercase tracking-wider', deptText[agent.department])}>
                {agent.department}
              </span>
            </>
          )}
          {isUser && <span className="text-xs font-semibold text-foreground">You</span>}
          {timestamp && (
            <span className="text-[10px] text-muted-foreground/60">{formatTime(timestamp)}</span>
          )}
        </div>
        <div
          className={cn(
            'inline-block max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted/70 text-foreground border border-border/40 rounded-tl-sm',
          )}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

import { cn } from '@/lib/utils';
import { resolveAgent } from '@/lib/agentResolver';
import AgentAvatar from './workspace/agents/AgentAvatar';
import { User } from 'lucide-react';

interface Props {
  role: 'user' | 'agent' | 'system';
  agentName?: string;
  text: string;
  timestamp?: string;
  nested?: boolean;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function ChatBubble({ role, agentName, text, timestamp, nested }: Props) {
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

  const profile = !isUser ? resolveAgent(agentName) : null;
  const accent = profile?.accentHex ?? '#10B981';
  const tintBg = hexToRgba(accent, 0.06);

  return (
    <div className={cn('flex gap-3 group', isUser && 'flex-row-reverse', nested && 'pl-10')}>
      {/* Avatar */}
      <div className="shrink-0">
        {isUser ? (
          <div className="h-8 w-8 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
            <User className="h-4 w-4 text-primary" />
          </div>
        ) : (
          <AgentAvatar slug={profile?.id} size="sm" />
        )}
      </div>

      {/* Bubble */}
      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        <div className="flex items-baseline gap-1.5 mb-1">
          {isUser ? (
            <span className="text-xs font-semibold text-foreground">You</span>
          ) : profile ? (
            <>
              <span className="text-xs font-semibold text-foreground">{profile.name}</span>
              <span className="text-[11px]" style={{ color: accent }}>· {profile.role}</span>
            </>
          ) : null}
          {timestamp && (
            <span className="text-[10px] text-muted-foreground/60">{formatTime(timestamp)}</span>
          )}
        </div>
        <div
          className={cn(
            'inline-block max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'border-l-2 rounded-tl-sm text-foreground',
          )}
          style={!isUser ? { backgroundColor: tintBg, borderLeftColor: accent } : undefined}
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

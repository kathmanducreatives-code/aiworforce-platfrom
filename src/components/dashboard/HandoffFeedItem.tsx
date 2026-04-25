import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import AgentAvatar from '@/components/agents/AgentAvatar';
import {
  Sparkles, Play, ArrowRightLeft, AlertCircle, Check, X, CheckCircle2,
} from 'lucide-react';
import type { DBActivity, ActivityEventType } from '@/lib/orchestration';

// Legacy shape kept for backward compat with the old hardcoded feed.
export interface HandoffEvent {
  type: 'handoff';
  time: string;
  from: { agent: string; dept: 'talent' | 'growth' | 'content' | 'intelligence'; action: string };
  to:   { agent: string; dept: 'talent' | 'growth' | 'content' | 'intelligence'; action: string };
}

const deptStroke: Record<string, string> = {
  talent: 'stroke-emerald-500',
  growth: 'stroke-blue-500',
  content: 'stroke-violet-500',
  intelligence: 'stroke-amber-500',
};

const eventChrome: Record<ActivityEventType, { label: string; icon: any; tint: string; border: string }> = {
  plan_created:      { label: 'Plan',     icon: Sparkles,     tint: 'text-primary',       border: 'border-l-primary/70' },
  agent_started:     { label: 'Started',  icon: Play,         tint: 'text-blue-400',      border: 'border-l-blue-500/70' },
  handoff:           { label: 'Handoff',  icon: ArrowRightLeft, tint: 'text-zinc-400',    border: 'border-l-zinc-500/70' },
  awaiting_approval: { label: 'Awaiting', icon: AlertCircle,  tint: 'text-amber-400',     border: 'border-l-amber-500/70' },
  approved:          { label: 'Approved', icon: Check,        tint: 'text-emerald-400',   border: 'border-l-emerald-500/70' },
  rejected:          { label: 'Rejected', icon: X,            tint: 'text-rose-400',      border: 'border-l-rose-500/70' },
  plan_complete:     { label: 'Complete', icon: CheckCircle2, tint: 'text-emerald-400',   border: 'border-l-emerald-500/70' },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  event: HandoffEvent | DBActivity;
}

export default function HandoffFeedItem({ event }: Props) {
  // Legacy hardcoded handoff
  if ('type' in event && event.type === 'handoff') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-xl border border-white/10 bg-[#1f2a3d]/70 px-4 py-3.5 overflow-hidden border-l-[3px] border-l-zinc-500/70"
      >
        <span className="absolute top-2.5 right-2.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">
          Handoff
        </span>
        <div className="flex items-center gap-3 mb-2.5">
          <AgentAvatar agentName={event.from.agent} size="sm" />
          <svg width="60" height="14" viewBox="0 0 60 14" className="shrink-0">
            <line x1="2" y1="7" x2="50" y2="7" className={cn(deptStroke[event.from.dept])} strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round">
              <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.9s" repeatCount="indefinite" />
            </line>
            <path d="M50 3 L57 7 L50 11" fill="none" className={cn(deptStroke[event.to.dept])} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <AgentAvatar agentName={event.to.agent} size="sm" />
          <span className="text-[11px] text-zinc-500 font-mono ml-auto mr-16">{event.time}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-zinc-500 mb-0.5 text-[10px] uppercase tracking-wider font-semibold">{event.from.agent}</p>
            <p className="text-zinc-300">{event.from.action}</p>
          </div>
          <div>
            <p className="text-zinc-500 mb-0.5 text-[10px] uppercase tracking-wider font-semibold">{event.to.agent}</p>
            <p className="text-zinc-300">{event.to.action}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Live DB activity
  const ev = event as DBActivity;
  const chrome = eventChrome[ev.event_type] ?? eventChrome.plan_created;
  const Icon = chrome.icon;

  // Special-case handoff layout when we have from/to agent names in metadata
  if (ev.event_type === 'handoff' && ev.metadata?.from_agent && ev.metadata?.to_agent) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'relative rounded-xl border border-white/10 bg-[#1f2a3d]/70 px-4 py-3.5 overflow-hidden border-l-[3px]',
          chrome.border,
        )}
      >
        <span className="absolute top-2.5 right-2.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">
          Handoff
        </span>
        <div className="flex items-center gap-3 mb-2.5">
          <AgentAvatar agentName={String(ev.metadata.from_agent)} size="sm" />
          <ArrowRightLeft className="h-3.5 w-3.5 text-zinc-500" />
          <AgentAvatar agentName={String(ev.metadata.to_agent)} size="sm" />
          <span className="text-[11px] text-zinc-500 font-mono ml-auto mr-16">{formatTime(ev.created_at)}</span>
        </div>
        <p className="text-sm text-zinc-300">{ev.title}</p>
        {ev.body && <p className="text-xs text-zinc-500 mt-0.5">{ev.body}</p>}
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative rounded-xl border border-border bg-card/70 px-4 py-3 overflow-hidden border-l-[3px] flex items-start gap-3',
        chrome.border,
      )}
    >
      <div className={cn('mt-0.5 shrink-0', chrome.tint)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground truncate">{ev.title}</p>
          <span className={cn('text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded bg-muted/60', chrome.tint)}>
            {chrome.label}
          </span>
        </div>
        {ev.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ev.body}</p>}
      </div>
      <span className="text-[11px] text-muted-foreground font-mono shrink-0">{formatTime(ev.created_at)}</span>
    </motion.div>
  );
}

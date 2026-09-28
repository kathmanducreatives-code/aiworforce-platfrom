// ONE AGENT STATUS for every department page — Lyra, Atlas and Scribe read as
// the same object: portrait, name, role, and one status pill.
//
//   sm  — a chip in a page header (28px portrait)
//   md  — the head of an agent panel or strip (40px portrait)
//
// `status` is the agent's LIVE word (useDepartmentAgentStatus → the same
// visual-state source as the dashboard cards). There is no default: when the
// live state is not known yet, no pill is shown rather than a guess.
//
// `meta` is the department's own line (Atlas: accounts indexed, drafts ready).

import type { ReactNode } from 'react';
import AgentPortrait from '@/components/agents/AgentPortrait';
import { cn } from '@/lib/utils';

interface Props {
  agentId?: string;
  name: string;
  role: string;
  src?: string | null;
  status?: string | null;
  size?: 'sm' | 'md';
  meta?: ReactNode;
  /** Controls at the end of the row (collapse, close). */
  trailing?: ReactNode;
  className?: string;
}

/** The status pill: a soft emerald capsule with a dot. */
export function AgentStatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-300 ring-1 ring-inset ring-emerald-400/20">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.7)]" aria-hidden />
      {label}
    </span>
  );
}

export default function AgentStatus({ agentId, name, role, src, status = null, size = 'md', meta, trailing, className }: Props) {
  const sm = size === 'sm';
  return (
    <div className={cn('flex min-w-0 items-center', sm ? 'gap-2.5' : 'gap-3', className)}>
      <AgentPortrait agentId={agentId} name={name} src={src ?? undefined} size={sm ? 28 : 40} decorative />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex min-w-0 items-center gap-2">
          <p className={cn('truncate font-semibold text-foreground', sm ? 'text-[12.5px]' : 'text-[14px]')}>{name}</p>
          {status && <AgentStatusPill label={status} />}
        </div>
        <p className={cn('mt-0.5 truncate text-muted-foreground/75', sm ? 'text-[11px]' : 'text-[12px]')}>{role}</p>
        {meta && <div className="mt-1 truncate text-[11px] text-muted-foreground tabular-nums">{meta}</div>}
      </div>
      {trailing}
    </div>
  );
}

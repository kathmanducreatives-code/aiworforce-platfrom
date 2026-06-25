import { ArrowRight, Clock, Sparkles, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import AgentAvatar from './AgentAvatar';
import WorkflowThumbnail from './WorkflowThumbnail';
import { OUTPUT_LABEL } from '@/lib/workflows/visualMeta';
import type { WorkflowDefinition, WorkflowStatus } from '@/lib/workflows/registry';

interface Props {
  workflow: WorkflowDefinition;
  status: WorkflowStatus;
  lastRunAt?: number | null;
  onSelect: () => void;
}

function StatusChip({ status }: { status: WorkflowStatus }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.7)]" /> Ready
      </span>
    );
  }
  if (status === 'setup_needed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/[0.07] text-amber-300">
        <Wrench className="w-3 h-3" /> Setup needed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.03] text-neutral-400">
      Coming soon
    </span>
  );
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function WorkflowCard({ workflow, status, lastRunAt, onSelect }: Props) {
  const disabled = status === 'coming_soon';
  const cta = status === 'setup_needed' ? 'Configure provider' : status === 'coming_soon' ? 'Coming soon' : 'Run workflow';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'group text-left relative flex flex-col rounded-card border bg-white/[0.025] backdrop-blur-xl overflow-hidden transition-all duration-200',
        'border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
        !disabled && 'hover:border-emerald-500/35 hover:bg-white/[0.04] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_rgba(16,185,129,0.55)]',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <WorkflowThumbnail workflow={workflow} />

      <div className="flex flex-col gap-3 p-5 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {workflow.recommended && (
            <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.14em] font-mono font-semibold text-emerald-300 border border-emerald-500/30 bg-emerald-500/[0.08] rounded-full px-2 py-0.5">
              <Sparkles className="w-3 h-3" /> Recommended
            </span>
          )}
          <StatusChip status={status} />
        </div>

        <div>
          <h3 className="text-[17.5px] font-semibold text-foreground leading-snug tracking-tight">{workflow.title}</h3>
          <p className="text-[14px] text-neutral-300/90 mt-1.5 line-clamp-2 leading-relaxed">{workflow.description}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center -space-x-2">
            {workflow.agents.map((a) => (
              <AgentAvatar key={a} agentId={a} size={24} className="ring-2 ring-[#0a0a0a]" />
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] font-mono text-neutral-400">
            <span>{OUTPUT_LABEL[workflow.outputType] || workflow.outputType}</span>
            <span className="text-neutral-700">·</span>
            <span>{workflow.estimatedCredits}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          {lastRunAt ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-500">
              <Clock className="w-3 h-3" /> Last run {timeAgo(lastRunAt)}
            </span>
          ) : <span />}
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[12.5px] font-medium transition-all',
              status === 'ready' && 'text-emerald-300 group-hover:gap-2',
              status === 'setup_needed' && 'text-amber-300',
              status === 'coming_soon' && 'text-neutral-500',
            )}
          >
            {cta}
            {!disabled && <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />}
          </span>
        </div>
      </div>
    </button>
  );
}

import { ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import AgentAvatar from './AgentAvatar';
import WorkflowThumbnail from './WorkflowThumbnail';
import { OUTPUT_LABEL } from '@/lib/workflows/visualMeta';
import type { WorkflowDefinition, WorkflowStatus } from '@/lib/workflows/registry';

interface Props {
  workflow: WorkflowDefinition;
  status: WorkflowStatus;
  reason?: string;
  onSelect: () => void;
}

/** Larger featured tile for the "Start here" row. */
export default function FeaturedWorkflowCard({ workflow, status, reason, onSelect }: Props) {
  const disabled = status === 'coming_soon';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'group text-left relative flex flex-col rounded-card border bg-gradient-to-br from-white/[0.04] to-white/[0.015] backdrop-blur-xl overflow-hidden transition-all duration-200',
        'border-emerald-500/20 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(16,185,129,0.04)]',
        !disabled && 'hover:border-emerald-500/40 hover:-translate-y-0.5 hover:shadow-[0_22px_46px_-22px_rgba(16,185,129,0.55)]',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <WorkflowThumbnail workflow={workflow} height={148} />
      <div className="flex flex-col gap-3 p-6 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.14em] font-mono font-semibold text-emerald-300 border border-emerald-500/30 bg-emerald-500/[0.08] rounded-full px-2 py-0.5">
            <Sparkles className="w-3 h-3" /> Start here
          </span>
        </div>
        <div>
          <h3 className="text-[20px] font-semibold text-foreground leading-snug tracking-tight">{workflow.title}</h3>
          <p className="text-[14px] text-neutral-300/90 mt-2 line-clamp-2 leading-relaxed">{workflow.description}</p>
          {reason && (
            <p className="mt-2 text-[12.5px] text-emerald-300/90 leading-relaxed">{reason}</p>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="flex items-center -space-x-2">
              {workflow.agents.map((a) => (
                <AgentAvatar key={a} agentId={a} size={26} className="ring-2 ring-[#0a0a0a]" />
              ))}
            </div>
            <span className="text-[12px] font-mono text-neutral-400">
              {OUTPUT_LABEL[workflow.outputType] || workflow.outputType} · {workflow.estimatedCredits}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300 group-hover:gap-2 transition-all">
            Run <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </button>
  );
}

import { Clock, Sparkles, AlertTriangle, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import AgentAvatar from './AgentAvatar';
import type { WorkflowDefinition, WorkflowStatus } from '@/lib/workflows/registry';

interface Props {
  workflow: WorkflowDefinition;
  status: WorkflowStatus;
  lastRunAt?: number | null;
  onSelect: () => void;
}

const OUTPUT_LABEL: Record<string, string> = {
  lead_table: 'Lead table',
  contact_table: 'Contact table',
  enrichment_table: 'Enrichment',
  draft_list: 'Drafts',
  content_doc: 'Content',
  audit_report: 'Audit report',
  briefing: 'Briefing',
};

function StatusChip({ status }: { status: WorkflowStatus }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.7)]" /> Ready
      </span>
    );
  }
  if (status === 'setup_needed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/[0.06] text-amber-300">
        <Wrench className="w-2.5 h-2.5" /> Setup needed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-neutral-400">
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
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'group text-left relative flex flex-col gap-3 p-4 rounded-xl border bg-[#0a0a0a]/60 backdrop-blur-xl transition-all duration-200',
        'border-white/[0.06] hover:border-emerald-500/30 hover:bg-[#0c0c0c]/80 hover:shadow-[0_0_24px_-12px_rgba(16,185,129,0.45)]',
        disabled && 'opacity-60 hover:border-white/[0.06] hover:shadow-none cursor-not-allowed',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {workflow.recommended && (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-mono text-emerald-300/90 border border-emerald-500/20 bg-emerald-500/[0.05] rounded px-1.5 py-px">
                <Sparkles className="w-2.5 h-2.5" /> Recommended
              </span>
            )}
            <StatusChip status={status} />
          </div>
          <h3 className="text-[14px] font-medium text-foreground leading-tight">{workflow.title}</h3>
          <p className="text-[12px] text-neutral-400 mt-1 line-clamp-2 leading-snug">{workflow.description}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.04]">
        <div className="flex items-center -space-x-1.5">
          {workflow.agents.map((a) => (
            <AgentAvatar key={a} agentId={a} size={22} className="ring-1 ring-[#0a0a0a]" />
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500">
          <span>{OUTPUT_LABEL[workflow.outputType] || workflow.outputType}</span>
          <span className="text-neutral-700">·</span>
          <span>{workflow.estimatedCredits}</span>
        </div>
      </div>

      {lastRunAt && (
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
          <Clock className="w-3 h-3" /> Last run {timeAgo(lastRunAt)}
        </div>
      )}

      {status === 'setup_needed' && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90">
          <AlertTriangle className="w-3 h-3" /> Needs a provider before it can run
        </div>
      )}
    </button>
  );
}

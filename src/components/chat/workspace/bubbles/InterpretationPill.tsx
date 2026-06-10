import { Brain } from 'lucide-react';

interface Props {
  businessGoal?: string | null;
  intent?: string | null;
  selectedActorKey?: string | null;
  executionMode?: string | null;
}

export default function InterpretationPill({
  businessGoal,
  intent,
  selectedActorKey,
  executionMode,
}: Props) {
  if (!businessGoal && !intent && !selectedActorKey && !executionMode) return null;
  return (
    <div className="mt-1.5 inline-flex items-start gap-2 max-w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <Brain className="h-3 w-3 text-emerald-300/80 shrink-0 mt-0.5" />
      <div className="text-[11px] text-[#7D8590] leading-snug min-w-0">
        <span className="text-[#C9D1D9]">Pilot read this as:</span>{' '}
        {businessGoal && <span className="text-[#C9D1D9]">{businessGoal}</span>}
        <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
          {intent && (
            <span className="px-1.5 py-0.5 rounded border border-white/[0.08] text-[10px] font-mono text-[#C9D1D9]">
              {intent}
            </span>
          )}
          {selectedActorKey && (
            <span className="px-1.5 py-0.5 rounded border border-emerald-500/20 text-[10px] font-mono text-emerald-300">
              {selectedActorKey}
            </span>
          )}
          {executionMode && (
            <span className="px-1.5 py-0.5 rounded border border-white/[0.08] text-[10px] uppercase tracking-wider text-[#7D8590]">
              {executionMode}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

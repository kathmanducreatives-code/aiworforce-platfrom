import { Sparkles, ShieldCheck } from 'lucide-react';
import { formatCredits, isDevBypass } from '@/lib/credits/ledger';

interface Props {
  estimatedCredits: number;
  agents?: string[];
  runs?: string;
  output?: string;
  safetyNote?: string;
}

/**
 * Drop-in row used in every workflow confirmation card. Shows estimated
 * credits, what the workforce will do, the expected output, and the safety
 * note that NOTHING will be sent automatically.
 */
export default function WorkflowEstimateRow({ estimatedCredits, agents, runs, output, safetyNote }: Props) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 space-y-2.5 text-[12.5px] text-neutral-300">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-medium">Estimated cost</span>
        </span>
        <span className="font-mono tabular-nums text-emerald-300">
          ~{formatCredits(estimatedCredits)} credits
        </span>
      </div>
      {(runs || output || (agents && agents.length > 0)) && (
        <div className="space-y-1 text-neutral-400">
          {agents && agents.length > 0 && (
            <div>
              <span className="text-neutral-500">Workforce: </span>
              <span className="text-neutral-200">{agents.join(' → ')}</span>
            </div>
          )}
          {runs && <div><span className="text-neutral-500">Includes: </span>{runs}</div>}
          {output && <div><span className="text-neutral-500">You'll get: </span>{output}</div>}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11.5px] text-neutral-500 pt-1 border-t border-white/[0.05]">
        <ShieldCheck className="h-3 w-3 text-emerald-400/70" />
        {safetyNote || 'Nothing will be sent automatically. All outreach stays draft-only.'}
      </div>
      {isDevBypass() && (
        <div className="text-[11px] text-amber-300/80 pt-0.5">
          Dev mode · credits estimated locally, not charged.
        </div>
      )}
    </div>
  );
}

import { Loader2 } from 'lucide-react';
import {
  exclusionSummary, progressLines, type WorkbenchProgress,
} from '@/lib/workbench/workbenchProgress';

/**
 * Live stage counters for the run that owns this Workbench.
 *
 * A stage that has not run yet renders as "—", never "0". The difference is the
 * whole point: "we have not looked yet" and "we looked and found none" are
 * different statements, and collapsing them is what made a working run
 * indistinguishable from a hung one.
 */
export default function WorkflowProgressStrip({ progress }: { progress: WorkbenchProgress }) {
  const lines = progressLines(progress);
  const exclusions = exclusionSummary(progress);

  return (
    <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02] shrink-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        {progress.in_progress && <Loader2 className="h-3 w-3 animate-spin text-emerald-300" />}
        <span className="text-[11px] uppercase tracking-wider text-[#7D8590]">
          {progress.in_progress ? 'Sourcing in progress' : 'Run complete'}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {lines.map((l) => (
          <div key={l.label} className="text-[11px] text-[#7D8590]">
            {l.label}{' '}
            <span className={l.reached ? 'text-[#C9D1D9] font-medium' : 'text-[#4a5058]'}>
              {l.reached ? l.value : '—'}
            </span>
          </div>
        ))}
      </div>
      {exclusions.length > 0 && (
        <div className="text-[11px] text-[#7D8590] mt-1">
          Excluded before any paid lookup: {exclusions.join(', ')}.
        </div>
      )}
      {progress.in_progress && (
        <div className="text-[11px] text-amber-300/80 mt-1">
          These rows are still being verified — they are not qualified leads yet.
        </div>
      )}
    </div>
  );
}

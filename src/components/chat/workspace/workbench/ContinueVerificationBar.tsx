import { useState } from 'react';
import { Loader2, PlayCircle } from 'lucide-react';
import { continueWorkflow } from '@/lib/workbench/continueWorkflow';

/**
 * Offer to continue a workflow that stopped holding a paid company dataset.
 *
 * One click, no ids to paste and no keys: `continueWorkflow` goes out as the
 * signed-in user. The button disables itself while starting, because a second
 * click would be a second request — the backend is idempotent and would return
 * the same continuation, but the UI should not invite the race.
 */
export default function ContinueVerificationBar({
  originalTaskId, originalPlanId, conversationId, onContinued,
}: {
  originalTaskId: string;
  originalPlanId: string;
  conversationId: string;
  onContinued: (r: { planId: string; taskId: string | null; conversationId: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await continueWorkflow({ originalTaskId, originalPlanId, conversationId });
    if (!r.ok || !r.plan_id) {
      setError(r.message ?? 'Could not continue this workflow.');
      setBusy(false);
      return;
    }
    // Ownership moves to the continuation; the conversation does not change.
    onContinued({
      planId: r.plan_id,
      taskId: r.task_id ?? null,
      conversationId: r.conversation_id ?? conversationId,
    });
    setBusy(false);
  };

  return (
    <div className="px-3 py-2 border-b border-white/[0.06] bg-emerald-500/[0.05] shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-[#C9D1D9]">
          This run stopped before verification. The companies it already found can be
          continued without searching again.
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md
                     border border-emerald-500/30 bg-emerald-500/10 text-emerald-200
                     hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
            : <><PlayCircle className="h-3.5 w-3.5" /> Continue verification</>}
        </button>
      </div>
      {error && <div className="text-[11px] text-amber-300 mt-1">{error}</div>}
    </div>
  );
}

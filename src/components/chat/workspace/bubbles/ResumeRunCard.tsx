import { useState } from 'react';
import { Loader2, PlayCircle, PauseCircle } from 'lucide-react';
import { continueWorkflow } from '@/lib/workbench/continueWorkflow';

/**
 * Resume a run that saved a checkpoint, from the chat where it stopped.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The checkpoint message used to end with: say "continue" and I'll pick it up
 * from here. There was nothing on the other end of that sentence. On
 * 2026-08-28 16:49 the user did exactly as told, Chat Brain read "continue"
 * against a conversation full of the original request, returned
 * `objective: source, route_reason: discovery`, and the product previewed and
 * ran a BRAND NEW sourcing job — re-buying the 30 companies and the enrichment
 * the checkpoint already held. Two credits, to re-establish saved work, after
 * a message that said nothing extra would be charged.
 *
 * Resumption is not a sentence to be interpreted. It is a specific task and
 * plan, and `continue-workflow` already takes exactly those ids, derives
 * everything else from records the caller owns, and is idempotent. This is that
 * call, on the message that reports the pause.
 */
export default function ResumeRunCard({
  taskId, planId, conversationId, summary,
}: {
  taskId: string;
  planId: string;
  conversationId: string;
  summary?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    const r = await continueWorkflow({
      originalTaskId: taskId, originalPlanId: planId, conversationId,
    });
    if (!r.ok || !r.plan_id) {
      // THE REAL REASON. A continuation that cannot start has one, and hiding
      // it behind "could not continue" is how the last three of these took a
      // database query to explain.
      const code = r.error && r.error !== 'continuation_failed' ? ` (${r.error})` : '';
      setError(`${r.message ?? 'Could not continue this run.'}${code}`);
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
  };

  if (done) {
    return (
      <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3.5 py-2.5
                      text-[13px] text-emerald-300 flex items-center gap-2 max-w-[520px]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Picking up where it left off — no new search.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] px-3.5 py-3 max-w-[520px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-sky-400/80
                          flex items-center gap-1.5">
            <PauseCircle className="h-3 w-3" /> Paused
          </div>
          {summary && (
            <div className="mt-1 text-[12.5px] text-[#C9D1D9]">{summary}</div>
          )}
          <div className="mt-1 text-[11.5px] text-[#7D8590]">
            Continuing uses the work already paid for — it does not search again.
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md
                     border border-sky-500/30 bg-sky-500/10 text-sky-200
                     hover:bg-sky-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
            : <><PlayCircle className="h-3.5 w-3.5" /> Continue</>}
        </button>
      </div>
      {error && <div className="text-[11.5px] text-amber-300 mt-2">{error}</div>}
    </div>
  );
}

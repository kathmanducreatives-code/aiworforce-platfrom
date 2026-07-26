import { useCallback, useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildQuotaProgress, type QuotaBackendFields, type QuotaCandidate } from '@/lib/qualifiedLead/quotaProgress';
import { buildWorkbenchCounts } from '@/lib/qualifiedLead/workbenchCounts';
import {
  buildContinuationView, initialContinuationState, continuationReducer,
  canDispatchContinue, buildContinuationRequest,
  type CompanyFirstResponse, type ContinuationState,
} from '@/lib/qualifiedLead/continuation';

interface Props {
  /** The company-first response (or the task's `company_first` block). */
  response: (CompanyFirstResponse & QuotaBackendFields) | null;
  candidates?: QuotaCandidate[];
  taskId: string | null;
  /**
   * Resumes the SAME task from its checkpoint. Never creates a new task and
   * never restarts round 1 — the request body proves both.
   */
  onContinue: (req: ReturnType<typeof buildContinuationRequest>) => Promise<CompanyFirstResponse & QuotaBackendFields>;
}

/**
 * Quota progress + continuation for a company-first qualified-lead run.
 *
 * Every number here comes from the quota adapter. This component never counts
 * rows, accounts or successful writes — that inversion is what reported
 * "completed" for a run that delivered zero CONTACT-ready leads.
 */
export default function QualifiedLeadProgressCard({ response, candidates = [], taskId, onContinue }: Props) {
  const [latest, setLatest] = useState<(CompanyFirstResponse & QuotaBackendFields) | null>(response);
  const current = latest ?? response;

  const view = useMemo(() => buildContinuationView(current), [current]);
  const progress = useMemo(() => buildQuotaProgress(current, candidates), [current, candidates]);
  const counts = useMemo(() => buildWorkbenchCounts({ rows: candidates, progress }), [candidates, progress]);

  const [state, setState] = useState<ContinuationState>(() => initialContinuationState(view, taskId));

  const handleContinue = useCallback(async () => {
    // Guarded BEFORE any state change, so a double click cannot dispatch twice.
    if (!canDispatchContinue(state, view)) return;
    const next = continuationReducer(state, { type: 'continue_clicked' });
    if (next.phase !== 'running') { setState(next); return; }
    setState(next);

    const req = buildContinuationRequest(next);
    try {
      const res = await onContinue(req);
      setLatest(res);
      setState((s) => continuationReducer(s, { type: 'succeeded', view: buildContinuationView(res) }));
    } catch (e) {
      setState((s) => continuationReducer(s, { type: 'failed', error: (e as Error)?.message ?? 'Continuation failed.' }));
    }
  }, [state, view, onContinue]);

  if (!current) return null;

  const running = state.phase === 'running';
  const complete = view.status === 'completed';

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
      {/* Status headline — mapped honestly from terminal_status, never from a
          200 response. */}
      <div className="flex items-start gap-2">
        {complete
          ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          : <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />}
        <div className="min-w-0">
          <div className={`text-[14px] font-semibold ${complete ? 'text-emerald-300' : 'text-amber-200'}`}>
            {view.lines[0]}
          </div>
          {view.lines.slice(1).map((l) => (
            <div key={l} className="text-[12.5px] text-[#C9D1D9]">{l}</div>
          ))}
        </div>
      </div>

      {/* Account-shaped and lead-shaped counts, separately labelled. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {counts.map((c) => (
          <div
            key={c.key}
            className={`rounded-lg border px-2 py-1.5 ${
              c.group === 'lead' ? 'border-emerald-500/15 bg-emerald-500/[0.03]' : 'border-white/[0.06] bg-white/[0.02]'
            }`}
          >
            <div className="text-[9.5px] font-mono uppercase tracking-wider text-[#7D8590] leading-tight">{c.label}</div>
            <div className={`text-[16px] font-bold tabular-nums ${
              c.tone === 'positive' ? 'text-emerald-300' : c.tone === 'warning' ? 'text-amber-300' : 'text-[#F0F6FC]'
            }`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Funnel narrative — the five canonical progress lines. */}
      <div className="text-[12px] text-[#8B949E] flex flex-wrap gap-x-2 gap-y-0.5">
        {progress.lines.map((l, i) => (
          <span key={l}>{l}{i < progress.lines.length - 1 && <span className="text-[#484F58] ml-2">·</span>}</span>
        ))}
      </div>

      {state.error && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-2.5 text-[12px] text-rose-200">
          Continuation failed: {state.error}
          {state.lastCheckpointAt && (
            <div className="text-rose-300/70 mt-0.5">
              The previous checkpoint is intact — continuing again resumes from it.
            </div>
          )}
        </div>
      )}

      {/* Continue is offered ONLY for continuation_required with a token, and is
          disabled while a continuation is in flight. */}
      {view.actionLabel && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleContinue}
            disabled={running}
            className={`h-8 px-3.5 rounded-lg font-bold text-[12.5px] ${
              running
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-white/[0.04]'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black'
            }`}
          >
            {running
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Continuing…</>
              : <><RefreshCw className="h-3.5 w-3.5" /> {state.error ? 'Retry continuation' : view.actionLabel}</>}
          </Button>
          <span className="text-[11px] text-[#7D8590]">
            Resumes round {view.nextRound ?? '—'} of the same task — no results are discarded.
          </span>
        </div>
      )}
    </div>
  );
}

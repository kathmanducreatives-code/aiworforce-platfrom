import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, MessageSquare, X } from 'lucide-react';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useProductTour } from '@/hooks/useProductTour';
import { recommendFirstMove } from '@/lib/workflows/recommend';
import { restartProductTour } from '@/components/tour/ProductTour';

/**
 * First-run helper card shown on the Dashboard after onboarding.
 * Dismissible. Persists dismissal to company_brain.onboarding_meta.
 */
export default function FirstRunHelper() {
  const navigate = useNavigate();
  const { data } = useCompanyBrain();
  const { state, dismissFirstRunHelper, loading } = useProductTour();
  const firstMove = useMemo(() => recommendFirstMove(data?.profile), [data?.profile]);

  if (loading) return null;
  if (!data?.onboarding_completed) return null;
  if (state.first_run_helper_dismissed) return null;

  return (
    <div className="relative mb-6 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] via-transparent to-transparent overflow-hidden">
      <div className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-emerald-500/15 blur-[100px]" />

      <button
        type="button"
        onClick={() => dismissFirstRunHelper()}
        aria-label="Dismiss"
        className="absolute top-3 right-3 z-10 h-7 w-7 rounded-md text-neutral-500 hover:text-foreground hover:bg-white/[0.05] flex items-center justify-center"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5 p-5 lg:p-6">
        <div className="min-w-0">
          <div className="text-[11px] font-mono uppercase tracking-[0.22em] text-emerald-300/80">Start here</div>
          <h3 className="mt-1.5 text-[20px] font-semibold text-foreground tracking-tight">
            {firstMove.headline}
          </h3>
          <p className="mt-1.5 text-[13.5px] text-neutral-300 leading-[1.55] max-w-xl">
            {firstMove.body}
          </p>
          <ol className="mt-4 space-y-1.5 text-[13px] text-neutral-300">
            <li className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center justify-center">1</span>
              Run a workflow
            </li>
            <li className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center justify-center">2</span>
              Review the output in Workbench
            </li>
            <li className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center justify-center">3</span>
              Approve or edit the next actions
            </li>
          </ol>
        </div>

        <div className="flex flex-col items-stretch lg:items-end gap-2 lg:min-w-[220px]">
          <button
            type="button"
            onClick={() => navigate('/workflows', { state: { firstRun: true, workflowId: firstMove.workflowId } })}
            className="h-10 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-[13.5px] font-semibold flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(16,185,129,0.3)]"
          >
            Run recommended workflow <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/workflows')}
            className="h-9 px-4 rounded-lg border border-white/[0.08] hover:border-emerald-500/30 hover:bg-white/[0.03] text-[13px] text-neutral-200 flex items-center justify-center gap-2"
          >
            <Compass className="h-3.5 w-3.5" /> Open Workflows
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => restartProductTour()}
              className="flex-1 h-9 px-3 rounded-lg border border-white/[0.06] hover:border-emerald-500/30 hover:bg-white/[0.03] text-[12.5px] text-neutral-300 flex items-center justify-center gap-1.5"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Restart tour
            </button>
            <button
              type="button"
              onClick={() => dismissFirstRunHelper()}
              className="h-9 px-3 rounded-lg text-[12.5px] text-neutral-400 hover:text-foreground hover:bg-white/[0.04]"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

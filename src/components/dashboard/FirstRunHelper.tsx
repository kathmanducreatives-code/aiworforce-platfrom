import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, MessageSquare, X, Loader2, Sparkles } from 'lucide-react';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useProductTour } from '@/hooks/useProductTour';
import { recommendFirstMove } from '@/lib/workflows/recommend';
import { restartProductTour } from '@/components/tour/ProductTour';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WORKFLOWS } from '@/lib/workflows/registry';
import { recordRun, summarizeInputs } from '@/lib/workflows/recentRuns';
import { pilotChat } from '@/lib/pilotChat';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { toast } from 'sonner';

function getDefaultWorkflowValues(workflowId: string, profile: any) {
  const company = profile?.company || {};
  const icp = profile?.icp || {};
  const competitors = profile?.competitors || {};

  switch (workflowId) {
    case 'find_hiring_signal_accounts':
      return {
        role: 'GTM',
        industry: company.industry || 'B2B SaaS',
        location: company.location || 'USA',
        stage: company.stage || 'early-stage 1–50',
        count: 5,
        strictness: 'flexible',
      };
    case 'find_icp_accounts':
      return {
        category: company.category || 'B2B SaaS',
        persona: icp.buyer_roles?.[0] || 'Founder, CEO',
        industry: company.industry || 'B2B',
        location: company.location || 'USA',
        count: 5,
      };
    case 'draft_outreach':
      return {
        source: 'workbench',
        channel: 'email',
        tone: 'founder-led',
        goal: 'start conversation',
      };
    case 'linkedin_post_from_signals':
      return {
        topic: '',
        style: 'tactical insight',
        length: 'short',
      };
    case 'website_audit':
      return {
        url: company.website_url || 'https://example.com',
        type: 'conversion',
        depth: 'quick',
      };
    case 'research_company':
      return {
        domain: company.website_url || 'example.com',
        focus: 'positioning',
      };
    case 'competitor_snapshot':
      return {
        domain: competitors.known?.[0] || 'competitor.com',
      };
    case 'daily_workforce_briefing':
      return {
        range: 'today',
      };
    default:
      return {};
  }
}

/**
 * First-run helper card shown on the Dashboard after onboarding.
 * Dismissible. Persists dismissal to company_brain.onboarding_meta.
 */
export default function FirstRunHelper() {
  const navigate = useNavigate();
  const { data } = useCompanyBrain();
  const { workspaceId } = useWorkspace();
  const { state, dismissFirstRunHelper, loading } = useProductTour();
  const [running, setRunning] = useState(false);

  const firstMove = useMemo(() => recommendFirstMove(data?.profile), [data?.profile]);

  const values = useMemo(() => {
    if (!firstMove?.workflowId) return {};
    return getDefaultWorkflowValues(firstMove.workflowId, data?.profile);
  }, [firstMove, data?.profile]);

  const inputsSummary = useMemo(() => {
    return summarizeInputs(values) || '—';
  }, [values]);

  const handleRunFirstWorkflow = async () => {
    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }
    const wf = WORKFLOWS.find((w) => w.id === firstMove.workflowId);
    if (!wf) {
      toast.error('Recommended workflow not found');
      return;
    }
    setRunning(true);
    const prompt = wf.buildPrompt(values);
    const metadata = wf.buildMetadata?.(values) ?? { workflow_id: wf.id, workflow_inputs: values };
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    recordRun({
      id: runId,
      workflowId: wf.id,
      workflowTitle: wf.title,
      category: wf.category,
      agents: wf.agents,
      inputSummary: inputsSummary,
      status: 'running',
      createdAt: Date.now(),
    });

    try {
      await pilotChat({
        message: prompt,
        workspace_id: workspaceId,
        action_source: 'first_run_helper',
        metadata: { ...metadata, workflow_run_id: runId, workflow_title: wf.title, agents_used: wf.agents, confirmed: true },
      });
      toast.success(`${wf.title} dispatched`, { description: `${AGENT_BY_ID[wf.primaryAgent]?.name || 'Pilot'} is on it.` });
      dismissFirstRunHelper();
    } catch (e) {
      toast.error('Could not start workflow', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  const askPilot = () => {
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text: `Pilot, help me get started with my ${firstMove.workflowName} workflow.` } }));
  };

  if (loading) return null;
  if (!data?.onboarding_completed) return null;
  if (state.first_run_helper_dismissed) return null;

  return (
    <div className="relative mb-6 rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] via-neutral-950/40 to-transparent backdrop-blur-md overflow-hidden shadow-lg shadow-emerald-950/20">
      <div className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-emerald-500/15 blur-[100px]" />

      <button
        type="button"
        onClick={() => dismissFirstRunHelper()}
        aria-label="Dismiss"
        className="absolute top-3 right-3 z-10 h-7 w-7 rounded-md text-neutral-400 hover:text-foreground hover:bg-white/[0.05] flex items-center justify-center transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 p-6 lg:p-7">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.22em] text-emerald-400">
            <Sparkles className="h-3 w-3 text-emerald-300" /> Start here
          </div>
          <h3 className="mt-2 text-[22px] font-bold text-white tracking-tight">
            Start with your first AI workflow.
          </h3>
          <p className="mt-1.5 text-[14px] text-neutral-300 leading-relaxed max-w-2xl">
            Based on your Company Brain, Pilot recommends this first workflow to create useful activity and populate your Workbench.
          </p>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl bg-neutral-900/50 rounded-xl p-4 border border-white/[0.04]">
            <div className="space-y-2 text-[13px]">
              <div>
                <span className="text-neutral-400 font-medium">Recommended workflow:</span>{' '}
                <span className="text-emerald-300 font-semibold">{firstMove.workflowName}</span>
              </div>
              <div>
                <span className="text-neutral-400 font-medium">Why:</span>{' '}
                <span className="text-neutral-200">{firstMove.why}</span>
              </div>
              <div>
                <span className="text-neutral-400 font-medium">Inputs:</span>{' '}
                <span className="text-neutral-200 font-mono text-[12px]">{inputsSummary}</span>
              </div>
            </div>
            <div className="space-y-2 text-[13px] border-t md:border-t-0 md:border-l border-white/[0.06] pt-2 md:pt-0 md:pl-4">
              <div>
                <span className="text-neutral-400 font-medium">Agent team:</span>{' '}
                <span className="text-neutral-200 font-mono text-[12px] uppercase">
                  {firstMove.agentTeam.map((a) => AGENT_BY_ID[a]?.name || a).join(' → ')}
                </span>
              </div>
              <div>
                <span className="text-neutral-400 font-medium">What you will get:</span>{' '}
                <span className="text-neutral-200">{firstMove.outputDescription}</span>
              </div>
              <div>
                <span className="text-neutral-400 font-medium">Estimated credits:</span>{' '}
                <span className="text-emerald-300/90 font-mono font-semibold">~{firstMove.estimatedCredits || '5'} credits</span>
              </div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-neutral-500 font-medium flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
            Safety note: {firstMove.safetyNote}
          </div>
        </div>

        <div className="flex flex-col justify-center items-stretch lg:items-end gap-2.5 lg:min-w-[240px]">
          <button
            type="button"
            disabled={running}
            onClick={handleRunFirstWorkflow}
            className="h-11 px-5 rounded-lg bg-emerald-400 hover:bg-emerald-300 disabled:bg-emerald-500/50 text-neutral-950 text-[14px] font-bold flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(16,185,129,0.25)] transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Dispatching...
              </>
            ) : (
              <>
                Run first workflow <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
          
          <button
            type="button"
            onClick={() => navigate('/workflows')}
            className="h-9 px-4 rounded-lg border border-white/[0.08] hover:border-emerald-500/30 hover:bg-white/[0.03] text-[13px] text-neutral-200 flex items-center justify-center gap-2 transition-colors"
          >
            <Compass className="h-3.5 w-3.5" /> Open Workflows
          </button>
          
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={askPilot}
              className="h-9 px-3 rounded-lg border border-white/[0.06] hover:border-emerald-500/30 hover:bg-white/[0.03] text-[12.5px] text-neutral-300 flex items-center justify-center gap-1.5 transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Ask Pilot
            </button>
            <button
              type="button"
              onClick={() => dismissFirstRunHelper()}
              className="h-9 px-3 rounded-lg text-[12.5px] text-neutral-400 hover:text-foreground hover:bg-white/[0.04] transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Discover with Apify, LeadOcean or both — on the mission card (lead-pipeline's
// strategy_plan / strategy_run). Renders nothing unless VITE_STRATEGY_DISCOVERY === 'true'.
//
// 1. Pick a strategy (or Auto). 2. Agentory shows the plan the server computed for this
//    request: the strategy, its steps and the worst-case spend. 3. Running it needs an
//    explicit approval of that worst case; the server re-checks the plan hash and the signed
//    token, so a changed plan never runs on an old approval. 4. The result shows each
//    provider's contribution, the overlap, every company with its verdict, signals, source
//    links and conflicts — all from the response (src/lib/strategyDiscovery.ts).

import { useState } from 'react';
import { AlertTriangle, ExternalLink, Layers, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { invokeFunction } from '@/lib/agentoryApi';
import { useOptionalChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { PROVIDER_LABEL, usd } from '@/lib/providerRunSummary';
import {
  BUSINESS_MODEL_LABEL, OUTCOME_LABEL, STRATEGY_CHOICES, VERDICT_LABEL, comparisonRow, overlapView, planStrategy, routeLine, runStrategy, spendLine,
  strategyDiscoveryUiEnabled, strategyLabel, worstCaseLine,
  type CompanyRow, type ComparisonRow, type Invoke, type OutcomeView, type StrategyChoice, type StrategyPlanView, type StrategyRunView,
} from '@/lib/strategyDiscovery';
import { simulatedInvoke, strategyDiscoveryMockMode, type Simulation } from '@/lib/strategyDiscoveryMock';
import simulation from '@/lib/__fixtures__/strategyDiscoverySimulation.json';
import { localSimulation } from './devSimulation';
import { ProviderRunSummaryCard } from './ProviderRunSummaryCard';

// Development-only simulation (strategyDiscoveryMock.ts): never active in a production build.
const MOCK = strategyDiscoveryMockMode();
// A scenario from `npm run dev:atlas -- <scenario> --preview` replaces the committed simulation.
const invoke: Invoke = MOCK === 'off' ? invokeFunction as unknown as Invoke : simulatedInvoke(MOCK, (localSimulation ?? simulation) as unknown as Simulation);
const nameOf = (p: string) => PROVIDER_LABEL[p] ?? p;
const VERDICT_TONE = { qualified: 'text-emerald-300/90', pending: 'text-amber-200/80', rejected: 'text-[#8B8F96]' } as const;

export function StrategyDiscoveryPanel({ messageId, query, requestedCount, conversationId }: { messageId: string; query: string; requestedCount?: number | null; conversationId?: string | null }) {
  if ((!strategyDiscoveryUiEnabled() && MOCK === 'off') || !query.trim()) return null;
  return <Panel messageId={messageId} query={query} requestedCount={requestedCount ?? null} conversationId={conversationId ?? null} />;
}

function Panel({ messageId, query, requestedCount, conversationId }: { messageId: string; query: string; requestedCount: number | null; conversationId: string | null }) {
  const openWorkbench = useOptionalChatWorkspace()?.openWorkbench ?? null;
  const { workspaceId: realWorkspace } = useWorkspace();
  // The development simulation needs no workspace: nothing reaches a server.
  const workspaceId = realWorkspace ?? (MOCK !== 'off' ? 'simulated-workspace' : null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<StrategyChoice>('auto');
  const [plan, setPlan] = useState<StrategyPlanView | null>(null);
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState<'idle' | 'planning' | 'running'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<StrategyRunView | null>(null);
  // Runs made from this card in this session, for a side-by-side comparison.
  const [history, setHistory] = useState<ComparisonRow[]>([]);
  // The user's explicit decision to run with REQUIRED requirements no tool can check (hash-bound on the server).
  const [reviewOnly, setReviewOnly] = useState(false);
  // The user's permission to count LIKELY B2B matches (labelled, never verified; hash-bound on the server).
  const [acceptLikely, setAcceptLikely] = useState(false);

  const request = (c: StrategyChoice, ro = reviewOnly, al = acceptLikely) => ({ workspaceId: workspaceId ?? '', messageId, query, choice: c, requestedCount, reviewOnly: ro, acceptLikely: al });

  const makePlan = async (c: StrategyChoice, ro = false, al = acceptLikely) => {
    if (!workspaceId) return;
    setChoice(c); setReviewOnly(ro); setAcceptLikely(al); setState('planning'); setError(null); setApproved(false); setRun(null); setPlan(null);
    const r = await planStrategy(invoke, request(c, ro, al));
    setState('idle');
    if (r.ok) setPlan(r.value); else setError(r.error);
  };

  const start = async () => {
    if (!workspaceId || !plan) return;
    setState('running'); setError(null);
    const r = await runStrategy(invoke, request(choice), plan);
    setState('idle');
    if (!r.ok) { setError(r.error); return; }
    setRun(r.value);
    const row = comparisonRow(r.value);
    if (row) setHistory((h) => [...h.filter((x) => x.strategy !== row.strategy), row]);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); void makePlan('auto'); }} className="mt-3 w-full flex items-center gap-1.5 text-[12px] text-[#8B8F96] hover:text-[#ECE9E4] transition-colors">
        <Layers className="h-3.5 w-3.5" aria-hidden /> Discover with Apify / LeadOcean
      </button>
    );
  }

  const canRun = plan?.status === 'ready' && approved && state === 'idle' && !run;
  const overlap = overlapView(run?.summary ?? null);

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]" data-testid="strategy-discovery">
      {MOCK !== 'off' && (
        <div className="mb-2 rounded-md border border-amber-300/30 bg-amber-300/[0.06] px-2.5 py-1.5 text-[11px] text-amber-200/90" data-testid="strategy-simulated">
          Simulated data — development only. No provider was called and these are not real companies.
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Discovery strategy">
        {STRATEGY_CHOICES.map((o) => (
          <button
            key={o.id} type="button" title={o.blurb} onClick={() => void makePlan(o.id)} aria-pressed={choice === o.id} disabled={state !== 'idle'}
            className={`h-7 px-2.5 rounded-md text-[11.5px] border transition-colors ${choice === o.id ? 'border-white/20 bg-white/[0.07] text-[#ECE9E4]' : 'border-white/[0.06] text-[#8B8F96] hover:text-[#ECE9E4]'}`}
          >{o.label}</button>
        ))}
      </div>

      {state === 'planning' && <p className="mt-2 text-[12px] text-[#8B8F96] flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Planning…</p>}
      {state === 'running' && <p className="mt-2 text-[12px] text-[#8B8F96] flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running — this can take a few minutes…</p>}
      {error && <p className="mt-2 text-[12px] text-red-300/90" data-testid="strategy-discovery-error">{error}</p>}

      {plan && state === 'idle' && !run && (
        <div className="mt-2.5 space-y-2 text-[12px]" data-testid="strategy-plan">
          <div className="text-[#ECE9E4]">
            <span className="font-medium">{strategyLabel(plan.strategy)}</span>
            {plan.selectedBy && <span className="text-[#6E7278]"> · chosen by {plan.selectedBy === 'model' ? 'Agentory' : plan.selectedBy}</span>}
          </div>
          {plan.steps.length > 0 && (
            <ul className="space-y-0.5 text-[#A3A7AD]">
              {plan.steps.map((s) => (
                <li key={`${s.capability}-${s.role}`} className="flex items-center gap-1.5">
                  <span className="text-[#ECE9E4]">{nameOf(s.provider)}</span>
                  <span className="truncate" title={s.why ?? undefined}>{s.capability.split('.').slice(1).join('.').replace(/_/g, ' ')}</span>
                  {s.maxItems !== null && <span className="ml-auto shrink-0 text-[11px] text-[#6E7278]">≤{s.maxItems}</span>}
                </li>
              ))}
            </ul>
          )}
          <RequirementList plan={plan} />
          {plan.status === 'blocked' && plan.questions.length > 0 && (
            <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] px-3 py-2 space-y-1.5" data-testid="strategy-questions">
              <div className="text-[#ECE9E4] font-medium">This request can't run normally yet</div>
              {plan.questions.map((q) => <p key={q} className="text-[#A3A7AD]">{q}</p>)}
              <Button size="sm" variant="outline" onClick={() => void makePlan(choice, true)} className="h-7 px-3 rounded-lg text-[12px]" data-testid="strategy-review-only">
                Run as review-only
              </Button>
              <p className="text-[11px] text-[#6E7278]">Review-only companies are never counted as qualified. To change the requirement instead, edit your request.</p>
            </div>
          )}
          {plan.status === 'blocked' && plan.questions.length === 0 && (
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[#A3A7AD]">{plan.blockedReason ?? 'This strategy cannot run for this request.'}</div>
          )}
          {plan.status === 'ready' && plan.steps.some((s) => s.capability === 'apify.website_business_model') && (
            <label className="flex items-center gap-1.5 text-[11px] text-[#A3A7AD] cursor-pointer" data-testid="strategy-accept-likely">
              <Checkbox checked={acceptLikely} onCheckedChange={(v) => void makePlan(choice, reviewOnly, v === true)} aria-label="Count likely B2B matches" />
              Count likely B2B matches toward the request (labelled “Likely B2B”, never verified)
            </label>
          )}
          {plan.status === 'ready' && reviewOnly && (
            <div className="text-[11px] text-amber-200/80" data-testid="strategy-review-only-note">Review-only: requirements no tool can check stay unverified; those companies are listed as needing verification.</div>
          )}
          {plan.status === 'ready' && (
            <div className="flex items-center gap-2 pt-1">
              {plan.worstCase.apifyUsd > 0 || plan.worstCase.leadoceanRecords > 0 ? (
                <label className="flex items-center gap-1.5 text-[#A3A7AD] cursor-pointer">
                  <Checkbox checked={approved} onCheckedChange={(v) => setApproved(v === true)} aria-label="Approve the worst-case spend" />
                  Approve {worstCaseLine(plan.worstCase)}
                </label>
              ) : (
                <label className="flex items-center gap-1.5 text-[#8B8F96] cursor-pointer">
                  <Checkbox checked={approved} onCheckedChange={(v) => setApproved(v === true)} aria-label="Approve this plan" />
                  <ShieldCheck className="h-3.5 w-3.5" /> No provider spend — approve to run
                </label>
              )}
              <Button size="sm" onClick={start} disabled={!canRun} className="ml-auto h-7 px-3 rounded-lg text-[12px]">Run</Button>
            </div>
          )}
        </div>
      )}

      {run && (
        <div className="mt-2.5 text-[12px] text-[#A3A7AD]" data-testid="strategy-run-result">
          <div className="flex items-center gap-1.5 text-[#ECE9E4]">
            <span className="font-medium">{strategyLabel(run.strategy)}</span>
            <span className="text-[#6E7278]">· {run.status}{run.written !== null ? ` · ${run.written} written to Leads` : ''}</span>
            {run.workbenchPlanId && openWorkbench && MOCK === 'off' && (
              <button type="button" data-testid="strategy-open-workbench"
                className="ml-auto rounded border border-white/10 px-2 py-0.5 text-[11px] text-[#C9CCD1] hover:bg-white/[0.06]"
                onClick={() => openWorkbench({ planId: run.workbenchPlanId!, conversationId })}>
                Open in Workbench
              </button>
            )}
          </div>
          {run.outcome && <OutcomeBanner outcome={run.outcome} />}
          {run.reason && <div className="mt-1 text-[11px] text-amber-300/90">{run.reason}</div>}
          {run.summary ? <ProviderRunSummaryCard response={run.response} /> : (
            <div className="mt-1 text-[11px] text-[#8B8F96]" data-testid="strategy-run-no-summary">This run returned no provider summary; no totals are shown.</div>
          )}
          {overlap && overlap.perProvider.length > 1 && (
            <div className="mt-1.5 text-[11px] text-[#8B8F96]" data-testid="strategy-run-overlap">
              {overlap.perProvider.map((p) => `${nameOf(p.provider)} ${p.discovered} (${p.onlyHere} only there)`).join(' · ')} · {overlap.combinedUnique} unique combined · {overlap.overlap} found by both
            </div>
          )}
          {(['qualified', 'pending'] as const).map((group) => {
            const rows = run.companies.filter((c) => c.verdict === group);
            if (!rows.length) return null;
            return (
              <section key={group} className="mt-2" aria-label={group === 'qualified' ? 'Qualified companies' : 'Companies needing verification'} data-testid={`strategy-group-${group}`}>
                <h4 className="text-[11px] uppercase tracking-wide text-[#6E7278]">{group === 'qualified' ? `Qualified (${rows.length})` : `Needs verification (${rows.length})`}</h4>
                <ul className="mt-1 space-y-1.5">{rows.map((c) => <CompanyCard key={c.key} c={c} />)}</ul>
              </section>
            );
          })}
          {(run.excludedCount > 0 || run.companies.some((c) => c.verdict === 'rejected')) && (
            <div className="mt-2 text-[11px] text-[#8B8F96]" data-testid="strategy-group-rejected">
              Rejected: {run.excludedCount + run.companies.filter((c) => c.verdict === 'rejected').length} {run.excludedCount === 1 ? 'company was' : 'companies were'} ruled out by your requirements (not written to Leads).
              {run.rejected.length > 0 && (
                <ul className="mt-1 space-y-0.5" data-testid="strategy-rejected-list">
                  {run.rejected.map((r) => (
                    <li key={`${r.name}:${r.domain ?? ''}`}><span className="text-[#ECE9E4]/80">{r.name}</span>{r.domain ? ` (${r.domain})` : ''}{r.reasons.length ? ` — ${r.reasons.join('; ')}` : ''}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {run.companies.length === 0 && run.excludedCount === 0 && <div className="mt-1 text-[11px] text-[#8B8F96]">No companies were returned.</div>}
        </div>
      )}

      {history.length > 1 && (
        <table className="mt-3 w-full text-left text-[11px] text-[#A3A7AD]" data-testid="strategy-comparison">
          <caption className="text-left text-[#6E7278] pb-1">Runs from this card</caption>
          <thead className="text-[#6E7278]"><tr><th className="font-normal">Strategy</th><th className="font-normal text-right">Companies</th><th className="font-normal text-right">Qualified</th><th className="font-normal text-right">Pending</th><th className="font-normal text-right">Rejected</th><th className="font-normal text-right">Spend</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.strategy} className="tabular-nums">
                <th scope="row" className="font-normal text-[#ECE9E4]">{strategyLabel(h.strategy)}{h.failed ? ' ⚠' : ''}</th>
                <td className="text-right">{h.companies}</td><td className="text-right">{h.qualified}</td><td className="text-right">{h.pending}</td><td className="text-right">{h.rejected}</td>
                <td className="text-right">{[h.spend.apifyUsd > 0 ? usd(h.spend.apifyUsd) : null, h.spend.leadoceanRecords > 0 ? `${h.spend.leadoceanRecords} rec` : null].filter(Boolean).join(' + ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const ROUTE_TONE = { checked: 'text-[#A3A7AD]', ranked_only: 'text-[#6E7278]', not_checkable: 'text-amber-200/80' } as const;

/** What Agentory will check, requirement by requirement, before anything is bought. */
function RequirementList({ plan }: { plan: StrategyPlanView }) {
  if (!plan.requirements.length && !plan.interpretation.assumptions.length) return null;
  return (
    <div className="rounded-lg border border-white/[0.06] px-3 py-2" data-testid="strategy-requirements">
      <div className="text-[11px] uppercase tracking-wide text-[#6E7278] mb-1">What Agentory will check</div>
      <ul className="space-y-0.5">
        {plan.requirements.map((r) => (
          <li key={r.label} className="flex items-start gap-1.5" data-testid="strategy-requirement">
            <span className={`shrink-0 text-[10px] px-1 rounded border ${r.necessity === 'required' ? 'border-white/20 text-[#ECE9E4]' : 'border-white/[0.08] text-[#8B8F96]'}`}>{r.necessity === 'required' ? 'Required' : 'Preferred'}</span>
            <span className="text-[#ECE9E4]">{r.label}</span>
            <span className={`ml-auto text-right text-[11px] ${ROUTE_TONE[r.route]}`} title={r.explanation}>{routeLine(r)}</span>
          </li>
        ))}
      </ul>
      {plan.interpretation.assumptions.map((a) => <div key={a} className="mt-1 text-[11px] text-[#8B8F96]">Assumption: {a}</div>)}
      {plan.interpretation.disclosures.map((d) => <div key={d} className="mt-1 text-[11px] text-amber-200/80">Not checked: {d}</div>)}
      {plan.interpretation.merged.map((m) => <div key={m.span} className="mt-1 text-[11px] text-[#6E7278]">“{m.span}” is already covered: {m.reason}</div>)}
    </div>
  );
}

const OUTCOME_TONE: Record<OutcomeView['status'], string> = {
  completed: 'border-emerald-300/25 bg-emerald-300/[0.05] text-emerald-200/90',
  completed_with_shortfall: 'border-amber-300/25 bg-amber-300/[0.05] text-amber-200/90',
  needs_verification: 'border-amber-300/25 bg-amber-300/[0.05] text-amber-200/90',
  no_results: 'border-white/10 bg-white/[0.02] text-[#A3A7AD]',
  blocked: 'border-white/10 bg-white/[0.02] text-[#A3A7AD]',
  failed: 'border-red-300/25 bg-red-300/[0.05] text-red-200/90',
  cancelled: 'border-white/10 bg-white/[0.02] text-[#A3A7AD]',
};

/** The mission's outcome: only qualified companies count toward the number requested. */
function OutcomeBanner({ outcome }: { outcome: OutcomeView }) {
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 ${OUTCOME_TONE[outcome.status]}`} data-testid="strategy-outcome" data-status={outcome.status}>
      <div className="font-medium">{OUTCOME_LABEL[outcome.status]}</div>
      <div className="text-[12px]">{outcome.summary}</div>
      {outcome.nextStep && <div className="text-[11px] opacity-80 mt-0.5">Next: {outcome.nextStep}</div>}
      <div className="text-[11px] opacity-80 mt-0.5" data-testid="strategy-spend">Spend: {spendLine(outcome.spend)}</div>
    </div>
  );
}

const BM_TONE = { verified_b2b: 'text-emerald-300/90', likely_b2b: 'text-amber-200/80', mixed: 'text-amber-200/80', unknown: 'text-[#8B8F96]', not_b2b: 'text-[#8B8F96]' } as const;

function CompanyCard({ c }: { c: CompanyRow }) {
  return (
    <li className="rounded-md border border-white/[0.05] px-2.5 py-1.5" data-testid="strategy-company">
      <div className="flex items-center gap-1.5">
        <span className="text-[#ECE9E4] font-medium truncate">{c.name}</span>
        {c.domain && <span className="text-[11px] text-[#6E7278] truncate">{c.domain}</span>}
        <span className={`ml-auto shrink-0 text-[11px] ${VERDICT_TONE[c.verdict]}`}>{VERDICT_LABEL[c.verdict]}</span>
      </div>
      <div className="text-[11px] text-[#6E7278]">
        {c.location ?? 'Location unknown'} · {c.industry.length ? c.industry.join(', ') : 'Industry unknown'} · Found by {c.providers.map(nameOf).join(' + ') || 'unknown'}
        {c.mergedRecords ? ` · ${c.mergedRecords + 1} records merged` : ''}
        {c.gaps.length ? ` · missing: ${c.gaps.join(', ').replace(/_/g, ' ')}` : ''}{c.disproven.length ? ` · disproven: ${c.disproven.join(', ').replace(/_/g, ' ')}` : ''}
      </div>
      {c.businessModel && (
        <div className="mt-0.5 text-[11px]" data-testid="strategy-business-model">
          <span className={BM_TONE[c.businessModel.status]}>{BUSINESS_MODEL_LABEL[c.businessModel.status]}</span>
          {c.countedAsLikely && <span className="ml-1 text-amber-200/80" data-testid="strategy-counted-likely">· counted as a likely match</span>}
          {c.businessModel.quote ? <span className="text-[#A3A7AD]"> — “{c.businessModel.quote}”</span> : <span className="text-[#6E7278]"> — {c.businessModel.reason}</span>}
          {c.businessModel.url && <a href={c.businessModel.url} target="_blank" rel="noreferrer noopener" className="ml-1 inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">source <ExternalLink className="h-2.5 w-2.5" aria-hidden /></a>}
          {c.businessModel.fetchedAt && <span className="text-[#6E7278]"> · read {c.businessModel.fetchedAt.slice(0, 10)}</span>}
        </div>
      )}
      {c.checks.map((k) => (
        <div key={`${k.dimension}-${k.reason}`} className={`mt-0.5 text-[11px] ${k.result === 'pass' ? 'text-[#A3A7AD]' : 'text-[#6E7278]'}`} title={k.reason}>
          {k.result === 'pass' ? '✓' : k.result === 'fail' ? '✗' : '…'} {k.dimension.replace(/_/g, ' ')}: <span className="truncate">{k.reason}</span>
        </div>
      ))}
      {(c.website || c.linkedinUrl) && (
        <div className="mt-0.5 flex items-center gap-2 text-[11px]">
          {c.website && <a href={c.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">website <ExternalLink className="h-2.5 w-2.5" aria-hidden /></a>}
          {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">LinkedIn <ExternalLink className="h-2.5 w-2.5" aria-hidden /></a>}
        </div>
      )}
      {c.signals.map((sg, i) => (
        <div key={`${sg.type}-${i}`} className="mt-0.5 flex items-center gap-1 text-[11px] text-[#A3A7AD]">
          <span>{sg.type.replace(/_/g, ' ')}{sg.eventDate ? ` · ${sg.eventDate.slice(0, 10)}` : ' · undated'} · {nameOf(sg.provider)}</span>
          {sg.sourceUrl && <a href={sg.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">source <ExternalLink className="h-2.5 w-2.5" aria-hidden /></a>}
        </div>
      ))}
      {c.conflicts.map((x) => (
        <div key={x.field} className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-200/80">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {x.field.replace(/_/g, ' ')}: {x.values.map((v) => `${nameOf(v.provider)} says ${v.value}`).join(' · ')}
        </div>
      ))}
    </li>
  );
}

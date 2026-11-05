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
import { PROVIDER_LABEL, usd } from '@/lib/providerRunSummary';
import {
  STRATEGY_CHOICES, VERDICT_LABEL, comparisonRow, overlapView, planStrategy, runStrategy, strategyDiscoveryUiEnabled, strategyLabel, worstCaseLine,
  type ComparisonRow, type Invoke, type StrategyChoice, type StrategyPlanView, type StrategyRunView,
} from '@/lib/strategyDiscovery';
import { ProviderRunSummaryCard } from './ProviderRunSummaryCard';

const invoke = invokeFunction as unknown as Invoke;
const nameOf = (p: string) => PROVIDER_LABEL[p] ?? p;
const VERDICT_TONE = { qualified: 'text-emerald-300/90', pending: 'text-amber-200/80', rejected: 'text-[#8B8F96]' } as const;

export function StrategyDiscoveryPanel({ messageId, query, requestedCount }: { messageId: string; query: string; requestedCount?: number | null }) {
  if (!strategyDiscoveryUiEnabled() || !query.trim()) return null;
  return <Panel messageId={messageId} query={query} requestedCount={requestedCount ?? null} />;
}

function Panel({ messageId, query, requestedCount }: { messageId: string; query: string; requestedCount: number | null }) {
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<StrategyChoice>('auto');
  const [plan, setPlan] = useState<StrategyPlanView | null>(null);
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState<'idle' | 'planning' | 'running'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<StrategyRunView | null>(null);
  // Runs made from this card in this session, for a side-by-side comparison.
  const [history, setHistory] = useState<ComparisonRow[]>([]);

  const request = (c: StrategyChoice) => ({ workspaceId: workspaceId ?? '', messageId, query, choice: c, requestedCount });

  const makePlan = async (c: StrategyChoice) => {
    if (!workspaceId) return;
    setChoice(c); setState('planning'); setError(null); setApproved(false); setRun(null); setPlan(null);
    const r = await planStrategy(invoke, request(c));
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
          {plan.status === 'blocked' && (
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[#A3A7AD]">{plan.blockedReason ?? 'This strategy cannot run for this request.'}</div>
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
          </div>
          {run.reason && <div className="mt-1 text-[11px] text-amber-300/90">{run.reason}</div>}
          {run.summary ? <ProviderRunSummaryCard response={run.response} /> : (
            <div className="mt-1 text-[11px] text-[#8B8F96]" data-testid="strategy-run-no-summary">This run returned no provider summary; no totals are shown.</div>
          )}
          {overlap && overlap.perProvider.length > 1 && (
            <div className="mt-1.5 text-[11px] text-[#8B8F96]" data-testid="strategy-run-overlap">
              {overlap.perProvider.map((p) => `${nameOf(p.provider)} ${p.discovered} (${p.onlyHere} only there)`).join(' · ')} · {overlap.combinedUnique} unique combined · {overlap.overlap} found by both
            </div>
          )}
          <ul className="mt-2 space-y-1.5" aria-label="Companies">
            {run.companies.map((c) => (
              <li key={c.key} className="rounded-md border border-white/[0.05] px-2.5 py-1.5" data-testid="strategy-company">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#ECE9E4] font-medium truncate">{c.name}</span>
                  {c.domain && <span className="text-[11px] text-[#6E7278] truncate">{c.domain}</span>}
                  <span className={`ml-auto shrink-0 text-[11px] ${VERDICT_TONE[c.verdict]}`}>{VERDICT_LABEL[c.verdict]}</span>
                </div>
                <div className="text-[11px] text-[#6E7278]">Found by {c.providers.map(nameOf).join(' + ') || 'unknown'}{c.gaps.length ? ` · missing: ${c.gaps.join(', ').replace(/_/g, ' ')}` : ''}{c.disproven.length ? ` · disproven: ${c.disproven.join(', ')}` : ''}</div>
                {c.checks.map((k) => (
                  <div key={`${k.dimension}-${k.reason}`} className={`mt-0.5 text-[11px] ${k.result === 'pass' ? 'text-[#A3A7AD]' : 'text-[#6E7278]'}`} title={k.reason}>
                    {k.result === 'pass' ? '✓' : k.result === 'fail' ? '✗' : '…'} {k.dimension.replace(/_/g, ' ')}: <span className="truncate">{k.reason}</span>
                  </div>
                ))}
                {(c.website || c.linkedinUrl) && (
                  <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                    {c.website && <a href={c.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">website <ExternalLink className="h-2.5 w-2.5" /></a>}
                    {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">LinkedIn <ExternalLink className="h-2.5 w-2.5" /></a>}
                  </div>
                )}
                {c.signals.map((s, i) => (
                  <div key={`${s.type}-${i}`} className="mt-0.5 flex items-center gap-1 text-[11px] text-[#A3A7AD]">
                    <span>{s.type.replace(/_/g, ' ')}{s.eventDate ? ` · ${s.eventDate.slice(0, 10)}` : ' · undated'} · {nameOf(s.provider)}</span>
                    {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline decoration-white/20 hover:text-[#ECE9E4]">source <ExternalLink className="h-2.5 w-2.5" /></a>}
                  </div>
                ))}
                {c.conflicts.map((x) => (
                  <div key={x.field} className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-200/80">
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {x.field.replace(/_/g, ' ')}: {x.values.map((v) => `${nameOf(v.provider)} says ${v.value}`).join(' · ')}
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {run.companies.length === 0 && <div className="mt-1 text-[11px] text-[#8B8F96]">No companies were returned.</div>}
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

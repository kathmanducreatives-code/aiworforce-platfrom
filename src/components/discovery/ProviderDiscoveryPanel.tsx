// Search with your connected data providers — on the mission card (provider
// discovery; renders nothing unless VITE_PROVIDER_DISCOVERY === 'true').
//
// 1. Pick Auto or specific providers. 2. Agentory shows the plan the server
//    computed from THIS compiled mission: what each provider filters, what
//    Agentory checks itself, what cannot be satisfied, and the credit ceiling.
// 3. A paid plan needs an explicit approval; approving sends the plan's hash,
//    so a changed plan cannot run on an old approval. Results land in Leads.

import { useEffect, useState } from 'react';
import { Check, CircleSlash, Database, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { invokeFunction } from '@/lib/agentoryApi';
import {
  HANDLING_LABEL, PROVIDERS, creditsLine, planDiscovery, providerDiscoveryUiEnabled, runApprovedDiscovery,
  type Invoke, type PlanView, type ProviderId, type RunView, type Selection,
} from '@/lib/providerDiscovery';

const invoke = invokeFunction as unknown as Invoke;
const OPTIONS: { id: 'auto' | ProviderId; label: string }[] = [{ id: 'auto', label: 'Auto' }, ...PROVIDERS.map((p) => ({ id: p.id, label: p.label }))];
const nameOf = (p: string) => PROVIDERS.find((x) => x.id === p)?.label ?? p;

export function ProviderDiscoveryPanel({ messageId }: { messageId: string }) {
  if (!providerDiscoveryUiEnabled()) return null;
  return <Panel messageId={messageId} />;
}

function Panel({ messageId }: { messageId: string }) {
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<'auto' | ProviderId[]>('auto');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState<'idle' | 'planning' | 'running'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<{ run: RunView; written: number } | null>(null);
  const selection: Selection = choice;

  useEffect(() => {
    if (!open || !workspaceId) return;
    let live = true;
    setState('planning'); setError(null); setApproved(false); setRun(null);
    planDiscovery(invoke, workspaceId, messageId, selection).then((r) => {
      if (!live) return;
      setState('idle');
      if (r.ok) setPlan(r.value); else { setPlan(null); setError(r.error); }
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, messageId, JSON.stringify(selection)]);

  const toggle = (id: 'auto' | ProviderId) => {
    if (id === 'auto') return setChoice('auto');
    setChoice((c) => {
      const cur = c === 'auto' ? [] : c;
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return next.length ? next : 'auto';
    });
  };

  const start = async () => {
    if (!workspaceId || !plan) return;
    setState('running'); setError(null);
    const r = await runApprovedDiscovery(invoke, workspaceId, messageId, selection, plan);
    setState('idle');
    if (r.ok) setRun(r.value); else setError(r.error);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full flex items-center gap-1.5 text-[12px] text-[#8B8F96] hover:text-[#ECE9E4] transition-colors">
        <Database className="h-3.5 w-3.5" aria-hidden /> Search with your data providers
      </button>
    );
  }

  const isOn = (id: 'auto' | ProviderId) => (id === 'auto' ? choice === 'auto' : choice !== 'auto' && choice.includes(id));
  const canRun = plan?.status === 'ready' && (!plan.requiresApproval || approved) && state === 'idle' && !run;

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]" data-testid="provider-discovery">
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Data providers">
        {OPTIONS.map((o) => (
          <button
            key={o.id} type="button" onClick={() => toggle(o.id)} aria-pressed={isOn(o.id)}
            className={`h-7 px-2.5 rounded-md text-[11.5px] border transition-colors ${isOn(o.id) ? 'border-white/20 bg-white/[0.07] text-[#ECE9E4]' : 'border-white/[0.06] text-[#8B8F96] hover:text-[#ECE9E4]'}`}
          >{o.label}</button>
        ))}
      </div>

      {state === 'planning' && <p className="mt-2 text-[12px] text-[#8B8F96] flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Planning…</p>}
      {error && <p className="mt-2 text-[12px] text-red-300/90">{error}</p>}

      {plan && state !== 'planning' && (
        <div className="mt-2.5 space-y-2.5 text-[12px]">
          {plan.steps.map((s) => (
            <div key={`${s.provider}-${s.role}`}>
              <div className="flex items-center gap-1.5 text-[#ECE9E4]">
                <span className="font-medium">{nameOf(s.provider)}</span>
                <span className="text-[#6E7278]">{s.role === 'fallback' ? 'fallback · only if the first fails' : s.kind.replace('_', ' ')}</span>
                <span className="ml-auto text-[#8B8F96]">≤{s.maxRecords} rows{s.allowanceLimited ? ' · limited by allowance' : ''}</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {s.requirements.map((r) => (
                  <li key={r.criterionId} className="flex items-center gap-1.5 text-[#A3A7AD]">
                    <Check className="h-3 w-3 text-emerald-400/80 shrink-0" aria-hidden />
                    <span className="truncate">{r.label}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-[#6E7278]">{HANDLING_LABEL[r.handling]}{r.via ? ` · ${nameOf(r.via)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {plan.status === 'blocked' && (
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[#A3A7AD]">
              <div className="flex items-center gap-1.5 text-[#ECE9E4]"><CircleSlash className="h-3.5 w-3.5" /> Can't search without loosening your request</div>
              {plan.unsupportedRequirements.length > 0 && (
                <div className="mt-1">Not supported by the selected providers: {plan.unsupportedRequirements.map((u) => u.label).join(', ')}</div>
              )}
              {plan.blockedReason && plan.unsupportedRequirements.length === 0 && <div className="mt-1">{plan.blockedReason}</div>}
            </div>
          )}
          {plan.refused.length > 0 && (
            <div className="text-[11px] text-[#6E7278]">{plan.refused.map((r) => `${nameOf(r.provider)}: ${r.reason}`).join(' · ')}</div>
          )}

          {plan.status === 'ready' && !run && (
            <div className="flex items-center gap-2 pt-1">
              {plan.requiresApproval ? (
                <label className="flex items-center gap-1.5 text-[#A3A7AD] cursor-pointer">
                  <Checkbox checked={approved} onCheckedChange={(v) => setApproved(v === true)} aria-label="Approve provider credits" />
                  Approve {creditsLine(plan)}
                </label>
              ) : (
                <span className="flex items-center gap-1.5 text-[#8B8F96]"><ShieldCheck className="h-3.5 w-3.5" /> {creditsLine(plan)}</span>
              )}
              <Button size="sm" onClick={start} disabled={!canRun} className="ml-auto h-7 px-3 rounded-lg text-[12px]">
                {state === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Search'}
              </Button>
            </div>
          )}
        </div>
      )}

      {run && (
        <div className="mt-2 text-[12px] text-[#A3A7AD]" data-testid="provider-discovery-result">
          <span className="text-[#ECE9E4] font-medium">{run.run.counts.qualified}</span> qualified ·{' '}
          <span className="text-[#ECE9E4] font-medium">{run.run.counts.needsVerification}</span> need verification ·{' '}
          {run.run.counts.rejected} rejected — {run.written} added to Leads
          {run.run.steps.filter((s) => s.status === 'failed').map((s) => (
            <div key={s.provider} className="text-[11px] text-amber-300/90">{nameOf(s.provider)}: {s.reason}</div>
          ))}
        </div>
      )}
    </div>
  );
}

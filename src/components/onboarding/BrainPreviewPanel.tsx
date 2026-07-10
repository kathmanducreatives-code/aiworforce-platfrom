// Live Company Brain preview — sticky right rail across every onboarding step.
// Redesigned as a compact intelligence panel with orb header, icon rows,
// evidence count, and BRAIN_POWERS activation grid.

import { AlertTriangle, Building2, Cpu, Radar, Target, Users, Shield, Sparkles } from 'lucide-react';
import { BRAIN_POWERS, type CompletenessResult } from '@/lib/companyBrainCompleteness';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import { CompletenessRing } from './CompletenessRing';

type RowState = 'set' | 'partial' | 'empty';

function IconRow({ icon, label, value, state }: { icon: React.ReactNode; label: string; value: string; state: RowState }) {
  const dot =
    state === 'set' ? 'bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]'
    : state === 'partial' ? 'bg-amber-400/80'
    : 'bg-muted-foreground/20';
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/60 text-primary/80">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">{label}</p>
        <p className="truncate text-xs text-foreground/90">{value || 'Not yet'}</p>
      </div>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
    </div>
  );
}

export function BrainPreviewPanel({
  brain,
  completeness,
  evidenceCount,
}: {
  brain: CompanyBrainV2;
  completeness: CompletenessResult;
  evidenceCount?: { sources: number; pages: number };
}) {
  const tc = brain.target_customer;
  const disqCount =
    tc.disqualifiers.industries.length + tc.disqualifiers.company_types.length +
    tc.disqualifiers.keywords.length + tc.disqualifiers.titles.length + tc.disqualifiers.domains.length;

  const state = (nonEmpty: boolean, partial = false): RowState =>
    nonEmpty ? 'set' : partial ? 'partial' : 'empty';

  const rows = [
    { icon: <Building2 className="h-3.5 w-3.5" />, label: 'Company', value: brain.company.name, state: state(!!brain.company.name) },
    { icon: <Target className="h-3.5 w-3.5" />,    label: 'Market',  value: tc.industries.slice(0, 2).join(', '), state: state(tc.industries.length > 0) },
    { icon: <Users className="h-3.5 w-3.5" />,     label: 'Buyers',  value: brain.buyer_personas.slice(0, 2).join(', '), state: state(brain.buyer_personas.length > 0) },
    { icon: <Radar className="h-3.5 w-3.5" />,     label: 'Signals', value: [...brain.triggers, ...brain.jobs_to_watch].slice(0, 2).join(', '), state: state(brain.triggers.length + brain.jobs_to_watch.length > 0) },
    { icon: <Shield className="h-3.5 w-3.5" />,    label: 'Disqualifiers', value: disqCount ? `${disqCount} rule${disqCount === 1 ? '' : 's'}` : '', state: state(disqCount > 0) },
  ];

  return (
    <aside
      aria-label="Company Brain preview"
      className="overflow-hidden rounded-2xl border border-border/50 bg-card/40 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.15)] backdrop-blur-xl"
    >
      {/* gradient hairline */}
      <div
        aria-hidden
        className="h-px w-full"
        style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.6), transparent)' }}
      />

      {/* Header + orb */}
      <div className="relative overflow-hidden border-b border-border/50 p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: 'radial-gradient(200px 120px at 50% 0%, hsl(var(--primary) / 0.15), transparent 70%)' }}
        />
        <div className="relative">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <Cpu className="h-3.5 w-3.5" />
            </div>
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your</p>
              <h2 className="text-sm font-semibold tracking-tight">Company Brain</h2>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <CompletenessRing value={completeness.percent} size={112} stroke={9} caption="Ready" />
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span
                className={[
                  'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]',
                  completeness.confidence === 'strong'
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : completeness.confidence === 'partial'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-600/50 bg-zinc-700/20 text-zinc-300',
                ].join(' ')}
              >
                {completeness.confidence} confidence
              </span>
              <span className="text-[10px] text-muted-foreground">
                {completeness.required_met}/{completeness.required_total} required
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Understands */}
      <div className="border-b border-border/50 p-4">
        <h3 className="mb-1 flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary/80" /> Agentory understands
        </h3>
        <div className="divide-y divide-border/30">
          {rows.map((r) => <IconRow key={r.label} {...r} />)}
        </div>
      </div>

      {/* Evidence */}
      {evidenceCount && (evidenceCount.sources > 0 || evidenceCount.pages > 0) && (
        <div className="border-b border-border/50 px-5 py-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="uppercase tracking-[0.14em] text-muted-foreground">Evidence</span>
            <span className="text-foreground/80">
              {evidenceCount.sources} source{evidenceCount.sources === 1 ? '' : 's'} · {evidenceCount.pages} page{evidenceCount.pages === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      )}

      {/* Needs confirmation */}
      {completeness.missing.length > 0 && (
        <div className="border-b border-border/50 bg-amber-500/[0.03] p-4">
          <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-[0.18em] text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Needs confirmation
          </h3>
          <ul className="space-y-1 px-1">
            {completeness.missing.slice(0, 5).map((m) => (
              <li key={m} className="flex items-start gap-1.5 text-xs text-amber-100/90">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Powers */}
      <div className="p-4">
        <h3 className="mb-2 px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">This powers</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {BRAIN_POWERS.map((p) => {
            const on = completeness.complete;
            return (
              <div
                key={p.key}
                className={[
                  'rounded-lg border px-2 py-1.5 text-[11px] transition-colors',
                  on ? 'border-primary/30 bg-primary/[0.06] text-foreground' : 'border-border/40 bg-background/30 text-muted-foreground',
                ].join(' ')}
              >
                <p className="font-medium">{p.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

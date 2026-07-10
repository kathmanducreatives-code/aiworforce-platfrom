// Live Company Brain preview (sticky right rail across every onboarding step).
//
// Renders three sections:
//  1. Completeness ring + confidence
//  2. What Agentory already knows (compact rows)
//  3. What still needs confirmation
//  4. What this powers (real BRAIN_POWERS names only)
//
// Reads the SAME completeness rules the server enforces — never promises an
// activation the server would refuse.

import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Check, Cpu } from 'lucide-react';
import { BRAIN_POWERS, type CompletenessResult } from '@/lib/companyBrainCompleteness';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import { CompletenessRing } from './CompletenessRing';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 uppercase tracking-[0.12em] text-muted-foreground/80">{label}</span>
      <span className="truncate text-right text-foreground/90">{value || '—'}</span>
    </div>
  );
}

function ConfidenceBadge({ level }: { level: CompletenessResult['confidence'] }) {
  const cls =
    level === 'strong'
      ? 'border-primary/40 bg-primary/10 text-primary'
      : level === 'partial'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-zinc-600/50 bg-zinc-700/20 text-zinc-300';
  return (
    <Badge variant="outline" className={`gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${cls}`}>
      {level} confidence
    </Badge>
  );
}

export function BrainPreviewPanel({
  brain,
  completeness,
}: {
  brain: CompanyBrainV2;
  completeness: CompletenessResult;
}) {
  const tc = brain.target_customer;
  const disqCount =
    tc.disqualifiers.industries.length + tc.disqualifiers.company_types.length +
    tc.disqualifiers.keywords.length + tc.disqualifiers.titles.length + tc.disqualifiers.domains.length;

  return (
    <aside
      aria-label="Company Brain preview"
      className="overflow-hidden rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md"
    >
      {/* Header + ring */}
      <div className="relative border-b border-border/50 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            <Cpu className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your</p>
            <h2 className="text-sm font-semibold tracking-tight">Company Brain</h2>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <CompletenessRing value={completeness.percent} size={132} caption="Ready" />
          <div className="flex items-center gap-2">
            <ConfidenceBadge level={completeness.confidence} />
            <span className="text-[10px] text-muted-foreground">
              {completeness.required_met}/{completeness.required_total} required
            </span>
          </div>
        </div>
      </div>

      {/* Knows */}
      <div className="border-b border-border/50 p-5">
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agentory knows</h3>
        <div className="divide-y divide-border/40">
          <Row label="Company" value={brain.company.name} />
          <Row label="Model" value={brain.company.business_model} />
          <Row label="Industries" value={tc.industries.slice(0, 3).join(', ')} />
          <Row label="Buyers" value={brain.buyer_personas.slice(0, 3).join(', ')} />
          <Row label="Triggers" value={[...brain.triggers, ...brain.jobs_to_watch].slice(0, 3).join(', ')} />
          <Row label="Disqualifiers" value={disqCount ? `${disqCount} rule${disqCount === 1 ? '' : 's'}` : ''} />
        </div>
      </div>

      {/* Needs confirmation */}
      {completeness.missing.length > 0 && (
        <div className="border-b border-border/50 bg-amber-500/[0.03] p-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            Needs your confirmation
          </h3>
          <ul className="space-y-1.5">
            {completeness.missing.slice(0, 6).map((m) => (
              <li key={m} className="text-xs text-amber-100/90">• {m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Powers */}
      <div className="p-5">
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">This powers</h3>
        <ul className="space-y-2">
          {BRAIN_POWERS.map((p) => {
            const on = completeness.complete;
            return (
              <li key={p.key} className="flex items-start gap-2">
                <span
                  className={[
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-primary transition-colors',
                    on ? 'border-primary/60 bg-primary/15' : 'border-border/60 bg-muted/20 text-muted-foreground/40',
                  ].join(' ')}
                >
                  <Check className="h-2.5 w-2.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{p.label}</p>
                  <p className="text-[11px] text-muted-foreground">{p.blurb}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

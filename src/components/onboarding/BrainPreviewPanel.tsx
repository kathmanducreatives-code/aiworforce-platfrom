// Live Company Brain preview (right rail, visible on every onboarding step).
//
// Shows what Agentory currently knows, what still needs confirmation, and what
// the Brain powers. It reads the SAME completeness rules the server enforces,
// so it can never promise an activation the server will refuse.

import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Brain, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { BRAIN_POWERS, type CompletenessResult } from '@/lib/companyBrainCompleteness';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right text-foreground/90">{value || '—'}</span>
    </div>
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
    <aside className="space-y-3" aria-label="Company Brain preview">
      <Card className="border-border/60 bg-card/60 p-4 backdrop-blur">
        <header className="mb-3 flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-tight">Your Company Brain</h2>
        </header>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Completeness</span>
            <span className="font-medium text-foreground">{completeness.percent}%</span>
          </div>
          <Progress value={completeness.percent} className="h-1.5" />
          <div className="mt-2 flex items-center gap-1.5">
            <Badge
              variant="outline"
              className={
                completeness.confidence === 'strong' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : completeness.confidence === 'partial' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-zinc-600/50 bg-zinc-700/20 text-zinc-300'
              }
            >
              {completeness.confidence} confidence
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {completeness.required_met}/{completeness.required_total} required
            </span>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border/50 pt-3">
          <Row label="Company" value={brain.company.name} />
          <Row label="Model" value={brain.company.business_model} />
          <Row label="Industries" value={tc.industries.join(', ')} />
          <Row label="Buyers" value={brain.buyer_personas.slice(0, 3).join(', ')} />
          <Row label="Triggers" value={[...brain.triggers, ...brain.jobs_to_watch].slice(0, 3).join(', ')} />
          <Row label="Disqualifiers" value={disqCount ? `${disqCount} rule${disqCount === 1 ? '' : 's'}` : ''} />
        </div>
      </Card>

      {completeness.missing.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-200">
            <Sparkles className="h-3.5 w-3.5" />
            What needs your confirmation
          </h3>
          <ul className="space-y-1">
            {completeness.missing.map((m) => (
              <li key={m} className="flex items-center gap-1.5 text-xs text-amber-100/90">
                <Circle className="h-2.5 w-2.5 shrink-0" />
                {m}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="border-border/60 bg-card/40 p-4">
        <h3 className="mb-2 text-xs font-semibold text-foreground">This powers</h3>
        <ul className="space-y-1.5">
          {BRAIN_POWERS.map((p) => (
            <li key={p.key} className="flex items-start gap-1.5 text-xs">
              <CheckCircle2
                className={`mt-0.5 h-3 w-3 shrink-0 ${completeness.complete ? 'text-emerald-400' : 'text-muted-foreground/40'}`}
              />
              <span>
                <span className="text-foreground/90">{p.label}</span>
                <span className="text-muted-foreground"> — {p.blurb}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}

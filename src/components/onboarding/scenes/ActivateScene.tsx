// Activate phase — the launch moment. The floating Brain orb is the hero
// (rendered by the shell); this scene carries the copy, the five product pills,
// the safety statement and the CTA. When blocked, it shows clickable missing
// decision cards instead of any percentage scorecard.

import { Target, Radar, PenLine, Cpu, Send, Loader2, Rocket, ShieldCheck, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SceneFrame } from '@/components/onboarding/SceneFrame';
import type { CompletenessResult } from '@/lib/companyBrainCompleteness';

const PILLS = [
  { key: 'leads', label: 'Leads', icon: <Target className="h-3.5 w-3.5" /> },
  { key: 'radar', label: 'Scout Radar', icon: <Radar className="h-3.5 w-3.5" /> },
  { key: 'content', label: 'Content', icon: <PenLine className="h-3.5 w-3.5" /> },
  { key: 'agents', label: 'Agents', icon: <Cpu className="h-3.5 w-3.5" /> },
  { key: 'outreach', label: 'Outreach', icon: <Send className="h-3.5 w-3.5" /> },
];

const STEP_LABEL: Record<string, string> = {
  company: 'Confirm company details',
  customers: 'Confirm your target customer',
  buyers: 'Confirm a buyer persona',
  triggers: 'Confirm a buying signal',
  disqualifiers: 'Confirm your disqualifiers',
  content: 'Confirm messaging or a pain point',
};

export function ActivateScene({
  completeness, busy, onActivate, onSaveDraft, onGoToMissing, onBack,
}: {
  completeness: CompletenessResult;
  busy: 'activate' | 'save' | null;
  onActivate: () => void;
  onSaveDraft: () => void;
  onGoToMissing: (step: string) => void;
  onBack: () => void;
}) {
  const complete = completeness.complete;
  const missingSteps = Object.keys(completeness.missing_by_step);
  const decisionsLeft = missingSteps.length;

  return (
    <SceneFrame
      eyebrow="Step 5 of 5 · Activate"
      title={complete ? 'Your Company Brain is ready.' : `Almost ready — ${decisionsLeft} decision${decisionsLeft === 1 ? '' : 's'} left`}
      helper={
        complete
          ? 'Agentory will now use this context across Leads, Scout Radar, Content, Agents, and Outreach.'
          : 'Confirm the decisions below and Agentory can activate your Brain. Your draft is already saved.'
      }
      width="xl"
      footer={
        complete ? (
          <div className="flex flex-col gap-3">
            <Button
              size="lg" onClick={onActivate} disabled={busy === 'activate'}
              className="h-12 w-full gap-2 bg-primary text-primary-foreground shadow-[0_0_32px_hsl(var(--primary)/0.45)] transition-shadow hover:bg-primary/90 hover:shadow-[0_0_44px_hsl(var(--primary)/0.6)]"
            >
              {busy === 'activate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Activate Company Brain
            </Button>
            <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back</Button>
            <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={busy === 'save'}>
              {busy === 'save' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save draft and finish later
            </Button>
          </div>
        )
      }
    >
      {complete ? (
        <div className="space-y-5">
          <div className="flex flex-wrap justify-center gap-2">
            {PILLS.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-xs font-medium text-foreground/90">
                <span className="text-primary">{p.icon}</span>{p.label}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Nothing sends automatically. You stay in control.
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {missingSteps.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => onGoToMissing(step)}
              className="group flex w-full items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-4 py-3 text-left transition-colors hover:border-amber-400/50 hover:bg-amber-500/[0.08]"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-400/40 text-[10px] font-semibold text-amber-300">!</span>
                <span className="text-sm text-foreground/90">{STEP_LABEL[step] ?? `Confirm ${step}`}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-amber-300/70 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      )}
    </SceneFrame>
  );
}

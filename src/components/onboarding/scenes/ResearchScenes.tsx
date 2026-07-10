// Research phase scenes.
//   9.  draft_brain   → the "Draft my Company Brain" moment (calls draft)
//   10. draft_summary → "Your first Company Brain draft is ready."

import { Sparkles } from 'lucide-react';
import { ResearchTimeline, type TimelineStage } from '@/components/onboarding/ResearchTimeline';
import { SceneFrame } from '@/components/onboarding/SceneFrame';
import { SceneFooter } from './sceneKit';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

// -------------------------------------------------------- Scene 9: draft ----

export function DraftBrainScene({ busy, onDraft, onBack }: {
  busy: boolean; onDraft: () => void; onBack: () => void;
}) {
  const stages: TimelineStage[] = [
    { id: 't', label: 'Building targeting', status: busy ? 'active' : 'pending' },
    { id: 'b', label: 'Building buyer personas', status: busy ? 'active' : 'pending' },
    { id: 's', label: 'Building signals', status: busy ? 'active' : 'pending' },
    { id: 'sf', label: 'Building safety rules', status: busy ? 'active' : 'pending' },
    { id: 'm', label: 'Building messaging', status: busy ? 'active' : 'pending' },
  ];
  return (
    <SceneFrame
      eyebrow="Step 3 of 5 · Research"
      title={busy ? 'Building your Company Brain…' : 'Ready to draft your Company Brain'}
      helper={busy ? undefined : 'Agentory turns everything it read into a first ICP. Anything inferred without proof is flagged for you — never invented.'}
      width="lg"
      footer={<SceneFooter onBack={onBack} primaryLabel="Draft my Company Brain" onPrimary={onDraft} primaryBusy={busy} />}
    >
      {busy ? (
        <ResearchTimeline stages={stages} running />
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 text-sm text-foreground/80">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          Targeting, buyers, signals, safety rules and messaging — drafted from real evidence and your own words.
        </div>
      )}
    </SceneFrame>
  );
}

// ------------------------------------------------------ Scene 10: summary ---

export function DraftSummaryScene({ brain, onReview, onBack }: {
  brain: CompanyBrainV2; onReview: () => void; onBack: () => void;
}) {
  const counts = [
    { label: 'Industries', n: brain.target_customer.industries.length },
    { label: 'Buyer personas', n: brain.buyer_personas.length },
    { label: 'Signals', n: brain.triggers.length + brain.jobs_to_watch.length },
    { label: 'Disqualifiers', n:
      brain.target_customer.disqualifiers.industries.length +
      brain.target_customer.disqualifiers.company_types.length +
      brain.target_customer.disqualifiers.keywords.length },
    { label: 'Content angles', n: brain.content_angles.length },
  ];
  return (
    <SceneFrame
      eyebrow="Step 3 of 5 · Research"
      title="Your first Company Brain draft is ready."
      helper="You’ll confirm one decision group at a time — nothing is locked in until you activate."
      width="lg"
      footer={<SceneFooter onBack={onBack} primaryLabel="Review my Brain" onPrimary={onReview} />}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {counts.map((c) => (
          <div key={c.label} className="rounded-xl border border-border/50 bg-background/30 px-3 py-3 text-center">
            <p className="text-xl font-semibold tabular-nums text-primary">{c.n}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.13em] text-muted-foreground/80">{c.label}</p>
          </div>
        ))}
      </div>
    </SceneFrame>
  );
}

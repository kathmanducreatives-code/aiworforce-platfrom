// Founder phase scenes — one focused ask per screen.
//   1. founder_name      → only the name
//   2. founder_linkedin  → only the profile URL + consent
//   3. founder_research  → AI working animation (calls research_founder)
//   4. founder_verify    → clean summary card, confirm or edit in a drawer

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ResearchTimeline, type TimelineStage } from '@/components/onboarding/ResearchTimeline';
import { EditDrawer } from '@/components/onboarding/EditDrawer';
import { SceneFrame } from '@/components/onboarding/SceneFrame';
import { SceneInput, SceneFooter, SummaryRow, ReadChips } from './sceneKit';
import { canEnrichFounder, type FounderForm } from '@/lib/onboardingV3';

// ------------------------------------------------------------ Scene 1: name --

export function FounderNameScene({ value, onChange, onContinue }: {
  value: FounderForm; onChange: (f: FounderForm) => void; onContinue: () => void;
}) {
  const ready = value.name.trim().length > 0;
  return (
    <SceneFrame
      eyebrow="Step 1 of 5 · Founder"
      title="What should Agentory call you?"
      helper="We’ll use this to personalize your workspace and how your agents communicate."
      footer={<SceneFooter primaryLabel="Continue" onPrimary={onContinue} primaryDisabled={!ready} />}
    >
      <SceneInput
        label="Founder name"
        value={value.name}
        onChange={(v) => onChange({ ...value, name: v })}
        placeholder="Jane Doe"
        autoFocus
        onEnter={() => ready && onContinue()}
      />
    </SceneFrame>
  );
}

// -------------------------------------------------------- Scene 2: linkedin --

export function FounderLinkedInScene({ value, onChange, onAnalyze, onSkip, onBack }: {
  value: FounderForm; onChange: (f: FounderForm) => void;
  onAnalyze: () => void; onSkip: () => void; onBack: () => void;
}) {
  return (
    <SceneFrame
      eyebrow="Step 1 of 5 · Founder"
      title="Where can Agentory learn your background?"
      helper="Optional. We read only the public profile URL you paste — never emails, phones or contacts."
      footer={
        <SceneFooter
          onBack={onBack}
          primaryLabel="Analyze LinkedIn profile"
          onPrimary={onAnalyze}
          primaryDisabled={!canEnrichFounder(value)}
          secondary={
            <Button variant="ghost" size="sm" onClick={onSkip} className="text-muted-foreground">
              Skip and continue manually
            </Button>
          }
        />
      }
    >
      <div className="space-y-4">
        <SceneInput
          label="LinkedIn profile URL"
          value={value.linkedin_url}
          onChange={(v) => onChange({ ...value, linkedin_url: v })}
          placeholder="https://linkedin.com/in/your-handle"
        />
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-3.5">
          <span className="flex min-w-0 items-start gap-2.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 text-xs leading-relaxed text-foreground/90">
              Use this public LinkedIn profile to enrich my Company Brain.
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Nothing runs until you toggle this on and click Analyze.</span>
            </span>
          </span>
          <Switch checked={value.enrichment_consent} onCheckedChange={(c) => onChange({ ...value, enrichment_consent: c === true })} />
        </label>
      </div>
    </SceneFrame>
  );
}

// -------------------------------------------------------- Scene 3: research --

export function FounderResearchScene({ busy, research, onContinue, onBack }: {
  busy: boolean; research: any; onContinue: () => void; onBack: () => void;
}) {
  const done = !!research && !busy;
  const sparse = done && (research?.confidence === 'low' || (research?.missing_evidence?.length ?? 0) >= 3);
  const stages: TimelineStage[] = [
    { id: 'read', label: 'Reading public profile', detail: 'The single URL you provided', status: busy ? 'active' : done ? 'done' : 'pending' },
    { id: 'role', label: 'Extracting role and experience', detail: research?.current_role || 'Title, company, history', status: done ? 'done' : busy ? 'active' : 'pending' },
    { id: 'cred', label: 'Finding credibility signals', detail: `${research?.credibility_signals?.length ?? 0} found`, status: done ? 'done' : 'pending' },
    { id: 'gtm', label: 'Mapping GTM relevance', detail: `${research?.gtm_relevance?.length ?? 0} signals`, status: done ? 'done' : 'pending' },
  ];
  return (
    <SceneFrame
      eyebrow="Step 1 of 5 · Founder"
      title={busy ? 'Learning your background…' : done ? 'Here’s what Agentory read' : 'Ready when you are'}
      helper={sparse ? 'Limited public LinkedIn data found. You can continue and fill this in by hand.' : undefined}
      width="lg"
      footer={<SceneFooter onBack={onBack} primaryLabel="Continue" onPrimary={onContinue} primaryBusy={busy} />}
    >
      <ResearchTimeline stages={stages} running={busy} />
    </SceneFrame>
  );
}

// ---------------------------------------------------------- Scene 4: verify --

export function FounderVerifyScene({ value, research, onChange, onConfirm, onBack }: {
  value: FounderForm; research: any;
  onChange: (f: FounderForm) => void; onConfirm: () => void; onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const name = value.name || research?.name || '';
  const role = value.role || research?.current_role || '';
  const company = research?.current_company || '';
  const background = research?.headline || research?.summary || '';

  return (
    <SceneFrame
      eyebrow="Step 1 of 5 · Founder"
      title="Does this look right?"
      helper="Confirm what Agentory learned about you, or edit any detail."
      width="lg"
      footer={
        <SceneFooter
          onBack={onBack}
          primaryLabel="Confirm and continue"
          onPrimary={onConfirm}
          secondary={<Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="text-muted-foreground">Edit details</Button>}
        />
      }
    >
      <div className="rounded-2xl border border-border/50 bg-background/30 p-5">
        <SummaryRow label="Name" value={name} />
        <SummaryRow label="Role / title" value={role} />
        <SummaryRow label="Current company" value={company} />
        <SummaryRow label="Background" value={background} />
        <div className="pt-3">
          <ReadChips label="Credibility signals" values={research?.credibility_signals ?? []} empty="None detected" />
        </div>
        <div className="pt-3">
          <ReadChips label="GTM relevance" values={research?.gtm_relevance ?? []} empty="No GTM signal detected" />
        </div>
      </div>

      <EditDrawer open={editing} onOpenChange={setEditing} title="Edit founder details" description="Your edits always win over what the AI read.">
        <SceneInput label="Name" value={value.name} onChange={(v) => onChange({ ...value, name: v })} placeholder="Jane Doe" />
        <SceneInput label="Role / title" value={value.role} onChange={(v) => onChange({ ...value, role: v })} placeholder="Founder & CEO" />
        <SceneInput label="First goal" value={value.first_help_goal} onChange={(v) => onChange({ ...value, first_help_goal: v })} placeholder="Find warm leads" />
      </EditDrawer>
    </SceneFrame>
  );
}

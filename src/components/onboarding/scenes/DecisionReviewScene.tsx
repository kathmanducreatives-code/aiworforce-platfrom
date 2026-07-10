// Review phase — ONE decision group per scene (Targeting / Buyers / Signals /
// Safety / Messaging). Never a giant review dashboard: a single premium
// decision card with read-only chips, "Accept and continue", and "Edit" that
// opens a drawer of chip editors. Config-driven so all five scenes share code.

import { useState } from 'react';
import { Target, Users, Radar, Shield, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChipInput } from '@/components/onboarding/ChipInput';
import { EditDrawer } from '@/components/onboarding/EditDrawer';
import { SceneFrame } from '@/components/onboarding/SceneFrame';
import { SceneFooter, ReadChips } from './sceneKit';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import type { SceneId } from '@/lib/onboardingScenes';

interface Group {
  label: string;
  get: (b: CompanyBrainV2) => string[];
  /** When present, the group is editable in the drawer. */
  set?: (b: CompanyBrainV2, next: string[]) => void;
  emptyHelper?: string;
}

interface ReviewConfig {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accept: string;
  groups: Group[];
}

const CONFIGS: Record<string, ReviewConfig> = {
  review_targeting: {
    eyebrow: 'Step 4 of 5 · Review · Targeting',
    icon: <Target className="h-4 w-4" />,
    title: 'Who Agentory will target',
    subtitle: 'Powers Leads, Scout Radar and every scoring surface.',
    accept: 'Accept targeting',
    groups: [
      { label: 'Industries', get: (b) => b.target_customer.industries, set: (b, v) => { b.target_customer.industries = v; }, emptyHelper: 'Add industries you sell into' },
      { label: 'Business models', get: (b) => b.target_customer.business_models, set: (b, v) => { b.target_customer.business_models = v; }, emptyHelper: 'Add business models' },
      { label: 'Company size', get: (b) => (b.target_customer.company_size.label ? [b.target_customer.company_size.label] : []) },
      { label: 'Geography', get: (b) => b.target_customer.geography },
      { label: 'Must-have traits', get: (b) => b.target_customer.must_have, set: (b, v) => { b.target_customer.must_have = v; }, emptyHelper: 'Non-negotiable traits' },
    ],
  },
  review_buyers: {
    eyebrow: 'Step 4 of 5 · Review · Buyers',
    icon: <Users className="h-4 w-4" />,
    title: 'Who actually signs',
    subtitle: 'The roles Agentory will treat as decision-makers.',
    accept: 'Accept buyers',
    groups: [
      { label: 'Buyer personas', get: (b) => b.buyer_personas, set: (b, v) => { b.buyer_personas = v; }, emptyHelper: 'Roles that hold the budget' },
      { label: 'Pain points', get: (b) => b.pain_points, set: (b, v) => { b.pain_points = v; }, emptyHelper: 'The pain your product solves' },
    ],
  },
  review_signals: {
    eyebrow: 'Step 4 of 5 · Review · Signals',
    icon: <Radar className="h-4 w-4" />,
    title: 'When to act',
    subtitle: 'Triggers, jobs and tools Scout Radar watches on your behalf.',
    accept: 'Accept signals',
    groups: [
      { label: 'Buying triggers', get: (b) => b.triggers, set: (b, v) => { b.triggers = v; }, emptyHelper: 'e.g. new funding, exec hire' },
      { label: 'Jobs to watch', get: (b) => b.jobs_to_watch, set: (b, v) => { b.jobs_to_watch = v; }, emptyHelper: 'Titles that signal intent' },
      { label: 'Tools to watch', get: (b) => b.tools, set: (b, v) => { b.tools = v; }, emptyHelper: 'Tools worth watching' },
      { label: 'Competitors', get: (b) => b.competitors, set: (b, v) => { b.competitors = v; }, emptyHelper: 'Competitors to track' },
    ],
  },
  review_safety: {
    eyebrow: 'Step 4 of 5 · Review · Safety',
    icon: <Shield className="h-4 w-4" />,
    title: 'What Agentory will never do',
    subtitle: 'Disqualifiers are enforced before anything reaches you or a prospect.',
    accept: 'Accept safety rules',
    groups: [
      { label: 'Industries to avoid', get: (b) => b.target_customer.disqualifiers.industries, set: (b, v) => { b.target_customer.disqualifiers.industries = v; }, emptyHelper: 'Industries to skip' },
      { label: 'Company types to avoid', get: (b) => b.target_customer.disqualifiers.company_types, set: (b, v) => { b.target_customer.disqualifiers.company_types = v; }, emptyHelper: 'e.g. agencies, freelancers' },
      { label: 'Keywords to avoid', get: (b) => b.target_customer.disqualifiers.keywords, set: (b, v) => { b.target_customer.disqualifiers.keywords = v; }, emptyHelper: "Words that mean 'not a fit'" },
      { label: 'Required evidence', get: (b) => b.qualification_rules.required_evidence, set: (b, v) => { b.qualification_rules.required_evidence = v; }, emptyHelper: 'Proof Agentory must verify' },
      { label: 'Reject if', get: (b) => b.qualification_rules.reject_if, set: (b, v) => { b.qualification_rules.reject_if = v; }, emptyHelper: 'Auto-reject conditions' },
    ],
  },
  review_messaging: {
    eyebrow: 'Step 4 of 5 · Review · Messaging',
    icon: <MessageSquare className="h-4 w-4" />,
    title: 'How Agentory should speak',
    subtitle: 'Voice, angles and positioning for Content and Outreach.',
    accept: 'Accept messaging',
    groups: [
      { label: 'Positioning promise', get: (b) => (b.positioning.promise ? [b.positioning.promise] : []) },
      { label: 'Content angles', get: (b) => b.content_angles, set: (b, v) => { b.content_angles = v; }, emptyHelper: 'Narrative angles' },
      { label: 'Brand voice', get: (b) => (b.brand_voice.tone ? [b.brand_voice.tone] : []) },
      { label: 'Banned claims / avoid', get: (b) => [...b.positioning.avoid_positioning, ...b.brand_voice.avoid] },
    ],
  },
};

export function DecisionReviewScene({
  scene, brain, confidence, onEditBrain, onContinue, onBack, isLast,
}: {
  scene: SceneId;
  brain: CompanyBrainV2;
  confidence: string;
  onEditBrain: (b: CompanyBrainV2) => void;
  onContinue: () => void;
  onBack: () => void;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const cfg = CONFIGS[scene];
  if (!cfg) return null;

  const editable = cfg.groups.filter((g) => g.set);

  const setList = (mutate: (b: CompanyBrainV2, v: string[]) => void) => (next: string[]) => {
    const nb: CompanyBrainV2 = structuredClone(brain);
    mutate(nb, next);
    onEditBrain(nb);
  };

  return (
    <SceneFrame
      eyebrow={cfg.eyebrow}
      title={cfg.title}
      helper={cfg.subtitle}
      width="xl"
      footer={
        <SceneFooter
          onBack={onBack}
          primaryLabel={isLast ? 'Accept and finish review' : cfg.accept}
          onPrimary={onContinue}
          secondary={editable.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="text-muted-foreground">Edit</Button> : undefined}
        />
      }
    >
      <div className="rounded-2xl border border-border/50 bg-background/30 p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">{cfg.icon}</span>
          <Badge variant="outline" className="gap-1 rounded-full border-primary/30 bg-primary/5 text-[10px] uppercase tracking-[0.14em] text-primary">AI drafted</Badge>
          <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{confidence} confidence</Badge>
        </div>
        <div className="space-y-4">
          {cfg.groups.map((g) => (
            <ReadChips key={g.label} label={g.label} values={g.get(brain)} empty={g.emptyHelper ?? 'None yet'} />
          ))}
        </div>
      </div>

      {editable.length > 0 && (
        <EditDrawer open={editing} onOpenChange={setEditing} title={`Edit ${cfg.title.toLowerCase()}`} description="Your edits become the confirmed Brain.">
          {editable.map((g) => (
            <ChipInput
              key={g.label}
              label={g.label}
              values={g.get(brain)}
              onChange={setList(g.set!)}
              emptyHelper={g.emptyHelper}
            />
          ))}
        </EditDrawer>
      )}
    </SceneFrame>
  );
}

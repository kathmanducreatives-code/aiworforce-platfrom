// Saved Company Brain dashboard — premium "strategic operating brain" view.
//
// Reads the workspace's `company_brain.profile` via `useCompanyBrain`
// (RLS + WorkspaceContext scoped), renders a hierarchy of premium section
// cards, and lets the user edit one section at a time. Never restarts
// onboarding on its own: the Refresh action opens a confirm modal that
// navigates to /onboarding/company-brain?restart=1 without touching the
// active Brain.
//
// Hierarchy:
//   A. Active Brain hero (BrainHero)
//   B. Brain at a glance (BrainAtAGlance)
//   C. Workflow usage narrative (WorkflowUsage)
//   D. Main strategic sections (ICP/Targeting, Buyer Personas) — wide
//   E. Buying signals + Company understanding — medium
//   F. Disqualifiers & safety + Messaging — supporting
//
// Backend contract unchanged: same table, same profile shape, same patch/merge
// path as before. SectionKey re-exported for route parity.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import { ProgressiveBackground } from '@/components/onboarding/ProgressiveBackground';
import { BrainHero } from '@/components/company-brain/BrainHero';
import { BrainAtAGlance } from '@/components/company-brain/BrainAtAGlance';
import { WorkflowUsage } from '@/components/company-brain/WorkflowUsage';
import { BrainSectionCard, Field } from '@/components/company-brain/BrainSectionCard';
import { Pill, type PillTone } from '@/components/company-brain/Pill';
import { EmptyState } from '@/components/company-brain/EmptyState';
import CompanyBrainEditDrawer, { type SectionKey as DrawerSectionKey } from '@/components/company-brain/CompanyBrainEditDrawer';
import RestartOnboardingModal from '@/components/company-brain/RestartOnboardingModal';

import { mergeProfilePatch, toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';
import { deriveHealth, SECTION_META, type SectionKey } from '@/lib/companyBrainSections';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { data, loading, refresh } = useCompanyBrain();
  const [openSection, setOpenSection] = useState<DrawerSectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<SectionKey | null>(null);

  const view = useMemo(() => toSavedBrainView(data?.profile as BrainProfile | undefined), [data?.profile]);
  const { brain, raw } = view;
  const health = useMemo(() => deriveHealth(brain), [brain]);

  const lastUpdated = data?.onboarding_completed_at
    ? new Date(data.onboarding_completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  async function saveSection(section: SectionKey, patch: BrainProfile) {
    if (!workspaceId) { toast.error('No workspace'); return; }
    const merged = mergeProfilePatch(raw, patch);
    const { error } = await supabase
      .from('company_brain')
      .update({ profile: merged as any })
      .eq('workspace_id', workspaceId);
    if (error) { toast.error('Save failed', { description: error.message }); return; }
    toast.success('Section saved');
    setSavedFlash(section);
    setTimeout(() => setSavedFlash((s) => (s === section ? null : s)), 1600);
    refresh();
  }

  if (loading) {
    return (
      <div className="relative min-h-screen text-foreground">
        <ProgressiveBackground />
        <div className="relative z-10 flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Company Brain…
        </div>
      </div>
    );
  }

  const t = brain.target_customer;
  const sizeLabel = t.company_size.label
    || (t.company_size.min && t.company_size.max
      ? `${t.company_size.min}–${t.company_size.max}`
      : '');

  const edit = (key: SectionKey) => () => setOpenSection(key);

  return (
    <div className="relative min-h-screen overflow-x-clip text-foreground">
      <ProgressiveBackground />

      <div className="relative z-10 mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        {/* A. Active Brain hero */}
        <BrainHero
          companyName={brain.company.name}
          category={brain.company.category}
          lastUpdated={lastUpdated}
          onEditSection={(k) => setOpenSection(k)}
          onRestart={() => setRestartOpen(true)}
        />

        {/* B. Brain at a glance */}
        <BrainAtAGlance brain={brain} />

        {/* C. Workflow usage narrative */}
        <WorkflowUsage />

        {/* D + E + F. Strategic sections — responsive 12-column grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* ICP / targeting — wide */}
          <BrainSectionCard
            index={0}
            className="lg:col-span-7"
            eyebrow={SECTION_META.targeting.eyebrow}
            title={SECTION_META.targeting.title}
            explanation={SECTION_META.targeting.explanation}
            icon={SECTION_META.targeting.icon}
            health={health.targeting}
            justSaved={savedFlash === 'targeting'}
            onEdit={edit('targeting')}
          >
            <div className="space-y-3">
              <PillGroup label="Industries" values={t.industries} tone="emerald" emptyHint="Add target industries so Agentory knows who fits." onAdd={edit('targeting')} />
              <PillGroup label="Business models" values={t.business_models} tone="emerald" emptyHint="Add business models to tighten targeting." onAdd={edit('targeting')} />
              <PillGroup label="Geography" values={t.geography} tone="emerald" emptyHint="Add geography to scope where leads come from." onAdd={edit('targeting')} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Company size">
                  {sizeLabel ? <span>{sizeLabel}</span> : (
                    <span className="text-muted-foreground/80">
                      <EmptyState hint="Add company size to qualify leads." onAdd={edit('targeting')} />
                    </span>
                  )}
                </Field>
                <PillGroup label="Must-have traits" values={t.must_have} tone="emerald" emptyHint="Add must-have traits to improve lead qualification." onAdd={edit('targeting')} />
              </div>
            </div>
          </BrainSectionCard>

          {/* Buyer personas — wide */}
          <BrainSectionCard
            index={1}
            className="lg:col-span-5"
            eyebrow={SECTION_META.buyers.eyebrow}
            title={SECTION_META.buyers.title}
            explanation={SECTION_META.buyers.explanation}
            icon={SECTION_META.buyers.icon}
            health={health.buyers}
            justSaved={savedFlash === 'buyers'}
            onEdit={edit('buyers')}
          >
            <div className="space-y-3">
              <PillGroup label="Buyer roles" values={brain.buyer_personas} tone="neutral" emptyHint="Add buyer roles to focus who outreach targets." onAdd={edit('buyers')} />
              <PillGroup label="Pain points" values={brain.pain_points} tone="neutral" emptyHint="Add pain points so drafts speak to real problems." onAdd={edit('buyers')} />
            </div>
          </BrainSectionCard>

          {/* Buying signals — medium-high */}
          <BrainSectionCard
            index={2}
            className="lg:col-span-6"
            eyebrow={SECTION_META.signals.eyebrow}
            title={SECTION_META.signals.title}
            explanation={SECTION_META.signals.explanation}
            icon={SECTION_META.signals.icon}
            health={health.signals}
            justSaved={savedFlash === 'signals'}
            onEdit={edit('signals')}
          >
            <div className="space-y-3">
              <PillGroup label="Triggers" values={brain.triggers} tone="signal" emptyHint="Add buying triggers so Scout Radar knows what to watch." onAdd={edit('signals')} />
              <PillGroup label="Jobs to watch" values={brain.jobs_to_watch} tone="signal" emptyHint="Add hiring roles or jobs to watch for relevant timing." onAdd={edit('signals')} />
            </div>
          </BrainSectionCard>

          {/* Company understanding — medium */}
          <BrainSectionCard
            index={3}
            className="lg:col-span-6"
            eyebrow={SECTION_META.company.eyebrow}
            title={SECTION_META.company.title}
            explanation={SECTION_META.company.explanation}
            icon={SECTION_META.company.icon}
            health={health.company}
            whisper={brain.company.website_url ? 'From your website' : undefined}
            justSaved={savedFlash === 'company'}
            onEdit={edit('company')}
          >
            <div className="space-y-3">
              <Field label="Description">
                {brain.company.description ? (
                  <p className="leading-snug">{brain.company.description}</p>
                ) : (
                  <EmptyState hint="Add a short description so agents understand what you do." onAdd={edit('company')} />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  {brain.company.category ? <span>{brain.company.category}</span> : <AddMini onClick={edit('company')} label="Add category" />}
                </Field>
                <Field label="Business model">
                  {brain.company.business_model ? <span>{brain.company.business_model}</span> : <AddMini onClick={edit('company')} label="Add business model" />}
                </Field>
                <Field label="Stage">
                  {brain.company.stage ? <span>{brain.company.stage}</span> : <AddMini onClick={edit('company')} label="Add stage" />}
                </Field>
                <Field label="Team size">
                  {brain.company.team_size ? <span>{brain.company.team_size}</span> : <AddMini onClick={edit('company')} label="Add team size" />}
                </Field>
              </div>
            </div>
          </BrainSectionCard>

          {/* Disqualifiers & safety — supporting */}
          <BrainSectionCard
            index={4}
            className="lg:col-span-6"
            eyebrow={SECTION_META.disqualifiers.eyebrow}
            title={SECTION_META.disqualifiers.title}
            explanation={SECTION_META.disqualifiers.explanation}
            icon={SECTION_META.disqualifiers.icon}
            health={health.disqualifiers}
            justSaved={savedFlash === 'disqualifiers'}
            onEdit={edit('disqualifiers')}
          >
            <div className="space-y-3">
              <PillGroup label="Industries to avoid" values={t.disqualifiers.industries} tone="danger" emptyHint="Add industries to avoid so bad-fit leads are filtered out." onAdd={edit('disqualifiers')} />
              <PillGroup label="Keywords to avoid" values={t.disqualifiers.keywords} tone="danger" emptyHint="Add keywords to avoid so outreach stays on-target." onAdd={edit('disqualifiers')} />
              <PillGroup label="Required evidence" values={brain.qualification_rules.required_evidence} tone="neutral" emptyHint="Add required evidence so leads are validated before outreach." onAdd={edit('disqualifiers')} />
              <PillGroup label="Reject if" values={brain.qualification_rules.reject_if} tone="danger" emptyHint="Add reject-if rules to auto-disqualify bad fits." onAdd={edit('disqualifiers')} />
            </div>
          </BrainSectionCard>

          {/* Messaging & positioning — supporting */}
          <BrainSectionCard
            index={5}
            className="lg:col-span-6"
            eyebrow={SECTION_META.messaging.eyebrow}
            title={SECTION_META.messaging.title}
            explanation={SECTION_META.messaging.explanation}
            icon={SECTION_META.messaging.icon}
            health={health.messaging}
            justSaved={savedFlash === 'messaging'}
            onEdit={edit('messaging')}
          >
            <div className="space-y-3">
              <Field label="Positioning promise">
                {brain.positioning.promise ? (
                  <p className="leading-snug">“{brain.positioning.promise}”</p>
                ) : (
                  <EmptyState hint="Add a positioning promise to anchor every message." onAdd={edit('messaging')} />
                )}
              </Field>
              <PillGroup label="Content angles" values={brain.content_angles} tone="neutral" emptyHint="Add content angles to guide generated content." onAdd={edit('messaging')} />
              <Field label="Voice tone">
                {brain.brand_voice.tone ? <span>{brain.brand_voice.tone}</span> : <AddMini onClick={edit('messaging')} label="Add voice tone" />}
              </Field>
              <PillGroup label="Banned claims" values={brain.brand_voice.avoid} tone="warning" emptyHint="Add banned claims to keep generated content on-brand." onAdd={edit('messaging')} />
            </div>
          </BrainSectionCard>
        </div>
      </div>

      <CompanyBrainEditDrawer
        open={openSection !== null}
        section={openSection}
        brain={brain}
        onOpenChange={(v) => { if (!v) setOpenSection(null); }}
        onSave={(patch) => saveSection(openSection as SectionKey, patch)}
      />

      <RestartOnboardingModal
        open={restartOpen}
        onOpenChange={setRestartOpen}
        onConfirm={() => { setRestartOpen(false); navigate('/onboarding/company-brain?restart=1'); }}
      />
    </div>
  );
}

// ---- local content helpers --------------------------------------------------------

function PillGroup({
  label, values, tone, emptyHint, onAdd,
}: {
  label: string;
  values: string[];
  tone: PillTone;
  emptyHint: string;
  onAdd?: () => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {values.length ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Pill key={v} tone={tone}>{v}</Pill>
          ))}
        </div>
      ) : (
        <EmptyState hint={emptyHint} onAdd={onAdd} />
      )}
    </div>
  );
}

function AddMini({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/45 bg-background/20 px-2 py-0.5 text-[11.5px] text-muted-foreground/80 transition-colors hover:border-primary/45 hover:text-foreground/90"
    >
      + {label}
    </button>
  );
}

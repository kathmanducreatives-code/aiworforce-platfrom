// Saved Company Brain dashboard — the destination for users who already
// finished onboarding. Reads the workspace's `company_brain.profile` via
// `useCompanyBrain` (RLS + WorkspaceContext scoped), renders section cards,
// and lets the user edit one section at a time. Never restarts onboarding on
// its own: "Run onboarding again" opens a confirm modal that navigates to
// /onboarding/company-brain?restart=1 without touching the active Brain.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, CheckCircle2, Loader2, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Button } from '@/components/ui/button';

import { ProgressiveBackground } from '@/components/onboarding/ProgressiveBackground';
import CompanyBrainSectionCard, { ChipList, LabelValue } from '@/components/company-brain/CompanyBrainSectionCard';
import CompanyBrainEditDrawer, { type SectionKey } from '@/components/company-brain/CompanyBrainEditDrawer';
import RestartOnboardingModal from '@/components/company-brain/RestartOnboardingModal';
import SystemUsageStrip from '@/components/company-brain/SystemUsageStrip';

import { mergeProfilePatch, toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { data, loading, refresh } = useCompanyBrain();
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);

  const view = useMemo(() => toSavedBrainView(data?.profile as BrainProfile | undefined), [data?.profile]);
  const { brain, raw } = view;

  const lastUpdated = data?.onboarding_completed_at
    ? new Date(data.onboarding_completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  async function saveSection(patch: BrainProfile) {
    if (!workspaceId) { toast.error('No workspace'); return; }
    const merged = mergeProfilePatch(raw, patch);
    const { error } = await supabase
      .from('company_brain')
      .update({ profile: merged as any })
      .eq('workspace_id', workspaceId);
    if (error) { toast.error('Save failed', { description: error.message }); return; }
    toast.success('Section saved');
    refresh();
  }

  if (loading) {
    return (
      <div className="relative flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading Company Brain…
      </div>
    );
  }

  const targeting = brain.target_customer;
  const sizeLabel = targeting.company_size.label
    || (targeting.company_size.min && targeting.company_size.max
      ? `${targeting.company_size.min}–${targeting.company_size.max}`
      : '');

  return (
    <div className="relative min-h-screen text-foreground">
      <ProgressiveBackground />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 space-y-6">
        {/* Header */}
        <header className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-11 w-11 rounded-xl border border-primary/40 bg-primary/10 flex items-center justify-center shrink-0 shadow-[0_0_18px_hsl(var(--primary)/0.25)]">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Company Brain</h1>
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3 w-3 text-primary/70" /> Approval-first
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {brain.company.name || 'Your company'}
                  {brain.company.category ? <span> · {brain.company.category}</span> : null}
                  {lastUpdated ? <span className="text-muted-foreground/70"> · updated {lastUpdated}</span> : null}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <Button onClick={() => setOpenSection('company')} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Edit Company Brain
              </Button>
              <Button variant="outline" onClick={() => setRestartOpen(true)} className="gap-2">
                <RotateCcw className="h-3.5 w-3.5" /> Run onboarding again
              </Button>
            </div>
          </div>
        </header>

        {/* Sections */}
        <div className="grid gap-4 md:grid-cols-2">
          <CompanyBrainSectionCard title="Company understanding" subtitle="Who you are and what you do." onEdit={() => setOpenSection('company')}>
            <div className="space-y-3">
              <LabelValue label="Description" value={brain.company.description} />
              <div className="grid grid-cols-2 gap-3">
                <LabelValue label="Category" value={brain.company.category} />
                <LabelValue label="Business model" value={brain.company.business_model} />
                <LabelValue label="Stage" value={brain.company.stage} />
                <LabelValue label="Team size" value={brain.company.team_size} />
              </div>
              {brain.company.website_url && (
                <LabelValue label="Website" value={brain.company.website_url} />
              )}
            </div>
          </CompanyBrainSectionCard>

          <CompanyBrainSectionCard title="ICP / targeting" subtitle="Who counts as a fit worth researching." onEdit={() => setOpenSection('targeting')}>
            <div className="space-y-3">
              <Row label="Industries"><ChipList values={targeting.industries} /></Row>
              <Row label="Business models"><ChipList values={targeting.business_models} /></Row>
              <Row label="Geography"><ChipList values={targeting.geography} /></Row>
              <Row label="Company size"><span className="text-sm">{sizeLabel || <span className="text-muted-foreground italic">Not set</span>}</span></Row>
              <Row label="Must-have traits"><ChipList values={targeting.must_have} /></Row>
            </div>
          </CompanyBrainSectionCard>

          <CompanyBrainSectionCard title="Buyer personas" subtitle="The roles you sell to." onEdit={() => setOpenSection('buyers')}>
            <div className="space-y-3">
              <Row label="Buyer roles"><ChipList values={brain.buyer_personas} /></Row>
              <Row label="Pain points"><ChipList values={brain.pain_points} /></Row>
            </div>
          </CompanyBrainSectionCard>

          <CompanyBrainSectionCard title="Buying signals" subtitle="What Scout Radar should watch for." onEdit={() => setOpenSection('signals')}>
            <div className="space-y-3">
              <Row label="Triggers"><ChipList values={brain.triggers} /></Row>
              <Row label="Jobs to watch"><ChipList values={brain.jobs_to_watch} /></Row>
            </div>
          </CompanyBrainSectionCard>

          <CompanyBrainSectionCard title="Disqualifiers & safety" subtitle="Who and what to never target." onEdit={() => setOpenSection('disqualifiers')}>
            <div className="space-y-3">
              <Row label="Industries to avoid"><ChipList values={targeting.disqualifiers.industries} /></Row>
              <Row label="Keywords to avoid"><ChipList values={targeting.disqualifiers.keywords} /></Row>
              <Row label="Required evidence"><ChipList values={brain.qualification_rules.required_evidence} /></Row>
              <Row label="Reject if"><ChipList values={brain.qualification_rules.reject_if} /></Row>
            </div>
          </CompanyBrainSectionCard>

          <CompanyBrainSectionCard title="Messaging & positioning" subtitle="How Agentory should sound on your behalf." onEdit={() => setOpenSection('messaging')}>
            <div className="space-y-3">
              <LabelValue label="Positioning promise" value={brain.positioning.promise} />
              <Row label="Content angles"><ChipList values={brain.content_angles} /></Row>
              <Row label="Voice tone"><span className="text-sm">{brain.brand_voice.tone || <span className="text-muted-foreground italic">Not set</span>}</span></Row>
              <Row label="Banned claims"><ChipList values={brain.brand_voice.avoid} /></Row>
            </div>
          </CompanyBrainSectionCard>
        </div>

        <SystemUsageStrip />
      </div>

      <CompanyBrainEditDrawer
        open={openSection !== null}
        section={openSection}
        brain={brain}
        onOpenChange={(v) => { if (!v) setOpenSection(null); }}
        onSave={saveSection}
      />

      <RestartOnboardingModal
        open={restartOpen}
        onOpenChange={setRestartOpen}
        onConfirm={() => { setRestartOpen(false); navigate('/onboarding/company-brain?restart=1'); }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

// Saved Company Brain — premium vertical intelligence flow.
//
// The user scrolls through their ICP in the same sequence Agentory uses it:
//   01 Target Market → 02 Buyer Profile → 03 Buying Moments
//   → 04 Qualification & Safety → 05 Messaging Fit
//
// Reads `company_brain.profile` via `useCompanyBrain` (RLS + WorkspaceContext
// scoped). Edit/save contract is unchanged: same table, same profile shape,
// same mergeProfilePatch shallow-merge, same drawer SectionKey mapping.
// Onboarding, backend functions, schema, auth, and RLS are untouched.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import { ProgressiveBackground } from '@/components/onboarding/ProgressiveBackground';
import { IcpHero } from '@/components/company-brain/IcpHero';
import { deriveSellerIdentityState, sellerIdentityBanner } from '@/lib/companyBrain/sellerIdentityState';
import { IcpSection, PillGroup, TextRows, StatementField, InlineAdd } from '@/components/company-brain/IcpSection';
import { SystemImpactFooter } from '@/components/company-brain/SystemImpactFooter';
import CompanyBrainEditDrawer, { type SectionKey as DrawerSectionKey } from '@/components/company-brain/CompanyBrainEditDrawer';
import RestartOnboardingModal from '@/components/company-brain/RestartOnboardingModal';

import { mergeProfilePatch, toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';
import { deriveHealth, FLOW_SECTIONS, type SectionKey } from '@/lib/companyBrainSections';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { data, loading, isRefreshing, refresh } = useCompanyBrain();
  const [openSection, setOpenSection] = useState<DrawerSectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<SectionKey | null>(null);

  const view = useMemo(() => toSavedBrainView(data?.profile as BrainProfile | undefined), [data?.profile]);
  const { brain, raw } = view;
  const health = useMemo(() => deriveHealth(brain), [brain]);

  // Seller-identity state for the diagnostic banner (nested vs hidden legacy flat).
  const identityState = useMemo(() => deriveSellerIdentityState(data?.profile), [data?.profile]);
  const identityBanner = useMemo(() => sellerIdentityBanner(identityState), [identityState]);

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

  // `loading` is now "nothing cached AND a first read pending", so a background
  // refetch (or an auth-driven workspace re-resolve) no longer blanks the page
  // and no longer resets scroll position.
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
  const edit = (k: SectionKey) => () => setOpenSection(k);

  // Section 02 — split primary buyer from the rest of the roles.
  const [primaryBuyer, ...otherRoles] = brain.buyer_personas;

  return (
    <div className="relative min-h-screen overflow-x-clip text-foreground">
      <ProgressiveBackground />

      {/* scroll container; pb-36 reserves clearance for the floating command dock */}
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 pb-36 sm:px-6 sm:py-8 lg:py-10">
        {/* Background read in flight while the page stays fully usable. */}
        {isRefreshing && (
          <div className="px-1 pb-1 text-[11px] text-muted-foreground">Refreshing…</div>
        )}

        {/* Seller-identity diagnostic. Warns when a hidden legacy flat field
            disagrees with the nested identity generation now uses — the state
            that blocks outreach backend-side. Reads the same profile the page
            already loaded; exposes no raw JSON. */}
        {identityBanner && (
          <div
            role="alert"
            className={
              'mb-4 rounded-lg border px-4 py-3 text-sm ' +
              (identityBanner.tone === 'error'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : identityBanner.tone === 'warning'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'border-border bg-muted/40 text-muted-foreground')
            }
          >
            <div className="font-medium">
              {identityState.status === 'conflict' ? 'Identity conflict' : identityState.status === 'legacy_detected' ? 'Legacy data detected' : 'Identity needs confirmation'}
            </div>
            <div className="mt-0.5">{identityBanner.message}</div>
          </div>
        )}

        {/* compact ICP hero */}
        <IcpHero
          companyName={brain.company.name}
          category={brain.company.category}
          stage={brain.company.stage}
          lastUpdated={lastUpdated}
          onEditSection={(k) => setOpenSection(k)}
          onRestart={() => setRestartOpen(true)}
        />

        {/* vertical intelligence flow */}
        <div className="mt-6 space-y-4 lg:mt-7 lg:space-y-5">
          {/* 01 — Target Market */}
          <IcpSection
            {...FLOW_SECTIONS[0]}
            health={health.targeting}
            index={0}
            justSaved={savedFlash === 'targeting'}
            onEdit={edit('targeting')}
          >
            <div className="space-y-4">
              <PillGroup label="Industries" values={t.industries} tone="emerald" emptyHint="Add target industries so Agentory knows who fits." onAdd={edit('targeting')} />
              <PillGroup label="Business models" values={t.business_models} tone="emerald" emptyHint="Add business models to tighten targeting." onAdd={edit('targeting')} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PillGroup label="Company stage" values={t.funding_stage} tone="emerald" emptyHint="+ Add stage" onAdd={edit('targeting')} />
                <StatementField label="Company size" value={sizeLabel} emptyHint="+ Add company size" onAdd={edit('targeting')} />
              </div>
              <PillGroup label="Geography" values={t.geography} tone="emerald" emptyHint="+ Add geography" onAdd={edit('targeting')} />
              <TextRows label="Must-have company traits" values={t.must_have} emptyHint="Add must-have traits to improve lead qualification." onAdd={edit('targeting')} />
            </div>
          </IcpSection>

          <FlowConnector />

          {/* 02 — Buyer Profile */}
          <IcpSection
            {...FLOW_SECTIONS[1]}
            health={health.buyers}
            index={1}
            justSaved={savedFlash === 'buyers'}
            onEdit={edit('buyers')}
          >
            <div className="space-y-4">
              <StatementField label="Primary buyer" value={primaryBuyer || ''} emptyHint="Add the primary buyer role you sell to." onAdd={edit('buyers')} />
              {otherRoles.length > 0 && (
                <PillGroup label="Other buyer roles" values={otherRoles} tone="neutral" />
              )}
              <TextRows label="Pain points" values={brain.pain_points} emptyHint="Add pain points so drafts speak to real problems." onAdd={edit('buyers')} />
            </div>
          </IcpSection>

          <FlowConnector />

          {/* 03 — Buying Moments */}
          <IcpSection
            {...FLOW_SECTIONS[2]}
            health={health.signals}
            index={2}
            justSaved={savedFlash === 'signals'}
            onEdit={edit('signals')}
          >
            <div className="space-y-4">
              <PillGroup label="Buying signals & triggers" values={brain.triggers} tone="signal" emptyHint="Add buying signals so Scout Radar knows what to watch." onAdd={edit('signals')} />
              <PillGroup label="Jobs or roles to watch" values={brain.jobs_to_watch} tone="signal" emptyHint="+ Add jobs to watch" onAdd={edit('signals')} />
            </div>
          </IcpSection>

          <FlowConnector />

          {/* 04 — Qualification & Safety */}
          <IcpSection
            {...FLOW_SECTIONS[3]}
            health={health.disqualifiers}
            index={3}
            justSaved={savedFlash === 'disqualifiers'}
            onEdit={edit('disqualifiers')}
          >
            <div className="space-y-4">
              <TextRows label="Required evidence" values={brain.qualification_rules.required_evidence} emptyHint="Add required evidence so leads are validated before outreach." onAdd={edit('disqualifiers')} />
              <PillGroup label="Industries to avoid" values={t.disqualifiers.industries} tone="danger" emptyHint="+ Add industries to avoid" onAdd={edit('disqualifiers')} />
              <PillGroup label="Keywords to avoid" values={t.disqualifiers.keywords} tone="danger" emptyHint="+ Add keywords to avoid" onAdd={edit('disqualifiers')} />
              <TextRows label="Reject-if rules" values={brain.qualification_rules.reject_if} emptyHint="Add reject-if rules to auto-disqualify bad fits." onAdd={edit('disqualifiers')} />
            </div>
          </IcpSection>

          <FlowConnector />

          {/* 05 — Messaging Fit */}
          <IcpSection
            {...FLOW_SECTIONS[4]}
            health={health.messaging}
            index={4}
            justSaved={savedFlash === 'messaging'}
            onEdit={edit('messaging')}
          >
            <div className="space-y-4">
              <StatementField label="Positioning promise" value={brain.positioning.promise} emptyHint="Add a positioning promise to anchor every message." onAdd={edit('messaging')} quote />
              <PillGroup label="Content angles" values={brain.content_angles} tone="neutral" emptyHint="+ Add content angles" onAdd={edit('messaging')} />
              <StatementField label="Voice tone" value={brain.brand_voice.tone} emptyHint="+ Add voice tone" onAdd={edit('messaging')} />
              <PillGroup label="Banned claims" values={brain.brand_voice.avoid} tone="warning" emptyHint="Add banned claims to keep generated content on-brand." onAdd={edit('messaging')} />
            </div>
          </IcpSection>
        </div>

        {/* quiet system impact footer */}
        <div className="mt-5 lg:mt-6">
          <SystemImpactFooter />
        </div>
      </div>

      <CompanyBrainEditDrawer
        open={openSection !== null}
        section={openSection}
        brain={brain}
        onOpenChange={(v) => { if (!v) setOpenSection(null); }}
        onSave={(patch) => saveSection(openSection as SectionKey, patch)}
        serverUpdatedAt={data?.onboarding_completed_at ?? null}
      />

      <RestartOnboardingModal
        open={restartOpen}
        onOpenChange={setRestartOpen}
        onConfirm={() => { setRestartOpen(false); navigate('/onboarding/company-brain?restart=1'); }}
      />
    </div>
  );
}

/** Premium signal connector between sections — visible emerald rail with travelling light pulse. */
function FlowConnector() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden className="flex justify-center py-1" style={{ minHeight: '40px' }}>
      <div className="relative flex h-10 flex-col items-center">
        {/* base guide line — wider, more visible */}
        <div
          className="absolute top-0 h-full"
          style={{
            width: '2px',
            background: 'linear-gradient(to bottom, transparent, hsl(160 84% 52% / 0.30), transparent)',
            borderRadius: '1px',
          }}
        />
        {/* outer soft glow around the line */}
        <div
          className="absolute top-0 h-full"
          style={{
            width: '12px',
            background: 'linear-gradient(to bottom, transparent, hsl(160 84% 52% / 0.10), transparent)',
            filter: 'blur(4px)',
          }}
        />
        {/* scroll-reactive travelling light pulse */}
        {!reduce && (
          <motion.div
            className="absolute top-0"
            style={{
              width: '3px',
              background: 'linear-gradient(to bottom, transparent, hsl(160 84% 60% / 0.85), transparent)',
              filter: 'blur(0.5px)',
              borderRadius: '2px',
            }}
            initial={{ opacity: 0, height: '0%', y: '0%' }}
            whileInView={{ opacity: [0, 1, 1, 0], height: ['0%', '100%', '100%', '0%'], y: ['0%', '0%', '0%', '100%'] }}
            viewport={{ once: false, margin: '-30px' }}
            transition={{ duration: 1.8, ease: 'easeInOut', times: [0, 0.3, 0.7, 1] }}
          />
        )}
        {/* glowing diamond node */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          initial={reduce ? false : { scale: 0.5, opacity: 0.3 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: '-30px' }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <div
            className="h-2 w-2 rotate-45 rounded-[2px] border border-emerald-400/50"
            style={{
              background: 'linear-gradient(135deg, hsl(160 84% 52% / 0.7), hsl(160 84% 40% / 0.4))',
              boxShadow: '0 0 10px hsl(160 84% 52% / 0.6), inset 0 0 4px hsl(160 84% 60% / 0.4)',
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}

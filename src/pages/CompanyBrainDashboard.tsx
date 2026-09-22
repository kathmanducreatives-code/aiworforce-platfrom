import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import { BrainOverview } from '@/components/company-brain/BrainOverview';
import { Button } from '@/components/ui/button';
import { deriveSellerIdentityState, sellerIdentityBanner } from '@/lib/companyBrain/sellerIdentityState';
import CompanyBrainEditDrawer, { type SectionKey as DrawerSectionKey } from '@/components/company-brain/CompanyBrainEditDrawer';
import RestartOnboardingModal from '@/components/company-brain/RestartOnboardingModal';

import { mergeProfilePatch, toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';
import { type SectionKey } from '@/lib/companyBrainSections';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { data, loading, isRefreshing, error, refresh } = useCompanyBrain();
  const [openSection, setOpenSection] = useState<DrawerSectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<SectionKey | null>(null);

  const view = useMemo(() => toSavedBrainView(data?.profile as BrainProfile | undefined), [data?.profile]);
  const { brain, raw } = view;

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
        <div className="relative z-10 flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Company Brain…
        </div>
      </div>
    );
  }

  return (
    <div className="relative text-foreground">

      {/* scroll container; pb-36 reserves clearance for the floating command dock */}
      <div className="brain-overview-page relative z-10">
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

        {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm"><span>Company Brain could not refresh. Please try again.</span><Button size="sm" variant="outline" onClick={() => refresh()}>Retry</Button></div>}
        {(!error || data) && <BrainOverview brain={brain} active={!!data?.onboarding_completed} activatedAt={lastUpdated} saved={savedFlash} onEdit={setOpenSection} onRestart={() => setRestartOpen(true)} />}
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useBrainScope } from '@/hooks/useBrainScope';
import { BrainScopeSwitcher } from '@/components/company-brain/BrainScopeSwitcher';
import { saveClientBrainPatch } from '@/lib/brainInvoke';
import { DENIAL_TEXT } from '@/lib/clientBrainApi';
import { brainScopeKey } from '@/lib/brainScope';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import { BrainOverview } from '@/components/company-brain/BrainOverview';
import { Button } from '@/components/ui/button';
import { deriveSellerIdentityState, sellerIdentityBanner } from '@/lib/companyBrain/sellerIdentityState';
import CompanyBrainEditDrawer, { type SectionKey as DrawerSectionKey } from '@/components/company-brain/CompanyBrainEditDrawer';
import RestartOnboardingModal from '@/components/company-brain/RestartOnboardingModal';

import { toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';
import { saveCompanyBrainPatch } from '@/lib/companyBrainSave';
import { type SectionKey } from '@/lib/companyBrainSections';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  // Which Brain: the agency's own, or a client's (Phase 3c, held — off unless
  // VITE_CLIENT_BRAINS is set). Uncertain → the agency Brain.
  const brainScope = useBrainScope();
  const scope = brainScope.scope;
  const { data, loading, isRefreshing, error, denied, refresh } = useCompanyBrain(scope);
  const [openSection, setOpenSection] = useState<DrawerSectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<SectionKey | null>(null);

  // Access to the selected client went away (revoked, archived, signed out):
  // say so and return to the agency Brain. Nothing from that client stays on screen.
  const { accessChanged } = brainScope;
  useEffect(() => {
    if (scope.kind === 'client' && denied) {
      toast.error(DENIAL_TEXT[denied]);
      accessChanged();
    }
  }, [scope, denied, accessChanged]);
  // A half-finished edit belongs to the Brain it was opened on.
  const scopeId = scope.kind === 'client' ? scope.clientId : null;
  // Which Brain, for which signed-in session: a save answered after a switch of
  // client, workspace or user is not applied to what is now on screen.
  const { principal } = useWorkspace();
  const identity = workspaceId && principal ? brainScopeKey(workspaceId, scope, principal) : null;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => { setOpenSection(null); }, [scopeId, workspaceId]);

  const view = useMemo(() => toSavedBrainView(data?.profile as BrainProfile | undefined), [data?.profile]);
  const { brain, raw } = view;

  // Seller-identity state for the diagnostic banner (nested vs hidden legacy flat).
  const identityState = useMemo(() => deriveSellerIdentityState(data?.profile), [data?.profile]);
  const identityBanner = useMemo(() => sellerIdentityBanner(identityState), [identityState]);

  const lastUpdated = data?.onboarding_completed_at
    ? new Date(data.onboarding_completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Edits go through the authorized backend save (the one write path), built on
  // the version this page loaded. A failure throws so the editor keeps the edit.
  async function saveSection(section: SectionKey, patch: BrainProfile) {
    if (!workspaceId) { toast.error('No workspace'); throw new Error('no_workspace'); }
    const savedFor = currentIdentity.current;
    const result = scope.kind === 'client'
      ? await saveClientBrainPatch({ workspaceId, scope, patch, expectedVersion: data?.version ?? null })
      : await saveCompanyBrainPatch({ workspaceId, patch, expectedUpdatedAt: data?.updated_at ?? null });
    if (currentIdentity.current !== savedFor) throw new Error('switched');
    if (!result.ok && 'denied' in result && result.denied) {
      toast.error(result.message ?? 'Access changed');
      accessChanged();
      throw new Error('denied');
    }
    if (!result.ok) {
      toast.error(result.conflict ? 'Company Brain was changed elsewhere' : 'Save failed', { description: result.message });
      if (result.conflict) refresh();
      throw new Error(result.conflict ? 'stale' : 'save_failed');
    }
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
        {(!error || data) && <BrainOverview brain={brain} active={!!data?.onboarding_completed} activatedAt={lastUpdated} saved={savedFlash} onEdit={setOpenSection}
          onRestart={scope.kind === 'agency' ? () => setRestartOpen(true) : undefined}
          clientName={brainScope.currentClient?.name ?? null}
          scopeSwitcher={brainScope.available ? <BrainScopeSwitcher scope={scope} clients={brainScope.clients} onSelect={brainScope.select} disabled={openSection !== null} /> : undefined} />}
      </div>

      <CompanyBrainEditDrawer
        open={openSection !== null}
        section={openSection}
        brain={brain}
        onOpenChange={(v) => { if (!v) setOpenSection(null); }}
        onSave={(patch) => saveSection(openSection as SectionKey, patch)}
        clientId={scopeId}
        serverUpdatedAt={scope.kind === 'client' ? (data?.version == null ? null : String(data.version)) : (data?.updated_at ?? null)}
      />

      <RestartOnboardingModal
        open={restartOpen}
        onOpenChange={setRestartOpen}
        onConfirm={() => { setRestartOpen(false); navigate('/onboarding/company-brain?restart=1'); }}
      />
    </div>
  );
}

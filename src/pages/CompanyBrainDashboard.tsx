import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import { BrainOverview } from '@/components/company-brain/BrainOverview';
import { Button } from '@/components/ui/button';
import { deriveSellerIdentityState, sellerIdentityBanner } from '@/lib/companyBrain/sellerIdentityState';
import CompanyBrainEditDrawer, { type SectionKey as DrawerSectionKey } from '@/components/company-brain/CompanyBrainEditDrawer';
import RestartOnboardingModal from '@/components/company-brain/RestartOnboardingModal';

import { mergeProfilePatch, toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';
import { type SectionKey } from '@/lib/companyBrainSections';
import { buildFieldPatch, type SectionState } from '@/lib/companyBrainPatch';
import { saveCompanyBrainPatch } from '@/lib/companyBrainSave';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { data, loading, isRefreshing, error, refresh } = useCompanyBrain();
  const [openSection, setOpenSection] = useState<DrawerSectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<SectionKey | null>(null);

  const serverView = useMemo(() => toSavedBrainView(data?.profile as BrainProfile | undefined), [data?.profile]);

  // Optimistic profile. Inline edits apply immediately and are written in
  // order through one queue; each write carries every edit before it, so two
  // quick edits never overwrite each other. While writes are pending the page
  // shows this copy; once the queue drains it follows the server again.
  const [optimistic, setOptimistic] = useState<BrainProfile | null>(null);
  const latestRaw = useRef<BrainProfile>(serverView.raw);
  const serverRaw = useRef<BrainProfile>(serverView.raw);
  // The row version the queued saves build on. The server refuses a save whose
  // version is out of date, so a change from another tab, a teammate, onboarding
  // or the Signals radar is never silently overwritten.
  const version = useRef<string | null>(data?.updated_at ?? null);
  const pending = useRef(0);
  const batchFailed = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    serverRaw.current = serverView.raw;
    if (pending.current > 0) return;
    latestRaw.current = serverView.raw;
    version.current = data?.updated_at ?? null;
    setOptimistic(null);
  }, [serverView, data?.updated_at]);

  const view = useMemo(() => (optimistic ? toSavedBrainView(optimistic) : serverView), [optimistic, serverView]);
  const { brain } = view;

  // Seller-identity state for the diagnostic banner (nested vs hidden legacy flat).
  const identityState = useMemo(() => deriveSellerIdentityState(data?.profile), [data?.profile]);
  const identityBanner = useMemo(() => sellerIdentityBanner(identityState), [identityState]);

  const lastUpdated = data?.onboarding_completed_at
    ? new Date(data.onboarding_completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const flash = useCallback((section: SectionKey) => {
    setSavedFlash(section);
    setTimeout(() => setSavedFlash((s) => (s === section ? null : s)), 1600);
  }, []);

  /**
   * Queue one save of `patch`. Resolves false if it did not save.
   *
   * Every save goes through the authorized backend `update` (saveCompanyBrainPatch),
   * never a direct row write: the server merges the PATCH — only the keys this
   * edit touched — keeps the copies agents and lead search read in line, and
   * refuses a save built on an out-of-date version. The page keeps its optimistic
   * copy for display only. Queued saves chain the version each save returns, so
   * this page's own consecutive edits never conflict with each other.
   */
  const writePatch = useCallback((patch: BrainProfile): Promise<boolean> => {
    if (!workspaceId) { toast.error('No workspace'); return Promise.resolve(false); }
    const merged = mergeProfilePatch(latestRaw.current, patch);
    latestRaw.current = merged;
    setOptimistic(merged);
    pending.current += 1;

    const run = queue.current.then(async () => {
      // A save after a failed one was built on top of it — don't save half a batch.
      if (batchFailed.current) return false;
      const result = await saveCompanyBrainPatch({ workspaceId, patch, expectedUpdatedAt: version.current });
      if (!result.ok) {
        batchFailed.current = true;
        toast.error(result.conflict ? 'Company Brain was changed elsewhere' : 'Save failed', { description: result.message });
        return false;
      }
      version.current = result.updatedAt ?? version.current;
      return true;
    }).finally(() => {
      pending.current -= 1;
      if (pending.current === 0) {
        if (batchFailed.current) {
          // Roll the page back to what the server holds.
          batchFailed.current = false;
          latestRaw.current = serverRaw.current;
          setOptimistic(null);
        }
        refresh();
      }
    });
    queue.current = run;
    return run;
  }, [workspaceId, refresh]);

  // The drawer keeps its edit when this throws (see CompanyBrainEditDrawer).
  async function saveSection(section: SectionKey, patch: BrainProfile) {
    if (!(await writePatch(patch))) throw new Error('save_failed');
    toast.success('Section saved');
    flash(section);
  }

  const saveFields = useCallback(async (section: SectionKey, changes: SectionState) => {
    // Built from the latest optimistic profile, not this render's, so an edit
    // made while another is still saving keeps it.
    const ok = await writePatch(buildFieldPatch(section, changes, toSavedBrainView(latestRaw.current).brain));
    if (ok) flash(section);
    return ok;
  }, [writePatch, flash]);

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
        {(!error || data) && <BrainOverview brain={brain} active={!!data?.onboarding_completed} activatedAt={lastUpdated} saved={savedFlash} syncing={isRefreshing} onEdit={setOpenSection} onRestart={() => setRestartOpen(true)} onSaveFields={saveFields} />}
      </div>

      <CompanyBrainEditDrawer
        open={openSection !== null}
        section={openSection}
        brain={brain}
        onOpenChange={(v) => { if (!v) setOpenSection(null); }}
        onSave={(patch) => saveSection(openSection as SectionKey, patch)}
        serverUpdatedAt={data?.updated_at ?? null}
      />

      <RestartOnboardingModal
        open={restartOpen}
        onOpenChange={setRestartOpen}
        onConfirm={() => { setRestartOpen(false); navigate('/onboarding/company-brain?restart=1'); }}
      />
    </div>
  );
}

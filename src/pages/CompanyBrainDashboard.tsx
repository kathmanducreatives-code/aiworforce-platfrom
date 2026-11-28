import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { mergeProfilePatch, toSavedBrainView, type BrainProfile } from '@/lib/companyBrainView';
import { SECTION_META, type SectionKey } from '@/lib/companyBrainSections';
import { buildFieldPatch, type SectionState } from '@/lib/companyBrainPatch';
import { isEmptyBrain } from '@/lib/companyBrainInsights';
import { saveCompanyBrainPatch } from '@/lib/companyBrainSave';
import { describeUnsaved, keepUnsaved, type UnsavedEdit } from '@/lib/companyBrainUnsaved';
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { BrainEditableContext } from '@/components/company-brain/brainEditable';
import { BrainMemoryPanel } from '@/components/company-brain/memory/BrainMemoryPanel';
import { companyBrainWritesBlocked, COMPANY_BRAIN_UNAVAILABLE_MESSAGE, COMPANY_BRAIN_UNAVAILABLE_TITLE } from '@/lib/env/companyBrainAvailability';
import { BrainCompletionPanel, IcpConflictList, type SaveOutcome } from '@/components/company-brain/completion/BrainCompletionPanel';
import { fetchStoredResearch } from '@/lib/companyBrain/researchRuns';
import { assessCompanyBrain, assessIcpConsistency, buildCompletionSuggestions, type AssessmentSectionKey, type ProvenanceClaim, type StoredResearchRun } from '@/lib/companyBrain/completion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchMemorySnapshot } from '@/lib/companyBrain/memoryApi';
import { describeSectionProvenance } from '@/lib/companyBrain/provenanceView';

export default function CompanyBrainDashboard() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  // Which Brain: the agency's own, or a client's (Phase 3c, held — off unless
  // VITE_CLIENT_BRAINS is set). Uncertain → the agency Brain.
  const brainScope = useBrainScope();
  const scope = brainScope.scope;
  const { accessChanged } = brainScope;
  const scopeId = scope.kind === 'client' ? scope.clientId : null;
  // Which Brain, for which signed-in session (CACHE-SESSION): a save answered
  // after a switch of client, workspace or user never moves what is on screen.
  const { principal } = useWorkspace();
  const scopeKey = workspaceId && principal ? brainScopeKey(workspaceId, scope, principal) : null;
  const currentScopeKey = useRef(scopeKey);
  currentScopeKey.current = scopeKey;
  const { data, loading, isRefreshing, error, denied, refresh } = useCompanyBrain(scope);
  // A Brain's version token: updated_at (agency) or the integer version (client).
  const dataVersion = scope.kind === 'client' ? (data?.version == null ? null : String(data.version)) : (data?.updated_at ?? null);
  // Viewers get a read-only page (Phase 3a). The server refuses their writes regardless.
  const { canEditBrain } = useWorkspaceRole();
  // The isolated TEST project refuses every Brain write at the database: the
  // page is read-only there and says why, instead of failing a save as a
  // "conflict" (TEST, 2026-11-12).
  const brainWritesBlocked = companyBrainWritesBlocked(import.meta.env);
  const [openSection, setOpenSection] = useState<DrawerSectionKey | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<SectionKey | null>(null);
  // Inline edits refused because the Brain changed elsewhere, kept so they can be re-applied.
  const [unsaved, setUnsaved] = useState<UnsavedEdit[]>([]);
  const lastFailureWasConflict = useRef(false);

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
  const version = useRef<string | null>(dataVersion);
  const pending = useRef(0);
  const batchFailed = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    serverRaw.current = serverView.raw;
    if (pending.current > 0) return;
    latestRaw.current = serverView.raw;
    version.current = dataVersion;
    setOptimistic(null);
  }, [serverView, dataVersion]);

  // Access to the selected client went away (revoked, archived, signed out):
  // say so and return to the agency Brain. Nothing from that client stays on screen.
  useEffect(() => {
    if (scope.kind === 'client' && denied) {
      toast.error(DENIAL_TEXT[denied]);
      accessChanged();
    }
  }, [scope, denied, accessChanged]);
  // Switching Brain: optimistic copies, refused edits and open editors belong
  // to the Brain they were made on.
  useEffect(() => {
    setOpenSection(null);
    setOptimistic(null);
    setUnsaved([]);
  }, [scopeId, workspaceId]);

  const view = useMemo(() => (optimistic ? toSavedBrainView(optimistic) : serverView), [optimistic, serverView]);
  const { brain } = view;

  // ── Company Brain V2 (B2.0): truthful readiness + guided completion ──────
  // Agency Brain only: client Brains have their own (held) store and save path.
  const [research, setResearch] = useState<StoredResearchRun[]>([]);
  useEffect(() => {
    let live = true;
    setResearch([]);
    if (scope.kind === 'agency' && workspaceId) void fetchStoredResearch(workspaceId).then((r) => { if (live) setResearch(r); });
    return () => { live = false; };
  }, [scope.kind, workspaceId]);
  // B2.1: the ICP copies' disagreements, attached to their sections with one-click resolutions.
  const icpConflicts = useMemo(() => (scope.kind === 'agency' ? assessIcpConsistency(view.raw).conflicts : []), [scope.kind, view.raw]);
  const assessment = useMemo(() => (scope.kind === 'agency' ? assessCompanyBrain(view.raw, { conflicts: icpConflicts }) : null), [scope.kind, view.raw, icpConflicts]);
  const suggestions = useMemo(() => (scope.kind === 'agency' ? buildCompletionSuggestions(view.raw, research) : []), [scope.kind, view.raw, research]);
  // B2.2: "where this came from" per section — the recorded revisions (with their
  // source) and confirmed memory, from the same snapshot the memory panel reads.
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const memoryQ = useQuery({
    queryKey: ['brain-memory', workspaceId],
    queryFn: () => fetchMemorySnapshot(workspaceId as string),
    enabled: scope.kind === 'agency' && !!workspaceId,
    staleTime: 15_000,
    retry: false,
  });
  const provenanceFor = useCallback((section: AssessmentSectionKey) => (memoryQ.data
    ? describeSectionProvenance({ section, revisions: memoryQ.data.revisions, runs: research, memory: memoryQ.data.items, currentUserId: user?.id ?? null })
    : null), [memoryQ.data, research, user?.id]);

  // Seller-identity state for the diagnostic banner (nested vs hidden legacy flat).
  const identityState = useMemo(() => deriveSellerIdentityState(data?.profile), [data?.profile]);
  const identityBanner = useMemo(() => sellerIdentityBanner(identityState), [identityState]);
  // A Brain nobody has started gets a setup prompt, not identity diagnostics.
  const brainEmpty = useMemo(() => isEmptyBrain(brain, !!data?.onboarding_completed), [brain, data?.onboarding_completed]);

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
  // Why the last write did not save, in words, for the inline status (CB-002: a
  // failed save must never look like nothing happened).
  const lastSaveError = useRef<string | null>(null);
  const writePatch = useCallback((patch: BrainProfile, provenance?: ProvenanceClaim): Promise<boolean> => {
    lastSaveError.current = null;
    if (!workspaceId) { lastSaveError.current = 'No workspace is selected. Reload the page.'; toast.error('No workspace'); return Promise.resolve(false); }
    const merged = mergeProfilePatch(latestRaw.current, patch);
    latestRaw.current = merged;
    setOptimistic(merged);
    pending.current += 1;

    // The Brain this edit was made on, fixed NOW — not when the queued save
    // starts. If the user has switched Brain (client, workspace or login) by
    // then, the edit is not sent at all: it must never reach another Brain or
    // build on another Brain's version. (The switch already discarded the
    // optimistic copy.)
    const enqueuedFor = currentScopeKey.current;
    const run = queue.current.then(async () => {
      if (currentScopeKey.current !== enqueuedFor) {
        lastSaveError.current = 'You switched Company Brain (workspace, client or sign-in) before this saved. Nothing was saved.';
        return false;
      }
      // A save after a failed one was built on top of it — don't save half a batch.
      if (batchFailed.current) {
        lastSaveError.current = 'An earlier change did not save, so this one was not sent. Try again.';
        return false;
      }
      const savedFor = enqueuedFor;
      let result: Awaited<ReturnType<typeof saveCompanyBrainPatch>> | Awaited<ReturnType<typeof saveClientBrainPatch>>;
      try {
        result = scope.kind === 'client'
          ? await saveClientBrainPatch({ workspaceId, scope, patch, expectedVersion: version.current === null ? null : Number(version.current) })
          : await saveCompanyBrainPatch({ workspaceId, patch, expectedUpdatedAt: version.current, provenance });
      } catch (e) {
        // A network or runtime error is a failed save like any other: reported, rolled back,
        // and the queue keeps working (CB-002).
        batchFailed.current = true;
        lastSaveError.current = `The save could not reach the server${e instanceof Error && e.message ? ` (${e.message})` : ''}. Check your connection and try again.`;
        toast.error('Save failed', { description: lastSaveError.current });
        return false;
      }
      // The user switched Brain while this was saving: its answer is not this Brain's.
      if (currentScopeKey.current !== savedFor) return result.ok;
      if (!result.ok && 'denied' in result && result.denied) {
        batchFailed.current = true;
        lastSaveError.current = result.message ?? 'Your access to this Company Brain changed.';
        toast.error(result.message ?? 'Access changed');
        accessChanged();
        return false;
      }
      if (!result.ok) {
        batchFailed.current = true;
        lastFailureWasConflict.current = result.conflict === true;
        lastSaveError.current = result.message || 'The server did not save this change.';
        toast.error(
          'unavailable' in result && result.unavailable ? COMPANY_BRAIN_UNAVAILABLE_TITLE : result.conflict ? 'Company Brain was changed elsewhere'
            : 'contradiction' in result && result.contradiction ? 'This change would contradict your ICP' : 'Save failed',
          { description: result.message });
        return false;
      }
      const next = scope.kind === 'client' ? (result as { version?: string }).version : (result as { updatedAt?: string }).updatedAt;
      version.current = next ?? version.current;
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
        // B2.2: the new revision (and its source) is now on record.
        void queryClient.invalidateQueries({ queryKey: ['brain-memory', workspaceId] });
      }
    });
    // CB-002: chain on a promise that never rejects. A rejected link made every later
    // `.then` skip its body, so after one failed request no section could save again
    // (and none said so) until the page was reloaded.
    queue.current = run.catch(() => false);
    return run;
  }, [workspaceId, refresh, scope, accessChanged, queryClient]);

  // A completion save (typed or an accepted suggestion): the same queue and backend `update`.
  // Resolves with WHY it did not save, so the section shows it next to the form.
  const saveCompletion = useCallback(async (patch: BrainProfile, provenance?: ProvenanceClaim): Promise<SaveOutcome> => {
    let ok = false;
    try { ok = await writePatch(patch, provenance); } catch (e) {
      lastSaveError.current = e instanceof Error && e.message ? e.message : 'The save could not reach the server.';
    }
    if (ok) { toast.success('Saved to your Company Brain'); return { ok: true }; }
    return { ok: false, message: lastSaveError.current ?? 'The save did not complete. Try again.' };
  }, [writePatch]);

  // The drawer keeps its edit when this throws (see CompanyBrainEditDrawer).
  async function saveSection(section: SectionKey, patch: BrainProfile) {
    if (!(await writePatch(patch))) throw new Error(lastSaveError.current ?? 'save_failed');
    toast.success('Section saved');
    flash(section);
  }

  const saveFields = useCallback(async (section: SectionKey, changes: SectionState) => {
    // Built from the latest optimistic profile, not this render's, so an edit
    // made while another is still saving keeps it.
    const ok = await writePatch(buildFieldPatch(section, changes, toSavedBrainView(latestRaw.current).brain));
    if (ok) flash(section);
    else if (lastFailureWasConflict.current) setUnsaved((list) => keepUnsaved(list, { section, changes }));
    return ok;
  }, [writePatch, flash]);

  // Re-apply refused edits on top of the latest version: saveFields rebuilds each
  // patch from the current copy, so the other change is kept.
  const reapplyUnsaved = useCallback(async () => {
    const edits = unsaved;
    setUnsaved([]);
    for (const e of edits) await saveFields(e.section, e.changes);
  }, [unsaved, saveFields]);

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
        {identityBanner && !brainEmpty && (
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

        {brainWritesBlocked && (
          <div role="status" data-testid="brain-unavailable" className="mb-4 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm">
            <div className="font-medium text-sky-700 dark:text-sky-300">{COMPANY_BRAIN_UNAVAILABLE_TITLE}</div>
            <div className="mt-0.5 text-muted-foreground">{COMPANY_BRAIN_UNAVAILABLE_MESSAGE}</div>
          </div>
        )}

        {unsaved.length > 0 && (
          <div role="alert" className="brain-unsaved mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <div className="font-medium text-amber-700 dark:text-amber-300">Changed on another tab or device</div>
            <div className="mt-0.5 text-muted-foreground">
              Your edit to {describeUnsaved(unsaved, (k) => SECTION_META[k].title)} wasn&apos;t saved. The page now shows the latest version.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={reapplyUnsaved} disabled={isRefreshing}>Apply my edit again</Button>
              <Button size="sm" variant="ghost" onClick={() => setUnsaved([])}>Discard my edit</Button>
            </div>
          </div>
        )}

        {error && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm"><span>Company Brain could not refresh. Please try again.</span><Button size="sm" variant="outline" onClick={() => refresh()}>Retry</Button></div>}
        {(!error || data) && <BrainEditableContext.Provider value={canEditBrain && !brainWritesBlocked}><BrainOverview brain={brain} active={!!data?.onboarding_completed} activatedAt={lastUpdated} saved={savedFlash} syncing={isRefreshing} onEdit={setOpenSection} onRestart={scope.kind === 'agency' && !brainWritesBlocked ? () => setRestartOpen(true) : undefined} onStartSetup={scope.kind === 'agency' && !brainWritesBlocked ? () => navigate('/onboarding/company-brain') : undefined} onSaveFields={saveFields}
          clientName={brainScope.currentClient?.name ?? null}
          readiness={assessment}
          completion={assessment && (
            <BrainCompletionPanel assessment={assessment} profile={view.raw} suggestions={suggestions}
              canEdit={canEditBrain && !brainWritesBlocked} onSave={saveCompletion}
              onOpenEditor={(section) => setOpenSection(section)}
              provenanceFor={provenanceFor}
              renderConflicts={(section) => (
                <IcpConflictList conflicts={icpConflicts.filter((c) => c.section === section)}
                  canEdit={canEditBrain && !brainWritesBlocked} onSave={saveCompletion} />
              )} />
          )}
          scopeSwitcher={brainScope.available ? <BrainScopeSwitcher scope={scope} clients={brainScope.clients} onSelect={brainScope.select} disabled={openSection !== null} /> : undefined} /></BrainEditableContext.Provider>}
        {/* Company memory: decisions, preferences, approved facts, agent
            suggestions and history. The agency Brain only — client Brains are
            a separate, held feature with their own store. */}
        {scope.kind === 'agency' && workspaceId && <BrainMemoryPanel workspaceId={workspaceId} canEdit={canEditBrain && !brainWritesBlocked} />}
      </div>

      <CompanyBrainEditDrawer
        open={openSection !== null}
        section={openSection}
        brain={brain}
        onOpenChange={(v) => { if (!v) setOpenSection(null); }}
        onSave={(patch) => saveSection(openSection as SectionKey, patch)}
        clientId={scopeId}
        clientName={brainScope.currentClient?.name ?? null}
        serverUpdatedAt={dataVersion}
      />

      <RestartOnboardingModal
        open={restartOpen}
        onOpenChange={setRestartOpen}
        onConfirm={() => { setRestartOpen(false); navigate('/onboarding/company-brain?restart=1'); }}
      />
    </div>
  );
}

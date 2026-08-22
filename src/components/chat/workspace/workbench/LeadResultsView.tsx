import { useEffect, useMemo, useState, useCallback } from 'react';
import { useLeadResults, type LeadTableRow } from '@/hooks/useLeadResults';
import { dispatchResultAction, type LeadResultPanelAction } from '@/lib/chatActions';
import type { LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';
import LeadTable from './leadTable/LeadTable';
import BulkActionToolbar from './leadTable/BulkActionToolbar';
import LeadDetailDrawer from './leadTable/LeadDetailDrawer';
import { estimateCredits, recommendNextAction, isRecommendationDispatchable, ACTION_LABEL } from './leadTable/credits';
import { rowsToCsv, downloadCsv } from './leadTable/csv';
import { Loader2, Filter, Sparkles, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { runLeadAction } from '@/lib/leadActions';
import { LEAD_ACTION_LOADING, workbenchActionToLeadKind, type LeadActionKind } from '@/lib/leadActionRequest';
import { deriveRowAction, rowsForExport, type RowAction } from '@/lib/leadRowAction';
import { emptyBatchTally, formatBatchSummary } from '@/lib/leadActionOutcome';
import {
  emptyAccountView, mergeWorkbenchStage, STAGE_FOR_ACTION,
  type WorkbenchAccountView,
} from '@/lib/workbenchAccountView';
import { buildCompanyResearchView } from '@/lib/companyResearchDisplay';
import { toOutreachStageView } from '@/lib/outreachStageView';
import { hydrateAccountView, applyHydrationFloor, savedIcpFromBrain, hydrateAccountResearchSnapshot } from '@/lib/accountResearchHydration';
import { buildWhyRelevant } from '@/lib/icpSnapshot';
import {
  buildPersonalizationContext, assessOpenerEligibility, brainContextFromProfile,
  buildOutreachRowHint, type OutreachRowHint,
} from '@/lib/outreachOpener';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { buildQuotaProgress } from '@/lib/qualifiedLead/quotaProgress';
import { qualificationFromRow } from '@/lib/qualifiedLead/rowQualification';
import { resolveQualification as qualificationFromRecord } from '@/lib/qualifiedLead/qualification';
import { EMPTY_WORKBENCH_MESSAGE } from '@/lib/workbench/workbenchSession';
import { buildRunSummary } from '@/lib/workbench/runSummary';
import {
  LEAD_TAB_EMPTY, type LeadTabId, notReachedCompanies, partitionLeads, tabsFor,
} from '@/lib/workbench/leadTabs';
import type { PortfolioView } from '@/lib/workbench/portfolioView';
import type { WorkbenchProgress } from '@/lib/workbench/workbenchProgress';
import type { EvaluationRow } from '@/lib/workbench/evaluationRows';
import RunSummaryHero from './RunSummaryHero';
import RunDetails from './RunDetails';

interface Props {
  meta: LeadResultsPanelMeta;
  conversationId: string | null;
  taskId?: string | null;
  /**
   * The run's own projections, passed down rather than rendered as siblings.
   *
   * They used to be three fixed-height strips ABOVE this view, which is what
   * left the leads roughly 180px of an 800px panel. They now feed the one
   * headline and the collapsed Run details, both rendered here.
   */
  portfolio?: PortfolioView | null;
  progress?: WorkbenchProgress | null;
  evaluationRows?: EvaluationRow[];
  /**
   * The two secondary views, built by the panel.
   *
   * Both need the panel's `data`; passing the built elements keeps the leads
   * fetched once. `useLeadResults` holds plain state with no shared cache, so
   * calling it a second time to satisfy a tab would double every query.
   */
  insightsSlot?: React.ReactNode;
  activitySlot?: React.ReactNode;
}

export default function LeadResultsView({
  meta, conversationId, taskId = null,
  portfolio = null, progress = null, evaluationRows = [],
  insightsSlot = null, activitySlot = null,
}: Props) {
  const { closeWorkbench } = useChatWorkspace();
  const { workspaceId } = useWorkspace();
  // THE FULL OWNERSHIP CHAIN, not just the plan id. `meta.plan_id` alone is what
  // let a new conversation display a previous chat's completed run.
  const { items, loading, error, refresh } = useLeadResults({
    workspaceId: workspaceId ?? null,
    conversationId,
    taskId,
    planId: meta.plan_id ?? null,
  });
  const tools = useToolAvailability();
  // Direct lead-action state. Per-row (Part E) is the source of truth; a light
  // global banner is kept for selection/errors only.
  const [directRunning, setDirectRunning] = useState<LeadActionKind | null>(null);
  const [rowActions, setRowActions] = useState<Record<string, RowAction>>({});
  // Account-centric state: one slot PER STAGE per lead. rowActions holds only the
  // latest attempt for progress/banner purposes and must never decide which
  // completed stages still exist.
  const [accountViews, setAccountViews] = useState<Record<string, WorkbenchAccountView>>({});
  const [actionOutcome, setActionOutcome] = useState<{ kind: LeadActionKind; success: boolean; error?: string; summary?: string } | null>(null);
  const [onlyWithWebsite, setOnlyWithWebsite] = useState(false);
  const [minFit, setMinFit] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerRow, setDrawerRow] = useState<LeadTableRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: LeadResultPanelAction; ids: string[]; credits: number } | null>(null);

  // Active workspace Company Brain → saved ICP (never generic defaults).
  const { data: brain } = useCompanyBrain();
  const savedIcp = useMemo(
    () => savedIcpFromBrain((brain as { profile?: unknown } | null)?.profile ?? null),
    [brain],
  );

  // Zero-credit hydration. Seed each loaded account's research + saved-ICP stage
  // from data Agentory ALREADY collected (verified website, company LinkedIn, live
  // job posting, source proof, enrichment summary). Hydration is a FLOOR — an
  // action-updated stage always wins (applyHydrationFloor), so completed
  // intelligence survives every later action and no user is charged to rediscover
  // sources. No provider call, no network, no writes.
  useEffect(() => {
    if (items.length === 0) return;
    setAccountViews((prev) => {
      const next: Record<string, WorkbenchAccountView> = { ...prev };
      for (const r of items) {
        const { view } = hydrateAccountView(r, savedIcp);
        next[r.id] = applyHydrationFloor(view, prev[r.id]);
      }
      return next;
    });
  }, [items, savedIcp]);

  // Per-row personalized-opener hint (pure, zero-credit). Drives the Personalized
  // Message cell: a persisted opener, or a SPECIFIC blocker — never the generic
  // "Complete the required previous step first". Generation itself runs later via
  // run-agent with output_mode: "personalized_opener".
  const outreachHints = useMemo<Record<string, OutreachRowHint>>(() => {
    const brainCtx = brainContextFromProfile((brain as { profile?: unknown } | null)?.profile ?? null);
    const out: Record<string, OutreachRowHint> = {};
    for (const r of items) {
      const view = accountViews[r.id];
      const icpSnap = view?.icp_snapshot ?? null;
      if (!icpSnap) continue;
      const snap = hydrateAccountResearchSnapshot(r);
      const dm = view?.decision_makers.last_success?.primary_decision_maker ?? null;
      const ctx = buildPersonalizationContext({
        snapshot: snap, icp_snapshot: icpSnap, saved_icp: savedIcp, brain: brainCtx,
        decision_maker: dm, why_relevant: buildWhyRelevant(icpSnap),
      });
      const eligibility = assessOpenerEligibility(ctx, icpSnap);
      const persisted = (view?.outreach.last_success as { opener?: string } | null) ?? null;
      out[r.id] = buildOutreachRowHint({ eligibility, persisted: persisted && 'opener' in persisted ? persisted as never : null, source_count: snap.source_count });
    }
    return out;
  }, [items, accountViews, savedIcp, brain]);

  // ── THE TAB THE USER IS ON, AND WHAT IT CONTAINS ───────────────────────
  //
  // One table used to hold everything: a company that qualified, one still
  // waiting on a contact, and one the run never reached, as adjacent rows of
  // equal weight. Separated here, from the states the model already carried.
  const [tab, setTab] = useState<LeadTabId>('qualified');
  const partition = useMemo(
    () => partitionLeads(items.map((r) => ({ ...r, ...qualificationFromRow(r) }))),
    [items],
  );
  const notReached = useMemo(() => notReachedCompanies(evaluationRows), [evaluationRows]);
  const tabs = useMemo(() => tabsFor({
    qualified: partition.qualified.length,
    inReview: partition.inReview.length,
    notReached: notReached.length,
    hasInsights: !!insightsSlot,
  }), [partition, notReached, insightsSlot]);

  // A tab can vanish between renders — `Not reached` disappears once a resumed
  // run finishes it. Falling back to Qualified beats rendering nothing.
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab('qualified');
  }, [tabs, tab]);

  // SELECTION DOES NOT SURVIVE A TAB CHANGE.
  //
  // `selectedRows` is derived from the visible rows, so a selection made on
  // Qualified is already inert on In review — but it is still HELD, and comes
  // back on return. A toolbar reading "3 selected" for rows the user cannot see,
  // or a count that reappears after a detour, is a worse surprise than losing a
  // selection they can remake in one click.
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const tabRows = tab === 'in_review' ? partition.inReview : partition.qualified;

  const filtered = useMemo(() => tabRows.filter((r) => {
    if (onlyWithWebsite && !r.website) return false;
    if (minFit > 0 && (r.fit_score ?? 0) < minFit) return false;
    return true;
  }), [tabRows, onlyWithWebsite, minFit]);

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected],
  );
  const targetRows = selectedRows.length > 0 ? selectedRows : filtered;

  const bulkCredits = useMemo<Record<LeadResultPanelAction, number>>(() => ({
    enrich: estimateCredits('enrich', selectedRows),
    enrich_and_draft: estimateCredits('enrich_and_draft', selectedRows),
    find_contacts: estimateCredits('find_contacts', selectedRows),
    research_company: estimateCredits('research_company', selectedRows),
    draft_outreach: estimateCredits('draft_outreach', selectedRows),
    rank: estimateCredits('rank', selectedRows),
    export_csv: 0,
    save_to_signal_feed: 0,
  }), [selectedRows]);

  const counts = useMemo(() => ({
    found: items.length,
    contactReady: items.filter((r) => r.contact_status !== 'needs_contact').length,
    needContact: items.filter((r) => r.contact_status === 'needs_contact').length,
    enrichable: items.filter((r) => !!r.website && r.enrichment_status !== 'enriched').length,
    draftReady: items.filter((r) => r.draft_status === 'drafted' || r.draft_status === 'approved').length,
  }), [items]);

  // `qualifiedLeadCounts` (buildWorkbenchCounts) lived here and fed the six-chip
  // header. `buildRunSummary` supersedes it: same precedence discipline, but it
  // reconciles the portfolio and stage projections too, which the chips never
  // saw — and it reports the disagreements rather than rendering a fourth
  // opinion beside them.

  // ── THE ONE SET OF HEADLINE NUMBERS ────────────────────────────────────
  //
  // Replaces three counter systems that rendered simultaneously: this view's
  // six chips, PortfolioSummary's eleven cells and WorkflowProgressStrip's
  // seven stage lines. "Qualified" appeared three times across them, from three
  // different persisted projections that nothing ever compared.
  //
  // `buildRunSummary` picks one authority per number and RECORDS every dissent,
  // which `RunDetails` shows. A conflict nobody can see is a conflict that
  // survives.
  const runQuota = useMemo(() => {
    const run = meta.qualified_lead_run;
    if (!run || run.count_entity !== 'contact_ready_lead') return null;
    return buildQuotaProgress({
      requested_leads: run.requested_lead_count ?? null,
      quota_policy: run.quota_policy ?? null,
      terminal_status: run.terminal_status ?? null,
      rounds_completed: run.rounds_completed ?? null,
    }, items.map(qualificationFromRow));
  }, [meta.qualified_lead_run, items]);

  const summary = useMemo(() => {
    const resolved = items.map(qualificationFromRow).map(qualificationFromRecord);
    return buildRunSummary({
      quota: runQuota,
      portfolio,
      progress,
      rows: {
        total: items.length,
        // EXPLICIT POSITIVE VERDICTS ONLY. `level !== 'not_qualified'` once
        // reported 20 qualified for a run that qualified none, because absence
        // of a rejection is not a pass.
        qualified: resolved.filter((q) => q.qualified).length,
        pending: resolved.filter((q) => !q.qualified && q.evaluated).length,
      },
    });
  }, [items, runQuota, portfolio, progress]);

  // The qualification diagnostics were computed here and rendered inline above
  // the table. They are DIAGNOSTIC — read when a number looks wrong — so phase 2
  // moves them to an Insights tab. Both derivations are pure functions of
  // `meta.qualified_lead_run` (`insightsFromResult` / `processingState`) and are
  // recomputed there; keeping a dead copy here would be a second answer waiting
  // to drift from the live one.

  const recommendation = useMemo(() => meta.recommended_next_action
    ? {
        action: (meta.recommended_next_action.action as LeadResultPanelAction) ?? 'find_contacts',
        label: meta.recommended_next_action.label,
        reason: meta.recommended_next_action.reason,
        estimated_credits: meta.recommended_next_action.estimated_credits ?? 0,
      }
    : recommendNextAction(items),
  [items, meta.recommended_next_action]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelected((s) => {
      if (s.size === filtered.length) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  }, [filtered]);

  // Direct lead action → run-agent's lead_action branch with the given existing
  // lead_candidate_ids. Runs ONE company at a time and writes each row's own
  // lifecycle (running → success/empty/insufficient_context/error). The row/
  // drawer — not a chat transcript — is the result surface. NEVER starts Scout
  // sourcing.
  const runDirectLeadAction = useCallback(async (kind: LeadActionKind, rowsArg?: LeadTableRow[]) => {
    if (directRunning) return;
    const rows = rowsArg ?? selectedRows;
    if (rows.length === 0) {
      setActionOutcome({ kind, success: false, error: 'Select one or more Workbench rows first.' });
      return;
    }
    setActionOutcome(null);
    setDirectRunning(kind);
    setRowActions((s) => { const n = { ...s }; for (const r of rows) n[r.id] = { kind, status: 'running' }; return n; });

    // Tally by CATEGORY. A batch of pre-execution rejections must report
    // "4 request errors", not "0/4 succeeded" — the latter falsely implies four
    // leads were examined and none qualified.
    const tally = emptyBatchTally(rows.length);
    for (const r of rows) {
      try {
        const res = await runLeadAction({ leadAction: kind, leadCandidateIds: [r.id], workspaceId, planId: meta.plan_id });
        const p = (res.per_lead && res.per_lead[0]) ? res.per_lead[0] as Record<string, unknown> : {};
        const ra = deriveRowAction(kind, res, p);
        if (ra.status !== 'running') tally[ra.status] += 1;
        setRowActions((s) => ({ ...s, [r.id]: ra }));

        // Stage-aware merge: this updates ONE stage and carries every other
        // completed stage forward. Running Generate outreach can no longer
        // erase the research column.
        const stage = STAGE_FOR_ACTION[kind];
        setAccountViews((prev) => ({
          ...prev,
          [r.id]: mergeWorkbenchStage(prev[r.id] ?? emptyAccountView(r.id), {
            stage,
            lead_candidate_id: r.id,
            status: ra.status,
            reason_code: ra.reason_code,
            message: ra.detail,
            payload: stage === 'company_research'
              ? buildCompanyResearchView(p as never, ra.status === 'succeeded' ? 'succeeded' : 'partial')
              : stage === 'decision_makers'
                ? ra.decisionMakers ?? null
                // The FULL canonical outreach result. This used to be
                // `{ status: ra.status }`, which discarded the generated opener
                // along with its depth, evidence ids and approval state — the
                // row then had a success status and nothing to render.
                : toOutreachStageView({ ...p, status: ra.status, reason_code: ra.reason_code }),
            now: new Date().toISOString(),
          }),
        }));
      } catch (e) {
        // A thrown invoke never reached execution either.
        tally.request_error += 1;
        setRowActions((s) => ({
          ...s,
          [r.id]: { kind, status: 'request_error', detail: e instanceof Error ? e.message : undefined },
        }));
        // A thrown request is an attempt, not a reason to discard prior stages.
        setAccountViews((prev) => ({
          ...prev,
          [r.id]: mergeWorkbenchStage(prev[r.id] ?? emptyAccountView(r.id), {
            stage: STAGE_FOR_ACTION[kind],
            lead_candidate_id: r.id,
            status: 'request_error',
            now: new Date().toISOString(),
          }),
        }));
      }
    }
    setDirectRunning(null);
    setActionOutcome({ kind, success: tally.succeeded > 0, summary: formatBatchSummary(tally) });
    await refresh();
  }, [directRunning, selectedRows, workspaceId, meta.plan_id, refresh]);

  const runAction = useCallback((action: LeadResultPanelAction, rows: LeadTableRow[]) => {
    if (action === 'export_csv') {
      // The run context travels with the export so every row can be traced back
      // to the query, family and quota that produced it.
      downloadCsv(`leads-${meta.plan_id.slice(0, 8)}.csv`, rowsToCsv(rows, meta.qualified_lead_run ?? null));
      return;
    }
    const kind = workbenchActionToLeadKind(action);
    if (kind) { void runDirectLeadAction(kind, rows); return; }   // structured, row-scoped
    // Other actions (rank / save-to-signal-feed / enrich_and_draft) keep the
    // existing credits-confirm + chat path.
    const credits = estimateCredits(action, rows);
    if (credits > 0) {
      setConfirmAction({ action, ids: rows.map((r) => r.id), credits });
      return;
    }
    dispatchResultAction({
      conversationId,
      planId: meta.plan_id,
      leadCandidateIds: rows.map((r) => r.id),
      action,
      estimatedCredits: credits,
    });
  }, [conversationId, meta.plan_id, runDirectLeadAction]);

  // Bulk + recommended actions operate on the SELECTION (empty → clear message,
  // never all rows / a new search). Unlock cells operate on their own row.
  const onBulkAction = useCallback((a: LeadResultPanelAction) => runAction(a, selectedRows), [runAction, selectedRows]);
  const onUnlock = useCallback((a: LeadResultPanelAction, id: string) => {
    const row = items.find((r) => r.id === id);
    if (!row) return;
    runAction(a, [row]);
  }, [runAction, items]);

  // A recommendation whose prerequisite does not exist must not be dispatchable:
  // "Find decision-makers" with no qualified company would spend a paid call
  // searching people at nothing.
  const onRunRecommendation = useCallback(() => {
    if (!isRecommendationDispatchable(recommendation)) return;
    runAction(recommendation.action, selectedRows);
  }, [runAction, recommendation, selectedRows]);

  const confirmAndDispatch = useCallback(() => {
    if (!confirmAction) return;
    dispatchResultAction({
      conversationId,
      planId: meta.plan_id,
      leadCandidateIds: confirmAction.ids,
      action: confirmAction.action,
      estimatedCredits: confirmAction.credits,
      confirmed: true,
    });
    setConfirmAction(null);
  }, [confirmAction, conversationId, meta.plan_id]);

  const isApifyPeopleReady = tools.apify_people?.configured && tools.apify_people?.enabled;
  const isFirecrawlReady = tools.firecrawl?.configured && tools.firecrawl?.enabled;

  return (
    <div className="h-full w-full min-w-0 flex flex-col bg-[#0a0d12] relative overflow-hidden">

      {/* ── THE ANSWER ────────────────────────────────────────────────────
          What stood here: a 13.5px title, a 6-chip counter row (ACCOUNTS
          FOUND / EVALUATED / QUALIFIED COMPANIES / DECISION-MAKERS VERIFIED /
          CONTACT-READY / REMAINING), a filter row, and a dismissible banner
          explaining what Workbench is. The largest text on the page was the
          title; the number the user came for rendered at 11px inside the chip
          row, beside two other components showing their own answer to the same
          question.

          One number, one line of context, one action. The counters live in Run
          details, under the table. */}
      <RunSummaryHero
        summary={summary}
        cta={recommendation ? {
          label: recommendation.label,
          onClick: onRunRecommendation,
          // A recommendation whose prerequisite does not exist must not be
          // dispatchable — the reason is shown rather than the button silently
          // doing nothing.
          disabled: !isRecommendationDispatchable(recommendation),
          hint: isRecommendationDispatchable(recommendation)
            ? undefined : recommendation.reason,
        } : null}
      />

      {/* ── THE TABS ───────────────────────────────────────────────────────
          Qualified is the default and the hero. The counts are on the tabs
          themselves, which is the only place a count belongs now: it labels
          the thing you are about to look at instead of floating above three
          other numbers claiming the same subject. */}
      <div className="px-6 flex items-center gap-1 border-b border-white/[0.06] shrink-0">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-3 py-3 text-[13px] transition-colors ${
                active ? 'text-[#F0F6FC] font-medium' : 'text-[#8b949e] hover:text-[#C9D1D9]'
              }`}
            >
              {t.label}
              {t.count !== null && (
                <span className={`ml-1.5 tabular-nums ${active ? 'text-emerald-300' : 'text-[#6e7681]'}`}>
                  {t.count}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Filters apply to the two lead tabs only — there is nothing to filter
          on a list of companies the run never reached, and offering a control
          that changes nothing is worse than not offering it. */}
      {(tab === 'qualified' || tab === 'in_review') && (
      <div className="px-6 py-2.5 flex items-center gap-1.5 text-[11.5px] border-b border-white/[0.06] shrink-0">
        <Filter className="h-3 w-3 text-[#6e7681]" />
        <button
          onClick={() => setOnlyWithWebsite((v) => !v)}
          className={`px-2.5 py-1 rounded-md border transition-colors ${onlyWithWebsite ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] bg-white/[0.02] text-[#8b949e] hover:text-[#C9D1D9]'}`}
        >
          Has website
        </button>
        {[60, 75, 90].map((v) => (
          <button
            key={v}
            onClick={() => setMinFit(minFit === v ? 0 : v)}
            className={`px-2.5 py-1 rounded-md border transition-colors ${minFit === v ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] bg-white/[0.02] text-[#8b949e] hover:text-[#C9D1D9]'}`}
          >
            Fit {v}+
          </button>
        ))}
      </div>
      )}

      {/* RecommendationBanner removed: the recommendation IS the hero CTA
          above, and rendering both stated one next step twice, in two visual
          languages, 60px apart. QualificationInsightsPanel moves to the
          Insights tab in phase 2 — it is diagnostic, not the answer. */}
      {/* Selection only exists on the lead tabs. */}
      {(tab === 'qualified' || tab === 'in_review') && (
        <BulkActionToolbar
          selectedCount={selectedRows.length}
          onClear={() => setSelected(new Set())}
          onAction={onBulkAction}
          credits={bulkCredits}
        />
      )}

      {actionOutcome && (
        <LeadActionOutcomeCard outcome={actionOutcome} onClose={() => setActionOutcome(null)} />
      )}

      {/* ── SECONDARY TABS ─────────────────────────────────────────────────
          Scrolled, bounded, and outside the lead-table branch entirely, so
          nothing about them can affect the space the leads get. */}
      {tab === 'not_reached' ? (
        <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
          <p className="text-[13px] text-[#8b949e] leading-relaxed mb-4 max-w-xl">
            The run stopped before checking these {notReached.length} companies.
            Resuming picks up exactly here — nothing already paid for is bought
            again.
          </p>
          <ul className="space-y-px">
            {notReached.map((c) => (
              <li
                key={c.company_key}
                className="flex items-baseline justify-between gap-4 py-2.5 border-b border-white/[0.04]"
              >
                <span className="text-[13.5px] text-[#C9D1D9] truncate">{c.company_name}</span>
                <span className="text-[12px] text-[#6e7681] shrink-0 truncate max-w-[45%]">
                  {c.strongest_signal ?? 'Not checked yet'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : tab === 'insights' ? (
        <div className="flex-1 min-h-0 overflow-auto px-6 py-5">{insightsSlot}</div>
      ) : tab === 'activity' ? (
        <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
          {activitySlot ?? (
            <p className="text-[13px] text-[#8b949e]">{LEAD_TAB_EMPTY.activity}</p>
          )}
        </div>
      ) : /* Body — the two lead tabs */
      loading && items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-[#7D8590]">
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading leads…
        </div>
      ) : error ? (
        <div className="m-3 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md p-2">
          {error} <button onClick={refresh} className="underline ml-2">Retry</button>
        </div>
      ) : items.length === 0 ? (
        // THIS WORKFLOW, not "some workflow". The distinction matters: the panel
        // used to show a previous chat's rows here, so an empty current run was
        // indistinguishable from a full one.
        <div className="flex-1 flex items-center justify-center text-[12px] text-[#7D8590]">
          {EMPTY_WORKBENCH_MESSAGE}
        </div>
      ) : tabRows.length === 0 ? (
        // WHAT THE BUCKET MEANS, not that it is empty. "No leads" leaves a
        // reader unable to tell a run that found nothing from a tab that does
        // not apply to their request.
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-[13px] text-[#8b949e] text-center max-w-sm leading-relaxed">
            {LEAD_TAB_EMPTY[tab]}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-8">
          <p className="text-[13px] text-[#8b949e] text-center">
            No {tab === 'qualified' ? 'qualified leads' : 'companies'} match these filters.
          </p>
        </div>
      ) : (
        <LeadTable
          rows={filtered}
          selected={selected}
          rowActions={rowActions}
          accountViews={accountViews}
          outreachHints={outreachHints}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onOpen={setDrawerRow}
          onUnlock={onUnlock}
        />
      )}

      {/* Obvious Action Buttons Group */}
      <div className="px-4 py-3 bg-[#0a0d12]/60 border-t border-white/[0.05] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runDirectLeadAction('find_decision_makers')}
            disabled={directRunning !== null || selectedRows.length === 0}
            className={`h-8 px-3 rounded text-[11.5px] font-semibold flex items-center gap-1.5 transition-colors ${
              directRunning !== null || selectedRows.length === 0
                ? 'border border-white/5 bg-white/[0.01] text-neutral-500 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_12px_rgba(16,185,129,0.15)]'
            }`}
            title={selectedRows.length === 0 ? 'Select at least one lead' : isApifyPeopleReady ? 'Find decision-makers for the selected lead(s)' : 'Uses job-poster hints; enable Apify for deeper people search'}
          >
            {directRunning === 'find_decision_makers'
              ? <><Loader2 className="h-3 w-3 animate-spin" /> {LEAD_ACTION_LOADING.find_decision_makers}</>
              : 'Find decision-makers'}
          </button>

          <button
            onClick={() => runDirectLeadAction('research_company')}
            disabled={directRunning !== null || selectedRows.length === 0 || !isFirecrawlReady}
            className={`h-8 px-3 rounded text-[11.5px] font-semibold flex items-center gap-1.5 transition-colors ${
              !isFirecrawlReady
                ? 'border border-dashed border-amber-500/30 bg-amber-500/5 text-amber-400 cursor-not-allowed'
                : directRunning !== null || selectedRows.length === 0
                ? 'border border-white/5 bg-white/[0.01] text-neutral-500 cursor-not-allowed'
                : 'border border-emerald-500/30 hover:border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-300'
            }`}
            title={!isFirecrawlReady ? 'Setup needed: Firecrawl' : selectedRows.length === 0 ? 'Select at least one lead' : 'Research the selected compan(y/ies)'}
          >
            {directRunning === 'research_company'
              ? <><Loader2 className="h-3 w-3 animate-spin" /> {LEAD_ACTION_LOADING.research_company}</>
              : <>Research company {!isFirecrawlReady && '(Setup needed)'}</>}
          </button>

          <button
            onClick={() => runDirectLeadAction('generate_outreach')}
            disabled={directRunning !== null || selectedRows.length === 0}
            className={`h-8 px-3 rounded text-[11.5px] font-semibold flex items-center gap-1.5 transition-colors ${
              directRunning !== null || selectedRows.length === 0
                ? 'border border-white/5 bg-white/[0.01] text-neutral-500 cursor-not-allowed'
                : 'border border-emerald-500/30 hover:border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-300'
            }`}
            title={selectedRows.length === 0 ? 'Select at least one lead' : 'Prepare an approval-only outreach draft'}
          >
            {directRunning === 'generate_outreach'
              ? <><Loader2 className="h-3 w-3 animate-spin" /> {LEAD_ACTION_LOADING.generate_outreach}</>
              : 'Generate outreach'}
          </button>

          <button
            onClick={() => runAction('export_csv', rowsForExport(selectedRows, filtered))}
            className="h-8 px-3 rounded border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04] text-[11.5px] font-semibold text-neutral-300 transition-colors"
          >
            Export CSV{selectedRows.length ? ` (${selectedRows.length})` : ''}
          </button>
        </div>

        <button
          onClick={() => closeWorkbench()}
          className="h-8 px-4 rounded border border-white/10 hover:bg-white/[0.05] text-[11.5px] font-semibold text-neutral-300 transition-colors"
        >
          Done
        </button>
      </div>

      {/* ── EVERYTHING TRUE BUT NOT THE POINT ──────────────────────────────
          The stage counts, the grading breakdown and the reviewed-but-not-
          selected companies. All three used to render above the table (and the
          last of them at `max-h-[45%]` below it), which is what left the leads
          roughly 180px of an 800px panel. */}
      <RunDetails
        summary={summary}
        portfolio={portfolio}
        progress={progress}
        evaluationRows={evaluationRows}
      />

      {/* Footer note. "Agentory credits estimated locally" was dropped — an
          implementation detail no reader can act on. The approval promise
          stays, because it is a commitment about their data. */}
      <div className="border-t border-white/[0.06] px-6 py-2 text-[11.5px] text-[#6e7681]">
        {filtered.length} of {items.length} shown · drafts always need your approval
      </div>

      <LeadDetailDrawer row={drawerRow ? (items.find((r) => r.id === drawerRow.id) ?? drawerRow) : null} onClose={() => setDrawerRow(null)} />

      {confirmAction && (
        <ConfirmDialog
          action={confirmAction.action}
          rows={confirmAction.ids.length}
          credits={confirmAction.credits}
          onCancel={() => setConfirmAction(null)}
          onConfirm={confirmAndDispatch}
        />
      )}
    </div>
  );
}

// Lightweight global banner. Per-row status cells are the source of truth; this
// only reports the selection error or a one-line "N/M succeeded — see each row".
function LeadActionOutcomeCard({ outcome, onClose }: { outcome: { kind: LeadActionKind; success: boolean; error?: string; summary?: string }; onClose: () => void }) {
  const ok = outcome.success && !outcome.error;
  const title = outcome.kind === 'research_company' ? 'Company research'
    : outcome.kind === 'find_decision_makers' ? 'Decision-makers' : 'Outreach draft';
  return (
    <div className={`mx-4 mt-2 mb-1 rounded-lg border p-2.5 text-[12px] relative ${ok ? 'border-emerald-500/25 bg-emerald-500/[0.05] text-[#C9D1D9]' : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200'}`}>
      <button onClick={onClose} className="absolute top-2 right-2 text-[#7D8590] hover:text-[#C9D1D9]"><X className="h-3.5 w-3.5" /></button>
      <div className="flex items-center gap-1.5 font-semibold pr-6">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
        {title}
      </div>
      <div className="mt-0.5 text-[#9aa4af]">{outcome.error ?? outcome.summary}</div>
    </div>
  );
}


function getActionDescription(action: LeadResultPanelAction, rows: number): string {
  switch (action) {
    case 'find_contacts':
      return `Scout will search decision-makers for ${rows} account rows.`;
    case 'research_company':
    case 'enrich':
      return `Hawk will enrich company context for ${rows} account ${rows === 1 ? 'row' : 'rows'}.`;
    case 'draft_outreach':
      return `Penn will draft outreach sequences for ${rows} account ${rows === 1 ? 'row' : 'rows'}.`;
    case 'enrich_and_draft':
      return `Hawk and Penn will enrich and draft outreach for ${rows} account ${rows === 1 ? 'row' : 'rows'}.`;
    case 'rank':
      return `Aria will rank ${rows} account ${rows === 1 ? 'row' : 'rows'} against your ICP.`;
    default:
      return `${action.replace(/_/g, ' ')} will run for ${rows} account ${rows === 1 ? 'row' : 'rows'}.`;
  }
}

function getActionAgentTeam(action: LeadResultPanelAction): string[] {
  switch (action) {
    case 'find_contacts': return ['pilot', 'scout'];
    case 'research_company':
    case 'enrich': return ['pilot', 'hawk'];
    case 'draft_outreach': return ['pilot', 'penn'];
    case 'enrich_and_draft': return ['pilot', 'hawk', 'penn'];
    case 'rank': return ['pilot', 'aria'];
    default: return ['pilot'];
  }
}

function getActionLabel(action: LeadResultPanelAction): string {
  switch (action) {
    case 'find_contacts': return 'Find decision-makers';
    case 'research_company':
    case 'enrich': return 'Enrich companies';
    case 'draft_outreach': return 'Draft outreach';
    case 'enrich_and_draft': return 'Enrich & draft outreach';
    case 'rank': return 'Rank against ICP';
    default: return action.replace(/_/g, ' ');
  }
}

function getActionOutputDescription(action: LeadResultPanelAction): string {
  switch (action) {
    case 'find_contacts':
      return 'Decision-maker contacts in Workbench';
    case 'research_company':
    case 'enrich':
      return 'Company details and context in Workbench';
    case 'draft_outreach':
      return 'Outreach drafts in Awaiting You';
    case 'enrich_and_draft':
      return 'Company context in Workbench and drafts in Awaiting You';
    case 'rank':
      return 'ICP rank scores in Workbench';
    default:
      return 'Structured workspace output';
  }
}

function ConfirmDialog({ action, rows, credits, onCancel, onConfirm }: { action: LeadResultPanelAction; rows: number; credits: number; onCancel: () => void; onConfirm: () => void }) {
  const desc = getActionDescription(action, rows);
  const team = getActionAgentTeam(action);
  const label = getActionLabel(action);
  const outputDesc = getActionOutputDescription(action);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/60 pointer-events-auto backdrop-blur-[2px]" onClick={onCancel} aria-hidden />
      <div className="relative pointer-events-auto w-[400px] max-w-[calc(100%-32px)] rounded-xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.04] to-[#0a0d12] shadow-2xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
        {/* Header */}
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-emerald-400/80 mb-0.5">
          Next step ready
        </div>
        <h4 className="text-[16px] font-bold text-white tracking-tight">{label}</h4>

        <div className="mt-3.5 space-y-3">
          {/* Task description */}
          <div>
            <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider">Task:</div>
            <p className="text-[13px] text-[#C9D1D9] mt-0.5 leading-relaxed">{desc}</p>
          </div>

          {/* Agent team */}
          <div>
            <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider mb-1">Agent team:</div>
            <div className="flex items-center gap-1.5 text-[12.5px] text-[#C9D1D9] font-semibold bg-white/[0.02] border border-white/[0.06] rounded-lg p-2">
              {team.map((slug, idx) => (
                <div key={slug} className="flex items-center gap-1.5">
                  <span className="text-[#C9D1D9] capitalize">{slug}</span>
                  {idx < team.length - 1 && (
                    <span className="text-neutral-600 text-[10px]">→</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Expected Output */}
          <div>
            <div className="text-[11px] font-mono text-[#7D8590] uppercase tracking-wider">Expected Output:</div>
            <p className="text-[12.5px] text-[#C9D1D9] mt-0.5 leading-relaxed">{outputDesc}</p>
          </div>

          {/* Footer */}
          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[12px]">
            <div className="text-[#7D8590]">
              Estimated: <span className="font-mono text-emerald-300">~{credits} credits</span>
            </div>
            <div className="flex items-center gap-1 text-[#7D8590]">
              <svg className="h-3.5 w-3.5 text-emerald-400/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              Nothing will be sent
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onConfirm}
              className="flex items-center gap-1.5 text-[13px] font-bold px-4 py-2 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 transition-colors shadow-[0_0_16px_rgba(16,185,129,0.15)]"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Start
            </button>
            <button
              onClick={onCancel}
              className="text-[13px] px-3 py-2 rounded-lg text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

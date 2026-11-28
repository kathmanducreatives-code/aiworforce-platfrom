// The `lead-pipeline` edge function's logic, every dependency injected.
//
//   plan  {workspace_id, icp, walk_id, overrides?}
//         Member. Dry run: the LeadOcean plan for the ICP (narrowed, with the
//         walk's excludeIds), its hash, and the exact worst case the proposed
//         ceilings allow. Nothing is bought.
//   run   {workspace_id, icp, walk_id, approval: {plan_hash, leadocean_records,
//         canonical_max_usd, signals_max_usd, phone_lookups}}
//         Owner/admin. Re-plans; the approval must name that plan's hash and
//         cover its LeadOcean estimate; each other ceiling is what that step may
//         spend (0 or absent = the step does not run). Writes eligible and
//         pending leads to the Leads tables; existing Leads are updated, never
//         re-created. Sends nothing, calls no one.
//
// Off (404) unless LEAD_PIPELINE_ENABLED and the workspace is in
// LEAD_PIPELINE_WORKSPACES, and LeadOcean is enabled for provider discovery
// (PROVIDER_LEADOCEAN_ENABLED + commercial terms) — the same connection, key
// vault and usage ledger. Company Brain is neither read nor written.

import { classifyConstraints, REQUIREMENT_VOCABULARY_VERSION } from "../requirementVocabulary.ts";
import type { PlanReplay, PlanSigner, PlanTokenPayload } from "./planToken.ts";
import { expandIndustries, flexibleMatches, flexibleOutcome, readIndustryMap, relaxForFlexible, requestedIndustries, type DiscoveryMode, type IndustryMap } from "./flexibleDiscovery.ts";
import { activeMissionContract } from "../missionInterpretationContract.ts";
import { understandingOf } from "../missionUnderstanding.ts";
import { summarizeProviderRun } from "./providerRunSummary.ts";
import { criteriaFreezeState } from "../missionCriteriaReader.ts";
import { approvability, contractHash, disclosures, MISSION_CONTRACT_VERSION, type MissionContract } from "../missionContract/contract.ts";
import { missionOutcome } from "./outcome.ts";
import { legacyWorkspaceExclusions } from "./workspaceExclusions.ts";
import { planProvenance } from "./provenance.ts";
import type { ContractBrainInput } from "../missionContract/brain.ts";
import type { PersistResult } from "./persistRows.ts";
import { checkApproved, checkCompiled, checkPlanRequirements, checkVerdicts, requirementVerdicts, type InvariantViolation } from "../missionContract/invariants.ts";

/** What the running service used to read this mission — for review and the TEST smoke (P8). */
export function understandingReport(mission: unknown, contract: string) {
  const u = understandingOf(mission);
  return {
    contract,
    version: u?.version ?? null,
    roles: u?.roles.length ?? 0, places: u?.places.length ?? 0, signals: u?.signals.length ?? 0,
    rejected: u?.rejected.length ?? 0, ambiguities: u?.ambiguities.length ?? 0,
    freeze: criteriaFreezeState(mission as never),
  };
}
import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { AdapterDeps, DiscoveryAdapter } from "../discoveryProviders/adapter.ts";
import type { DiscoveryApproval, UsageLedger } from "../discoveryProviders/budget.ts";
import type { ConnectionStore } from "../discoveryProviders/connections.ts";
import type { DiscoveryFlags, Env } from "../discoveryProviders/flags.ts";
import type { ProviderConnectionState } from "../discoveryProviders/routing.ts";
import type { CheckpointStore } from "./checkpoint.ts";
import { RunPending, spendBasis } from "./apifyRuns.ts";
import { ExclusionIndex, type ExistingRecord } from "./exclusions.ts";
import { configureIcp, ICPS, type IcpConfig, type IcpId } from "./icp.ts";
import { runLeadPipeline, worstCase, type PipelineApprovals, type PipelineLead, type PipelineRun } from "./pipeline.ts";
import { projectPipelineLead, type PipelineRow } from "./projection.ts";
import type { GenerateJsonFn } from "../intelligence/plannerWrapper.ts";
import type { ProviderId } from "../discoveryProviders/types.ts";
import { runDiscoveryStrategy, type StrategyRun, type StrategyRunInput } from "./multiProvider.ts";
import { adviseStrategy, isStrategy, planStrategy, specFromMission, type DiscoveryStrategyId, type StrategyContext, type StrategyPlan } from "./strategy.ts";

const on = (v: string | undefined) => !!v && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

export interface PipelineFlags { enabled: boolean; workspaces: Set<string>; signals: boolean; phones: boolean; strictRequirements?: boolean; companySearch?: boolean }
export function readPipelineFlags(env: Env): PipelineFlags {
  return {
    enabled: on(env("LEAD_PIPELINE_ENABLED")),
    workspaces: new Set((env("LEAD_PIPELINE_WORKSPACES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    // Unfinished-in-production steps have their own switches, off by default.
    signals: on(env("LEAD_PIPELINE_SIGNALS_ENABLED")),
    phones: on(env("LEAD_PIPELINE_PHONES_ENABLED")),
    // Option E Stage 6: refuse a model-invented requirement outside the closed vocabulary.
    // Off by default; until it is on, the plan only REPORTS what it would refuse.
    strictRequirements: on(env("LEAD_STRICT_REQUIREMENTS_ENABLED")),
    // Company-first discovery (harvestapi/linkedin-company-search). Off by default: until an
    // owner turns it on, a request with no hiring or post signal is refused exactly as before.
    companySearch: on(env("LEAD_PIPELINE_COMPANY_SEARCH")),
  };
}

export interface PipelineRequest {
  action: "plan" | "run";
  workspaceId: string;
  icpId: IcpId;
  walkId: string;
  overrides: Partial<Pick<IcpConfig, "requestedCount">> & { hasPhone?: boolean };
  approval: { planHash: string; leadoceanRecords: number; canonicalMaxUsd: number; signalsMaxUsd: number; phoneLookups: number } | null;
}

const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

export function parsePipelineRequest(b: Record<string, unknown>): PipelineRequest | null {
  if (b.action !== "plan" && b.action !== "run") return null;
  if (typeof b.workspace_id !== "string" || typeof b.walk_id !== "string" || !/^[a-z0-9:_-]{1,120}$/i.test(b.walk_id)) return null;
  if (b.icp !== "icp_a_b2b_saas" && b.icp !== "icp_b_agency") return null;
  const o = (b.overrides ?? {}) as Record<string, unknown>;
  const count = o.requested_count === undefined ? undefined : num(o.requested_count, 100);
  if (count === null || (count !== undefined && count < 1)) return null;
  const a = b.approval as Record<string, unknown> | null | undefined;
  let approval: PipelineRequest["approval"] = null;
  if (a) {
    const lo = num(a.leadocean_records, 500), c = num(a.canonical_max_usd ?? 0, 5), s = num(a.signals_max_usd ?? 0, 5), p = num(a.phone_lookups ?? 0, 200);
    if (typeof a.plan_hash !== "string" || lo === null || c === null || s === null || p === null || !Number.isInteger(lo) || !Number.isInteger(p)) return null;
    approval = { planHash: a.plan_hash, leadoceanRecords: lo, canonicalMaxUsd: c, signalsMaxUsd: s, phoneLookups: p };
  }
  return { action: b.action, workspaceId: b.workspace_id, icpId: b.icp, walkId: b.walk_id, overrides: { ...(count ? { requestedCount: count } : {}), ...(o.has_phone === true ? { hasPhone: true } : {}) }, approval };
}

export interface PipelineDeps {
  userId: string | null;
  flags: PipelineFlags;
  discoveryFlags: DiscoveryFlags;
  store: ConnectionStore;
  ledger: UsageLedger;
  checkpoints: CheckpointStore;
  loadExisting(workspaceId: string): Promise<ExistingRecord[]>;
  leadoceanFor(apiKey: string): { adapter: DiscoveryAdapter; deps: AdapterDeps };
  /** The Apify invoker when this deployment holds an Apify token; null = canonical and signals unavailable. */
  apify: ActorInvoker | null;
  /** Writes the rows; returns what was written (persistRows.ts) when the store reports it. */
  persist(rows: PipelineRow[], contactValuesWritten: number): Promise<PersistResult | void>;
  /** Per-workspace company-record cache; null unless DISCOVERY_EVIDENCE_CACHE_ENABLED (needs held migration 20261101120000). */
  evidenceCache?: import("./evidenceCache.ts").EvidenceCache | null;
  now?: () => Date;
}

/** Rejected companies, for the user: who was ruled out and why (bounded; no provider payloads). */
export function rejectedSummary(excluded: readonly PipelineLead[], max = 50) {
  return excluded.slice(0, max).map((l) => {
    const checks = ((l.qualification?.checks ?? []) as { result?: string; reason?: string }[]).filter((c) => c.result === "fail").map((c) => String(c.reason ?? ""));
    const reasons = [...checks, ...(l.screeningReasons ?? []), ...(l.rank?.explanation ? [l.rank.explanation] : [])].filter(Boolean);
    return { leadKey: l.leadKey, name: l.company?.name ?? null, domain: l.company?.domain ?? null, linkedinUrl: l.company?.linkedinUrl ?? null,
      reasons: [...new Set(reasons)].slice(0, 4) };
  });
}

/**
 * What saving did to the run's status. persistRows reports per-row failures instead of
 * throwing; ignoring them made a run that saved NOTHING report "completed". All rows
 * failed → "failed"; some → "partial"; the response always carries the failures.
 */
export function saveOutcome(runStatus: string, runReason: string | null, persisted: PersistResult | void, attempted: number) {
  const failed = persisted ? persisted.failed : 0;
  const written = persisted ? persisted.written + persisted.updated : attempted;
  if (!failed) return { status: runStatus, reason: runReason, written, failed: 0 };
  const all = failed >= attempted;
  return {
    status: all ? "failed" : runStatus === "completed" ? "partial" : runStatus,
    reason: all ? `none of the ${attempted} result(s) could be saved` : `${failed} of ${attempted} result(s) could not be saved${runReason ? `; ${runReason}` : ""}`,
    written, failed,
  };
}

const ADMIN = new Set(["owner", "admin"]);
const SIGNAL_PLAN = { collect: { companyPosts: true, jobs: true, founderPosts: false }, maxPostsPerSubject: 5, maxJobsPerCompany: 5, windowDays: 60 };

export async function handleLeadPipeline(req: PipelineRequest, d: PipelineDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = d.now ?? (() => new Date());
  if (!d.flags.enabled) return { status: 404, body: { error: "disabled" } };
  if (!d.userId) return { status: 401, body: { error: "sign in required" } };
  if (!d.flags.workspaces.has(req.workspaceId)) return { status: 403, body: { error: "the lead pipeline is not enabled for this workspace" } };
  const role = await d.store.memberRole(d.userId, req.workspaceId);
  if (!role) return { status: 403, body: { error: "not a member of this workspace" } };
  if (req.action === "run" && !ADMIN.has(role)) return { status: 403, body: { error: "only a workspace owner or admin can approve a paid run" } };

  const icp = configureIcp(ICPS[req.icpId], { ...(req.overrides.requestedCount ? { requestedCount: req.overrides.requestedCount } : {}), ...(req.overrides.hasPhone ? { leadocean: { ...ICPS[req.icpId].leadocean, hasPhone: true } } : {}) });
  const row = (await d.store.list(req.workspaceId)).find((x) => x.provider === "leadocean");
  const connections: ProviderConnectionState[] = [{
    provider: "leadocean", connected: row?.status === "connected", enabled: d.discoveryFlags.enabled && d.discoveryFlags.provider.leadocean,
    commercialTermsConfirmed: d.discoveryFlags.commercialTerms.leadocean, remainingCredits: row?.usage?.remaining ?? null,
    recentFailures: row && row.status !== "connected" ? 1 : 0, restrictions: row?.usage?.restrictions ?? [],
  }];
  const key = req.action === "run" ? await d.store.secret(req.workspaceId, "leadocean") : null;
  const lo = key ? d.leadoceanFor(key) : null;
  const a = req.approval;
  const approvals: PipelineApprovals = {
    discovery: null,
    canonicalMaxUsd: a && a.canonicalMaxUsd > 0 ? a.canonicalMaxUsd : null,
    signals: a && a.signalsMaxUsd > 0 && d.flags.signals ? { ...SIGNAL_PLAN, maxUsd: a.signalsMaxUsd } : null,
    phoneLookups: a && a.phoneLookups > 0 && d.flags.phones ? { maxLookups: a.phoneLookups, approvedBy: d.userId, approvedAt: now().toISOString() } : null,
  };
  const base = {
    workspaceId: req.workspaceId, walkId: req.walkId, icp, connections, approvals,
    leadocean: lo?.adapter ?? null, leadoceanDeps: lo?.deps ?? null, apify: d.apify, ledger: d.ledger, checkpoints: d.checkpoints,
    existing: new ExclusionIndex(req.action === "run" ? await d.loadExisting(req.workspaceId) : [], now), now,
    evidenceCache: d.evidenceCache ?? null,
  };
  const dry = await runLeadPipeline({ ...base, dryRun: true });
  if (req.action === "plan" || dry.status === "blocked") {
    return { status: dry.status === "blocked" ? 409 : 200, body: { status: dry.status, reason: dry.reason, plan: dry.plan, checkpoint: dry.checkpoint,
      worstCase: worstCase(dry.plan, { ...approvals, canonicalMaxUsd: approvals.canonicalMaxUsd ?? 0 }) } };
  }
  if (!a) return { status: 400, body: { error: "a run needs an approval" } };
  const est = dry.plan.estimatedCredits.leadocean ?? 0;
  if (a.planHash !== dry.plan.planHash) return { status: 409, body: { error: "plan changed since it was approved", plan: dry.plan } };
  if (a.leadoceanRecords < est) return { status: 409, body: { error: `approval covers ${a.leadoceanRecords} LeadOcean records; the plan needs up to ${est}` } };
  const discovery: DiscoveryApproval = { kind: "discovery", workspaceId: req.workspaceId, missionId: `lp:${req.walkId}:r${dry.checkpoint.recordsBought}`,
    planHash: a.planHash, maxCredits: { leadocean: est }, approvedBy: d.userId, approvedAt: now().toISOString() };
  const run: PipelineRun = await runLeadPipeline({ ...base, approvals: { ...approvals, discovery } });
  if (run.status === "blocked") return { status: 409, body: { error: run.reason } };
  const rows = [...run.queue, ...run.review].map((l) => projectPipelineLead(l, { workspaceId: req.workspaceId, values: run.contactValues })).filter((x): x is PipelineRow => !!x);
  const persistedRows = await d.persist(rows, rows.filter((r) => r.contact?.phone).length);
  const saved = saveOutcome(run.status, run.reason ?? null, persistedRows, rows.length);
  return {
    status: 200,
    body: {
      status: saved.status, reason: saved.reason, spend: run.spend, funnel: run.funnel, yield: run.yield, estimates: run.estimates,
      discovery: run.discovery, canonical: run.canonical, signals: run.signals && { spentUsd: run.signals.spentUsd, stopped: run.signals.stopped }, phones: run.phones,
      queue: run.queue, review: run.review, excludedCount: run.excluded.length, written: saved.written,
      ...(persistedRows ? { persistence: { inserted: persistedRows.written, updated: persistedRows.updated, failed: persistedRows.failed, failures: persistedRows.rows.filter((x) => x.action === "failed") } } : {}),
    },
  };
}

// ── Multi-provider strategy (strategy.ts / multiProvider.ts) ────────────────
//
//   strategy_plan  {workspace_id, query, walk_id, requested_count?, strategy?, exclude_providers?,
//                   allow_review_only?, max_leadocean_records?, max_apify_usd?}
//                  Member. GPT interprets the request (the mission compiler), the
//                  planner judges every strategy, GPT may pick among the feasible
//                  ones. Returns the plan and its hash. No provider is called.
//   strategy_run   the same, plus approval {plan_hash, leadocean_records, apify_usd}.
//                  Owner/admin. Re-interprets and re-plans; the approval must name
//                  that plan's hash (a re-interpretation that changes the plan is
//                  refused, never run) and cover its worst case. Writes eligible and
//                  pending leads; never looks up a phone; sends nothing.
//
// Same switches as the ICP walk (LEAD_PIPELINE_ENABLED + workspace allowlist),
// plus each provider's own flag: LeadOcean via PROVIDER_LEADOCEAN_ENABLED and
// its commercial terms, Apify discovery via PROVIDER_APIFY_DISCOVERY_ENABLED and
// a deployment token. Apollo is never planned (APOLLO_ACCESS_VALIDATED).


export interface StrategyRequest {
  action: "strategy_plan" | "strategy_run";
  workspaceId: string;
  walkId: string;
  query: string;
  requestedCount: number | null;
  user: StrategyContext["user"];
  budget: StrategyContext["budget"];
  /**
   * G3: the most the whole discovery may cost in USD (optional). Today only Apify is priced in
   * USD — LeadOcean is billed in records with no USD price (Free plan) and keeps its own record
   * limit — so it caps the Apify ceiling: effective max_apify_usd = min(max_apify_usd, this).
   */
  totalUsd?: number | null;
  approval: { planHash: string; leadoceanRecords: number; apifyUsd: number; token: string | null } | null;
  /** FLEXIBLE DISCOVERY (flexibleDiscovery.ts): the user's choice; absent = strict, unchanged. */
  mode?: DiscoveryMode;
}

const PROVIDER_NAMES: readonly ProviderId[] = ["leadocean", "apify", "apollo"];

export function parseStrategyRequest(b: Record<string, unknown>): StrategyRequest | null {
  if (b.action !== "strategy_plan" && b.action !== "strategy_run") return null;
  if (typeof b.workspace_id !== "string" || typeof b.walk_id !== "string" || !/^[a-z0-9:_-]{1,120}$/i.test(b.walk_id)) return null;
  if (typeof b.query !== "string" || !b.query.trim() || b.query.length > 2000) return null;
  const count = b.requested_count === undefined ? null : num(b.requested_count, 100);
  if (b.requested_count !== undefined && (count === null || count < 1 || !Number.isInteger(count))) return null;
  if (b.strategy !== undefined && !isStrategy(b.strategy)) return null;
  const exclude = b.exclude_providers === undefined ? [] : b.exclude_providers;
  if (!Array.isArray(exclude) || !exclude.every((p) => PROVIDER_NAMES.includes(p as ProviderId))) return null;
  const maxLo = b.max_leadocean_records === undefined ? 50 : num(b.max_leadocean_records, 500);
  const maxUsd = b.max_apify_usd === undefined ? 0.25 : num(b.max_apify_usd, 5);
  if (maxLo === null || maxUsd === null || !Number.isInteger(maxLo)) return null;
  const total = b.max_total_usd === undefined || b.max_total_usd === null ? null : num(b.max_total_usd, 5);
  if (b.max_total_usd !== undefined && b.max_total_usd !== null && total === null) return null;
  if (b.discovery_mode !== undefined && b.discovery_mode !== "strict" && b.discovery_mode !== "flexible") return null;
  const a = b.approval as Record<string, unknown> | null | undefined;
  let approval: StrategyRequest["approval"] = null;
  if (a) {
    const lo = num(a.leadocean_records ?? 0, 500), usd = num(a.apify_usd ?? 0, 5);
    if (typeof a.plan_hash !== "string" || lo === null || usd === null || !Number.isInteger(lo)) return null;
    if (a.token !== undefined && typeof a.token !== "string") return null;
    approval = { planHash: a.plan_hash, leadoceanRecords: lo, apifyUsd: usd, token: typeof a.token === "string" ? a.token : null };
  }
  return {
    action: b.action, workspaceId: b.workspace_id, walkId: b.walk_id, query: b.query.trim(), requestedCount: count,
    user: { ...(b.strategy ? { strategy: b.strategy as DiscoveryStrategyId } : {}), excludeProviders: exclude as ProviderId[], allowReviewOnly: b.allow_review_only === true,
      ...(b.accept_likely === true ? { acceptLikely: true } : {}) },
    budget: { maxLeadoceanRecords: maxLo, maxApifyUsd: maxUsd }, approval,
    ...(total !== null ? { totalUsd: total } : {}),
    ...(b.discovery_mode === "flexible" ? { mode: "flexible" as const } : {}),
  };
}

export interface Interpreted {
  mission: unknown;
  /**
   * MISSION CONTRACT MODE: the one authoritative statement of the request. When present,
   * `mission` is its frozen compilation, the plan hash binds its hash, the approval token
   * replays the contract itself, and the invariants (missionContract/invariants.ts) are
   * checked at compile, plan, approval and evaluation.
   */
  contract?: MissionContract;
  brain?: { status: string; fields: string[]; applied: unknown[]; rejected: unknown[]; merged?: { requirementId: string | null; value: string; sources: string[]; memoryIds: string[] }[]; refusedMemory?: { memory_id: string; value: string; reason: string }[] };
  /** What a strategy_run needs to rebuild this interpretation without the model. */
  replay?: Omit<PlanReplay, "advice">;
  /**
   * LEGACY PATH ONLY (no contract): the workspace's industry exclusions — the Company Brain
   * profile's and approved memory's. Applied by the same resolver as contract mode, so the
   * legacy path can no longer ignore them. Contract mode carries them as requirements instead.
   */
  workspaceExclusions?: ContractBrainInput | null;
}

/**
 * Why there is no mission. `clarification`: the model's validated understanding listed a
 * genuine ambiguity (MissionNeedsClarificationError) — the user is ASKED, nothing is spent.
 * That is an answer, not a server failure (it used to surface as a bare HTTP 500, which
 * failed the TEST smoke on 2026-11-05 and would read "lead pipeline failed" in the app).
 */
export type InterpretFailure = { error: string; clarification?: { questions: string[]; message: string } };

export interface StrategyDeps extends PipelineDeps {
  /** The shared grounded classifier for business-model verification; absent = that check is unavailable. */
  groundBusinessModel?: import("./businessModelCheck.ts").Grounder | null;
  /**
   * GPT interpretation: the mission compiler's final mission, or why there is none. Never a
   * regex fallback. `brain` reports how the workspace's Company Brain informed it
   * (brainContext.ts): the user's words outrank it; it fills open fields as targets only.
   */
  interpret(query: string, workspaceId: string, requestedCount: number | null): Promise<Interpreted | InterpretFailure>;
  /**
   * The SAME interpretation, rebuilt from what the plan signed: the model's proposal and
   * the Company Brain context it was compiled with. Deterministic; no model call.
   */
  recompile?(query: string, requestedCount: number | null, replay: PlanReplay): Promise<Interpreted | InterpretFailure>;
  /** Signs and verifies approval tokens (planToken.ts). Absent: strategy_run is refused. */
  signer?: PlanSigner | null;
  /** GPT strategy advice; null = the deterministic choice only. */
  advisor: GenerateJsonFn | null;
  /** The mission interpretation contract in force (default: AGENTORY_MISSION_CONTRACT, v1). */
  contractVersion?: string;
  /**
   * WORKBENCH LINK. Records the run as ONE task_plans row in this workspace (server-side,
   * after the membership and admin checks; the client never names a plan) and returns its
   * id, which the saved leads carry so the Workbench Leads table shows them. Absent or
   * failing: the leads are still saved, and the response says there is no Workbench view.
   */
  recordRunPlan?(p: { workspaceId: string; userId: string; query: string; planHash: string; status: "completed" | "partial" | "failed"; summary: string }): Promise<string | null>;
  /** Asynchronous Apify runs with recorded run ids and receipts (V5 Phase C); null/absent = run-sync. */
  apifyRuns?: StrategyRunInput["apifyRuns"];
}

/** Words by which a request asks for VERIFIED companies (then likely matches never count). */
const VERIFIED_WORDS = /\b(?:verified|verify|verifiably|confirmed|proven)\b/i;

export async function handleStrategyRequest(req: StrategyRequest, d: StrategyDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = d.now ?? (() => new Date());
  if (!d.flags.enabled) return { status: 404, body: { error: "disabled" } };
  if (!d.userId) return { status: 401, body: { error: "sign in required" } };
  if (!d.flags.workspaces.has(req.workspaceId)) return { status: 403, body: { error: "the lead pipeline is not enabled for this workspace" } };
  const role = await d.store.memberRole(d.userId, req.workspaceId);
  if (!role) return { status: 403, body: { error: "not a member of this workspace" } };
  if (req.action === "strategy_run" && !ADMIN.has(role)) return { status: 403, body: { error: "only a workspace owner or admin can approve a paid run", stage: "approval", code: "not_authorized" } };
  // AN EXPLICIT "VERIFIED" IS NEVER SILENTLY WEAKENED: counting likely matches is refused when
  // the request itself asks for verified / confirmed companies.
  if (req.user?.acceptLikely && VERIFIED_WORDS.test(req.query)) {
    return { status: 422, body: { status: "not_approvable", error: "your request asks for verified companies, so likely matches cannot count toward it; plan without counting likely matches" } };
  }

  // ── STRATEGY_RUN EXECUTES THE APPROVED PLAN, NOT A NEW READING (Stage 3) ──
  // The run never calls the model. It verifies the signed approval token from
  // strategy_plan (MAC, expiry, workspace, hash), rebuilds the interpretation from the
  // proposal the token carries, and re-plans with the signed advisor pick; the result
  // must have the approved hash (which binds meaning, ceilings and workspace).
  let token: PlanTokenPayload | null = null;
  if (req.action === "strategy_run") {
    if (!req.approval) return { status: 400, body: { error: "a run needs an approval", stage: "approval", code: "approval_missing" } };
    if (!d.signer || !d.recompile) return { status: 503, body: { error: "signed plan approvals are not available; nothing ran", stage: "approval", code: "approvals_unavailable" } };
    if (!req.approval.token) return { status: 400, body: { error: "a run needs the approval_token returned by strategy_plan; plan again and approve that plan", stage: "approval", code: "approval_missing" } };
    const v = await d.signer.verify(req.approval.token, { workspaceId: req.workspaceId, planHash: req.approval.planHash, walkId: req.walkId }, now());
    if (!v.ok) return { status: 409, body: { error: v.reason, stage: "approval", code: approvalCode(v.reason) } };
    token = v.payload;
  }
  const interpreted = token
    ? await d.recompile!(token.query, token.requestedCount, token.replay)
    : await d.interpret(req.query, req.workspaceId, req.requestedCount);
  if ("error" in interpreted) {
    const c = interpreted.clarification;
    return c
      ? { status: 422, body: { status: "needs_clarification", questions: c.questions, error: c.message } }
      : { status: 422, body: { error: `the request could not be interpreted: ${interpreted.error}` } };
  }
  // ── MISSION CONTRACT MODE: approvable, compiled faithfully, and the one that was approved ──
  const mc = interpreted.contract ?? null;
  const mcHash = mc ? await contractHash(mc) : null;
  if (mc) {
    if (mc.ambiguities.length) {
      return { status: 422, body: { status: "needs_clarification", questions: mc.ambiguities.map((a) => a.question), error: mc.ambiguities.map((a) => a.question).join(" ") } };
    }
    const ok = approvability(mc);
    if (!ok.ok) return { status: 422, body: { status: "not_approvable", reasons: ok.reasons, error: ok.reasons.join("; ") } };
    const violations: InvariantViolation[] = [...checkCompiled(mc, interpreted.mission)];
    if (token) violations.push(...await checkApproved(mc, (token.replay.proposal as { contractHash?: string } | null)?.contractHash ?? null));
    if (violations.length) return { status: 409, body: { error: "the mission's meaning did not survive intact; nothing ran", invariantViolations: violations, stage: token ? "approval" : "plan", code: "meaning_changed" } };
  }
  // CLOSED REQUIREMENT VOCABULARY (Option E Stage 6; requirementVocabulary.ts). It VALIDATES
  // and never renames, so an accepted request means exactly what it meant before. A proposed
  // hard constraint it cannot place, whose value is not in the user's own words, is the
  // model's idea: with the flag on it is refused explicitly (422, nothing bought), never
  // dropped and never quietly satisfied. With the flag off it is only reported.
  // A run checks the proposal the plan SIGNED (the rebuilt interpretation carries no replay).
  // (Contract mode has no free-form constraint channel: nothing to classify.)
  const proposed = mc ? [] : ((token?.replay ?? interpreted.replay)?.proposal as { hard_constraints?: unknown } | undefined)?.hard_constraints;
  const unsupported = classifyConstraints(proposed ?? [], token?.query ?? req.query)
    .filter((c) => c.kind === "other" && !c.quoted).map((c) => c.originalField);
  const contract = { version: REQUIREMENT_VOCABULARY_VERSION, enforced: !!d.flags.strictRequirements, unsupported };
  if (unsupported.length && contract.enforced) {
    return { status: 422, body: { error: "the request was read with a requirement ATLAS cannot place and you did not state; rephrase the request or remove it", contract } };
  }
  // LEGACY EXCLUSION GAP (2026-11-28): without the contract, the workspace's exclusions used to
  // be read and then ignored. They now apply as REQUIRED, workspace-authority criteria, by the
  // same resolver as contract mode (missionContract/brain.ts); a conflict is a question.
  let mission = interpreted.mission;
  let workspaceExclusions: ReturnType<typeof legacyWorkspaceExclusions> | null = null;
  if (!mc && interpreted.workspaceExclusions) {
    workspaceExclusions = legacyWorkspaceExclusions(mission, interpreted.workspaceExclusions, { workspaceId: req.workspaceId, now: now() });
    if (workspaceExclusions.resolution.conflicts.length) {
      const qs = workspaceExclusions.resolution.conflicts.map((c) => c.question);
      return { status: 422, body: { status: "needs_clarification", questions: qs, error: qs.join(" ") } };
    }
    mission = workspaceExclusions.mission;
  }
  let spec = specFromMission(mission as never, { defaultCount: req.requestedCount ?? 25 });
  if (mc) {
    const v = checkPlanRequirements(mc, spec.requirements.criteria as unknown as { id: string; kind: string }[]);
    if (v.length) return { status: 409, body: { error: "the plan's requirements differ from the approved contract; nothing ran", invariantViolations: v, stage: token ? "approval" : "plan", code: "meaning_changed" } };
  }
  // FLEXIBLE DISCOVERY: the user's explicit choice to rank by industry and consumer-only instead
  // of gating on them. GPT names related industries at PLAN time only; a run replays the signed list.
  const strictSpec = spec;
  let industries: IndustryMap | null = null;
  if (req.mode === "flexible") {
    const asked = requestedIndustries(spec);
    industries = token ? readIndustryMap(token.replay.flexible, asked) : await expandIndustries(asked, d.advisor, req.workspaceId);
    spec = relaxForFlexible(spec, industries).spec;
  }
  const flexibleView = spec.flexible ? {
    mode: "flexible" as const, relaxed: spec.flexible.relaxed, kept: spec.flexible.kept ?? [],
    industries: { requested: spec.flexible.industries.requested, related: spec.flexible.industries.related, source: spec.flexible.industries.source, note: spec.flexible.industries.error },
  } : null;

  const rows = await d.store.list(req.workspaceId);
  const lo = rows.find((x) => x.provider === "leadocean");
  const ap = rows.find((x) => x.provider === "apollo");
  const f = d.discoveryFlags;
  const ctx: StrategyContext = {
    providers: {
      leadocean: { enabled: f.enabled && f.provider.leadocean && f.commercialTerms.leadocean, connected: lo?.status === "connected", authorized: true, remaining: lo?.usage?.remaining ?? null },
      apify: { enabled: f.enabled && f.provider.apify, connected: !!d.apify, authorized: true },
      apollo: { enabled: f.enabled && f.provider.apollo && f.commercialTerms.apollo, connected: ap?.status === "connected", authorized: true },
    },
    budget: effectiveBudget(req), user: req.user, businessModelGrounding: !!d.groundBusinessModel, companySearch: !!d.flags.companySearch,
    // The plan hash binds the workspace and the interpretation contract it was read under.
    // Contract mode: the plan hash binds the contract's own hash, so an approval names one exact meaning.
    binding: { workspaceId: req.workspaceId, contractVersion: mc ? `${MISSION_CONTRACT_VERSION}:${mcHash}` : d.contractVersion ?? activeMissionContract() },
  };
  const base = planStrategy(spec, ctx);
  // A run reuses the advisor pick the plan signed; a plan asks the advisor (unless the user chose).
  const advice: PlanReplay["advice"] = token ? token.replay.advice
    : req.user?.strategy || !d.advisor ? null : await adviseStrategy(spec, base.candidates, d.advisor, req.workspaceId);
  const plan: StrategyPlan = advice ? planStrategy(spec, ctx, advice as never) : base;
  // What the plan was built from, so a reviewer can see hard vs soft and the Brain's part.
  const interpretation = {
    hard: spec.requirements.hard.map((h) => ({ key: h.key, label: h.label })),
    preferences: [
      ...(spec.preferredEmployees ? [{ key: "employee_range", values: spec.preferredEmployees }] : []),
      ...spec.requirements.preferences.map((p) => ({ key: p.key, values: p.values })),
    ],
    signals: spec.signals.map((s) => ({ kind: s.kind, hard: s.hard, windowDays: s.windowDays, roleTerms: s.roleTerms, roleFamilies: s.roleFamilies })),
    companyBrain: "brain" in interpreted ? interpreted.brain ?? null : null,
    contract,
    // WHICH READING THE RUNNING SERVICE USED (mission reliability S4): the interpretation
    // contract in effect, whether the model's v3 understanding was validated and applied,
    // and whether the mission's meaning is frozen. Metadata only — not in the plan hash.
    // In contract mode the mission was read by the Mission Contract (v4), whatever v1/v3 setting the function has.
    understanding: understandingReport(interpreted.mission, mc ? MISSION_CONTRACT_VERSION : d.contractVersion ?? activeMissionContract()),
    ...(mc ? { missionContract: { version: MISSION_CONTRACT_VERSION, hash: mcHash, contract: mc, assumptions: mc.assumptions, disclosures: disclosures(mc).map((r) => r.display.label), mergedDuplicates: mc.mergedDuplicates ?? [] } } : {}),
  };
  // G3 PROVIDER ISOLATION: a chosen provider is the only provider. Never a silent fallback —
  // the planner does not switch an explicit choice, and this refuses any plan that would.
  const isolation = providerIsolation(req.user?.strategy, plan);
  if (isolation) return { status: 409, body: { error: isolation, stage: req.action === "strategy_run" ? "approval" : "plan", code: "provider_isolation", plan } };
  // G2: where every requirement of this plan came from (a view; not in the plan hash).
  const brainReport = "brain" in interpreted ? interpreted.brain ?? null : null;
  const reqOf = new Map((mc?.requirements ?? []).map((r) => [r.id, r]));
  const provenance = planProvenance({
    spec, before: strictSpec,
    brain: workspaceExclusions ? { ...(brainReport ?? {}), rejected: [...((brainReport as { rejected?: unknown[] } | null)?.rejected ?? []), ...workspaceExclusions.resolution.notApplied],
      merged: workspaceExclusions.resolution.merged, refusedMemory: workspaceExclusions.resolution.refusedMemory } : brainReport as never,
    memoryIdsOf: (id) => reqOf.get(id)?.origin.memoryIds ?? [], policyOf: (id) => reqOf.get(id)?.origin.policy ?? null,
  });
  const budgetView = { requested: req.budget, totalUsd: req.totalUsd ?? null, effective: ctx.budget, allocation: allocationOf(plan, ctx.budget, req.user?.strategy ?? null) };
  if (req.action === "strategy_plan" || plan.status === "blocked") {
    // The approval token: what an owner/admin approves, and all a run may execute.
    const approval_token = req.action === "strategy_plan" && plan.status === "ready" && d.signer && interpreted.replay
      ? await d.signer.sign({ workspaceId: req.workspaceId, walkId: req.walkId, plannedBy: d.userId, planHash: plan.planHash, query: req.query, requestedCount: req.requestedCount, replay: { ...interpreted.replay, advice, ...(industries ? { flexible: industries } : {}) } }, now())
      : null;
    // A run whose re-plan is blocked never executed: that is the APPROVAL being refused, not a run failure.
    const stage = req.action === "strategy_run" ? "approval" : "plan";
    return { status: plan.status === "blocked" ? 409 : 200, body: { status: plan.status, plan, worstCase: plan.estimate, interpretation, budget: budgetView, provenance, discoveryMode: flexibleView ? "flexible" : "strict", ...(flexibleView ? { flexible: flexibleView } : {}), ...(approval_token ? { approval_token } : {}),
      stage, code: plan.status === "blocked" ? "plan_blocked" : "plan_ready" } };
  }
  if (!req.approval) return { status: 400, body: { error: "a run needs an approval", plan, stage: "approval", code: "approval_missing" } };
  if (req.approval.planHash !== plan.planHash) return { status: 409, body: { error: "plan changed since it was approved (re-interpretation or new limits); review the new plan", plan, stage: "approval", code: "plan_changed" } };

  const key = plan.steps.some((s) => s.provider === "leadocean") ? await d.store.secret(req.workspaceId, "leadocean") : null;
  const usesApify = plan.steps.some((s) => s.provider === "apify");
  const connections: ProviderConnectionState[] = [{
    provider: "leadocean", connected: lo?.status === "connected", enabled: !!ctx.providers.leadocean?.enabled,
    commercialTermsConfirmed: f.commercialTerms.leadocean, remainingCredits: lo?.usage?.remaining ?? null,
    recentFailures: lo && lo.status !== "connected" ? 1 : 0, restrictions: lo?.usage?.restrictions ?? [],
  }];
  const run: StrategyRun | RunPending = await runDiscoveryStrategy({
    workspaceId: req.workspaceId, walkId: req.walkId, spec, plan,
    approval: { planHash: req.approval.planHash, leadoceanRecords: req.approval.leadoceanRecords, apifyUsd: req.approval.apifyUsd, approvedBy: d.userId, approvedAt: now().toISOString() },
    // G3: a provider with no step in the APPROVED plan is never handed to the executor, so it
    // cannot be called — zero calls, zero records, zero charges — whatever the executor does.
    leadocean: key ? d.leadoceanFor(key).adapter : null, apify: usesApify ? d.apify : null, connections,
    ledger: d.ledger, checkpoints: d.checkpoints, existing: new ExclusionIndex(await d.loadExisting(req.workspaceId), now), now,
    evidenceCache: d.evidenceCache ?? null,
    groundBusinessModel: d.groundBusinessModel ?? null,
    acceptLikely: req.user?.acceptLikely === true,
    apifyRuns: usesApify ? d.apifyRuns ?? null : null,
  }).catch((e) => {
    // A RUN STILL GOING (Phase C): nothing is lost and nothing is bought again — the run id is
    // recorded on its reservation, and calling strategy_run again with the SAME approval token
    // adopts it (completed steps replay from the ledger at $0).
    if (e instanceof RunPending) return e;
    throw e;
  });
  if (run instanceof RunPending) {
    return { status: 202, body: { status: "running", stage: "execution", code: "running", plan: { planHash: plan.planHash },
      running: { actor: run.actorKey, runId: run.runId, state: run.status, reservedUsd: run.reservedUsd },
      next: "Call strategy_run again with the same approval token: the run in progress is adopted, never bought again.",
      outcome: { status: "running", summary: `Still running: ${run.actorKey.replace(/^apify_/, "").replace(/_/g, " ")} (${run.status.toLowerCase()}). Check again shortly — nothing will be bought twice.`,
        spend: { apifyUsd: run.reservedUsd, leadoceanRecords: 0, basis: "reserved" } } } };
  }
  const charged = run.charges ? spendBasis(run.charges) : null;
  if (run.status === "blocked") {
    // A "blocked" run that already spent is a FAILED run, not a refusal (audit S3/S4).
    const spent = run.spend.apifyUsd > 0 || run.spend.leadoceanRecords > 0;
    const outcome = missionOutcome({ requested: spec.requestedCount, qualified: 0, pending: 0, rejected: 0, runStatus: spent ? "failed" : "blocked", reason: run.reason,
      spend: { ...run.spend, basis: charged?.basis ?? "estimate" } });
    return { status: 409, body: { error: run.reason, plan, outcome, steps: run.steps, spend: run.spend,
      // The approval was accepted and execution started; it then stopped. Spent → failed; nothing spent → refused.
      stage: "execution", code: spent ? "execution_failed" : "execution_refused",
      ...(run.charges ? { charges: run.charges.map((c) => ({ actor: c.actorKey, runId: c.runId, state: c.state, usd: c.usd, reservedUsd: c.reservedUsd, build: c.build, status: c.status })), chargeStates: charged?.states ?? {} } : {}) } };
  }
  // The run's own plan: what the Workbench reads (`lead_candidates.plan_id`). Recorded before
  // the rows so every new lead carries it; a failure here never loses the leads.
  const summary = `${run.queue.length} qualified, ${run.review.length} for review of ${spec.requestedCount ?? "?"} requested (${run.strategy ?? "no strategy"})`;
  let runPlanId: string | null = null;
  try {
    runPlanId = d.recordRunPlan && d.userId ? await d.recordRunPlan({ workspaceId: req.workspaceId, userId: d.userId, query: token?.query ?? req.query,
      planHash: plan.planHash, status: run.status === "partial" ? "partial" : "completed", summary }) : null;
  } catch (e) { console.error("[lead-pipeline] run plan not recorded", { name: (e as Error)?.name }); runPlanId = null; }
  const projected = [...run.queue, ...run.review].map((l) => projectPipelineLead(l, { workspaceId: req.workspaceId, values: [], planId: runPlanId })).filter((x): x is PipelineRow => !!x);
  const persisted = await d.persist(projected, 0);
  const saved = saveOutcome(run.status, run.reason ?? null, persisted, projected.length);
  // FLEXIBLE DISCOVERY counts only Strong and Close matches toward the number asked for; the rest
  // are returned, labelled, for review. Strict counts exactly as before.
  const matches = spec.flexible ? flexibleMatches([...run.queue, ...run.review], spec.flexible.industries) : null;
  const counted = matches ? matches.filter((m) => m.tier === "strong" || m.tier === "close").length : null;
  return {
    status: 200,
    body: {
      status: saved.status, reason: saved.reason, strategy: run.strategy, steps: run.steps, spend: run.spend, limitations: run.limitations,
      stage: "execution", code: "completed", budget: budgetView,
      // Where the saved leads appear: the Workbench Leads table for this plan (null = not linked).
      workbench: runPlanId ? { planId: runPlanId } : null,
      // What the REQUEST got (outcome.ts): only qualified companies count toward the number asked for.
      outcome: flexibleOutcome(matches, spec.requestedCount, missionOutcome({
        requested: spec.requestedCount, qualified: counted ?? run.queue.length,
        // A likely match the user permitted counts (labelled); it is not also "pending".
        pending: matches ? matches.length - counted! : run.review.filter((l) => l.statuses.qualification === "pending" && !l.acceptedAsLikely).length, rejected: run.excluded.length,
        likely: run.review.filter((l) => l.acceptedAsLikely).length,
        runStatus: run.status, reason: run.reason,
        openRequirements: [...new Set(run.review.flatMap((l) => l.qualification?.gaps ?? []))].map((g) => g.replace(/_/g, " ")),
        // Async runs (Phase C) report Apify's own receipt; run-sync reports none (estimate).
        spend: { ...run.spend, basis: charged?.basis ?? "estimate" },
        saved: { failed: saved.failed, attempted: projected.length },
      })),
      mergedCompanies: run.mergedCompanies ?? [],
      // FLEXIBLE DISCOVERY: the original request, what was relaxed, and every company's match tier
      // with each attribute verified / inferred / unknown and its sources (flexibleDiscovery.ts).
      discoveryMode: flexibleView ? "flexible" : "strict",
      ...(flexibleView && matches ? { flexible: { ...flexibleView, originalRequest: token?.query ?? req.query, matches } } : {}),
      // Every Apify run: its id, how sure its charge is (settled / provider_reported / unknown).
      ...(run.charges ? { charges: run.charges.map((c) => ({ actor: c.actorKey, runId: c.runId, state: c.state, usd: c.usd, reservedUsd: c.reservedUsd, build: c.build, status: c.status })), chargeStates: charged?.states ?? {} } : {}),
      evidenceRefused: run.evidenceRefused, queue: run.queue, review: run.review, excludedCount: run.excluded.length,
      // Who was ruled out and why — the count alone hid it from the user.
      rejected: rejectedSummary(run.excluded),
      // What was actually written (inserted or updated in place), not what was projected.
      written: saved.written,
      ...(persisted ? { persistence: { inserted: persisted.written, updated: persisted.updated, failed: persisted.failed, failures: persisted.rows.filter((x) => x.action === "failed") } } : {}),
      // Per provider and combined: discovered, unique, qualified, pending, rejected, spend, errors.
      providerSummary: summarizeProviderRun(run),
      // Contract mode: one verdict per contract requirement for every returned company,
      // with the evidence it rests on (I4: an unknown is never reported as verified).
      ...(mc ? (() => {
        const verdicts = [...run.queue, ...run.review].map((l) => ({
          leadKey: l.leadKey, verdicts: requirementVerdicts(mc, (l.qualification?.checks ?? []) as never),
        }));
        const violations = verdicts.flatMap((v) => checkVerdicts(mc, v.verdicts));
        return { missionContractHash: mcHash, requirementVerdicts: verdicts, ...(violations.length ? { invariantViolations: violations } : {}) };
      })() : {}),
    },
  };
}

// ── G3: budgets, provider isolation, allocation ─────────────────────────────

/** The ceilings the planner works within: the total USD budget caps the (USD-priced) Apify ceiling. */
export function effectiveBudget(req: Pick<StrategyRequest, "budget" | "totalUsd">): StrategyContext["budget"] {
  const t = req.totalUsd;
  return t === null || t === undefined ? req.budget : { ...req.budget, maxApifyUsd: Math.min(req.budget.maxApifyUsd, t) };
}

/** A plan that would use a provider the user's choice rules out (never expected; refused if it happens). */
export function providerIsolation(choice: DiscoveryStrategyId | undefined, plan: Pick<StrategyPlan, "steps">): string | null {
  const used = new Set(plan.steps.map((s) => s.provider));
  if (choice === "apify_only" && used.has("leadocean")) return "Apify only was chosen, but the plan includes LeadOcean; nothing will run";
  if (choice === "leadocean_only" && used.has("apify")) return "LeadOcean only was chosen, but the plan includes Apify; nothing will run";
  return null;
}

export interface ProviderAllocation {
  provider: ProviderId;
  /** In the plan at all. A provider not in the plan gets 0 calls, 0 records, $0. */
  used: boolean;
  steps: number;
  /** The plan's worst case for this provider, and the ceiling it was planned within. */
  worstCase: { apifyUsd: number; leadoceanRecords: number };
  ceiling: { apifyUsd: number | null; leadoceanRecords: number | null };
  unit: "usd" | "records";
}

/** Per-provider allocation, so Auto and Both explain who gets what before approval. */
export function allocationOf(plan: Pick<StrategyPlan, "steps" | "strategy">, budget: StrategyContext["budget"], choice: DiscoveryStrategyId | null): { providers: ProviderAllocation[]; explanation: string } {
  const sum = (p: ProviderId) => plan.steps.filter((s) => s.provider === p).reduce((a, s) => ({ apifyUsd: a.apifyUsd + s.estimate.apifyUsd, leadoceanRecords: a.leadoceanRecords + s.estimate.leadoceanRecords }), { apifyUsd: 0, leadoceanRecords: 0 });
  const round = (x: { apifyUsd: number; leadoceanRecords: number }) => ({ apifyUsd: Math.round(x.apifyUsd * 1e5) / 1e5, leadoceanRecords: x.leadoceanRecords });
  const providers: ProviderAllocation[] = (["apify", "leadocean"] as const).map((p) => {
    const n = plan.steps.filter((s) => s.provider === p).length;
    return { provider: p, used: n > 0, steps: n, worstCase: round(sum(p)),
      ceiling: p === "apify" ? { apifyUsd: n ? budget.maxApifyUsd : 0, leadoceanRecords: null } : { apifyUsd: null, leadoceanRecords: n ? budget.maxLeadoceanRecords : 0 },
      unit: p === "apify" ? "usd" : "records" };
  });
  const names = providers.filter((p) => p.used).map((p) => (p.provider === "apify" ? "Apify" : "LeadOcean"));
  const explanation = !names.length ? "No provider is called."
    : choice === "apify_only" ? "Apify only: LeadOcean gets 0 records and 0 calls."
    : choice === "leadocean_only" ? "LeadOcean only: Apify gets $0 and 0 calls."
    : `${choice ? "You chose" : "Auto chose"} ${plan.strategy ?? "no strategy"}: ${names.join(" and ")}${names.length === 1 ? ` only; ${names[0] === "Apify" ? "LeadOcean" : "Apify"} gets nothing` : ""}.`;
  return { providers, explanation };
}

/** The approval failure, as a code the UI can act on (planToken.ts reasons). */
export function approvalCode(reason: string): "approval_expired" | "approval_other_workspace" | "approval_other_walk" | "approval_other_plan" | "approval_invalid" {
  if (/expired/.test(reason)) return "approval_expired";
  if (/another workspace/.test(reason)) return "approval_other_workspace";
  if (/another walk/.test(reason)) return "approval_other_walk";
  if (/different plan/.test(reason)) return "approval_other_plan";
  return "approval_invalid";
}

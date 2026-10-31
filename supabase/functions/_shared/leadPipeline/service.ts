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

import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { AdapterDeps, DiscoveryAdapter } from "../discoveryProviders/adapter.ts";
import type { DiscoveryApproval, UsageLedger } from "../discoveryProviders/budget.ts";
import type { ConnectionStore } from "../discoveryProviders/connections.ts";
import type { DiscoveryFlags, Env } from "../discoveryProviders/flags.ts";
import type { ProviderConnectionState } from "../discoveryProviders/routing.ts";
import type { CheckpointStore } from "./checkpoint.ts";
import { ExclusionIndex, type ExistingRecord } from "./exclusions.ts";
import { configureIcp, ICPS, type IcpConfig, type IcpId } from "./icp.ts";
import { runLeadPipeline, worstCase, type PipelineApprovals, type PipelineRun } from "./pipeline.ts";
import { projectPipelineLead, type PipelineRow } from "./projection.ts";
import type { GenerateJsonFn } from "../intelligence/plannerWrapper.ts";
import type { ProviderId } from "../discoveryProviders/types.ts";
import { runDiscoveryStrategy, type StrategyRun } from "./multiProvider.ts";
import { adviseStrategy, isStrategy, planStrategy, specFromMission, type DiscoveryStrategyId, type StrategyContext, type StrategyPlan } from "./strategy.ts";

const on = (v: string | undefined) => !!v && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

export interface PipelineFlags { enabled: boolean; workspaces: Set<string>; signals: boolean; phones: boolean }
export function readPipelineFlags(env: Env): PipelineFlags {
  return {
    enabled: on(env("LEAD_PIPELINE_ENABLED")),
    workspaces: new Set((env("LEAD_PIPELINE_WORKSPACES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    // Unfinished-in-production steps have their own switches, off by default.
    signals: on(env("LEAD_PIPELINE_SIGNALS_ENABLED")),
    phones: on(env("LEAD_PIPELINE_PHONES_ENABLED")),
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
  persist(rows: PipelineRow[], contactValuesWritten: number): Promise<void>;
  now?: () => Date;
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
  await d.persist(rows, rows.filter((r) => r.contact?.phone).length);
  return {
    status: 200,
    body: {
      status: run.status, reason: run.reason, spend: run.spend, funnel: run.funnel, yield: run.yield, estimates: run.estimates,
      discovery: run.discovery, canonical: run.canonical, signals: run.signals && { spentUsd: run.signals.spentUsd, stopped: run.signals.stopped }, phones: run.phones,
      queue: run.queue, review: run.review, excludedCount: run.excluded.length, written: rows.length,
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
  approval: { planHash: string; leadoceanRecords: number; apifyUsd: number } | null;
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
  const a = b.approval as Record<string, unknown> | null | undefined;
  let approval: StrategyRequest["approval"] = null;
  if (a) {
    const lo = num(a.leadocean_records ?? 0, 500), usd = num(a.apify_usd ?? 0, 5);
    if (typeof a.plan_hash !== "string" || lo === null || usd === null || !Number.isInteger(lo)) return null;
    approval = { planHash: a.plan_hash, leadoceanRecords: lo, apifyUsd: usd };
  }
  return {
    action: b.action, workspaceId: b.workspace_id, walkId: b.walk_id, query: b.query.trim(), requestedCount: count,
    user: { ...(b.strategy ? { strategy: b.strategy as DiscoveryStrategyId } : {}), excludeProviders: exclude as ProviderId[], allowReviewOnly: b.allow_review_only === true },
    budget: { maxLeadoceanRecords: maxLo, maxApifyUsd: maxUsd }, approval,
  };
}

export interface StrategyDeps extends PipelineDeps {
  /** GPT interpretation: the mission compiler's final mission, or why there is none. Never a regex fallback. */
  interpret(query: string, workspaceId: string, requestedCount: number | null): Promise<{ mission: unknown } | { error: string }>;
  /** GPT strategy advice; null = the deterministic choice only. */
  advisor: GenerateJsonFn | null;
}

export async function handleStrategyRequest(req: StrategyRequest, d: StrategyDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = d.now ?? (() => new Date());
  if (!d.flags.enabled) return { status: 404, body: { error: "disabled" } };
  if (!d.userId) return { status: 401, body: { error: "sign in required" } };
  if (!d.flags.workspaces.has(req.workspaceId)) return { status: 403, body: { error: "the lead pipeline is not enabled for this workspace" } };
  const role = await d.store.memberRole(d.userId, req.workspaceId);
  if (!role) return { status: 403, body: { error: "not a member of this workspace" } };
  if (req.action === "strategy_run" && !ADMIN.has(role)) return { status: 403, body: { error: "only a workspace owner or admin can approve a paid run" } };

  const interpreted = await d.interpret(req.query, req.workspaceId, req.requestedCount);
  if ("error" in interpreted) return { status: 422, body: { error: `the request could not be interpreted: ${interpreted.error}` } };
  const spec = specFromMission(interpreted.mission as never, { defaultCount: req.requestedCount ?? 25 });

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
    budget: req.budget, user: req.user,
  };
  const base = planStrategy(spec, ctx);
  const plan: StrategyPlan = req.user?.strategy || !d.advisor ? base : planStrategy(spec, ctx, await adviseStrategy(spec, base.candidates, d.advisor, req.workspaceId));
  if (req.action === "strategy_plan" || plan.status === "blocked") {
    return { status: plan.status === "blocked" ? 409 : 200, body: { status: plan.status, plan, worstCase: plan.estimate } };
  }
  if (!req.approval) return { status: 400, body: { error: "a run needs an approval", plan } };
  if (req.approval.planHash !== plan.planHash) return { status: 409, body: { error: "plan changed since it was approved (re-interpretation or new limits); review the new plan", plan } };

  const key = plan.steps.some((s) => s.provider === "leadocean") ? await d.store.secret(req.workspaceId, "leadocean") : null;
  const connections: ProviderConnectionState[] = [{
    provider: "leadocean", connected: lo?.status === "connected", enabled: !!ctx.providers.leadocean?.enabled,
    commercialTermsConfirmed: f.commercialTerms.leadocean, remainingCredits: lo?.usage?.remaining ?? null,
    recentFailures: lo && lo.status !== "connected" ? 1 : 0, restrictions: lo?.usage?.restrictions ?? [],
  }];
  const run: StrategyRun = await runDiscoveryStrategy({
    workspaceId: req.workspaceId, walkId: req.walkId, spec, plan,
    approval: { ...req.approval, approvedBy: d.userId, approvedAt: now().toISOString() },
    leadocean: key ? d.leadoceanFor(key).adapter : null, apify: d.apify, connections,
    ledger: d.ledger, checkpoints: d.checkpoints, existing: new ExclusionIndex(await d.loadExisting(req.workspaceId), now), now,
  });
  if (run.status === "blocked") return { status: 409, body: { error: run.reason, plan } };
  const projected = [...run.queue, ...run.review].map((l) => projectPipelineLead(l, { workspaceId: req.workspaceId, values: [] })).filter((x): x is PipelineRow => !!x);
  await d.persist(projected, 0);
  return {
    status: 200,
    body: {
      status: run.status, reason: run.reason, strategy: run.strategy, steps: run.steps, spend: run.spend, limitations: run.limitations,
      evidenceRefused: run.evidenceRefused, queue: run.queue, review: run.review, excludedCount: run.excluded.length, written: projected.length,
    },
  };
}

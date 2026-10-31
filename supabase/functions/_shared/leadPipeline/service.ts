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

const on = (v: string | undefined) => !!v && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

export interface PipelineFlags { enabled: boolean; workspaces: Set<string>; signals: boolean; phones: boolean; founderCheck: boolean }
export function readPipelineFlags(env: Env): PipelineFlags {
  return {
    enabled: on(env("LEAD_PIPELINE_ENABLED")),
    workspaces: new Set((env("LEAD_PIPELINE_WORKSPACES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    // Unfinished-in-production steps have their own switches, off by default.
    signals: on(env("LEAD_PIPELINE_SIGNALS_ENABLED")),
    // Phones are never part of a discovery run (enrichQueuedPhones is a separate step);
    // the flag is kept for that step's future endpoint.
    phones: on(env("LEAD_PIPELINE_PHONES_ENABLED")),
    founderCheck: on(env("LEAD_PIPELINE_FOUNDER_CHECK_ENABLED")),
  };
}

export interface PipelineRequest {
  action: "plan" | "run";
  workspaceId: string;
  icpId: IcpId;
  walkId: string;
  overrides: Partial<Pick<IcpConfig, "requestedCount">> & { hasPhone?: boolean };
  approval: { planHash: string; leadoceanRecords: number; canonicalMaxUsd: number; signalsMaxUsd: number; founderCheckMaxUsd: number } | null;
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
    const lo = num(a.leadocean_records, 500), c = num(a.canonical_max_usd ?? 0, 5), s = num(a.signals_max_usd ?? 0, 5), f = num(a.founder_check_max_usd ?? 0, 5);
    // A discovery run never looks phones up: an approval that asks for lookups is refused, not silently ignored.
    if (a.phone_lookups !== undefined && a.phone_lookups !== 0) return null;
    if (typeof a.plan_hash !== "string" || lo === null || c === null || s === null || f === null || !Number.isInteger(lo)) return null;
    approval = { planHash: a.plan_hash, leadoceanRecords: lo, canonicalMaxUsd: c, signalsMaxUsd: s, founderCheckMaxUsd: f };
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
    phoneLookups: null,
    founderCheck: a && a.founderCheckMaxUsd > 0 && d.flags.founderCheck ? { maxUsd: a.founderCheckMaxUsd, perCompany: 3 } : null,
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
      status: run.status, reason: run.reason, spend: run.spend, funnel: run.funnel, yield: run.yield, estimates: run.estimates, screening: run.screening, founderCheck: run.founderCheck,
      discovery: run.discovery, canonical: run.canonical, signals: run.signals && { spentUsd: run.signals.spentUsd, stopped: run.signals.stopped }, phones: run.phones,
      queue: run.queue, review: run.review, excludedCount: run.excluded.length, written: rows.length,
    },
  };
}

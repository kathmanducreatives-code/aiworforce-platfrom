// The `discovery-engine` edge function's logic, every dependency injected.
//
//   plan  {workspace_id, query, providers?}            member
//         GPT interprets the request (validated, grounded); the planner returns an
//         explainable plan and its exact worst case. No provider is called.
//   run   {workspace_id, query, spec, approval:{plan_hash, leadocean_records, apify_usd}}   owner/admin
//         The spec the user was SHOWN is re-validated against the query and re-planned
//         deterministically; the approval must name that plan's hash. Writes eligible
//         and needs-verification leads; existing Leads keep their ids. Never phones.
//
// Off (404) unless DISCOVERY_ENGINE_ENABLED and the workspace is in
// DISCOVERY_ENGINE_WORKSPACES. LeadOcean follows the provider-discovery flags and
// the workspace connection; Apify needs DISCOVERY_ENGINE_APIFY_ENABLED and a token;
// Apollo is registered and disabled.

import type { DiscoveryFlags, Env } from "../discoveryProviders/flags.ts";
import type { ConnectionStore } from "../discoveryProviders/connections.ts";
import type { UsageLedger } from "../discoveryProviders/budget.ts";
import type { ProviderId } from "../discoveryProviders/types.ts";
import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { DiscoveryAdapter } from "../discoveryProviders/adapter.ts";
import { ExclusionIndex, type ExistingRecord } from "../leadPipeline/exclusions.ts";
import type { EvidenceCache } from "./cache.ts";
import { executeDiscovery } from "./engine.ts";
import { planExecution, type PlannerContext } from "./planner.ts";
import { projectEngineLead, type EngineRow } from "./projection.ts";
import { interpretQuery, validateSpec, type InterpreterModel } from "./spec.ts";
import { leadOceanSource } from "./sources/leadocean.ts";
import { apifySource } from "./sources/apify.ts";
import { apolloSource } from "./sources/apollo.ts";

const on = (v: string | undefined) => !!v && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
export interface EngineFlags { enabled: boolean; workspaces: Set<string>; apify: boolean }
export function readEngineFlags(env: Env): EngineFlags {
  return {
    enabled: on(env("DISCOVERY_ENGINE_ENABLED")),
    workspaces: new Set((env("DISCOVERY_ENGINE_WORKSPACES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    apify: on(env("DISCOVERY_ENGINE_APIFY_ENABLED")),
  };
}

export interface EngineRequest {
  action: "plan" | "run";
  workspaceId: string;
  query: string;
  spec: unknown;
  approval: { planHash: string; leadoceanRecords: number; apifyUsd: number } | null;
}
export function parseEngineRequest(b: Record<string, unknown>): EngineRequest | null {
  if (b.action !== "plan" && b.action !== "run") return null;
  if (typeof b.workspace_id !== "string" || typeof b.query !== "string" || !b.query.trim() || b.query.length > 1000) return null;
  const a = b.approval as Record<string, unknown> | null | undefined;
  const ok = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
  if (b.action === "run" && (!a || typeof a.plan_hash !== "string" || !ok(a.leadocean_records, 500) || !ok(a.apify_usd, 20) || !b.spec)) return null;
  return { action: b.action, workspaceId: b.workspace_id, query: b.query.trim(), spec: b.spec ?? null,
    approval: a ? { planHash: String(a.plan_hash), leadoceanRecords: Number(a.leadocean_records), apifyUsd: Number(a.apify_usd) } : null };
}

export interface EngineDeps {
  userId: string | null;
  flags: EngineFlags;
  discoveryFlags: DiscoveryFlags;
  store: ConnectionStore;
  model: InterpreterModel;
  ledger: UsageLedger;
  cache: EvidenceCache;
  /** Workspace / provider spending limits (server-side, never from the client). */
  caps: { leadoceanRecords: number; apifyUsd: number };
  loadExisting(workspaceId: string): Promise<ExistingRecord[]>;
  leadoceanFor(apiKey: string): DiscoveryAdapter;
  apify: ActorInvoker | null;
  persist(rows: EngineRow[]): Promise<void>;
  now?: () => Date;
}

const ADMIN = new Set(["owner", "admin"]);

export async function handleEngine(req: EngineRequest, d: EngineDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = d.now ?? (() => new Date());
  if (!d.flags.enabled) return { status: 404, body: { error: "disabled" } };
  if (!d.userId) return { status: 401, body: { error: "sign in required" } };
  if (!d.flags.workspaces.has(req.workspaceId)) return { status: 403, body: { error: "the discovery engine is not enabled for this workspace" } };
  const role = await d.store.memberRole(d.userId, req.workspaceId);
  if (!role) return { status: 403, body: { error: "not a member of this workspace" } };
  if (req.action === "run" && !ADMIN.has(role)) return { status: 403, body: { error: "only a workspace owner or admin can approve a paid run" } };

  const lo = (await d.store.list(req.workspaceId)).find((x) => x.provider === "leadocean");
  const loOn = d.discoveryFlags.enabled && d.discoveryFlags.provider.leadocean && d.discoveryFlags.commercialTerms.leadocean;
  const ctx: PlannerContext = {
    providers: {
      leadocean: { enabled: loOn, permitted: lo?.status === "connected", reason: !loOn ? "LeadOcean is disabled by its feature flags" : lo?.status !== "connected" ? "LeadOcean is not connected for this workspace" : null },
      apify: { enabled: d.flags.apify && !!d.apify, permitted: true, reason: d.flags.apify && d.apify ? null : "Apify is disabled for the discovery engine" },
      apollo: { enabled: false, permitted: false, reason: "registered; not enabled until validated" },
    },
    caps: d.caps,
  };
  const parsed = req.action === "plan" ? await interpretQuery(req.query, d.model) : validateSpec(req.spec, req.query);
  if (!parsed.spec) return { status: 422, body: { error: parsed.error ?? "could not interpret the request", repairs: parsed.repairs } };
  const plan = planExecution(parsed.spec, ctx);
  if (req.action === "plan") return { status: 200, body: { spec: parsed.spec, repairs: parsed.repairs, plan } };

  const a = req.approval!;
  if (a.planHash !== plan.planHash) return { status: 409, body: { error: "the plan changed since it was approved", plan } };
  if (a.leadoceanRecords > d.caps.leadoceanRecords || a.apifyUsd > d.caps.apifyUsd) return { status: 409, body: { error: "the approval exceeds the workspace's provider limits" } };
  const key = await d.store.secret(req.workspaceId, "leadocean");
  const sources = {
    leadocean: leadOceanSource(key && loOn ? d.leadoceanFor(key) : null),
    apify: apifySource(ctx.providers.apify.enabled ? d.apify : null),
    apollo: apolloSource(null),
  } as Record<ProviderId, ReturnType<typeof apolloSource>>;
  const run = await executeDiscovery({
    workspaceId: req.workspaceId, runId: `de:${plan.planHash}`, spec: parsed.spec, plan,
    approval: { workspaceId: req.workspaceId, planHash: a.planHash, caps: { leadoceanRecords: a.leadoceanRecords, apifyUsd: a.apifyUsd }, approvedBy: d.userId, approvedAt: now().toISOString() },
    sources, apify: ctx.providers.apify.enabled ? d.apify : null, ledger: d.ledger, cache: d.cache,
    existing: new ExclusionIndex(await d.loadExisting(req.workspaceId), now), now,
  });
  if (run.status === "blocked") return { status: 409, body: { error: run.reason } };
  const rows = [...run.queue, ...run.review].map((l) => projectEngineLead(l, { workspaceId: req.workspaceId, run, query: req.query })).filter((x): x is EngineRow => !!x);
  await d.persist(rows);
  return { status: 200, body: { status: run.status, reason: run.reason, plan, steps: run.steps, spend: run.spend, cache: run.cache, budgetExhausted: run.budgetExhausted,
    queue: run.queue, review: run.review, rejectedCount: run.rejected.length, written: rows.length } };
}

// Run the fixed benchmark cohort against ONE provider, inside one approved budget.
//
//   1. Plan every step first: an exact-identity lookup per sendable known
//      company (LeadOcean: domain or LinkedIn URL; Apollo: domain only), and
//      the group-C discovery mission. Each plan's estimate is the server's
//      worst case for that step (runDiscovery caps spend at it).
//   2. Refuse the WHOLE run, before any call, if those worst cases sum past
//      the approved units. Nothing partial, nothing "close enough".
//   3. Execute through the existing orchestrator and ledger (idempotent keys,
//      charge_uncertain never re-bought, contact values redacted on arrival).
//      Stop the provider at the first auth / plan / scope / allowance /
//      uncertain-charge failure. No retry of anything paid.
//   4. Reconcile: the ledger's settled units against the provider's own usage
//      read (free) before and after, when the provider reports one.
//
// Decision-maker slots are skipped while unfilled. Suppressed slots are never
// sent (benchmark.sendable). The runner never enriches.

import { sendable, type Cohort, type ProviderBenchmarkResult, type CallTiming } from "./benchmark.ts";
import type { DiscoveryAdapter, SearchPage, UsageInfo } from "./adapter.ts";
import type { UsageLedger } from "./budget.ts";
import type { FetchLike } from "./http.ts";
import { runDiscovery, type DiscoveryRun } from "./orchestrator.ts";
import { planDiscovery, type DiscoveryPlan, type PlanLimits, type ProviderConnectionState } from "./routing.ts";
import type { CanonicalCompany } from "./normalize.ts";
import type { DiscoveryRequirements, ProviderCompany, ProviderId } from "./types.ts";

export const BENCHMARK_RUNNER_VERSION = "provider-benchmark-runner-v1" as const;

const STOP_KINDS = new Set(["auth_failed", "plan_restricted", "forbidden_scope", "allowance_exhausted", "charge_uncertain", "not_connected"]);

export interface RunnerInput {
  provider: Exclude<ProviderId, "apify">;
  cohort: Cohort;
  /** Group C, compiled once and used unchanged for every provider. */
  discovery: DiscoveryRequirements;
  /** The provider's adapter, built over the fetch it is given (timed here). */
  makeAdapter: (fetch: FetchLike) => DiscoveryAdapter;
  fetch: FetchLike;
  ledger: UsageLedger;
  workspaceId: string;
  /** The units the user approved for this provider's test. */
  approvedUnits: number;
  connection: ProviderConnectionState;
  /** Price of one unit in USD, from the approved budget; null when not priced. */
  usdPerUnit: number | null;
  now?: () => Date;
  clock?: () => number;
}

export interface RunnerStep {
  id: string;
  kind: "known_company" | "discovery";
  slot: string | null;
  plan: DiscoveryPlan | null;
  worstCaseUnits: number;
  skipped: string | null;
  run: Pick<DiscoveryRun, "status" | "reason" | "credits" | "counts"> | null;
  errorKind: string | null;
}

export interface RunnerReport {
  version: typeof BENCHMARK_RUNNER_VERSION;
  provider: ProviderId;
  refused: string | null;
  worstCaseUnits: number;
  approvedUnits: number;
  ledgerUnits: number;
  providerReportedUnits: number | null;
  reconciled: boolean | null;
  stoppedBy: string | null;
  steps: RunnerStep[];
  result: ProviderBenchmarkResult;
  /** Redacted raw pages (no contact values): re-parse with the adapter's normalizer, nothing re-bought. */
  rawPages: { step: string; raw: unknown }[];
}

function lookupRequirements(slot: string, identifier: string): DiscoveryRequirements {
  return {
    originalQuery: `benchmark known company ${slot}`, targetEntity: "company", requestedCount: 1,
    hard: [{ criterionId: `known:${slot}`, key: "known_companies", values: [identifier], label: `Known company ${slot}`, representable: true }],
    preferences: [], roles: [], forbidBroadening: ["geography", "industry", "size", "role"], forbidBroadeningUnread: [], criteria: [],
  };
}

function firstCompany(c: CanonicalCompany | undefined, provider: ProviderId): ProviderCompany | null {
  if (!c) return null;
  return {
    provider, recordId: c.sources[0]?.recordId ?? c.key, retrievedAt: c.sources[0]?.retrievedAt ?? "",
    name: c.name[0]?.value ?? null, domain: c.domain[0]?.value ?? null, linkedinUrl: c.linkedinUrl[0]?.value ?? null,
    hqCountry: c.hqCountry[0]?.value ?? null, hqRegion: c.hqRegion[0]?.value ?? null, hqCity: c.hqCity[0]?.value ?? null,
    employeeCount: c.employeeCount[0]?.value ?? null, employeeRange: c.employeeRange[0]?.value ?? null,
    industry: c.industry[0]?.value ?? null,
  };
}

export async function runProviderBenchmark(i: RunnerInput): Promise<RunnerReport> {
  const now = i.now ?? (() => new Date());
  const clock = i.clock ?? (() => performance.now());
  const timings: CallTiming[] = [];
  const timed: FetchLike = async (url, init) => {
    const t0 = clock();
    try { return await i.fetch(url, init); } finally { timings.push({ op: `${init.method} ${new URL(url).pathname}`, ms: Math.round(clock() - t0) }); }
  };
  const base = i.makeAdapter(timed);
  // Raw rows of the discovery step only (the duplicate-rate measure counts them).
  const rows: ProviderCompany[] = [];
  let capturing = false;
  // Every paid page's redacted raw copy, by step: replayable offline after a mapping fix.
  const rawPages: { step: string; raw: unknown }[] = [];
  let stepId = "";
  const adapter: DiscoveryAdapter = {
    ...base,
    async search(step, req, cursor, limit) {
      const page: SearchPage = await base.search(step, req, cursor, limit);
      if (page.raw !== undefined) rawPages.push({ step: stepId, raw: page.raw });
      if (capturing) rows.push(...page.companies, ...page.people.map((p) => p.company).filter((c): c is ProviderCompany => !!c));
      return page;
    },
  };
  const tight = (records: number): Partial<PlanLimits> => ({ maxRecordsPerStep: records, overfetch: 1, maxVerifications: 0 });

  // ── 1. Plan everything ──────────────────────────────────────────────────
  const steps: (RunnerStep & { req: DiscoveryRequirements | null })[] = [];
  for (const s of i.cohort.known_companies) {
    if (s.status !== "selected") continue;
    const id = `known:${s.slot}`;
    if (!sendable(s)) { steps.push({ id, kind: "known_company", slot: s.slot, plan: null, worstCaseUnits: 0, skipped: "suppressed (hold, CRM or existing Lead)", run: null, errorKind: null, req: null }); continue; }
    const identifier = i.provider === "apollo" ? s.domain : (s.domain ?? s.linkedin_url);
    if (!identifier) {
      steps.push({ id, kind: "known_company", slot: s.slot, plan: null, worstCaseUnits: 0, run: null, errorKind: null, req: null,
        skipped: i.provider === "apollo" ? "Apollo filters companies by domain only; this slot has no domain" : "no identifier" });
      continue;
    }
    const req = lookupRequirements(s.slot, identifier);
    const plan = planDiscovery({ requirements: req, connections: [i.connection], selection: [i.provider], limits: tight(1) });
    steps.push({ id, kind: "known_company", slot: s.slot, plan, worstCaseUnits: plan.estimatedCredits[i.provider] ?? 0,
      skipped: plan.steps.length ? null : `refused: ${plan.refused.map((r) => r.reason).join("; ")}`, run: null, errorKind: null, req });
  }
  const dplan = planDiscovery({ requirements: i.discovery, connections: [i.connection], selection: [i.provider], limits: tight(i.discovery.requestedCount) });
  steps.push({ id: "discovery", kind: "discovery", slot: null, plan: dplan, worstCaseUnits: dplan.estimatedCredits[i.provider] ?? 0,
    skipped: dplan.steps.length ? null : `refused: ${dplan.refused.map((r) => r.reason).join("; ")}`, run: null, errorKind: null, req: i.discovery });

  const worst = steps.reduce((n, s) => n + (s.skipped ? 0 : s.worstCaseUnits), 0);
  const empty: ProviderBenchmarkResult = { provider: i.provider, companyMatches: {}, personMatches: {}, discoveryRows: [], discoveryLeads: [], timings, unitsConsumed: 0, unit: i.provider === "apollo" ? "credits" : "records", costUsd: i.usdPerUnit === null ? null : 0 };
  const report = (o: Partial<RunnerReport>): RunnerReport => ({
    version: BENCHMARK_RUNNER_VERSION, provider: i.provider, refused: null, worstCaseUnits: worst, approvedUnits: i.approvedUnits,
    ledgerUnits: 0, providerReportedUnits: null, reconciled: null, stoppedBy: null,
    steps: steps.map(({ req: _r, ...s }) => s), result: empty, rawPages, ...o,
  });

  // ── 2. The budget gate: all or nothing ──────────────────────────────────
  if (worst > i.approvedUnits) return report({ refused: `worst case ${worst} units exceeds the approved ${i.approvedUnits}` });

  // ── 3. Execute ──────────────────────────────────────────────────────────
  const before: UsageInfo | null = await adapter.verifyKey().catch(() => null);
  const result: ProviderBenchmarkResult = { ...empty };
  let stoppedBy: string | null = null;
  let spent = 0;
  for (const s of steps) {
    if (s.skipped || !s.plan || !s.req) continue;
    if (stoppedBy) { s.skipped = `not run: provider stopped (${stoppedBy})`; continue; }
    capturing = s.kind === "discovery";
    stepId = s.id;
    const run = await runDiscovery({
      workspaceId: i.workspaceId, missionId: `benchmark:${i.cohort.version}:${i.provider}:${s.id}`, requirements: s.req, plan: s.plan,
      approval: { kind: "discovery", workspaceId: i.workspaceId, missionId: `benchmark:${i.cohort.version}:${i.provider}:${s.id}`, planHash: s.plan.planHash,
        maxCredits: { ...s.plan.estimatedCredits }, approvedBy: "benchmark-budget", approvedAt: now().toISOString() },
      adapters: { [i.provider]: adapter }, ledger: i.ledger, now,
    });
    s.run = { status: run.status, reason: run.reason, credits: run.credits, counts: run.counts };
    spent += run.credits[i.provider] ?? 0;
    const kind = run.steps.find((x) => x.errorKind)?.errorKind ?? null;
    s.errorKind = kind;
    if (kind && STOP_KINDS.has(kind)) stoppedBy = kind;
    if (s.kind === "known_company" && s.slot) result.companyMatches[s.slot] = firstCompany(run.leads[0]?.company, i.provider);
    if (s.kind === "discovery") result.discoveryLeads = run.leads;
  }
  result.discoveryRows = rows;
  result.unitsConsumed = spent;
  result.costUsd = i.usdPerUnit === null ? null : spent * i.usdPerUnit;

  // ── 4. Reconcile ────────────────────────────────────────────────────────
  const after: UsageInfo | null = await adapter.verifyKey().catch(() => null);
  const reported = before?.used != null && after?.used != null ? after.used - before.used : null;
  return report({
    result, stoppedBy, ledgerUnits: spent, providerReportedUnits: reported,
    reconciled: reported === null ? null : reported === spent,
  });
}

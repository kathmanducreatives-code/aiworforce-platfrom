// Multi-provider strategy canary — PROPOSED, NOT APPROVED. Dry run unless approved.
//
//   deno run --allow-read --allow-env scripts/lead-pipeline-strategy-canary.ts --stage s1
//       dry run: prints the exact plan, worst case and approval string; buys nothing
//   AGENTORY_PROVIDER_LIVE_TESTS=enabled deno run --allow-read --allow-write --allow-env \
//     --allow-net=api.apify.com[,api.leadocean.io] scripts/lead-pipeline-strategy-canary.ts \
//     --stage s1 --execute --approve "<the exact approval string>" --key-injected --out <file>
//
// Stages (each the smallest run that exercises one new path live):
//   s1  apify_only            "Find 1 US company currently hiring Account Executives."
//                             job search ≤4 postings + company records ≤2  (no LeadOcean)
//   s2  apify_plus_leadocean  "Find the founder at 1 US company currently hiring Account Executives."
//                             s1's Apify steps + LeadOcean people by domain ≤2 records
//
// The request's interpretation is a RECORDED model proposal compiled by the real
// mission compiler — no model call — so the plan hash is reproducible and the
// approval can name it. (GPT interpretation is exercised by the service and
// its tests; this canary validates the provider path.)
//
// Guards, all before any metered request:
//   * AGENTORY_PROVIDER_LIVE_TESTS=enabled (closed by default)
//   * --approve must equal: stage, strategy, plan hash, checked-out commit and caps
//   * free preflight: Apify GET /v2/users/me and monthly headroom ≥ the worst case;
//     LeadOcean GET /v1/account remaining ≥ the record cap (s2 only)
//   * Apify: allowlisted actors only (PIPELINE_ACTORS), maxTotalChargeUsd per run,
//     each actor at most once, ledger reservation first, no retries
//   * LeadOcean (s2): only POST /v1/search, once, body limit ≤ the cap; never /phone
//   * one shot: a lock file is written before the first paid request
//   * nothing is written to any database; nothing is sent; no one is called
// Keys are proxy-injected Network Secrets; this process sends placeholders.

import { assertLiveTestsEnabled } from "./_liveTestGate.ts";
import { compileLeadMission } from "../supabase/functions/_shared/leadMissionCompiler.ts";
import { leadOceanAdapter } from "../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import type { ActorInvoker } from "../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { memoryLedger } from "../supabase/functions/_shared/discoveryProviders/budget.ts";
import type { FetchLike } from "../supabase/functions/_shared/discoveryProviders/http.ts";
import { pipelineApifyInvoker } from "../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";
import { memoryCheckpointStore } from "../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { runDiscoveryStrategy } from "../supabase/functions/_shared/leadPipeline/multiProvider.ts";
import { planStrategy, specFromMission, type StrategyContext } from "../supabase/functions/_shared/leadPipeline/strategy.ts";

const WS = "00000000-0000-4000-8000-0000000057a1";
const BLANK = {
  requested_opportunity_count: 1, requested_contact_ready_count: null, company_types: [], geographies: ["United States"], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }], soft_preferences: [],
  preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: ["job_signal_first"], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: 30, required_signal_terms: ["Account Executive"], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: ["do not send outreach"], output_intent: "companies", strategies: ["hiring"],
};
export const STAGES = Object.freeze({
  s1: { query: "Find 1 US company currently hiring Account Executives.", proposal: BLANK, expect: "apify_only" },
  s2: { query: "Find the founder at 1 US company currently hiring Account Executives.", proposal: { ...BLANK, decision_maker_roles: ["Founder"], output_intent: "contacts" }, expect: "apify_plus_leadocean" },
});
export const CANARY_CTX: StrategyContext = {
  providers: { leadocean: { enabled: true, connected: true, authorized: true }, apify: { enabled: true, connected: true, authorized: true } },
  budget: { maxLeadoceanRecords: 2, maxApifyUsd: 0.02 },
};

export function canaryPlan(stage: keyof typeof STAGES) {
  const s = STAGES[stage];
  const mission = compileLeadMission({ originalUserQuery: s.query, proposal: s.proposal, requestedCount: 1 }).final_mission;
  const spec = specFromMission(mission as never, { defaultCount: 1 });
  return { spec, plan: planStrategy(spec, CANARY_CTX) };
}

export const approvalString = (stage: string, p: { strategy: string | null; planHash: string; estimate: { leadoceanRecords: number; apifyUsd: number } }, commit: string) =>
  `stage=${stage},strategy=${p.strategy},plan=${p.planHash},commit=${commit.slice(0, 12)},leadocean=${p.estimate.leadoceanRecords},apify_usd=${p.estimate.apifyUsd}`;

class Refusal extends Error {}

async function headCommit(): Promise<string> {
  const head = (await Deno.readTextFile(".git/HEAD")).trim();
  if (!head.startsWith("ref: ")) return head;
  const ref = head.slice(5);
  try { return (await Deno.readTextFile(`.git/${ref}`)).trim(); } catch {
    const packed = await Deno.readTextFile(".git/packed-refs");
    return packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0] ?? "unknown";
  }
}

/** Apify: each allowlisted actor at most once; anything else refused before a request. */
function apifyGuard(inner: ActorInvoker, allowed: string[]): ActorInvoker & { log: string[] } {
  const log: string[] = [];
  const g: ActorInvoker = (key, input, opts) => {
    if (!allowed.includes(key)) return Promise.reject(new Refusal(`refused: actor ${key} is not in this stage`));
    if (log.includes(key)) return Promise.reject(new Refusal(`refused: ${key} already ran once (no repeats)`));
    log.push(key);
    return inner(key, input, opts);
  };
  return Object.assign(g, { log });
}

/** LeadOcean: only POST /v1/search, once, within the record cap. Never a phone or enrich endpoint. */
function leadOceanGuard(inner: FetchLike, maxRecords: number): FetchLike {
  let searched = false;
  return (url, init) => {
    const u = new URL(url);
    if (u.host !== "api.leadocean.io") return Promise.reject(new Refusal(`refused: host ${u.host}`));
    if (init.method === "GET" && u.pathname === "/v1/account") return inner(url, init);
    if (init.method !== "POST" || u.pathname !== "/v1/search" || searched) return Promise.reject(new Refusal(`refused: ${init.method} ${u.pathname}`));
    const body = JSON.parse(String(init.body ?? "{}")) as { limit?: number };
    if (typeof body.limit !== "number" || body.limit > maxRecords) return Promise.reject(new Refusal(`refused: search limit ${body.limit} > ${maxRecords}`));
    searched = true;
    return inner(url, init);
  };
}

async function main() {
  const args = Deno.args;
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const stage = (arg("--stage") ?? "s1") as keyof typeof STAGES;
  if (!(stage in STAGES)) throw new Refusal("--stage must be s1 or s2");
  const { spec, plan } = canaryPlan(stage);
  const commit = await headCommit();
  console.log(`STRATEGY CANARY ${stage}: "${STAGES[stage].query}"`);
  console.log(`  plan ${plan.status} strategy=${plan.strategy} (${plan.selectedBy}) hash=${plan.planHash}`);
  for (const s of plan.steps) console.log(`  ${s.capability}: ≤${s.maxItems} — ${s.estimate.leadoceanRecords} LeadOcean records, $${s.estimate.apifyUsd}`);
  for (const l of plan.limitations) console.log(`  limitation ${l.code}: ${l.detail}`);
  console.log(`  WORST CASE: ${plan.estimate.leadoceanRecords} LeadOcean records, $${plan.estimate.apifyUsd} Apify`);
  console.log(`  APPROVAL STRING: ${approvalString(stage, plan, commit)}`);
  if (plan.status !== "ready" || plan.strategy !== STAGES[stage].expect) throw new Refusal(`refused: the plan is ${plan.status}/${plan.strategy}, expected ${STAGES[stage].expect}`);
  if (!args.includes("--execute")) { console.log("DRY RUN — nothing bought."); return; }

  assertLiveTestsEnabled();
  if (arg("--approve") !== approvalString(stage, plan, commit)) throw new Refusal(`refused: --approve must equal "${approvalString(stage, plan, commit)}"`);
  if (!args.includes("--key-injected")) throw new Refusal("refused: keys must be proxy-injected Network Secrets (--key-injected)");
  const realFetch: FetchLike = (u, i) => fetch(u, i);
  // Free preflight.
  const me = await fetch("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: "Bearer injected-by-proxy" } });
  const lim = (await me.json() as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } } }).data;
  if (me.status !== 200 || typeof lim?.current?.monthlyUsageUsd !== "number") throw new Refusal(`refused: cannot read Apify usage (${me.status})`);
  const before = lim.current.monthlyUsageUsd;
  if ((lim.limits?.maxMonthlyUsageUsd ?? 0) - before < plan.estimate.apifyUsd) throw new Refusal("refused: Apify monthly headroom below the worst case");
  const lo = leadOceanGuard(realFetch, plan.estimate.leadoceanRecords);
  if (plan.estimate.leadoceanRecords > 0) {
    const a = await (await lo("https://api.leadocean.io/v1/account", { method: "GET", headers: { "x-api-key": "injected-by-proxy" } })).json() as { data?: { records?: { remaining?: number } } };
    if ((a.data?.records?.remaining ?? 0) < plan.estimate.leadoceanRecords) throw new Refusal("refused: LeadOcean records below the cap");
  }
  const lock = arg("--lock") ?? `.strategy-canary-${stage}.lock`;
  try { await Deno.writeTextFile(lock, JSON.stringify({ stage, planHash: plan.planHash, commit, startedAt: new Date().toISOString() }), { createNew: true }); }
  catch { throw new Refusal(`refused: ${lock} exists — this stage already started once; reconcile first`); }

  const apifyRaw = pipelineApifyInvoker({ token: "injected-by-proxy", fetch: realFetch, timeoutMs: 120_000 });
  const apify = apifyGuard(apifyRaw, ["apify_linkedin_job_search", "apify_linkedin_company_details"]);
  const run = await runDiscoveryStrategy({
    workspaceId: WS, walkId: `strategy-canary-${stage}`, spec, plan,
    approval: { planHash: plan.planHash, leadoceanRecords: plan.estimate.leadoceanRecords, apifyUsd: plan.estimate.apifyUsd, approvedBy: "owner (strategy canary)", approvedAt: new Date().toISOString() },
    leadocean: plan.estimate.leadoceanRecords > 0 ? leadOceanAdapter({ apiKey: "injected-by-proxy", fetch: lo }) : null,
    apify, connections: [{ provider: "leadocean", connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: null, recentFailures: 0 }],
    ledger: memoryLedger(), checkpoints: memoryCheckpointStore(), existing: new ExclusionIndex([]),
  });
  let after = before;
  for (let i = 0; i < 6 && after <= before && apifyRaw.runs.length; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    after = ((await (await fetch("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: "Bearer injected-by-proxy" } })).json()) as { data?: { current?: { monthlyUsageUsd?: number } } }).data?.current?.monthlyUsageUsd ?? after;
  }
  const report = {
    stage, strategy: run.strategy, planHash: run.planHash, commit, status: run.status, reason: run.reason, steps: run.steps, spend: run.spend,
    reconciliation: { apifyRuns: apifyRaw.runs, apifyUsageBeforeUsd: before, apifyUsageAfterUsd: after, apifyDeltaUsd: Math.round((after - before) * 1e6) / 1e6, apifyCapUsd: plan.estimate.apifyUsd },
    evidenceRefused: run.evidenceRefused,
    leads: [...run.queue, ...run.review, ...run.excluded].map((l) => ({ company: l.company.domain, lane: l.rank.lane, qualification: l.statuses.qualification, gaps: l.qualification?.gaps, disproven: l.qualification?.disproven, record: l.canonicalRecord, person: l.person?.title ?? null, enrichment: l.statuses.enrichment })),
  };
  if (arg("--out")) await Deno.writeTextFile(arg("--out")!, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, spend: report.spend, reconciliation: report.reconciliation }, null, 2));
}

if (import.meta.main) await main();

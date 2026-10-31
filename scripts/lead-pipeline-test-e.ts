// Lead pipeline live test E — PROPOSED, NOT APPROVED. Dry run unless approved.
//
//   deno run --allow-read --allow-write --allow-env --allow-net=api.leadocean.io,api.apify.com \
//     scripts/lead-pipeline-test-e.ts [--icp a|b] --out <file>                       # dry run: prints the exact plan, buys nothing
//   ... --execute --approve "leadocean=15,apify_usd=0.18" --key-injected --apify-user <username>   # only after approval
// One shot: a lock file (--lock, default .test-e.lock) is created before the first paid request;
// a second execution is refused while it exists.
//
// One ICP walk, end to end:
//   LeadOcean people search  1 page × ≤10 rows, hasPhone narrowing     ≤10 records
//   Apify company records    harvestapi/linkedin-company, ≤10           ≤$0.05
//   Apify signals            company posts ≤3 + jobs ≤5, eligible only  ≤$0.13
//   LeadOcean phone lookups  eligible, unblocked, has_phone, top 5      ≤5 records
//   → shared qualification → ranking → queue, reconciled against both providers.
//
// Guards, all before any byte leaves:
//   * the approval string must equal the computed worst case exactly
//   * preflight (free): LeadOcean GET /v1/account — plan, remaining records ≥ worst
//     case, not over limit; Apify GET /v2/users/me — authenticated account
//   * a LeadOcean wire guard admits only POST /v1/search (≤ planned pages, each
//     body's limit ≤ the plan) and POST /v2/people/phone (≤ approved lookups),
//     each request once; anything else is refused
//   * Apify: allowlisted actors, maxTotalChargeUsd per run, ledger reservation
//     first, no repeats, no retries; a timeout counts the worst case and stops
//   * nothing is written to any database; nothing is sent; no one is called
// Keys are cloud Network Secrets the proxy injects; this process sends placeholders.

import { leadOceanAdapter } from "../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { memoryLedger } from "../supabase/functions/_shared/discoveryProviders/budget.ts";
import type { FetchLike } from "../supabase/functions/_shared/discoveryProviders/http.ts";
import { memoryCheckpointStore } from "../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex, type ExistingRecord } from "../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { configureIcp, ICP_A, ICP_B, type IcpConfig } from "../supabase/functions/_shared/leadPipeline/icp.ts";
import { runLeadPipeline, worstCase, type PipelineApprovals } from "../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { pipelineApifyInvoker } from "../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";

export const TEST_E = Object.freeze({
  test: "E", walkId: "test-e-1", requestedCount: 10, overfetch: 1,
  canonicalMaxUsd: 0.05,
  signals: { collect: { companyPosts: true, jobs: true, founderPosts: false }, maxPostsPerSubject: 3, maxJobsPerCompany: 5, windowDays: 60, maxUsd: 0.13 },
  phoneLookups: 5,
});
const LO = "https://api.leadocean.io";
const WS = "00000000-0000-4000-8000-00000000e2e0";

export function testEIcp(which: "a" | "b"): IcpConfig {
  const base = which === "b" ? ICP_B : ICP_A;
  return configureIcp(base, { requestedCount: TEST_E.requestedCount, leadocean: { ...base.leadocean, hasPhone: true } });
}

export function approvalsFor(): Omit<PipelineApprovals, "discovery"> {
  return { canonicalMaxUsd: TEST_E.canonicalMaxUsd, signals: TEST_E.signals, phoneLookups: { maxLookups: TEST_E.phoneLookups, approvedBy: "owner (test E)", approvedAt: new Date().toISOString() } };
}

export const approvalString = (w: { leadoceanRecords: number; apifyUsd: number }) => `leadocean=${w.leadoceanRecords},apify_usd=${w.apifyUsd}`;

export class ERefusal extends Error {}

/** GET /v1/account → records. The live response is {success, data:{records}} (seen 2026-10-31); a bare body is accepted too. */
export function accountRecords(json: unknown): { remaining: number; used: number; overLimit: boolean } | null {
  const j = (json ?? {}) as { data?: { records?: Record<string, unknown> }; records?: Record<string, unknown> };
  const r = j.data?.records ?? j.records;
  if (!r || typeof r.remaining !== "number" || typeof r.used !== "number") return null;
  return { remaining: r.remaining, used: r.used, overLimit: r.overLimit === true };
}

/** LeadOcean wire guard for test E. */
export function loGuard(inner: FetchLike, plan: { maxPages: number; pageSize: number; lookups: number }) {
  let pages = 0, lookups = 0;
  const seen = new Set<string>();
  const log: { path: string; status: number | null; credits: number | null }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.origin !== LO) throw new ERefusal(`refused: host ${u.host}`);
    const free = init.method === "GET" && u.pathname === "/v1/account";
    if (!free) {
      const sig = `${init.method} ${u.pathname} ${init.body ?? ""}`;
      if (seen.has(sig)) throw new ERefusal("refused: identical paid request already sent (no retries)");
      if (init.method === "POST" && u.pathname === "/v1/search") {
        const b = JSON.parse(init.body ?? "{}") as { limit?: number; reveal_email?: boolean };
        if (++pages > plan.maxPages) throw new ERefusal("refused: page ceiling");
        if (!b.limit || b.limit > plan.pageSize) throw new ERefusal("refused: page size above plan");
        if (b.reveal_email) throw new ERefusal("refused: reveal in discovery");
      } else if (init.method === "POST" && u.pathname === "/v2/people/phone") {
        if (++lookups > plan.lookups) throw new ERefusal("refused: phone lookup ceiling");
      } else throw new ERefusal(`refused: ${init.method} ${u.pathname} is not part of test E`);
      seen.add(sig);
    }
    const res = await inner(url, init);
    let credits: number | null = null;
    try { const j = await res.clone().json() as { meta?: { credits?: unknown } }; credits = typeof j?.meta?.credits === "number" ? j.meta.credits : null; } catch { /* */ }
    log.push({ path: u.pathname, status: res.status, credits });
    return res;
  };
  return { fetch, log };
}

async function apifyUsage(): Promise<{ used: number; limit: number }> {
  const r = await fetch("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: "Bearer injected-by-proxy" } });
  const d = (await r.json() as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } } }).data;
  if (r.status !== 200 || typeof d?.current?.monthlyUsageUsd !== "number") throw new ERefusal(`refused: cannot read Apify usage (${r.status})`);
  return { used: d.current.monthlyUsageUsd, limit: d.limits?.maxMonthlyUsageUsd ?? 0 };
}

async function main() {
  const args = Deno.args;
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const which = (arg("--icp") ?? "a") as "a" | "b";
  const out = arg("--out");
  const icp = testEIcp(which);
  const ledger = memoryLedger();
  const checkpoints = memoryCheckpointStore();
  const existing: ExistingRecord[] = arg("--existing") ? JSON.parse(await Deno.readTextFile(arg("--existing")!)) : [];
  const realFetch: FetchLike = (u, i) => fetch(u, i);
  const lo = loGuard(realFetch, { maxPages: 1, pageSize: TEST_E.requestedCount, lookups: TEST_E.phoneLookups });
  const deps = { apiKey: "injected-by-proxy", fetch: lo.fetch };
  const base = {
    workspaceId: WS, walkId: TEST_E.walkId, icp, connections: [{ provider: "leadocean" as const, connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: null, recentFailures: 0 }],
    limits: { overfetch: TEST_E.overfetch }, leadocean: leadOceanAdapter(deps), leadoceanDeps: deps, ledger, checkpoints, existing: new ExclusionIndex(existing),
    usdPerLeadOceanRecord: 0,
  };
  const approvals = approvalsFor();
  const dry = await runLeadPipeline({ ...base, apify: null, approvals: { ...approvals, discovery: null }, dryRun: true });
  const wc = worstCase(dry.plan, { ...approvals, discovery: null });
  console.log(`TEST E (ICP ${which.toUpperCase()}) plan ${dry.plan.status} hash=${dry.plan.planHash}`);
  for (const s of dry.plan.steps) console.log(`  ${s.provider} ${s.kind}: ${s.maxPages} page(s) × ≤${s.pageSize}, ≤${s.maxRecords} records`);
  for (const l of wc.lines) console.log(`  ${l}`);
  console.log(`  APPROVAL STRING: ${approvalString(wc)}`);
  if (!args.includes("--execute")) { console.log("DRY RUN — nothing bought."); return; }

  if (arg("--approve") !== approvalString(wc)) throw new ERefusal(`refused: --approve must equal "${approvalString(wc)}"`);
  if (!args.includes("--key-injected")) throw new ERefusal("refused: keys must be proxy-injected Network Secrets (--key-injected)");
  // Preflight, free.
  const acct = accountRecords(await (await lo.fetch(`${LO}/v1/account`, { method: "GET", headers: { "x-api-key": "injected-by-proxy" } })).json());
  if (!acct || acct.remaining < wc.leadoceanRecords || acct.overLimit) throw new ERefusal("refused: LeadOcean account cannot cover the worst case");
  const ap = await fetch("https://api.apify.com/v2/users/me", { headers: { Authorization: "Bearer injected-by-proxy" } });
  if (ap.status !== 200) throw new ERefusal(`refused: Apify account not authenticated (${ap.status})`);
  const apUser = (await ap.json() as { data?: { username?: string } }).data?.username ?? null;
  if (arg("--apify-user") && apUser !== arg("--apify-user")) throw new ERefusal("refused: Apify account is not the intended one");
  const apUsageBefore = await apifyUsage();
  if (apUsageBefore.limit - apUsageBefore.used < wc.apifyUsd) throw new ERefusal("refused: Apify monthly headroom below the worst case");
  // One shot: the in-memory ledger does not survive a process, so a second execution is refused
  // by a lock written BEFORE the first paid request (delete it only after reconciling).
  const lock = arg("--lock") ?? ".test-e.lock";
  try { await Deno.writeTextFile(lock, JSON.stringify({ test: "E", planHash: dry.plan.planHash, startedAt: new Date().toISOString() }), { createNew: true }); }
  catch { throw new ERefusal(`refused: ${lock} exists — test E already started once; reconcile before anything else`); }
  const apify = pipelineApifyInvoker({ token: "injected-by-proxy", fetch: realFetch, timeoutMs: 120_000 });
  const discovery = { kind: "discovery" as const, workspaceId: WS, missionId: `lp:${TEST_E.walkId}:r0`, planHash: dry.plan.planHash, maxCredits: { leadocean: dry.plan.estimatedCredits.leadocean ?? 0 }, approvedBy: "owner (test E)", approvedAt: new Date().toISOString() };
  const run = await runLeadPipeline({ ...base, apify, approvals: { ...approvals, discovery } });
  // Apify's usage counter can lag: re-read until it moves past the start value or ~60 s pass.
  let apUsageAfter = await apifyUsage();
  for (let i = 0; i < 6 && apUsageAfter.used <= apUsageBefore.used && apify.runs.length; i++) { await new Promise((r) => setTimeout(r, 10_000)); apUsageAfter = await apifyUsage(); }
  const after = accountRecords(await (await lo.fetch(`${LO}/v1/account`, { method: "GET", headers: { "x-api-key": "injected-by-proxy" } })).json());
  const report = {
    test: "E", icp: icp.id, status: run.status, reason: run.reason, spend: run.spend, yield: run.yield, funnel: run.funnel, estimates: run.estimates,
    reconciliation: { leadoceanBefore: acct.remaining, leadoceanAfter: after?.remaining ?? null, leadoceanCharged: run.spend.leadoceanRecords, apifyRuns: apify.runs,
      apifyUser: apUser, apifyUsageBeforeUsd: apUsageBefore.used, apifyUsageAfterUsd: apUsageAfter.used,
      apifyDeltaUsd: Math.round((apUsageAfter.used - apUsageBefore.used) * 1e6) / 1e6, apifyCapUsd: wc.apifyUsd },
    wire: lo.log, queue: run.queue, review: run.review, excluded: run.excluded.map((l) => ({ company: l.company.domain, reasons: l.qualification?.disproven })),
  };
  // contactValues are deliberately NOT written to the report.
  if (out) await Deno.writeTextFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, spend: report.spend, reconciliation: report.reconciliation, yield: report.yield }, null, 2));
}

if (import.meta.main) await main();

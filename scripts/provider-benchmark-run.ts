// Execute ONE approved provider benchmark test. Today: LeadOcean Test L only.
//
//   deno run --allow-read --allow-write --allow-env --allow-net=api.leadocean.io \
//     scripts/provider-benchmark-run.ts --test L --approve leadocean=13 --key-injected --out <file>
//   ... --dry-run   plans the run and prints its worst case; sends nothing
//
// Guards that sit OUTSIDE the runner, on the wire itself:
//   1. Only GET /v1/account (free) and POST /v1/search/companies, /v1/search.
//   2. The sum of `limit` over every paid request may never exceed the approved
//      records (LeadOcean bills rows returned, never more than `limit`).
//   3. A paid request identical to one already sent is refused before it
//      leaves: no retry of a metered call, however the code above asks for one.
// The key is a cloud Network Secret the proxy adds; this process sends a
// placeholder and never sees it.

import { compileLeadMission } from "../supabase/functions/_shared/leadMissionCompiler.ts";
import { leadOceanAdapter } from "../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { scoreProvider, type Cohort } from "../supabase/functions/_shared/discoveryProviders/benchmark.ts";
import { runProviderBenchmark } from "../supabase/functions/_shared/discoveryProviders/benchmarkRunner.ts";
import { memoryLedger } from "../supabase/functions/_shared/discoveryProviders/budget.ts";
import { leadEvidence } from "../supabase/functions/_shared/discoveryProviders/evidenceContract.ts";
import type { FetchLike } from "../supabase/functions/_shared/discoveryProviders/http.ts";
import { requirementsFromMission } from "../supabase/functions/_shared/discoveryProviders/requirements.ts";

/** The approval on record (2026-10-31): Test L, LeadOcean Free plan, at most 13 records, $0. */
export const APPROVED = Object.freeze({ test: "L", provider: "leadocean", maxRecords: 13, usd: 0 });
const ALLOWED: ReadonlyArray<[string, string, boolean]> = [
  ["GET", "/v1/account", false], ["POST", "/v1/search/companies", true], ["POST", "/v1/search", true],
];

export class WireRefusal extends Error {}

/** The wire guard: allowlist, record ceiling over `limit`, no repeat of a paid request. */
export function wireGuard(inner: FetchLike, maxRecords: number) {
  const sent = new Set<string>();
  const log: { method: string; path: string; paid: boolean; limit: number | null; status: number | null; credits: number | null }[] = [];
  let committedLimit = 0;
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const rule = ALLOWED.find(([m, p]) => m === init.method && p === u.pathname);
    if (u.host !== "api.leadocean.io" || !rule) throw new WireRefusal(`refused before sending: ${init.method} ${u.host}${u.pathname} is not in Test L`);
    const paid = rule[2];
    let limit: number | null = null;
    if (paid) {
      const body = JSON.parse(init.body ?? "{}") as { limit?: unknown };
      limit = typeof body.limit === "number" ? body.limit : NaN;
      if (!Number.isInteger(limit) || limit < 1) throw new WireRefusal("refused before sending: a paid request without an explicit limit");
      const sig = `${init.method} ${u.pathname} ${init.body}`;
      if (sent.has(sig)) throw new WireRefusal("refused before sending: a repeat of a paid request (no retries of metered calls)");
      if (committedLimit + limit > maxRecords) throw new WireRefusal(`refused before sending: limits would total ${committedLimit + limit} > ${maxRecords} records`);
      sent.add(sig);
      committedLimit += limit;
    }
    const entry = { method: init.method, path: u.pathname, paid, limit, status: null as number | null, credits: null as number | null };
    log.push(entry);
    const res = await inner(url, init);
    entry.status = res.status;
    if (paid) {
      try { const j = await res.clone().json() as { meta?: { credits?: unknown } }; entry.credits = typeof j?.meta?.credits === "number" ? j.meta.credits : null; } catch { /* non-JSON */ }
    }
    return res;
  };
  return { fetch, log, committed: () => committedLimit };
}

if (import.meta.main) {
  const arg = (n: string) => { const i = Deno.args.indexOf(n); return i >= 0 ? Deno.args[i + 1] : undefined; };
  const dry = Deno.args.includes("--dry-run");
  if (arg("--test") !== APPROVED.test) throw new Error(`only Test ${APPROVED.test} is approved`);
  const approve = arg("--approve");
  if (approve !== `${APPROVED.provider}=${APPROVED.maxRecords}`) throw new Error(`--approve must be exactly ${APPROVED.provider}=${APPROVED.maxRecords}`);
  if (!dry && !Deno.args.includes("--key-injected")) throw new Error("the LeadOcean key must be a proxy-injected Network Secret (--key-injected)");
  const out = arg("--out");
  const root = new URL("../", import.meta.url);
  const cohort = JSON.parse(await Deno.readTextFile(new URL("benchmarks/provider-discovery/cohort.json", root))) as Cohort;
  const mc = JSON.parse(await Deno.readTextFile(new URL("benchmarks/provider-discovery/mission-c-proposal.json", root)));
  const discovery = requirementsFromMission(compileLeadMission({ originalUserQuery: mc.query, proposal: mc.proposal, requestedCount: mc.proposal.requested_opportunity_count }).final_mission as never);

  const real: FetchLike = dry ? (() => { throw new WireRefusal("dry run: nothing is sent"); }) as never : (url, init) => fetch(url, init);
  const guard = wireGuard(real, APPROVED.maxRecords);
  const started = new Date().toISOString();
  const rep = await runProviderBenchmark({
    provider: "leadocean", cohort, discovery, fetch: guard.fetch, ledger: memoryLedger(), workspaceId: "benchmark-test-l",
    // Placeholder: the proxy replaces it with the Network Secret.
    makeAdapter: (f) => leadOceanAdapter({ apiKey: "injected-by-proxy", fetch: f }),
    approvedUnits: dry ? 0 : APPROVED.maxRecords, connection: { provider: "leadocean", connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: null, recentFailures: 0 },
    usdPerUnit: APPROVED.usd,
  });
  const score = scoreProvider(cohort, rep.result, null, new Date().toISOString());
  const roles = discovery.roles;
  const output = {
    test: APPROVED, started, finished: new Date().toISOString(), dryRun: dry,
    wire: { requests: guard.log, committedLimit: guard.committed() },
    runner: { ...rep, result: undefined },
    score,
    leads: rep.result.discoveryLeads.map((l) => ({
      status: l.status, providerStatus: l.providerStatus, rejectionBasis: l.rejectionBasis, reasons: l.reasons,
      shared: l.shared, evidence: leadEvidence(l, roles),
    })),
    knownCompanies: rep.result.companyMatches,
  };
  const text = JSON.stringify(output, null, 2);
  if (out) await Deno.writeTextFile(out, text);
  console.log(JSON.stringify({ dryRun: dry, refused: rep.refused, worstCaseUnits: rep.worstCaseUnits, approvedUnits: rep.approvedUnits, stoppedBy: rep.stoppedBy, ledgerUnits: rep.ledgerUnits, providerReportedUnits: rep.providerReportedUnits, reconciled: rep.reconciled, wire: guard.log }, null, 1));
}

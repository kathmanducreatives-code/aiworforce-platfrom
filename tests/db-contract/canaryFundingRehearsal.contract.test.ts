// THE FIRST REAL-APIFY CANARY, REHEARSED OFFLINE ON THE ADMISSION SCHEMA.
//
//   "Find one US company hiring Account Executives that raised funding within
//    the last six months."
//
// The real path — compile, kickoff authorization over the canary catalog
// (docs/launch/proposals/smoke-catalog-canary-funding.json), the worker runner,
// run-agent, the SQL admission gate, PostgREST and the Lead Library writer —
// with only the vendors scripted (job search, company details, Atomus). The
// paid canary's proposed start limits are used with SYNTHETIC prices, so what
// the gate would admit, refuse and charge is pinned before any real purchase.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { company, daysAgo, job, runScenario } from "./lib/discoveryScenario.ts";
import { seedWorkspace, sql } from "./lib/harness.ts";
import { reconcilePriorLiability } from "./lib/smokeMission.ts";
import { prepareKickoff } from "../../scripts/test-project/real-gpt/prepareKickoff.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
// Literal paths, so the CI dependency scanner (scripts/ci/planCore.mjs) can name every read.
const CATALOG = JSON.parse(Deno.readTextFileSync(new URL("../../docs/launch/proposals/smoke-catalog-canary-funding.json", import.meta.url)));
const PROPOSAL = JSON.parse(Deno.readTextFileSync(new URL("../../docs/launch/proposals/canary-funding-reviewed-mission-proposal.json", import.meta.url)));
export const CANARY_GOAL = "Find one US company hiring Account Executives that raised funding within the last six months.";

/** The catalog as the operator completes it (synthetic prices standing in for observed ones). */
function quotes(): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, t] of Object.entries(CATALOG.approved_quotes as Record<string, Record<string, unknown>>)) {
    out[k] = { ...t, source: "synthetic contract control (not a vendor quote)" };
  }
  return out;
}

const funded = company("funded", { name: "Fundly Software" });
const stale = company("stale", { name: "Stalefund Software" });
const unknown = company("unknownfund", { name: "Quietco Software" });
const atomusRow = (co: Record<string, unknown>, rounds: Array<[string, number]>) => ({
  input: co.linkedinUrl, status: "success",
  summary: { linkedin_url: co.linkedinUrl, domain: String(co.website).replace(/^https?:\/\//, ""), last_updated: daysAgo(2) },
  company: { financial: { funding: { num_funding_rounds: rounds.length,
    rounds: rounds.map(([type, d]) => ({ type, announced_at: daysAgo(d).slice(0, 10), raised_amount: 5_000_000, investors: ["Fund I"] })) } } },
});
const ATOMUS: Record<string, Record<string, unknown>> = {
  [String(funded.linkedinUrl)]: atomusRow(funded, [["series_a", 60]]),
  [String(stale.linkedinUrl)]: atomusRow(stale, [["seed", 300]]),
};

const PAID_CANARY_LIMITS = Object.fromEntries(Object.entries(CATALOG.actor_limits_proposed_for_paid_canary)
  .filter(([k]) => k !== "note")) as Record<string, number>;
const canary = (label: string) => runScenario({
  label, goal: CANARY_GOAL, proposal: PROPOSAL, quotes: quotes(), actorLimits: PAID_CANARY_LIMITS,
  requestedCount: 1, runBudget: { provider_usd: 0.20, max_candidates: 3 },
  jobs: [job("funded", funded, {}, 3), job("stale", stale, {}, 4), job("unknownfund", unknown, {}, 5)],
  atomus: (url) => ATOMUS[url] ?? null,
});
const UP = Deno.readTextFileSync(new URL("../../supabase/migrations-held/20261029120000_smoke_read_cap_seven.sql", import.meta.url));
const VERIFY = Deno.readTextFileSync(new URL("../../scripts/test-project/canary-funding-verify.sql", import.meta.url));
const DOWN = Deno.readTextFileSync(new URL("../../supabase/migrations-held/rollback/20261029120000_smoke_read_cap_seven.down.sql", import.meta.url));
/** A held migration's statements, inside the client's own transaction (it refuses a bare begin/commit). */
const apply = (file: string) => sql.begin((tx) => tx.unsafe(file.replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, "")));
const provider = (r: Awaited<ReturnType<typeof runScenario>>) => r.of("provider").map((o) => [o.actor, Number(o.committed_microusd)]);

Deno.test("CANARY TODAY (BLOCKER): on the current admission schema the canary catalog is refused at authorization — nothing can start", opts, async () => {
  // Jobs 3 + details 2 + Atomus 2 reads: over the held migration's five-read cap.
  await assertRejects(() => canary("canary-today"), Error, "sum to at most 5");
  const [c] = await sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'discovery_smoke_authorizations_provider_polls_check'`;
  assert(String(c.d).includes("<= 5"), "the current cap is five");
});

Deno.test("CANARY WITH THE PROPOSED READ CAP: funding verified, only the funded company qualifies, every cap holds", opts, async () => {
  await apply(UP);
  try {
    const r = await canary("canary-read-cap-seven");
    console.log("CANARY_OUTCOME", JSON.stringify(r.outcome));
    // Interpretation reached the worker intact: two separate windows, nothing dropped.
    assertEquals((r.trace.compiled_mission.required_signals as Array<Record<string, unknown>>).map((s) => [s.event ?? s.type, s.timeframe_days]),
      [["hiring", 30], ["funding", 180]]);
    const actors = provider(r).map(([a]) => a);
    assertEquals(actors, ["apify:harvestapi~linkedin-job-search", "apify:harvestapi~linkedin-company", "apify:atomus~linkedin-company-scraper"]);
    assert(!r.vendorRequests.some((v) => v.path.includes("pvalyou")), "no unapproved fallback");
    // Hard caps, as the gate counted them.
    const committed = (k: string) => r.of(k).reduce((a, o) => a + Number(o.committed_microusd), 0);
    assert(committed("provider") <= 18_600, `provider ${committed("provider")} µ$`);
    assert(committed("model") <= 50_000 && r.outcome.committed <= 250_000);
    assert(r.outcome.polls <= 7, `reads ${r.outcome.polls}`);
    assertEquals(new Set(actors).size, actors.length, "one start per approved actor");
    for (const q of r.trace.requests as Array<Record<string, unknown>>) {
      if (q.method === "POST" && q.host === "api.apify.com") {
        const cap = Number(new Map(q.query as [string, string][]).get("maxTotalChargeUsd"));
        assert(cap > 0 && cap <= 0.01055, `vendor-side charge cap on every start (${cap})`);
      }
    }
    // The decision: funded within 180 days qualifies; the others never do.
    assertEquals(r.outcome.qualified, ["Fundly Software"], JSON.stringify(r.outcome.leads));
    assertEquals(r.outcome.runner, "completed");
    // Model attempts beyond the four admitted are refused BEFORE sending — never bought.
    assert(r.outcome.models <= 4 && r.refused.every((x) => x === "usd_limit"), JSON.stringify(r.refused));
    const lead = r.leads.find((l) => l.raw?.company_name === "Fundly Software")!;
    const ev = (lead.raw.canonical_decision.hard_evidence ?? []) as Array<Record<string, unknown>>;
    assertEquals(ev.find((e) => e.dimension === "funding")?.source, "apify_funding_atomus");
    assertEquals(ev.find((e) => e.dimension === "funding")?.corroborated, false, "one provider's record, not independently confirmed");
    assertEquals(r.leads.filter((l) => l.raw?.company_name === "Fundly Software").length, 1, "one row per company");
    for (const l of r.leads) assertEquals(l.workspace_id, r.m.ws, "written only in the canary workspace");
    // The operator's post-run verification (scripts/test-project/canary-funding-verify.sql), on these rows.
    const verify = VERIFY.replaceAll(":'workspace_id'", `'${r.m.ws}'`).replaceAll(":'queue_id'", `'${r.m.queueId}'`);
    const rows = await sql.unsafe(verify.split(";\n\n-- The funding record")[0]) as unknown as Array<Record<string, string>>;
    for (const c of rows.filter((x) => x.id !== "C10")) assert(c.result !== "FAIL", `${c.id} ${c.what}: ${c.actual}`);
    assertEquals(rows.find((x) => x.id === "C05")!.actual, "1");
  } finally {
    // THIS THROWAWAY DATABASE ONLY: the rollback refuses while an authorization
    // holds more than 5 reads (by design), so the rehearsal's own rows are
    // returned to the old cap first.
    await sql`update public.discovery_smoke_authorizations set provider_polls = 5 where provider_polls > 5`;
    await apply(DOWN);
  }
  const [c] = await sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'discovery_smoke_authorizations_provider_polls_check'`;
  assert(String(c.d).includes("<= 5"), "rolled back to the current cap");
});

Deno.test("THE GENERATED PAID KICKOFF SQL runs on the proposed read cap, and is refused on today's", opts, async () => {
  const ws = await seedWorkspace();
  const user = crypto.randomUUID();
  await sql`insert into auth.users (id, email) values (${user}, ${"canary-" + user + "@example.invalid"})`;
  const kickoff = () => prepareKickoff({
    scenario: "canary_funding", project_ref: "abcdefghijklmnopqrst", workspace_id: ws, user_id: user,
    queue_id: crypto.randomUUID(), plan_id: crypto.randomUUID(), pricing_version: "contract", catalog: CATALOG.approved_quotes,
    prices: { jobs_maximum_microusd: 4000, details_maximum_microusd: 4050, atomus_maximum_microusd: 10550,
      observed_at: new Date().toISOString(), source: "synthetic contract control (not a vendor quote)" },
    compile: () => Promise.resolve(structuredClone(PROPOSAL)),
    paid: { approved_by: "contract test", actor_limits: PAID_CANARY_LIMITS },
  });
  await reconcilePriorLiability();
  const today = await kickoff();
  await assertRejects(() => apply(today.sql), Error, "sum to at most 5");
  const [none] = await sql`select count(*)::int as n from public.lead_mission_queue where id = ${String((today.request as Record<string, unknown>).plan_id)}`;
  assertEquals(none.n, 0, "the refused kickoff left nothing queued");
  await apply(UP);
  try {
    const k = await kickoff();
    await apply(k.sql);
    const [a] = await sql`select a.actor_limits, a.provider_polls, q.status from public.discovery_smoke_authorizations a
      join public.lead_mission_queue q on q.id = a.queue_id where q.workspace_id = ${ws}`;
    assertEquals(a.actor_limits, PAID_CANARY_LIMITS);
    assertEquals(a.status, "queued");
    assert(a.provider_polls <= 7);
    // Never left claimable by another test in this shared database.
    await sql`update public.lead_mission_queue set status = 'cancelled' where workspace_id = ${ws}`;
    await sql`select public.stop_discovery_smoke(q.id, 'contract test: kickoff only') from public.lead_mission_queue q where q.workspace_id = ${ws}`;
  } finally {
    await sql`update public.discovery_smoke_authorizations set provider_polls = 5 where provider_polls > 5`;
    await apply(DOWN);
  }
});

// LEAD V2 QUALITY REGRESSIONS — EVIDENCE QUALITY AND PROVIDER FAILURES (T*, U*, RC14).
//
// Whole missions through the production engine, verifiers, canonical view,
// continuation and the REAL queue SQL (Replay Lab `runGoldenMission`), with the
// golden `qualified` mission's provider rows altered one way each. Zero provider
// calls, zero credits, zero production writes.
//
// Moved from the quality run's scratchpad probes (2026-10-06). Every test asserts
// the EXPECTED behaviour; T02 and T07 fail on code with the root cause, the rest
// passed in the run and are kept as guards.
//
// Not encoded: T08 (size from `employeeCount` alone stays unknown) — the run
// marked it QUESTIONABLE and the current rule ("the member count is never read",
// companySize.ts) is deliberate, so there is no agreed expected behaviour yet.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { daysAgo, GOLDEN, li } from "../replay/golden/scenarios.ts";
import { type GoldenMission, runGoldenMission, spendOf } from "../replay/lib/mission.ts";
import type { FixtureProviderResponse } from "../replay/lib/fixture.ts";
import { qcase } from "./lib/cases.ts";

const ACME = li("acme");
const SEARCH = "apify_linkedin_company_search", DETAILS = "apify_linkedin_company_details", ATOMUS = "apify_funding_atomus",
  PVALYOU = "apify_funding_pvalyou", JOBS = "apify_linkedin_job_search";
type Row = Record<string, unknown>;
type Responses = FixtureProviderResponse[];

/** The golden QUALIFIED mission (Canary 8's card: hard US, 11–50, funding ≤730d, a sales role ≤30d) with its rows altered. */
function variant(name: string, edit: (rs: Responses) => Responses): GoldenMission {
  const g = GOLDEN.qualified();
  g.name = `quality-${name}`;
  g.responses = edit(structuredClone(g.responses));
  return g;
}
const swap = (rs: Responses, actor: string, f: (r: FixtureProviderResponse) => FixtureProviderResponse | null) =>
  rs.flatMap((r) => r.actor === actor ? (f(r) ? [f(r)!] : []) : [r]);
const profileRows = (rs: Responses, f: (row: Row) => Row) =>
  rs.map((r) => (r.actor === SEARCH || r.actor === DETAILS) ? { ...r, rows: r.rows.map(f) } : r);

async function observe(g: GoldenMission) {
  const r = await runGoldenMission(g);
  const lead = r.view.leads.find((l) => l.company.key === ACME);
  return {
    r, lead, terminal: r.terminal, qualified: r.qualifiedKeys, bucket: lead?.bucket ?? null,
    hard: lead?.hard_checks ?? null, calls: r.provider.calls.filter((c) => !c.adopted).map((c) => c.actor),
  };
}

const job = (title: string, posted: string | null, companySlug = "acme"): Row => ({
  id: `job-${companySlug}-${title.length}`, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${companySlug}-${title.length}/`,
  descriptionText: `${companySlug} is hiring a ${title}.`, ...(posted ? { postedDate: posted } : {}), location: { linkedinText: "Austin, TX" },
  company: { id: companySlug, universalName: companySlug, name: companySlug, linkedinUrl: li(companySlug), website: `https://${companySlug}.com`,
    employeeCount: 30, industries: ["Software Development"], locations: [{ city: "Austin", country: "US" }] },
});
const withJobs = (rows: Row[]) => (rs: Responses) => swap(rs, JOBS, (r) => ({ ...r, rows }));

// ══ FIX WAVE 1 — CURRENTLY FAILING ══════════════════════════════════════════

Deno.test(qcase({
  id: "T07", rc: "T07", boundary: "fixture",
  query: "golden QUALIFIED card (hard US) — company record: HQ Toronto, Canada (headquarter: true) + an Austin, US office (headquarter: false)",
  current: "geography PASS → qualified, quota_met → completed: a Canadian-headquartered company satisfied a hard US requirement",
  expected: "hard geography reads the headquarters: geography is not pass and the company is not qualified",
}), async () => {
  const loc = [{ parsed: { text: "Toronto, ON, Canada", countryFull: "Canada" }, country: "CA", headquarter: true },
    { parsed: { text: "Austin, TX, United States", countryFull: "United States" }, country: "US", headquarter: false }];
  const o = await observe(variant("non-hq-us", (rs) => profileRows(rs, (x) => ({ ...x, locations: loc }))));
  assert(o.hard?.geography !== "pass", `geography ${o.hard?.geography}`);
  assert(!o.qualified.includes(ACME), `qualified: ${o.qualified}`);
});

Deno.test(qcase({
  id: "T02", rc: "T02", boundary: "fixture",
  query: "golden QUALIFIED card (sales role open in the last 30 days) — the job search returns one Account Executive posting with NO posted date",
  current: "hiring PASS → qualified, completed: `withinWindow` treats an undated posting as inside the 30-day window",
  expected: "an undated posting does not prove 'currently hiring': hiring is not pass and the company is not qualified",
}), async () => {
  const o = await observe(variant("undated-job", withJobs([job("Account Executive", null)])));
  assert(o.hard?.hiring !== "pass", `hiring ${o.hard?.hiring}`);
  assert(!o.qualified.includes(ACME), `qualified: ${o.qualified}`);
});

Deno.test(qcase({
  id: "T10", rc: "RC14", boundary: "fixture",
  query: "golden QUALIFIED card — every hard claim proven (US, 11–50, Series A 200 days ago, an AE role 5 days old)",
  current: "bucket low_priority — the lowest qualified label, because the company_profile anchor has no evidence dimension and is never proven",
  expected: "a company proving every hard requirement is labelled at least strong_opportunity",
}), async () => {
  const o = await observe(GOLDEN.qualified());
  assertEquals(o.hard, { geography: "pass", company_size: "pass", funding: "pass", hiring: "pass" });
  assert(o.bucket === "exact_match" || o.bucket === "strong_opportunity", `bucket ${o.bucket}`);
});

// ══ GUARDS — PASSED IN THE QUALITY RUN ══════════════════════════════════════

for (const [id, what, edit, field] of [
  ["T01", "a sales posting 45 days old (window 30)", withJobs([job("Account Executive", daysAgo(45))]), "hiring"],
  ["T03", "an engineering posting for a SALES requirement", withJobs([job("Senior Software Engineer", daysAgo(3))]), "hiring"],
  ["T04", "a posting from a DIFFERENT company", withJobs([job("Account Executive", daysAgo(3), "othercorp")]), "hiring"],
  ["T05", "a Series A 800 days ago (window 730)", (rs: Responses) => swap(rs, ATOMUS, (r) => {
    const x = structuredClone(r) as unknown as { rows: Array<{ company: { financial: { funding: { rounds: Array<Record<string, unknown>> } } } }> };
    x.rows[0].company.financial.funding.rounds[0].announced_at = daysAgo(800); return x as unknown as FixtureProviderResponse;
  }), "funding"],
  ["T06", "a round with no date", (rs: Responses) => swap(rs, ATOMUS, (r) => {
    const x = structuredClone(r) as unknown as { rows: Array<{ company: { financial: { funding: { rounds: Array<Record<string, unknown>> } } } }> };
    delete x.rows[0].company.financial.funding.rounds[0].announced_at; return x as unknown as FixtureProviderResponse;
  }), "funding"],
  ["T09", "a declared band of 51–200 with employeeCount 48", (rs: Responses) =>
    profileRows(rs, (x) => ({ ...x, employeeCountRange: { start: 51, end: 200 }, employeeCount: 48 })), "company_size"],
  ["U05", "a company record with no locations", (rs: Responses) =>
    profileRows(rs, (x) => { const y = { ...x }; delete y.locations; return y; }), "geography"],
] as const) {
  Deno.test(qcase({
    id, rc: id.startsWith("U") ? "U" : "T", boundary: "fixture", query: `golden QUALIFIED card — ${what}`,
    current: `${field} not pass, not qualified (correct in the run)`,
    expected: `${field} is not pass and the company is not qualified`,
  }), async () => {
    const o = await observe(variant(id, edit as (rs: Responses) => Responses));
    assert(o.hard?.[field as keyof typeof o.hard] !== "pass", `${field} ${JSON.stringify(o.hard)}`);
    assert(!o.qualified.includes(ACME), `qualified: ${o.qualified}`);
  });
}

Deno.test(qcase({
  id: "T10", rc: "T", boundary: "fixture", query: "golden QUALIFIED card — every hard claim proven",
  current: "every proven hard claim cites its provider evidence (correct in the run)",
  expected: "funding cites Atomus and hiring cites the job posting",
}), async () => {
  const o = await observe(GOLDEN.qualified());
  const ev = o.lead!.key_evidence.filter((e) => e.status === "proven");
  assert(ev.some((e) => e.dimension === "funding" && e.sources.includes(ATOMUS)));
  assert(ev.some((e) => e.dimension === "hiring" || e.dimension === "job"));
});

Deno.test(qcase({
  id: "U01", rc: "U", boundary: "fixture", query: "golden QUALIFIED card — the job search throws",
  current: "no crash; hiring unknown; not qualified; the search ends (correct in the run)",
  expected: "no crash, not qualified, the failed job search is never paid for and is one purchase identity across retries, the lineage ends",
}), async () => {
  const o = await observe(variant("jobs-throw", (rs) => rs.filter((r) => r.actor !== JOBS)));
  assert(!o.qualified.includes(ACME));
  const hiringRes = o.r.ledger.reservations.filter((x) => x.purpose === "hiring_evidence");
  // A failed call is RELEASED and may be retried next slice under the same key — never committed, never a second purchase.
  assertEquals(hiringRes.filter((x) => x.status === "executed" || x.status === "settled").length, 0, "a failed search committed spend");
  assertEquals(new Set(hiringRes.map((x) => x.idempotency_key)).size, 1, "retries are one purchase identity");
  assert(o.terminal !== null, "the lineage ends");
});

Deno.test(qcase({
  id: "U02", rc: "U", boundary: "fixture", query: "golden QUALIFIED card — Atomus throws, Pvalyou knows nothing",
  current: "funding unknown, not qualified (correct in the run)",
  expected: "funding never passes without evidence",
}), async () => {
  const o = await observe(variant("atomus-throw", (rs) => [...rs.filter((r) => r.actor !== ATOMUS),
    { actor: PVALYOU, rows: [], provenance: "Pvalyou: nothing on record" }]));
  assert(o.hard?.funding !== "pass");
  assert(!o.qualified.includes(ACME));
});

Deno.test(qcase({
  id: "U03", rc: "U", boundary: "fixture", query: "golden QUALIFIED card — company details throws",
  current: "size and geography unknown, nothing bought for the company, not qualified (correct in the run)",
  expected: "no crash, not qualified, no verifier purchase for an unresolved record",
}), async () => {
  const o = await observe(variant("details-throw", (rs) => rs.filter((r) => r.actor !== DETAILS)));
  assert(!o.qualified.includes(ACME));
  assertEquals(o.calls.filter((c) => c === ATOMUS || c === JOBS), []);
});

Deno.test(qcase({
  id: "U06", rc: "U", boundary: "fixture", query: "golden QUALIFIED card — page 1 lists the same company three times (case / trailing-slash variants)",
  current: "Atomus and the job search each bought once (correct in the run)",
  expected: "one company, each verifier bought once",
}), async () => {
  const o = await observe(variant("dup-company", (rs) => swap(rs, SEARCH, (r) =>
    (r.input_match as Record<string, unknown> | undefined)?.startPage === 1
      ? { ...r, rows: [...r.rows, { ...r.rows[0], linkedinUrl: li("ACME") }, { ...r.rows[0], linkedinUrl: li("acme") }] } : r)));
  assertEquals(o.calls.filter((c) => c === ATOMUS).length, 1);
  assertEquals(o.calls.filter((c) => c === JOBS).length, 1);
  assert(spendOf(o.r.ledger).paid_keys.length === new Set(spendOf(o.r.ledger).paid_keys).size);
});

Deno.test(qcase({
  id: "U07", rc: "U", boundary: "fixture", query: "golden QUALIFIED card — no job posting, Atomus has no rounds, Pvalyou has nothing",
  current: "not qualified; ends within four slices (correct in the run)",
  expected: "no qualification and no continuation loop",
}), async () => {
  const o = await observe(variant("all-empty", (rs) => [...swap(swap(rs, JOBS, (r) => ({ ...r, rows: [] })), ATOMUS, (r) => {
    const x = structuredClone(r) as unknown as { rows: Array<{ company: { financial: { funding: Record<string, unknown> } } }> };
    x.rows[0].company.financial.funding.rounds = []; x.rows[0].company.financial.funding.num_funding_rounds = 0;
    return x as unknown as FixtureProviderResponse;
  }), { actor: PVALYOU, rows: [], provenance: "nothing" }]));
  assertEquals(o.qualified.length, 0);
  assert(o.r.slices.length <= 4, `slices ${o.r.slices.map((s) => s.decision)}`);
});

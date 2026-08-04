// FREE PREQUALIFICATION GATES THE PAID STAGE — proved through the REAL engine.
//
// TEST task c8a6e53d-c227-4405-9fcc-e0791b03a4ec discovered 25 YC companies and
// then issued ONE paid Actor start per company to find a LinkedIn identity —
// sequentially, with an ENRICHMENT actor used as a name index. Sixteen starts,
// zero rows each, and the edge function was killed before it could write a
// status.
//
// These tests run `runCapabilityPlan` itself against the real 25 rows and assert
// what reached the wire: which Actors were called, for which companies, how many
// at a time, and in how many batches.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, type EngineProgress,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { createExecutionDeadline } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const mission = (): LeadMissionV1 => parseLeadMissionDeterministic(CANONICAL);
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

const c = (name: string, website: string, teamSize: number | null, jobs: string[]) =>
  ({ name, website, teamSize, batch: "W20", industries: ["B2B"], id: name.toLowerCase(),
     openJobs: jobs.map((title) => ({ title })) });

/** The REAL 25 rows from memo23 run 3Hv80atfVioMT9e4y / dataset kXRsrxikjrEiWNdBe. */
const REAL_25 = [
  c("Odeko", "http://www.odeko.com", 371, ["Brand Designer", "Senior/Staff Fullstack Engineer - Marketplace", "Senior DevOps Engineer"]),
  c("Mux", "http://mux.com", 95, ["Senior Platform Engineer"]),
  c("Bitmovin", "http://bitmovin.com", 145, ["Sales Director"]),
  c("SnapMagic", "https://www.snapmagic.com", 23, ["Head of Operations", "Head of Sales", "Head of Customer Success", "Enterprise Account Executive"]),
  c("Gemnote", "http://gemnote.com", 40, ["Head of Operations"]),
  c("Mashgin", "http://mashgin.com", 150, ["Senior Software Engineer, Backend", "Senior Technical Product Manager", "Software Engineer, Computer Vision and Deep Learning", "Senior Software Engineer, Full-Stack"]),
  c("Tara AI", "http://www.tara.ai", 13, ["Founding Account Executive — Remote", "Founding Account Executive — San Francisco, CA"]),
  c("Streak", "http://streak.com", 35, ["Staff UI Engineer"]),
  c("OneSignal", "https://onesignal.com", 150, ["Product Marketing Manager", "Senior Software Engineer, Email Team", "Staff Software Engineer, SMS Team (Fullstack)", "Senior Software Engineer, Journeys Team (Fullstack)"]),
  c("Magic", "https://getmagic.com/", 350, ["Account Executive - Global, Remote"]),
  c("HackerRank", "http://hackerrank.com", 300, ["Manager, Forward Deployed Engineering", "Forward Deployed Engineer", "Forward Deployed Engineer", "Hiring Senior Software Engineer"]),
  c("Apollo", "http://apollographql.com/", 200, ["Senior Customer Success Engineer", "Enterprise Sales Executive - West"]),
  c("Lob", "http://lob.com", 150, []),
  c("InfluxData", "https://influxdata.com", 210, []),
  c("Etleap", "https://etleap.com", 11, ["Senior Software Engineer - San Francisco (Onsite)", "Account Executive", "DevOps Engineer Latin America (remote)", "Software Engineer - Integrations South America (remote)"]),
  c("Padlet", "https://padlet.com", 65, []),
  c("Zentail", "https://zentail.com", 30, ["Business Development Representative - Hybrid", "Account Executive - Hybrid", "Software Engineer - Hybrid Preferred"]),
  c("Complir", "https://complir.io/", 13, ["Head of Germany"]),
  c("Hub", "https://hub.xyz", 10, ["Founding Engineer", "Field Operator - Brazil"]),
  c("Revion", "https://revion.inc", 10, ["Founding Engineer", "Founding Forward Deployed Enginner"]),
  ...Array.from({ length: 5 }, () => ({ name: null, website: null, teamSize: null, openJobs: [] })),
] as unknown as Record<string, unknown>[];

/** The five companies that must reach the paid stage — and only these. */
const ELIGIBLE = ["SnapMagic", "Tara AI", "Zentail", "Bitmovin", "Etleap"];
/** Real commercial signal, but a headcount outside 10-150. */
const OVERSIZED = ["Apollo", "Magic", "HackerRank", "InfluxData", "Odeko"];

interface Trace {
  calls: Array<{ actor: string; input: Record<string, unknown> }>;
  /** Peak simultaneous in-flight calls, per actor. */
  peak: Record<string, number>;
  inFlight: Record<string, number>;
  progress: EngineProgress[];
}

function newTrace(): Trace {
  return { calls: [], peak: {}, inFlight: {}, progress: [] };
}

/**
 * An invoker that RECORDS concurrency.
 *
 * Each call yields to the microtask queue before resolving, so two calls started
 * together are genuinely overlapping and the peak counter can see it. A mock
 * that resolved synchronously would report a peak of 1 no matter what the engine
 * did — the test would pass while the engine fired all five at once.
 */
function tracingDeps(trace: Trace, rows: Record<string, Record<string, unknown>[]>) {
  return {
    invoke: async (call: CompiledActorCall<unknown>) => {
      const k = call.actorKey;
      trace.calls.push({ actor: k, input: call.input as Record<string, unknown> });
      trace.inFlight[k] = (trace.inFlight[k] ?? 0) + 1;
      trace.peak[k] = Math.max(trace.peak[k] ?? 0, trace.inFlight[k]);
      await new Promise((r) => setTimeout(r, 1));
      trace.inFlight[k] -= 1;
      if (k === "apify_linkedin_company_search") {
        // The search Actor answers for whichever company was asked about.
        const q = String((call.input as { searchQuery?: string }).searchQuery ?? "");
        const domain = q.split(/\s+/).pop() ?? "";
        const slug = domain.split(".")[0];
        return [{
          id: slug, name: q.replace(` ${domain}`, ""),
          linkedinUrl: `https://www.linkedin.com/company/${slug}`,
          website: `https://${domain}`,
        }];
      }
      return rows[k] ?? [];
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
}

const ENRICH_ROWS = ELIGIBLE.map((name) => {
  const slug = name.toLowerCase().replace(/\s+/g, "");
  const domain = { SnapMagic: "snapmagic.com", "Tara AI": "tara.ai", Zentail: "zentail.com",
    Bitmovin: "bitmovin.com", Etleap: "etleap.com" }[name]!;
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${domain.split(".")[0]}`,
    website: `https://${domain}`, employeeCount: 40,
    description: `${name} is a B2B SaaS platform sold on subscription.`,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  };
});

async function runFixture(over: Record<string, unknown> = {}) {
  const trace = newTrace();
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    ...tracingDeps(trace, {
      apify_yc_companies_memo23: REAL_25,
      apify_linkedin_company_details: ENRICH_ROWS,
    }),
    onProgress: (p) => { trace.progress.push(p); },
    ...over,
  }, { mission: m, plan, brain: BRAIN, maxCandidates: 50 });
  return { trace, run };
}

const searchQueries = (t: Trace) => t.calls
  .filter((c) => c.actor === "apify_linkedin_company_search")
  .map((c) => String((c.input as { searchQuery?: string }).searchQuery ?? ""));

// ══════════════ 6. prequalification runs BEFORE identity resolution ══

Deno.test("6. prequalification decides the shortlist before anything is bought", async () => {
  const { trace, run } = await runFixture();

  const firstSearch = trace.calls.findIndex((c) => c.actor === "apify_linkedin_company_search");
  const discovery = trace.calls.findIndex((c) => c.actor === "apify_yc_companies_memo23");
  assert(discovery >= 0 && firstSearch > discovery, "discovery precedes the paid identity stage");

  // The shortlist exists, and it exists on the STATE — so a run that dies later
  // can still explain why each company was or was not pursued.
  assert(run.state.prequalification, "the free verdict must be persisted");
  assertEquals(run.state.prequalification!.total_rows, 25);
  assertEquals(run.state.prequalification!.unique_companies, 20);
  assertEquals(run.state.prequalification!.eligible_companies, 5);
});

// ═══════════ 7/8. only the eligible five reach the paid company search ══

Deno.test("7. exactly the five eligible companies reach LinkedIn company search", async () => {
  const { trace } = await runFixture();
  const queries = searchQueries(trace);

  assertEquals(queries.length, 5,
    `at most one search per eligible company; task c8a6e53d made 16 (got: ${queries.join(" | ")})`);
  for (const name of ELIGIBLE) {
    assert(queries.some((q) => q.startsWith(name)), `${name} must be searched`);
  }
  // Name AND domain — a bare name search is what returns the wrong "Apollo".
  assert(queries.includes("SnapMagic snapmagic.com"));
  assert(queries.includes("Tara AI tara.ai"));
  assert(queries.includes("Zentail zentail.com"));
  assert(queries.includes("Bitmovin bitmovin.com"));
  assert(queries.includes("Etleap etleap.com"));
});

Deno.test("8. out-of-range companies never reach identity resolution", async () => {
  const { trace, run } = await runFixture();
  const queries = searchQueries(trace);

  for (const name of OVERSIZED) {
    // MATCHED AT THE START OF THE QUERY, not as a substring. "SnapMagic
    // snapmagic.com" contains "Magic", and a substring assertion here failed on
    // a company that was correctly shortlisted — the test would have been
    // reporting a defect the engine did not have.
    assertFalse(queries.some((q) => q === name || q.startsWith(`${name} `)),
      `${name} is outside 10-150 and must not be paid for (queries: ${queries.join(" | ")})`);
  }
  // And they are excluded for the RIGHT reason, not merely absent.
  for (const name of OVERSIZED) {
    const rec = run.state.prequalification!.companies.find((x) => x.name === name)!;
    assert(rec, `${name} must still be recorded`);
    assertEquals(rec.exclusion, "employee_size", `${name} must say why it was skipped`);
    assertFalse(rec.shortlisted);
  }
  // Apollo and Magic each HAVE a real commercial opening — size is what excluded
  // them, not a missing signal. Recording that distinction is the whole point.
  const apollo = run.state.prequalification!.companies.find((x) => x.name === "Apollo")!;
  assert(apollo.commercial_jobs.length > 0, "Apollo does have a commercial role");
  assertEquals(apollo.team_size, 200);
});

// ════════════════════ 9/10. the FULL openJobs array is evaluated ══

Deno.test("9. every open job is evaluated, not just the first", async () => {
  const { run } = await runFixture();
  const snap = run.state.prequalification!.companies.find((x) => x.name === "SnapMagic")!;
  // SnapMagic's four roles include two Tier-C and two commercial.
  assert(snap.commercial_jobs.length >= 3, "all four roles were read");
  assertEquals(snap.strongest_signal, "Head of Sales",
    "the STRONGEST role, not openJobs[0] — which is 'Head of Operations'");
});

Deno.test("10. a commercial role listed after an engineering role is still found", async () => {
  const { run, trace } = await runFixture();
  // Etleap's openJobs[0] is "Senior Software Engineer". The Account Executive is
  // second. Reading openJobs[0] would have classified Etleap as technical-only.
  const etleap = run.state.prequalification!.companies.find((x) => x.name === "Etleap")!;
  assertEquals(etleap.strongest_signal, "Account Executive");
  assert(etleap.eligible);
  assert(searchQueries(trace).includes("Etleap etleap.com"));
});

// ════════════════════ 11/12. concurrency and batching ══

Deno.test("11. LinkedIn company search never runs more than 2 at a time", async () => {
  const { trace } = await runFixture();
  assertEquals(trace.peak["apify_linkedin_company_search"], 2,
    "five simultaneous paid Actor starts is the burst this budget cannot absorb");
});

Deno.test("12. company details receives resolved LinkedIn URLs in ONE batch", async () => {
  const { trace } = await runFixture();
  const details = trace.calls.filter((c) => c.actor === "apify_linkedin_company_details");

  assertEquals(details.length, 1,
    "one batched enrichment call, not one per company");
  const companies = (details[0].input as { companies?: string[] }).companies ?? [];
  assertEquals(companies.length, 5);
  for (const u of companies) {
    assert(u.startsWith("https://www.linkedin.com/company/"),
      `details must receive URLs, never names (got ${u})`);
  }
  // The defect this replaced, stated exactly:
  assertFalse(details.some((d) => "searches" in (d.input as Record<string, unknown>)),
    "the enrichment Actor must never be used as a name-search index");
});

// ════════════════════════════ 13. unresolved identities ══

Deno.test("13. an unresolved identity stays not-evaluated and is never actionable", async () => {
  const trace = newTrace();
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    // The search Actor finds NOTHING for anyone.
    invoke: (call: CompiledActorCall<unknown>) => {
      trace.calls.push({ actor: call.actorKey, input: call.input as Record<string, unknown> });
      if (call.actorKey === "apify_yc_companies_memo23") return Promise.resolve(REAL_25);
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  }, { mission: m, plan, brain: BRAIN, maxCandidates: 50 });

  assertEquals(run.state.qualified_company_keys.length, 0);
  for (const name of ELIGIBLE) {
    const co = run.companies.find((x) => x.company.company_name === name)!;
    assert(co, `${name} must still be in the working set`);
    assertEquals(co.verdict, null, "unresolved is NOT a rejection and NOT a pass");
    assertEquals(co.record.stage, "identity_pending");
    assertEquals(co.founders.length, 0, "no people are ever bought for it");
  }
  // NO RETRY LOOP. One search per shortlisted company, and that is all.
  assertEquals(trace.calls.filter((c) => c.actor === "apify_linkedin_company_search").length, 5);
  assertFalse(trace.calls.some((c) => c.actor === "apify_linkedin_company_employees"),
    "founder discovery must not run without a qualified company");
});

// ══════════════════════ deadline + progress + no paid calls in dry runs ══

Deno.test("14. a closed deadline stops the identity stage starting new calls", async () => {
  let now = 0;
  const deadline = createExecutionDeadline({
    budgetMs: 30_000, now: () => now, assumedCallMs: 12_000,
  });
  const trace = newTrace();
  const m = mission();
  const plan = buildCapabilityGraph(m);
  await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      trace.calls.push({ actor: call.actorKey, input: call.input as Record<string, unknown> });
      // Discovery burns the whole budget.
      if (call.actorKey === "apify_yc_companies_memo23") { now += 25_000; return Promise.resolve(REAL_25); }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    deadline,
  }, { mission: m, plan, brain: BRAIN, maxCandidates: 50 });

  assert(deadline.expired(), "the budget is spent");
  assertEquals(trace.calls.filter((c) => c.actor === "apify_linkedin_company_search").length, 0,
    "no new paid call may start once there is no room to finish it");
});

Deno.test("19. progress is published per stage and never qualifies prematurely", async () => {
  const { trace } = await runFixture();
  assert(trace.progress.length >= 3, "each stage publishes");

  const prequal = trace.progress.find((p) => p.stage === "prequalified")!;
  // 20, not 21: the five empty memo23 rows collapse to one artifact company in
  // the engine's own dedupe, and prequalification drops it from the working set
  // rather than counting a row with no name and no website as an account found.
  assertEquals(prequal.accounts_found, 20);
  assertEquals(prequal.eligible_opportunities, 5);
  assertEquals(prequal.exclusion_reasons["employee_size"], 5);
  assertEquals(prequal.qualified_companies, 0,
    "nothing may be reported qualified before the Company Brain has run");
  assert(prequal.in_progress, "intermediate rows are not actionable");

  // Every snapshot published before the Brain stage reports zero qualified.
  for (const p of trace.progress) {
    if (["accounts_found", "prequalified", "identity_resolved", "companies_enriched"].includes(p.stage)) {
      assertEquals(p.qualified_companies, 0, `${p.stage} must not claim a qualification`);
    }
  }
});

Deno.test("20. the whole fixture runs with ZERO real Actor starts", async () => {
  const { trace } = await runFixture();
  // Every call above went to a mock invoker held entirely in this file. The
  // engine holds no provider import of its own — assert that, so a future edit
  // cannot quietly add one and make these tests spend money.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  for (const forbidden of ["fetch(", "apifyFetch", "createClient", "Deno.env"]) {
    assertFalse(src.includes(forbidden), `${forbidden} must not appear in the engine`);
  }
  assert(trace.calls.length > 0, "the mock invoker is what ran");
});

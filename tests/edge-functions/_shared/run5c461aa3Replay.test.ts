// THE RUN THAT PRODUCED NOTHING, REPLAYED THROUGH THE REAL PIPELINE.
//
// ── WHAT THIS PROVES ───────────────────────────────────────────────────────
//
// Task 5c461aa3, 2026-08-28: 30 companies discovered, 11 reaching hiring
// verification, four paid job searches, 234 job rows returned — and zero
// qualified companies. The Workbench reported "30 companies reviewed,
// Qualified 0" and could not account for 29 of the 30.
//
// The fixture beside this file is the real returned data, read back from the
// four Apify datasets. The test drives it through the SAME functions the engine
// uses — `normalizeLinkedInJob`, `normalizeCompanyLinkedInUrl`, `dedupeJobs`,
// `assessHiring` — under two vocabularies:
//
//   AS RAN       required_titles: ["sales roles"]  — the literal phrase the
//                mission carried, used verbatim as a job-title keyword.
//   AS DEPLOYED  the same mission through `buildQualificationContext` after
//                6bbc69b9, which expands a category term to its role family.
//
// The first must reproduce production exactly: zero verified. The second must
// clear the bar the user asked for. Both directions matter — a fix that passed
// everything would be worth nothing, so the companies that genuinely were not
// hiring sales must still fail.
//
// NO NETWORK, NO SPEND. The provider rows are frozen; this is the audit's
// causal claim turned into something that runs on every commit.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RUN_5C461AA3_ROWS, RUN_5C461AA3_BATCHES,
} from "../../fixtures/run5c461aa3HiringRows.ts";
import {
  normalizeLinkedInJob, dedupeJobs,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  normalizeCompanyLinkedInUrl,
} from "../../../supabase/functions/_shared/structuredCompanyEnrichment.ts";
import {
  assessHiring,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";
import {
  buildQualificationContext,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";

/** The mission exactly as production compiled and executed it (hash 2cd1ff07…). */
const MISSION = {
  version: "lead-mission-v1", mission_type: "company_research", target_entity: "company",
  requested_count: 3, requested_output: "qualified_companies",
  original_user_query:
    "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
  company_profile: { verticals: ["recruiting", "staffing"], locations: [], stages: [], business_models: [] },
  decision_makers: { roles: [], current_employment_required: false },
  required_signals: [{
    type: "hiring", event: "hiring", subject: "company", phrase: "hiring sales roles",
    qualifier: { role_terms: ["sales roles"] },
  }],
  required_signal_terms: ["sales roles"],
  directives: {}, hard_constraints: {}, soft_preferences: {},
  field_provenance: {}, required_capabilities: [], prohibited_capabilities: [],
  // deno-lint-ignore no-explicit-any
} as any;

/** What the mission carried, used verbatim — the state that shipped. */
const AS_RAN = { source: "mission" as const, required_titles: ["sales roles"] };

/**
 * The engine's own join: rows are routed to a company by the URL they name,
 * never by position in the batch.
 */
function joinRowsToCompanies(): Map<string, ReturnType<typeof normalizeLinkedInJob>[]> {
  const batched = new Map<string, ReturnType<typeof normalizeLinkedInJob>[]>();
  for (const batch of RUN_5C461AA3_BATCHES) {
    const byUrl = new Map<string, string>();
    for (const u of batch.companies) {
      const k = normalizeCompanyLinkedInUrl(u);
      if (k) byUrl.set(k, u);
    }
    for (const raw of RUN_5C461AA3_ROWS) {
      if (!batch.companies.includes(raw.company)) continue;
      const j = normalizeLinkedInJob({
        id: `${raw.company}|${raw.title}`, title: raw.title, linkedinUrl: "https://job",
        company: { name: raw.company, linkedinUrl: raw.company },
      } as never);
      const owner = j.company_linkedin_url ? byUrl.get(j.company_linkedin_url) : undefined;
      if (!owner) continue;
      const list = batched.get(owner) ?? [];
      list.push(j);
      batched.set(owner, list);
    }
  }
  return batched;
}

const shaped = (jobs: ReturnType<typeof normalizeLinkedInJob>[]) =>
  dedupeJobs(jobs).map((j) => ({ title: j.title, url: j.job_url, location: j.location }));

const slug = (url: string) => url.split("/").pop()!;

function verdicts(vocab: { source: string; required_titles: readonly string[] }) {
  const batched = joinRowsToCompanies();
  const out = new Map<string, string>();
  for (const url of RUN_5C461AA3_BATCHES.flatMap((b) => b.companies)) {
    const jobs = shaped(batched.get(url) ?? []);
    out.set(slug(url), jobs.length === 0
      ? "no_rows_returned"
      // deno-lint-ignore no-explicit-any
      : assessHiring(jobs, [], { source: "external_job_search", vocab: vocab as any }).verdict);
  }
  return out;
}

Deno.test("1. every returned row reaches the company it names", () => {
  // The first thing to rule out: a join failure would explain the zero without
  // any of the rest being true.
  const batched = joinRowsToCompanies();
  const routed = [...batched.values()].reduce((n, l) => n + l.length, 0);
  const rowsForBatchedCompanies = RUN_5C461AA3_ROWS.filter((r) =>
    RUN_5C461AA3_BATCHES.some((b) => b.companies.includes(r.company))).length;
  assertEquals(routed, rowsForBatchedCompanies,
    "no row may be dropped between the provider and the company it names");
  assertEquals(batched.size, 9, "nine of the eleven companies searched returned rows");
});

Deno.test("2. two companies were searched and returned nothing at all", () => {
  // Not a matching failure — the provider had nothing for them. Recorded so the
  // funnel's own arithmetic stays checkable.
  const v = verdicts(AS_RAN);
  assertEquals(v.get("sotalentjobs"), "no_rows_returned");
  assertEquals(v.get("intelletec-ltd"), "no_rows_returned");
});

Deno.test("3. AS RAN: the vocabulary that shipped verified nobody", () => {
  // This is production. If this test ever passes with a non-zero count, the
  // fixture or the assessor has drifted from what actually happened.
  const v = verdicts(AS_RAN);
  const verified = [...v.entries()].filter(([, x]) => x === "hiring_verified");
  assertEquals(verified.length, 0,
    "the run produced zero qualified companies and this must reproduce it exactly");

  // And the reason is the vocabulary, not the evidence: every company with rows
  // scored zero commercial roles against the single literal phrase.
  const batched = joinRowsToCompanies();
  const pursuit = shaped(batched.get("https://www.linkedin.com/company/pursuit-sales-solutions")!);
  assert(pursuit.length >= 15, "this company posted a great many sales roles");
  const r = assessHiring(pursuit, [], { source: "external_job_search", vocab: AS_RAN });
  assertEquals(r.commercial_jobs.length, 0,
    'sixteen sales titles scored zero against the literal phrase "sales roles"');
});

Deno.test("4. AS DEPLOYED: the same evidence clears the mission's requested count", () => {
  const vocab = buildQualificationContext(MISSION).role_vocabulary;
  assertEquals(vocab.source, "mission");
  const v = verdicts(vocab);
  const verified = [...v.entries()].filter(([, x]) => x === "hiring_verified").map(([c]) => c);

  assert(verified.length >= MISSION.requested_count,
    `the mission asked for ${MISSION.requested_count}; hiring evidence now supports ${verified.length}`);
  // Named, so a regression says WHICH company stopped verifying.
  for (const expected of [
    "pursuit-sales-solutions", "blue-signal-search", "talentoma",
    "lateam-partners", "hirefeedd", "forcebrands",
  ]) {
    assert(verified.includes(expected), `${expected} posted sales roles and must verify`);
  }
});

Deno.test("5. AS DEPLOYED: companies that were not hiring sales still do not verify", () => {
  // The half that makes the fix worth having. A change that passed everything
  // would trade a false negative for a false positive.
  const vocab = buildQualificationContext(MISSION).role_vocabulary;
  const v = verdicts(vocab);
  // One preconstruction manager.
  assertEquals(v.get("engtal"), "watch");
  // One product-catalog operations manager.
  assertEquals(v.get("letsremotivate"), "watch");
});

Deno.test("6. KNOWN GAP: senior sales titles are missing from the gtm_sales family", () => {
  // storm4 posted "Sales Director" and verifies as `watch`, because the family
  // aliases carry "Head of Sales" but not "Sales Director", "Director of Sales"
  // or "VP of Sales" — titles this run saw repeatedly across four companies.
  //
  // Asserted as it IS, not as it should be: this is a real limitation the audit
  // found, it is NOT what fix 1 addresses, and pinning it here means widening
  // the family later has to come back and change this line deliberately.
  const vocab = buildQualificationContext(MISSION).role_vocabulary;
  assertEquals(verdicts(vocab).get("storm4"), "watch",
    'storm4 posted "Sales Director" — the gtm_sales family does not carry it');
  assertEquals(vocab.required_titles.includes("director of sales"), false);
  assertEquals(vocab.required_titles.includes("vp of sales"), false);
});

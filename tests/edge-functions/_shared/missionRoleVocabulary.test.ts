// THE USER'S WORDS ARE A CATEGORY, NOT A JOB TITLE.
//
// ── THE RUN THIS EXPLAINS ──────────────────────────────────────────────────
//
// Task 5c461aa3, 2026-08-28. Everything upstream worked: the mission compiled,
// the preview was truthful, Start ran without a model call, the preflight
// passed, discovery returned 30 companies, enrichment resolved identities, and
// five paid hiring searches returned 103 job rows. Zero companies qualified.
//
// The mission carried `required_signal_terms: ["sales roles"]` — the user's own
// phrase — and `buildQualificationContext` used it verbatim as a job-title
// keyword list. No job title on earth contains the phrase "sales roles", so
// `assessHiring` scored real openings against a vocabulary of exactly one
// impossible string:
//
//   4 open role(s) present, none matching the mission's compiled vocabulary
//   (sales roles) — verdict `watch`, commercial: 0
//
// Eleven companies sat at `verifying` and the run reported "none matched
// closely enough".
//
// `role_families` were already expanded through `roleFamilyAliases`; terms were
// not, on the reasoning that "terms are already phrases". True of the phrases
// it was built for, false of the one the user actually wrote.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationContext,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { assessHiring } from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";

const missionWithTerms = (terms: string[]) => ({
  version: "lead-mission-v1", mission_type: "company_research",
  target_entity: "company", requested_count: 3,
  requested_output: "qualified_companies",
  original_user_query: "Find 3 recruiting or staffing companies that fit my ICP and are actively hiring sales roles.",
  company_profile: { verticals: ["recruiting", "staffing"], locations: [], stages: [], business_models: [] },
  decision_makers: { roles: [], current_employment_required: false },
  required_signals: [{ type: "hiring", event: "hiring", subject: "company",
    phrase: "hiring sales roles", qualifier: { role_terms: terms } }],
  required_signal_terms: terms,
  directives: {}, hard_constraints: {}, soft_preferences: {},
  field_provenance: {}, required_capabilities: [], prohibited_capabilities: [],
  // deno-lint-ignore no-explicit-any
} as any);

/** The titles the paid search actually returned for Hire Feed. */
const HIRE_FEED_JOBS = [
  { title: "Strategy Manager (Remote)", url: "https://x/1", location: null },
  { title: "AI Process Consultant (Remote)", url: "https://x/2", location: null },
  { title: "Operations Manager (Remote)", url: "https://x/3", location: null },
  { title: "Sales/Account Executive (Remote)", url: "https://x/4", location: null },
];

Deno.test("a category term expands to the titles a job posting can actually have", () => {
  const ctx = buildQualificationContext(missionWithTerms(["sales roles"]));
  const titles = ctx.role_vocabulary.required_titles;
  assertEquals(ctx.role_vocabulary.source, "mission");
  assert(titles.includes("sales roles"),
    "the user's own words are kept — a term that IS a title must still match");
  for (const expected of ["account executive", "sdr", "head of sales"]) {
    assert(titles.includes(expected),
      `"${expected}" is a sales role and must be in the vocabulary`);
  }
});

Deno.test("the production evidence now verifies, and did not before", () => {
  const ctx = buildQualificationContext(missionWithTerms(["sales roles"]));
  const r = assessHiring(HIRE_FEED_JOBS, [],
    { source: "external_job_search", vocab: ctx.role_vocabulary });
  assertEquals(r.verdict, "hiring_verified",
    "an open Account Executive req IS a company actively hiring sales roles");
  assertEquals(r.commercial_jobs.length, 1);

  // THE STATE THAT SHIPPED: the unexpanded vocabulary, on the same rows.
  const unexpanded = assessHiring(HIRE_FEED_JOBS, [], {
    source: "external_job_search",
    vocab: { source: "mission", required_titles: ["sales roles"] },
  });
  assertEquals(unexpanded.verdict, "watch");
  assertEquals(unexpanded.commercial_jobs.length, 0,
    "this is the vocabulary that made 103 returned job rows count for nothing");
});

Deno.test("a term that IS a title is not widened into its discipline", () => {
  // `classifyRoleFamily` resolves "software engineer" too — because it is a
  // MEMBER of the engineering family, not its name. Expanding it would start
  // matching backend, frontend, ML and staff engineer: a false positive traded
  // for the false negative this fixes. The alias list is the test — a term
  // already in it is a title and stays exactly as written.
  const eng = buildQualificationContext(missionWithTerms(["software engineer"]));
  assertEquals(eng.role_vocabulary.required_titles, ["software engineer"]);

  // `normalizeRoleTerm` singularises, which is why the stored form is
  // "sales operation". "Sales Operations" is itself an alias of the ops
  // family, so it is a title and is left alone.
  const ops = buildQualificationContext(missionWithTerms(["sales operations"]));
  assertEquals(ops.role_vocabulary.required_titles, ["sales operation"]);
  assertEquals(ops.role_vocabulary.required_titles.includes("account executive"), false,
    "the boundary roleFamilies.ts exists to hold: an ops ask never becomes SDR/BDR/AE");

  // And the same evidence must NOT verify a Sales Operations mission.
  const r = assessHiring(HIRE_FEED_JOBS, [],
    { source: "external_job_search", vocab: ops.role_vocabulary });
  assertEquals(r.verdict === "hiring_verified", false,
    "an Account Executive opening is not evidence of hiring Sales Operations");
});

Deno.test("a term with no family is kept verbatim, not dropped", () => {
  const ctx = buildQualificationContext(missionWithTerms(["underwater basket weaver"]));
  assertEquals(ctx.role_vocabulary.required_titles, ["underwater basket weaver"]);
});

Deno.test("no terms still means the default commercial ladder", () => {
  const ctx = buildQualificationContext(missionWithTerms([]));
  assertEquals(ctx.role_vocabulary.source, "default_commercial");
  assertEquals(ctx.role_vocabulary.required_titles, []);
});

// Query-compilation + provider-input regression for the 2026-07-25 live defect:
// the whole user sentence was sent to LinkedIn as the job keyword string.
// ZERO network (run without --allow-net).

import { assertEquals, assert, assertFalse, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";
import { compileJobSearchSpec, findRawQueryLeak, extractHiringRolePhrase, extractJobLocation } from "../../supabase/functions/_shared/jobSearchSpec.ts";
import { buildJobsProviderInputs, assertCompiledForProvider, plannedResultTotal, JobSearchCompilationError } from "../../supabase/functions/_shared/jobsProviderInput.ts";
import { LIVE_RUN_REGRESSION } from "../../supabase/functions/_shared/jobSearchLiveFixture.ts";

const SAAS = "Founders of SaaS startups hiring Sales Operations in the United States";
const AUTO = "Founders of automation integrators hiring Business Development Managers in Texas";
const MFG = "Owners of small manufacturers hiring Sales Representatives in Ohio";
const SEEKER = "Sales Operations candidates looking for work";
const JOBS = "Sales Operations jobs in the United States";

const specOf = (q: string) => compileLeadEntityIntent(q).job_search_spec;
const kwText = (q: string) => specOf(q).keyword_queries.join(" | ").toLowerCase();

// ---- 1..9 compilation of the live regression request ------------------------
Deno.test("1. the SaaS regression request compiles to Sales-Operations keywords", () => {
  const s = specOf(SAAS);
  assertEquals(s.compilation_status, "compiled");
  assertEquals(s.keyword_queries[0], "Sales Operations");
  assert(s.job_families.includes("sales_ops"));
});
Deno.test("2. location compiles to United States (country canonicalised as the codebase does)", () => {
  assertEquals(specOf(SAAS).location, "United States");
  assertEquals(specOf(SAAS).country, "US");
  assertEquals(specOf(MFG).country, "US"); // a state still resolves its country
});
Deno.test("3. company vertical compiles to saas (and is NOT a keyword)", () => {
  assertEquals(specOf(SAAS).company_vertical, "saas");
  assertFalse(kwText(SAAS).includes("saas"));
});
Deno.test("4. requested person role compiles to founder-family executives", () => {
  const roles = specOf(SAAS).requested_person_roles;
  assert(roles.includes("Founder") && roles.includes("Co-Founder") && roles.includes("CEO"));
});
Deno.test("5. the original query survives as provenance", () => {
  assertEquals(specOf(SAAS).original_query, SAAS);
});
Deno.test("6/19. the original query is never a provider keyword", () => {
  const s = specOf(SAAS);
  assertFalse(s.keyword_queries.some((k) => k.toLowerCase() === SAAS.toLowerCase()));
  assertEquals(findRawQueryLeak(s), null);
  for (const inp of buildJobsProviderInputs(s, 25)) {
    assert(inp.query.toLowerCase() !== SAAS.toLowerCase());
  }
});
Deno.test('7. "Founders of" never appears in provider keywords', () => {
  assertFalse(kwText(SAAS).includes("founders of"));
});
Deno.test('8. "SaaS startups hiring" never appears in provider keywords', () => {
  assertFalse(kwText(SAAS).includes("startups hiring"));
  assertFalse(kwText(SAAS).includes("hiring"));
});
Deno.test("9. a Sales-Ops ask is never widened into AE/AM/SDR/BDR/generic sales", () => {
  const hay = kwText(SAAS);
  for (const bad of ["account executive", "account manager", "sdr", "bdr", "sales representative", "business development", "sales manager"]) {
    assertFalse(hay.includes(bad), `leaked generic role: ${bad}`);
  }
});

// ---- 10, 20, 21 bounded cost ------------------------------------------------
Deno.test("10/20/21. keyword variants SHARE one result ceiling", () => {
  const inputs = buildJobsProviderInputs(specOf(SAAS), 25);
  assertEquals(inputs.length, 3);
  assertEquals(plannedResultTotal(inputs), 25); // not 75
  assert(inputs.every((i) => i.max_results > 0));
  assertEquals(plannedResultTotal(buildJobsProviderInputs(specOf(SAAS), 10)), 10);
});

// ---- 11..13 fail-closed -----------------------------------------------------
Deno.test("11/13. an uncompilable hiring request yields unable_to_compile_job_search, never the raw query", () => {
  const spec = compileJobSearchSpec({ text: "Founders of SaaS startups that are hiring", hiringSignalRequired: true, requestedPersonRole: "founder" });
  assertEquals(spec.compilation_status, "insufficient");
  assertEquals(spec.keyword_queries.length, 0);
  const e = assertThrows(() => assertCompiledForProvider(spec), JobSearchCompilationError);
  assertEquals((e as JobSearchCompilationError).code, "unable_to_compile_job_search");
});
Deno.test("12. failed compilation cannot produce provider inputs (so the provider is never called)", () => {
  const spec = compileJobSearchSpec({ text: "Founders of SaaS startups that are hiring", hiringSignalRequired: true, requestedPersonRole: "founder" });
  assertThrows(() => buildJobsProviderInputs(spec, 25), JobSearchCompilationError);
});
Deno.test("11b. a hand-forged raw-query keyword is rejected as a leak", () => {
  const leaky = { ...specOf(SAAS), keyword_queries: [SAAS] };
  assert(findRawQueryLeak(leaky) !== null);
  assertThrows(() => assertCompiledForProvider(leaky), JobSearchCompilationError);
});

// ---- vertical cases ---------------------------------------------------------
Deno.test("automation-integrator request compiles role, state and vertical separately", () => {
  const i = compileLeadEntityIntent(AUTO);
  const s = i.job_search_spec;
  assertEquals(i.execution_mode, "company_first");
  assertEquals(s.keyword_queries, ["Business Development Manager"]); // singularised, not widened
  assertEquals(s.location, "Texas");
  assertEquals(s.company_vertical, "automation_integrator");
  assert(s.requested_person_roles.includes("Founder"));
  assertFalse(s.keyword_queries.join(" ").toLowerCase().includes("founders of"));
});
Deno.test("manufacturer request compiles role, state and vertical separately", () => {
  const i = compileLeadEntityIntent(MFG);
  const s = i.job_search_spec;
  assertEquals(s.keyword_queries, ["Sales Representative"]);
  assertEquals(s.location, "Ohio");
  assertEquals(s.company_vertical, "manufacturer");
  assert(s.requested_person_roles.includes("Owner"));
  assertFalse(s.keyword_queries.join(" ").toLowerCase().includes("owners of"));
});
Deno.test("job-seeker request compiles NO employer job search", () => {
  const i = compileLeadEntityIntent(SEEKER);
  assertEquals(i.execution_mode, "person_first");
  assertFalse(i.company_gate_required);
  assertEquals(i.job_search_spec.compilation_status, "not_applicable");
  assertEquals(i.job_search_spec.keyword_queries.length, 0);
});
Deno.test("pure job-keyword request is job-first and invents NO founder role", () => {
  const i = compileLeadEntityIntent(JOBS);
  assertEquals(i.execution_mode, "job_first");
  const s = i.job_search_spec;
  assertEquals(s.compilation_status, "compiled");
  assertEquals(s.keyword_queries[0], "Sales Operations");
  assertEquals(s.location, "United States");
  assertEquals(s.requested_person_roles, []);
});

// ---- 14..18, 22..24 provider input shape ------------------------------------
Deno.test("15/16/17/18. provider input carries role keywords + separate location only", () => {
  const inputs = buildJobsProviderInputs(specOf(SAAS), 25);
  for (const i of inputs) {
    assertEquals(i.location, "United States");
    const q = i.query.toLowerCase();
    assertFalse(q.includes("saas"));      // vertical is NOT a keyword
    assertFalse(q.includes("founder"));   // person role is NOT a keyword
    assertFalse(q.includes("united states")); // location is NOT in the keyword
  }
});
Deno.test("22/23. each variant carries its own keyword/location provenance", () => {
  const inputs = buildJobsProviderInputs(specOf(SAAS), 25);
  assertEquals(inputs.map((i) => i._variant_index), [0, 1, 2]);
  assertEquals(inputs[1]._variant_keyword, "Revenue Operations");
});

// ---- helpers ----------------------------------------------------------------
Deno.test("role-phrase and location extraction are deterministic", () => {
  assertEquals(extractHiringRolePhrase(SAAS), "Sales Operations");
  assertEquals(extractHiringRolePhrase("hiring Revenue Operations Managers in Ohio"), "Revenue Operations Manager");
  assertEquals(extractJobLocation("… in the United States").location, "United States");
  assertEquals(extractJobLocation("… in Ohio").location, "Ohio");
  assertEquals(extractJobLocation("… somewhere").location, null);
});

// ---- 15 sanitized live-run fixture -----------------------------------------
Deno.test("live-run fixture: compiled inputs match the expected role-focused searches", () => {
  const inputs = buildJobsProviderInputs(specOf(LIVE_RUN_REGRESSION.request), 25);
  assertEquals(
    inputs.map((i) => ({ keywords: i.query, location: i.location })),
    LIVE_RUN_REGRESSION.expected_provider_inputs.map((e) => ({ keywords: e.keywords, location: e.location as string | null })),
  );
  assertFalse(inputs.some((i) => i.query === LIVE_RUN_REGRESSION.request));
});
Deno.test("live-run fixture: the recorded junk titles still fail the job-family gate", async () => {
  const { classifyJobFamily } = await import("../../supabase/functions/_shared/jobFamily.ts");
  for (const t of LIVE_RUN_REGRESSION.rejected_job_titles) {
    assertFalse(classifyJobFamily(t, null).qualifiesAsSalesOps, `should not qualify: ${t}`);
  }
});

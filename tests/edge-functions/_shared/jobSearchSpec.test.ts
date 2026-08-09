// jobSearchSpec.ts + leadEntityIntent.ts geography — city/region extraction and
// no_broadening_requested. Regression for the 2026-08-09 Step-2 fix:
// "Find companies hiring GTM roles in London" previously fell through every
// location pass to { location: null, country: null }, silently discarding the
// one constraint the user stated.
//
// IMPORTANT, verified while writing these tests: `job_search_spec.location`
// (jobSearchSpec.ts's compileJobSearchSpec) is ONLY computed when the request
// carries a hiring signal or is job-first — `compileJobSearchSpec` early-returns
// `{location: null, ...}` otherwise. A pure person/company lookup with no
// hiring language ("Find 5 React engineers in Berlin") never reaches it. The
// broader, UNGATED geography list is `intent.geographies` (leadEntityIntent.ts's
// GEO_PATTERNS), computed for every request and consumed by
// evidenceContract.ts/leadMissionCompiler.ts/compoundSourcingPipeline.ts — both
// lists needed the same new entries, and both are tested below, each against
// phrasing that actually reaches it.
//
// ZERO network, ZERO model calls.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";

// ===================== job_search_spec.location (hiring-signal requests) ====
Deno.test("London resolves to the city, with a normalized UK country code", () => {
  const intent = compileLeadEntityIntent("Find companies hiring GTM roles in London");
  assertEquals(intent.job_search_spec.location, "London");
  assertEquals(intent.job_search_spec.country, "GB");
});
Deno.test("Berlin and Amsterdam resolve the same way, for a hiring-signal request", () => {
  const berlin = compileLeadEntityIntent("Find companies hiring React engineers in Berlin");
  assertEquals(berlin.job_search_spec.location, "Berlin");
  assertEquals(berlin.job_search_spec.country, "Germany");   // not in COUNTRY_ALIASES, stays the raw label

  const ams = compileLeadEntityIntent("Find companies hiring React engineers in Amsterdam");
  assertEquals(ams.job_search_spec.location, "Amsterdam");
  assertEquals(ams.job_search_spec.country, "Netherlands");
});
Deno.test("a named country still wins over a same-sentence city (country phrases checked first)", () => {
  const intent = compileLeadEntityIntent("Find companies hiring GTM roles in London, United Kingdom");
  assertEquals(intent.job_search_spec.location, "United Kingdom");
});
Deno.test("Europe/EMEA/APAC resolve as region labels, for a hiring-signal request", () => {
  assertEquals(compileLeadEntityIntent("Find companies hiring engineers in Europe").job_search_spec.location, "Europe");
  assertEquals(compileLeadEntityIntent("Find companies hiring in EMEA").job_search_spec.location, "EMEA");
  assertEquals(compileLeadEntityIntent("Find companies hiring in APAC").job_search_spec.location, "APAC");
});
Deno.test("KNOWN GAP: a pure person/company lookup with no hiring signal never reaches job_search_spec.location", () => {
  // Documents the gate, doesn't fix it here — intent.geographies (below) is the
  // field that actually preserves geography for this shape of request.
  const intent = compileLeadEntityIntent("Find 5 AI workflow companies in Europe");
  assertFalse(intent.hiring_signal_required);
  assertEquals(intent.job_search_spec.compilation_status, "not_applicable");
  assertEquals(intent.job_search_spec.location, null);
});

// ===================== intent.geographies (every request) ==================
Deno.test("Berlin/Amsterdam/Europe/EMEA/APAC resolve via intent.geographies even with no hiring signal", () => {
  assert(compileLeadEntityIntent("Find 5 React engineers in Berlin").geographies.includes("Berlin"));
  assert(compileLeadEntityIntent("Find 5 React engineers located in Amsterdam").geographies.includes("Amsterdam"));
  assert(compileLeadEntityIntent("Find 5 AI workflow companies in Europe").geographies.includes("Europe"));
  assert(compileLeadEntityIntent("Find companies expanding into EMEA").geographies.includes("EMEA"));
  assert(compileLeadEntityIntent("Find companies expanding into APAC").geographies.includes("APAC"));
});
Deno.test("Germany and Netherlands resolve via intent.geographies", () => {
  assert(compileLeadEntityIntent("Find founders of companies based in Germany").geographies.includes("Germany"));
  assert(compileLeadEntityIntent("Find founders of companies based in the Netherlands").geographies.includes("Netherlands"));
});

// ===================== no_broadening_requested ==============================
Deno.test("'do not broaden' / 'strictly' / 'exactly N' all set no_broadening_requested", () => {
  assert(compileLeadEntityIntent("Find leads strictly in Antarctica only. Do not broaden.").job_search_spec.no_broadening_requested);
  assert(compileLeadEntityIntent("Find exactly 5 Sales Director leads").job_search_spec.no_broadening_requested);
  assert(compileLeadEntityIntent("Companies hiring SDRs, London only.").job_search_spec.no_broadening_requested);
});
Deno.test("an ordinary request without strict language leaves the flag false", () => {
  assertFalse(compileLeadEntityIntent("Find founders of SaaS startups hiring Sales Operations").job_search_spec.no_broadening_requested);
});
Deno.test("no_broadening_requested is set even when compilation status is not 'compiled'", () => {
  // A pure person-lookup with no employer-side hiring signal compiles to
  // "not_applicable" — the flag must still be computed, since a caller may
  // read it before checking compilation_status.
  const spec = compileLeadEntityIntent("Find John Smith, strictly verified current employer only, do not broaden.").job_search_spec;
  assert(spec.no_broadening_requested);
});

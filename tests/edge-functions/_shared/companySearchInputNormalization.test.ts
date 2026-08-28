// THE PROVIDER BOUNDARY, AND WHAT IT MAY REFUSE.
//
// ── THE RUN THIS REPRODUCES ────────────────────────────────────────────────
//
// Task b1abea89, 2026-08-28 16:23 — the first run to reach a provider at all.
// The preflight passed, the capability engine started, and discovery was
// refused before Apify was called:
//
//   provider_input_validation_failed: apify_linkedin_company_search:
//   invalid_company_name_search_query: empty query (searchQuery: "")
//
// The strategy had asked for an industry-only pool — `industryIds: ["104",
// "137"]`, `companySize: ["1-10","11-50","51-200"]` — and expressed "no name
// filter" as an empty string rather than by omitting the field. The validator's
// own gate is `searchQuery !== undefined`, so an omitted query was always
// legitimate; a defined empty one was not.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileHarvestCompanySearchInput, invalidCompanyNameQueryReason,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const BASE = {
  scraperMode: "full" as const,
  companySize: ["1-10", "11-50", "51-200"],
  industryIds: ["104", "137"],
  locations: [] as string[],
  maxItems: 30,
};

Deno.test("an empty searchQuery is dropped, not refused", () => {
  // deno-lint-ignore no-explicit-any
  const r = compileHarvestCompanySearchInput({ ...BASE, searchQuery: "" } as any);
  assertEquals(r.ok, true,
    `the exact production input must compile: ${r.ok ? "" : r.errors.join("; ")}`);
  assert(r.ok);
  assertEquals((r.input as { searchQuery?: string }).searchQuery, undefined,
    "an empty query must be absent, so the actor runs an industry search");
  assert(r.warnings.some((w) => /searchQuery was empty/.test(w)),
    "and the drop must be stated, not silent");
});

Deno.test("whitespace is the same as empty", () => {
  // deno-lint-ignore no-explicit-any
  const r = compileHarvestCompanySearchInput({ ...BASE, searchQuery: "   " } as any);
  assertEquals(r.ok, true);
});

Deno.test("a real name query is still validated exactly as before", () => {
  // The rule this file must not weaken: the field is a NAME index.
  assertEquals(invalidCompanyNameQueryReason("Vercel"), null);
  assert(invalidCompanyNameQueryReason("vercel.com"),
    "a domain still belongs in match verification, not the query");
  assert(invalidCompanyNameQueryReason("https://vercel.com"));
  assert(invalidCompanyNameQueryReason(
    "companies that help early stage founders hire sales people"));

  // deno-lint-ignore no-explicit-any
  const bad = compileHarvestCompanySearchInput({ ...BASE, searchQuery: "acme.com" } as any);
  assertEquals(bad.ok, false, "a domain query must still be refused before spending");
});

Deno.test("dropping the query never produces an unbounded search", () => {
  // Without a name, an industry or a location this actor would enumerate
  // LinkedIn. Making the empty case legal must not make that case legal too.
  const r = compileHarvestCompanySearchInput({
    ...BASE, industryIds: [], locations: [], searchQuery: "",
    // deno-lint-ignore no-explicit-any
  } as any);
  assertEquals(r.ok, false);
  assert(r.ok === false && r.errors.some((e) => /unbounded search/.test(e)));
});

Deno.test("the empty query is dropped, never filled from the mission", () => {
  // The other repair anyone would reach for: put the mission's verticals in the
  // field. This actor's `searchQuery` is a NAME index — the validator's own
  // comment records that a concept phrase returned exactly one company
  // literally named that — so "recruiting staffing" would buy a search already
  // known to return garbage. Dropping is the only correct repair.
  // deno-lint-ignore no-explicit-any
  const r = compileHarvestCompanySearchInput({ ...BASE, searchQuery: "" } as any);
  assert(r.ok);
  const compiled = r.input as { searchQuery?: string; industryIds?: string[] };
  assertEquals(compiled.searchQuery, undefined, "absent, not invented");
  assertEquals(compiled.industryIds, ["104", "137"],
    "the industry filter is what makes this search bounded and meaningful");
});

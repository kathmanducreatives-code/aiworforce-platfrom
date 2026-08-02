import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldSkipBroadResearch } from "../../supabase/functions/_shared/broadResearchPolicy.ts";

// (24) research_web is NOT attempted after successful people sourcing in
// source_and_qualify_only mode (the v83 Q1 regression).
Deno.test("24: source_and_qualify_only skips broad research", () => {
  assertEquals(shouldSkipBroadResearch({ executionMode: "source_and_qualify_only" }), true);
});

Deno.test("24b: a provider-sourcing step skips broad research even when apifyContext is null (all staged)", () => {
  assertEquals(shouldSkipBroadResearch({ isProviderSourcingStep: true, hasProviderContext: false }), true);
});

Deno.test("24c: provider candidates sourced ⇒ skip broad research", () => {
  assertEquals(shouldSkipBroadResearch({ providerCandidatesSourced: true }), true);
});

// (25)(26) unchanged behavior for the legacy skip conditions + the default.
Deno.test("25/26: fast mode, source_with_apify, discovery still skip; no-signal defaults to NOT skip", () => {
  assertEquals(shouldSkipBroadResearch({ executionMode: "fast" }), true);
  assertEquals(shouldSkipBroadResearch({ plannedToolName: "source_with_apify" }), true);
  assertEquals(shouldSkipBroadResearch({ competitorDiscovery: true }), true);
  assertEquals(shouldSkipBroadResearch({ discoveryMode: "competitors" }), true);
  assertEquals(shouldSkipBroadResearch({ hasProviderContext: true }), true);
  assertEquals(shouldSkipBroadResearch({ hasScrapedContext: true }), true);
  // No provider signal at all (e.g. a pure research step) ⇒ broad research allowed.
  assertEquals(shouldSkipBroadResearch({ executionMode: "normal", plannedToolName: "research_web" }), false);
  assertEquals(shouldSkipBroadResearch({}), false);
});

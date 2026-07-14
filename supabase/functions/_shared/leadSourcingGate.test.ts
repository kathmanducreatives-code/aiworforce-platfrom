// Focused tests for the fail-closed Find Leads sourcing gate (the production
// helpers run-agent calls). Deterministic; no provider/LLM.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFindLeadsProviderSourcingStep,
  classifyProviderSourceOutcome,
  buildProviderSourceNoResults,
} from "./leadSourcingGate.ts";
import { FROZEN_Q1_SIGNALS } from "./scoutFallbackFixture.ts";

Deno.test("fix: the exact failing Q1 signals ARE recognized as provider sourcing (via body.tool_needed)", () => {
  // The live bug: tool_input has no tool_name/selected_actor_key, only tool_needed.
  assertEquals(
    isFindLeadsProviderSourcingStep({
      agent_slug: FROZEN_Q1_SIGNALS.agent_slug,
      tool_needed: FROZEN_Q1_SIGNALS.tool_needed,
      tool_name: (FROZEN_Q1_SIGNALS.tool_input as { tool_name?: string }).tool_name ?? null,
      selected_actor_key: (FROZEN_Q1_SIGNALS.tool_input as { selected_actor_key?: string }).selected_actor_key ?? null,
    }),
    true,
  );
});

Deno.test("fix: recognizes provider sourcing from any authoritative marker", () => {
  assertEquals(isFindLeadsProviderSourcingStep({ tool_needed: "source_with_apify" }), true);
  assertEquals(isFindLeadsProviderSourcingStep({ tool_name: "source_with_apify" }), true);
  assertEquals(isFindLeadsProviderSourcingStep({ selected_actor_key: "apify_people_search" }), true);
  assertEquals(isFindLeadsProviderSourcingStep({ selected_actor_key: "APIFY_JOBS" }), true);
});

Deno.test("fix: non-lead / research workflows are NOT provider sourcing (generic LLM stays allowed)", () => {
  assertEquals(isFindLeadsProviderSourcingStep({ tool_needed: "scrape_url" }), false);
  assertEquals(isFindLeadsProviderSourcingStep({ tool_needed: "research_web" }), false);
  assertEquals(isFindLeadsProviderSourcingStep({ tool_needed: "summarize_text" }), false);
  assertEquals(isFindLeadsProviderSourcingStep({ agent_slug: "scribe", tool_needed: "extract_structured" }), false);
  assertEquals(isFindLeadsProviderSourcingStep(null), false);
  assertEquals(isFindLeadsProviderSourcingStep({}), false);
});

Deno.test("fix: classifyProviderSourceOutcome maps each failure state to a structured reason", () => {
  assertEquals(classifyProviderSourceOutcome({ configured: false }), "provider_source_unconfigured");
  assertEquals(classifyProviderSourceOutcome({ unavailable: true }), "provider_source_unavailable");
  assertEquals(classifyProviderSourceOutcome({ errored: true }), "provider_source_failed");
  assertEquals(classifyProviderSourceOutcome({ rawItemCount: 0, acceptedItemCount: 0 }), "provider_source_empty");
  assertEquals(classifyProviderSourceOutcome({ rawItemCount: 12, acceptedItemCount: 3, providerBackedCandidateCount: 0 }), "no_provider_backed_candidates");
  // Proceed only when at least one provider-backed candidate survived.
  assertEquals(classifyProviderSourceOutcome({ rawItemCount: 12, acceptedItemCount: 3, providerBackedCandidateCount: 2 }), null);
});

Deno.test("fix: buildProviderSourceNoResults is the canonical fail-closed terminal", () => {
  const r = buildProviderSourceNoResults("provider_source_unavailable", { provider_calls: 0 });
  assertEquals(r.status, "no_results");
  assertEquals(r.result_status, "no_results");
  assertEquals(r.leads.length, 0);
  assertEquals(r.qualified_count, 0);
  assertEquals(r.contact_ready_count, 0);
  assertEquals(r.persisted_lead_count, 0);
  assertEquals(r.next_step, null);
  assertEquals(r.provider_calls, 0);
  assertEquals(r.reason, "provider_source_unavailable");
});

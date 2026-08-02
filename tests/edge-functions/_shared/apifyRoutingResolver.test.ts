// Production-path routing tests for the canonical tool resolver + founder actor
// selection. Every assertion runs the real production helpers run-agent calls:
// resolvePlannedTool / isProviderSourcingTool / resolveProviderSource
// (plannedToolResolver), guardScoutToAria (leadHandoffGuard),
// classifyProviderSourceOutcome / buildProviderSourceNoResults (leadSourcingGate),
// filterPlanForMode / stepAllowedInMode (executionMode). Deterministic; no provider.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolvePlannedTool,
  isProviderSourcingTool,
  resolveProviderSource,
} from "../../supabase/functions/_shared/plannedToolResolver.ts";
import {
  classifyProviderSourceOutcome,
  buildProviderSourceNoResults,
} from "../../supabase/functions/_shared/leadSourcingGate.ts";
import {
  buildProviderIndexFromItems,
  parseScoutCandidates,
  guardScoutToAria,
  type NormalizedProviderItem,
} from "../../supabase/functions/_shared/leadHandoffGuard.ts";
import { filterPlanForMode, stepAllowedInMode } from "../../supabase/functions/_shared/executionMode.ts";
import {
  FROZEN_Q1_SIGNALS,
  FROZEN_SCOUT_FABRICATED_OUTPUT,
  FROZEN_ACCEPTED_PROVIDER_ITEMS,
} from "../../supabase/functions/_shared/scoutFallbackFixture.ts";

const REAL_ITEMS: NormalizedProviderItem[] = [{
  company: "Acme Robotics",
  name: "Jane Doe",
  person_linkedin_url: "https://linkedin.com/in/jane-doe",
  source_url: "https://linkedin.com/in/jane-doe",
}];
const REAL_INDEX = buildProviderIndexFromItems(REAL_ITEMS);
const EMPTY_INDEX = buildProviderIndexFromItems([]);

// 1) body.tool_needed selects Apify even when tool_input.tool_name is absent.
Deno.test("routing 1: body.tool_needed=source_with_apify ⇒ Apify (no tool_name needed)", () => {
  const r = resolvePlannedTool({ tool_needed: "source_with_apify", tool_name: null, selected_actor_key: null });
  assertEquals(r.tool, "source_with_apify");
  assertEquals(r.matched_from, "tool_needed");
  assertEquals(isProviderSourcingTool({ tool_needed: FROZEN_Q1_SIGNALS.tool_needed }), true);
});

// 2) plan-step tool_needed is propagated.
Deno.test("routing 2: plan-step tool_needed is honored", () => {
  const r = resolvePlannedTool({ tool_needed: null, plan_step_tool_needed: "source_with_apify" });
  assertEquals(r.tool, "source_with_apify");
  assertEquals(r.matched_from, "plan_step_tool_needed");
});

// 3) explicit tool_needed takes precedence over ambiguous/conflicting tool_input.
Deno.test("routing 3: explicit tool_needed wins over conflicting tool_input", () => {
  const r = resolvePlannedTool({ tool_needed: "source_with_apify", tool_name: "scrape_url", selected_actor_key: "firecrawl_scrape_url" });
  assertEquals(r.tool, "source_with_apify");
  assertEquals(r.matched_from, "tool_needed");
});

// 4) founder query selects the people-search actor.
Deno.test("routing 4: founder query ⇒ people-search actor", () => {
  const r = resolveProviderSource("Using my ICP, find me 5 hot founders I should contact right now.");
  assertEquals(r?.kind, "people");
  assertEquals(r?.actor_key, "apify_people_search");
  assertEquals(r?.source_type, "people_profiles");
});

// 5) decision-maker query selects the people-search actor.
Deno.test("routing 5: decision-maker query ⇒ people-search actor", () => {
  assertEquals(resolveProviderSource("find the decision makers at these accounts")?.actor_key, "apify_people_search");
  assertEquals(resolveProviderSource("find me the CEOs of B2B SaaS companies")?.actor_key, "apify_people_search");
});

// 6) job-opening query selects the jobs actor.
Deno.test("routing 6: job-opening query ⇒ jobs actor", () => {
  const r = resolveProviderSource("find companies hiring RevOps engineers right now");
  assertEquals(r?.kind, "jobs");
  assertEquals(r?.actor_key, "apify_jobs");
});

// 7) Company Brain hiring signals do NOT convert a founder query into jobs.
Deno.test("routing 7: brain signals cannot flip a founder query to jobs (instruction-only)", () => {
  // resolveProviderSource takes ONLY the instruction — the brain is never an input,
  // so a person request stays people regardless of any hiring signals in the brain.
  assertEquals(resolveProviderSource("find me 5 founders who fit my ICP")?.actor_key, "apify_people_search");
});

// 8) missing provider configuration ⇒ structured no_results.
Deno.test("routing 8: missing provider config ⇒ structured no_results", () => {
  assertEquals(classifyProviderSourceOutcome({ configured: false }), "provider_source_unconfigured");
  const t = buildProviderSourceNoResults("provider_source_unconfigured", { provider_calls: 0 });
  assertEquals(t.result_status, "no_results");
  assertEquals(t.next_step, null);
});

// 9) provider execution failure ⇒ no generic LLM lead generation.
Deno.test("routing 9: provider failure ⇒ fail closed, not generic LLM", () => {
  assertEquals(classifyProviderSourceOutcome({ errored: true }), "provider_source_failed");
  assertEquals(isProviderSourcingTool({ tool_needed: "source_with_apify" }), true); // still gated
});

// 10) zero provider items blocks Aria.
Deno.test("routing 10: zero provider items ⇒ Aria blocked", () => {
  const guard = guardScoutToAria(parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null), EMPTY_INDEX);
  assertEquals(guard.shouldStop, true);
});

// 11) verified provider-backed candidates may reach Aria.
Deno.test("routing 11: provider-backed candidate ⇒ Aria may run", () => {
  const scout = JSON.stringify({ candidates: [{ name: "Jane Doe", company: "Acme Robotics", source_url: "https://linkedin.com/in/jane-doe" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  assertEquals(guard.verified.length, 1);
  assertEquals(guard.shouldStop, false);
});

// 12) source_and_qualify_only strips Penn/drafts/send/publish.
Deno.test("routing 12: SQO strips Penn/draft/send/publish", () => {
  const plan = [
    { agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 },
    { agent_slug: "aria", tool_needed: "extract_structured", step_index: 1 },
    { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 2 },
    { agent_slug: "penn", tool_needed: "send_email", step_index: 3 },
  ];
  const filtered = filterPlanForMode(plan, "source_and_qualify_only");
  assertEquals(filtered.steps.map((s) => s.agent_slug), ["scout", "aria"]);
  assertEquals(stepAllowedInMode({ tool_needed: "publish_content" }, "source_and_qualify_only"), false);
});

// 13) non-lead research workflows remain unaffected.
Deno.test("routing 13: non-lead research is generic (unaffected)", () => {
  assertEquals(resolvePlannedTool({ tool_needed: "research_web" }).tool, "generic");
  assertEquals(resolvePlannedTool({ tool_needed: "scrape_url" }).tool, "scrape_url");
  assertEquals(isProviderSourcingTool({ tool_needed: "summarize_text" }), false);
});

// 14) exact frozen failed-Q1 routing replay.
Deno.test("routing 14: frozen failed-Q1 routing replay ⇒ people actor, fail closed when unavailable", () => {
  const sig = { tool_needed: FROZEN_Q1_SIGNALS.tool_needed, tool_name: null, selected_actor_key: null };
  // source_with_apify selected = true; generic LLM fallback = false.
  assertEquals(resolvePlannedTool(sig).tool, "source_with_apify");
  assertEquals(isProviderSourcingTool(sig), true); // provider sourcing = true, generic fallback = false
  // actor type = people search.
  const src = resolveProviderSource(FROZEN_Q1_SIGNALS.instruction);
  assertEquals(src?.kind, "people");
  assertEquals(src?.actor_key, "apify_people_search");
  // when provider is unavailable ⇒ Aria false + result_status=no_results.
  const index = buildProviderIndexFromItems(FROZEN_ACCEPTED_PROVIDER_ITEMS as never[]);
  const guard = guardScoutToAria(parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null), index);
  assertEquals(guard.shouldStop, true);
  const reason = classifyProviderSourceOutcome({ unavailable: true });
  assertEquals(buildProviderSourceNoResults(reason ?? "provider_source_unavailable").result_status, "no_results");
});

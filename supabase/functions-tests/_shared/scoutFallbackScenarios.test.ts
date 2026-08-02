// Production-path scenario coverage for the Scout-fallback fail-closed hotfix.
// Every assertion runs the REAL production helpers run-agent calls — the sourcing
// recognizer + outcome classifier + no_results terminal (leadSourcingGate), the
// Scout→Aria hand-off guard (leadHandoffGuard), and the execution-mode filter
// (executionMode). Deterministic; no provider/LLM/Apify.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFindLeadsProviderSourcingStep,
  classifyProviderSourceOutcome,
  buildProviderSourceNoResults,
} from "../../functions/_shared/leadSourcingGate.ts";
import {
  buildProviderIndexFromItems,
  parseScoutCandidates,
  guardScoutToAria,
  type NormalizedProviderItem,
} from "../../functions/_shared/leadHandoffGuard.ts";
import {
  filterPlanForMode,
  stepAllowedInMode,
} from "../../functions/_shared/executionMode.ts";
import {
  FROZEN_Q1_SIGNALS,
  FROZEN_SCOUT_FABRICATED_OUTPUT,
  FROZEN_ACCEPTED_PROVIDER_ITEMS,
} from "../../functions/_shared/scoutFallbackFixture.ts";

// --- shared frozen provider-backed data (a real accepted Apify item) -----------
const REAL_ITEMS: NormalizedProviderItem[] = [{
  company: "Acme Robotics",
  name: "Jane Doe",
  person_linkedin_url: "https://linkedin.com/in/jane-doe",
  company_linkedin_url: "https://linkedin.com/company/acme-robotics",
  source_url: "https://linkedin.com/in/jane-doe",
  domain: "acme-robotics.com",
}];
const REAL_INDEX = buildProviderIndexFromItems(REAL_ITEMS);
const EMPTY_INDEX = buildProviderIndexFromItems([]);

const SIG = { agent_slug: "scout", tool_needed: "source_with_apify" };

/** Production predicate: given provider state, does the run fail closed? */
function failsClosed(state: Parameters<typeof classifyProviderSourceOutcome>[0]): boolean {
  return isFindLeadsProviderSourcingStep(SIG) && classifyProviderSourceOutcome(state) !== null;
}

// 1) Provider unconfigured + fabricated Scout output → Aria=false, no_results.
Deno.test("scenario 1: provider unconfigured + fabricated output ⇒ Aria not invoked, no_results", () => {
  assertEquals(failsClosed({ configured: false }), true);
  const guard = guardScoutToAria(parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null), EMPTY_INDEX);
  assertEquals(guard.shouldStop, true); // Aria not invoked
  assertEquals(buildProviderSourceNoResults("provider_source_unconfigured").result_status, "no_results");
});

// 2) Provider unavailable → no generic LLM lead fallback.
Deno.test("scenario 2: provider unavailable ⇒ fail closed (no generic LLM lead fallback)", () => {
  assertEquals(classifyProviderSourceOutcome({ unavailable: true }), "provider_source_unavailable");
  assertEquals(failsClosed({ unavailable: true }), true);
});

// 3) Provider execution error → Aria=false, provider_source_failed.
Deno.test("scenario 3: provider execution error ⇒ provider_source_failed, Aria not invoked", () => {
  assertEquals(classifyProviderSourceOutcome({ errored: true }), "provider_source_failed");
  assertEquals(guardScoutToAria(parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null), EMPTY_INDEX).shouldStop, true);
});

// 4) source_with_apify never invoked → global gate still recognizes + blocks.
Deno.test("scenario 4: source_with_apify never invoked ⇒ still recognized as provider sourcing (global gate)", () => {
  // The live regression input: tool_needed present, no tool_name/actor_key.
  assertEquals(isFindLeadsProviderSourcingStep({
    tool_needed: FROZEN_Q1_SIGNALS.tool_needed,
    tool_name: null,
    selected_actor_key: null,
  }), true);
});

// 5) Zero raw provider items → no_results.
Deno.test("scenario 5: zero raw provider items ⇒ provider_source_empty / no_results", () => {
  assertEquals(classifyProviderSourceOutcome({ rawItemCount: 0, acceptedItemCount: 0 }), "provider_source_empty");
  assertEquals(guardScoutToAria([], EMPTY_INDEX).shouldStop, true);
});

// 6) Raw items present but zero accepted → no_results.
Deno.test("scenario 6: raw items but zero accepted ⇒ empty index ⇒ no_results", () => {
  assertEquals(classifyProviderSourceOutcome({ rawItemCount: 20, acceptedItemCount: 0 }), "provider_source_empty");
  // 0 accepted ⇒ empty provider index ⇒ any Scout candidate is unsupported.
  const guard = guardScoutToAria(parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null), buildProviderIndexFromItems([]));
  assertEquals(guard.shouldStop, true);
});

// 7) Accepted items but zero Scout matches → no_results.
Deno.test("scenario 7: accepted items but zero Scout matches ⇒ no_provider_backed_candidates", () => {
  // Scout claims a company/person absent from the accepted index.
  const scout = JSON.stringify({ candidates: [{ name: "Ghost Person", company: "Nowhere Inc" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.shouldStop, true);
  assertEquals(classifyProviderSourceOutcome({ acceptedItemCount: 1, providerBackedCandidateCount: 0 }), "no_provider_backed_candidates");
});

// 8) Plausible fabricated companies → rejected before Aria.
Deno.test("scenario 8: plausible fabricated companies rejected before Aria", () => {
  const scout = JSON.stringify({ candidates: [{ company: "Vantage AI" }, { company: "Pipeline Hero" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.shouldStop, true);
});

// 9) Invented person attached to a REAL provider-backed company → rejected before Aria.
Deno.test("scenario 9: invented person on a real company rejected before Aria", () => {
  const scout = JSON.stringify({ candidates: [{ name: "Fake Founder", company: "Acme Robotics" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  // Company is real, but the invented person is not provider-backed ⇒ rejected.
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.rejected.length, 1);
});

// 10) Fabricated profile / company / evidence URLs → rejected before Aria.
Deno.test("scenario 10: fabricated URLs rejected before Aria", () => {
  const scout = JSON.stringify({ candidates: [
    { name: "Jane Doe", company: "Acme Robotics", source_url: "https://linkedin.com/in/not-real-fabricated" },
  ] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  // A cited URL not in the provider index rejects the candidate outright.
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.shouldStop, true);
});

// 11) Valid provider-backed ACCOUNT candidate → Aria may run; not contact-ready.
Deno.test("scenario 11: valid provider-backed account candidate ⇒ Aria may run, contact_ready=false", () => {
  const scout = JSON.stringify({ candidates: [{ company: "Acme Robotics", source_url: "https://linkedin.com/company/acme-robotics" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  assertEquals(guard.verified.length, 1);
  assertEquals(guard.shouldStop, false); // Aria may run
  // Account-level: no person identity ⇒ not contact-ready.
  assertEquals(guard.verified[0].person ?? null, null);
});

// 12) Valid provider-backed PERSON candidate → Aria may run.
Deno.test("scenario 12: valid provider-backed person candidate ⇒ Aria may run", () => {
  const scout = JSON.stringify({ candidates: [{ name: "Jane Doe", company: "Acme Robotics", source_url: "https://linkedin.com/in/jane-doe" }] });
  const guard = guardScoutToAria(parseScoutCandidates(scout, null), REAL_INDEX);
  assertEquals(guard.verified.length, 1);
  assertEquals(guard.shouldStop, false);
});

// 13) Generic LLM fallback for a non-lead research workflow → remains functional.
Deno.test("scenario 13: non-lead research workflow is not provider sourcing (generic LLM allowed)", () => {
  assertEquals(isFindLeadsProviderSourcingStep({ agent_slug: "hawk", tool_needed: "research_web" }), false);
  assertEquals(isFindLeadsProviderSourcingStep({ agent_slug: "scribe", tool_needed: "summarize_text" }), false);
  assertEquals(isFindLeadsProviderSourcingStep({ agent_slug: "hawk", tool_needed: "scrape_url" }), false);
});

// 14) source_and_qualify_only → Penn/draft/send/publish absent.
Deno.test("scenario 14: source_and_qualify_only strips Penn/draft/send/publish", () => {
  const plan = [
    { agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 },
    { agent_slug: "aria", tool_needed: "extract_structured", step_index: 1 },
    { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 2 },
    { agent_slug: "penn", tool_needed: "send_email", step_index: 3 },
    { agent_slug: "scribe", tool_needed: "publish_content", step_index: 4 },
  ];
  const filtered = filterPlanForMode(plan, "source_and_qualify_only");
  assertEquals(filtered.steps.map((s) => s.agent_slug), ["scout", "aria"]);
  assertEquals(filtered.removed.length, 3);
  assertEquals(stepAllowedInMode({ agent_slug: "penn", tool_needed: "draft_outreach" }, "source_and_qualify_only"), false);
  assertEquals(stepAllowedInMode({ tool_needed: "send_email" }, "source_and_qualify_only"), false);
  assertEquals(stepAllowedInMode({ tool_needed: "publish_content" }, "source_and_qualify_only"), false);
});

// 15) Terminal no_results persistence shape.
Deno.test("scenario 15: no_results terminal has the required zeroed shape + next_step=null", () => {
  const r = buildProviderSourceNoResults("provider_source_empty", { provider_calls: 0, rejected_provenance_count: 0 });
  assertEquals(r.result_status, "no_results");
  assertEquals(r.leads.length, 0);
  assertEquals(r.qualified_count, 0);
  assertEquals(r.contact_ready_count, 0);
  assertEquals(r.persisted_lead_count, 0);
  assertEquals(r.rejected_provenance_count, 0);
  assertEquals(r.provider_calls, 0);
  assertEquals(r.next_step, null);
});

// 16) Exact frozen failed-Q1 replay, end to end.
Deno.test("scenario 16: frozen failed-Q1 replay ⇒ fully fail-closed", () => {
  const sig = {
    agent_slug: FROZEN_Q1_SIGNALS.agent_slug,
    tool_needed: FROZEN_Q1_SIGNALS.tool_needed,
    tool_name: null,
    selected_actor_key: null,
  };
  // provider calls = 0 ⇒ empty accepted set ⇒ empty index.
  const index = buildProviderIndexFromItems(FROZEN_ACCEPTED_PROVIDER_ITEMS as never[]);
  const candidates = parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null);
  const guard = guardScoutToAria(candidates, index);

  assertEquals(isFindLeadsProviderSourcingStep(sig), true);     // recognized (was the miss)
  assertEquals(candidates.length, 10);                          // fabricated scout candidates
  assertEquals(guard.verified.length, 0);                       // candidates reaching Aria = 0
  assertEquals(guard.shouldStop, true);                         // Aria invoked = false ⇒ Penn = false
  const reason = classifyProviderSourceOutcome({ rawItemCount: 0, acceptedItemCount: 0 });
  const terminal = buildProviderSourceNoResults(reason ?? "provider_source_empty", { provider_calls: 0 });
  assertEquals(terminal.result_status, "no_results");           // result_status = no_results
  assertEquals(terminal.persisted_lead_count, 0);               // persisted leads = 0
  assertEquals(terminal.next_step, null);
  assertEquals(typeof terminal.reason, "string");               // structured reason present
});

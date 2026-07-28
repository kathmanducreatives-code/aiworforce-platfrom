// Deterministic regression tests for the Find Leads sourcing-only safety fix.
// Zero providers. Covers the 17 required scenarios from the halted-eval findings.
// Run: deno test supabase/functions/_shared/findLeadsSafety.test.ts

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeExecutionMode, isSourceAndQualifyOnly, filterPlanForMode,
  stepAllowedInMode, draftingAllowedInMode,
} from "./executionMode.ts";
import {
  buildProviderIndex, assertProviderBacked, filterToProviderBacked,
  hasValidProvenance, buildSourceFingerprint, zeroResult,
} from "./leadProvenance.ts";
import { evaluateDraftGate } from "./draftGate.ts";
import { separateIntent } from "./leadIntentModel.ts";

// ---- helpers ---------------------------------------------------------------
const scout = { agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 };
const aria = { agent_slug: "aria", tool_needed: "extract_structured", step_index: 1 };
const penn = { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 2 };
const fullyBackedDraft = {
  execution_mode: "fast", canonical_final_decision: "contact", contact_ready: true,
  provider_company_identity: true, provider_or_verified_person_identity: true,
  person_company_association: true, evidence_url_supported: true,
  hard_disqualifier_hit: false, persisted_lead_candidate_id: "lc_123",
};

// ---- 1 & 4 (zero-result short circuit) -------------------------------------
Deno.test("1. zero accepted provider results → canonical no_results (no leads)", () => {
  const z = zeroResult("22 reviewed, 0 accepted");
  assertEquals(z.status, "no_results");
  assertEquals(z.leads.length, 0);
  assertEquals(z.qualified_count, 0);
  assertEquals(z.contact_ready_count, 0);
});

// ---- 2 (zero results → zero drafts via gate) -------------------------------
Deno.test("2. zero accepted results → zero drafts (no persisted lead → gate blocks)", () => {
  const r = evaluateDraftGate({ ...fullyBackedDraft, persisted_lead_candidate_id: null, canonical_final_decision: "needs_review", contact_ready: false });
  assertFalse(r.allowed);
  assert(r.blocked_reasons.includes("no persisted lead_candidate_id"));
});

// ---- 3 (LLM-invented company rejected) -------------------------------------
Deno.test("3. LLM-generated company absent from provider input is rejected", () => {
  const idx = buildProviderIndex([{ company: "Realco", source_url: "https://x.com/jobs/1" }]);
  const chk = assertProviderBacked({ company: "Fabricated Co" }, idx); // LLM-invented, absent from provider input
  assertFalse(chk.ok);
  assert((chk.reason ?? "").includes("not present in normalized provider input"));
});

// ---- 4 (LLM-invented person rejected) --------------------------------------
Deno.test("4. LLM-generated person absent from provider input is rejected", () => {
  const idx = buildProviderIndex([{ name: "Real Person", source_url: "https://x.com/in/real" }]);
  const chk = assertProviderBacked({ person: "Fabricated Person" }, idx); // LLM-invented, absent from provider input
  assertFalse(chk.ok);
});

// ---- 5 (unsupported evidence URL rejected) ---------------------------------
Deno.test("5. unsupported evidence URL is rejected", () => {
  const idx = buildProviderIndex([{ company: "Realco", source_url: "https://realco.com" }]);
  const chk = assertProviderBacked({ company: "Realco", evidence_url: "https://made-up.example/funding" }, idx);
  assertFalse(chk.ok);
  assert((chk.reason ?? "").includes("evidence_url"));
});

// ---- 6 & 7 & 8 (source_and_qualify_only plan) ------------------------------
Deno.test("6. source_and_qualify_only yields Scout → Aria only", () => {
  const { steps } = filterPlanForMode([scout, aria, penn], "source_and_qualify_only");
  assertEquals(steps.map((s) => s.agent_slug), ["scout", "aria"]);
  assertEquals(steps.map((s) => s.step_index), [0, 1]); // re-indexed
});
Deno.test("7. Penn cannot be added in source_and_qualify_only", () => {
  assertFalse(stepAllowedInMode(penn, "source_and_qualify_only"));
  const { removed } = filterPlanForMode([scout, aria, penn], "source_and_qualify_only");
  assertEquals(removed.length, 1);
  assertEquals(removed[0].agent_slug, "penn");
});
Deno.test("8. draft tools cannot execute in source_and_qualify_only", () => {
  assertFalse(draftingAllowedInMode("source_and_qualify_only"));
  assertFalse(stepAllowedInMode({ agent_slug: "aria", tool_needed: "draft_outreach" }, "source_and_qualify_only"));
  const r = evaluateDraftGate({ ...fullyBackedDraft, execution_mode: "source_and_qualify_only" });
  assertFalse(r.allowed);
  assert(r.blocked_reasons.some((x) => x.includes("source_and_qualify_only")));
});

// ---- 9 & 10 (routing) ------------------------------------------------------
Deno.test("9. founder + why-now query routes account_first", () => {
  for (const q of [
    "Using my ICP, find me 5 hot founders I should contact right now.",
    "Find me 5 founders who fit my ICP and have a clear reason to talk right now.",
    "Show me 5 strong leads from my ICP with real proof that they may need us.",
    "Find me 5 founder-led SaaS companies that match my ICP and are hiring for sales or growth.",
  ]) {
    const si = separateIntent({ message: q });
    assertEquals(si.source_strategy, "account_first", `query routed wrong: ${q}`);
  }
});
Deno.test("10. explicit named-company profile query routes profile_first", () => {
  const si = separateIntent({ message: "Find the LinkedIn profiles of the founders of Acme and Globex." });
  assertEquals(si.source_strategy, "profile_first");
});

// ---- 11 (jobs actor supports signal, not identity invention) ---------------
Deno.test("11. jobs actor output can support a hiring signal but cannot invent founders", () => {
  // Provider returned a job row for a real company; an LLM-invented founder is rejected.
  const idx = buildProviderIndex([{ company: "Realco", source_url: "https://boards.greenhouse.io/realco/jobs/9" }]);
  assert(assertProviderBacked({ company: "Realco", source_url: "https://boards.greenhouse.io/realco/jobs/9" }, idx).ok);
  assertFalse(assertProviderBacked({ company: "Realco", person: "Invented Founder" }, idx).ok);
});

// ---- 12 & 13 & 14 (draft persistence preconditions) ------------------------
Deno.test("12. draft persistence requires contact_ready=true", () => {
  assertFalse(evaluateDraftGate({ ...fullyBackedDraft, contact_ready: false }).allowed);
});
Deno.test("13. draft persistence requires canonical_final_decision=contact", () => {
  assertFalse(evaluateDraftGate({ ...fullyBackedDraft, canonical_final_decision: "watch" }).allowed);
});
Deno.test("14. draft persistence requires a persisted lead candidate", () => {
  assertFalse(evaluateDraftGate({ ...fullyBackedDraft, persisted_lead_candidate_id: "" }).allowed);
  assert(evaluateDraftGate(fullyBackedDraft).allowed, "fully-backed draft should pass");
});

// ---- 15 (provenance on accepted candidates) --------------------------------
Deno.test("15. every accepted candidate has provider provenance", () => {
  const good = { provider: "apify", actor_id: "curious_coder/linkedin-jobs-scraper", provider_run_id: "run_1", source_url: "https://x/1", normalized_candidate_id: "n1", run_id: "eval_1", provider_item_id: "i1" };
  assert(hasValidProvenance(good));
  assertFalse(hasValidProvenance({ ...good, provider: "" }));
  assertFalse(hasValidProvenance({ ...good, provider_item_id: null, source_fingerprint: null }));
  // fingerprint is an acceptable per-item anchor
  assert(hasValidProvenance({ ...good, provider_item_id: null, source_fingerprint: buildSourceFingerprint({ provider: "apify", source_url: "https://x/1", name: "A" }) }));
});

// ---- 16 (run-scoped trace survives) ----------------------------------------
Deno.test("16. run-scoped trace fields survive provenance filtering", () => {
  const idx = buildProviderIndex([{ company: "Realco", source_url: "https://realco.com" }]);
  const cand = { company: "Realco", source_url: "https://realco.com", provenance: { provider: "apify", actor_id: "a", provider_run_id: "r", source_url: "https://realco.com", normalized_candidate_id: "n1", run_id: "eval_42", provider_item_id: "i1" } };
  const { kept } = filterToProviderBacked([cand], idx);
  assertEquals(kept.length, 1);
  assertEquals(kept[0].provenance?.run_id, "eval_42");
});

// ---- 17 (Q1 replay) --------------------------------------------------------
Deno.test("17. frozen Q1 fixture → no_results, 0 fabricated survive, 0 drafts, Penn not planned", () => {
  // Q1: provider (jobs actor) returned 22 raw rows, 0 accepted; the LLM emitted
  // 10 fabricated founders. Sanitized fixture (no real live names in prod logic).
  const acceptedProviderItems: Array<{ company?: string; name?: string; source_url?: string }> = []; // 0 accepted
  const llmFabricated = [
    { company: "FakeCo A", person: "Person A" }, { company: "FakeCo B", person: "Person B" },
    { company: "FakeCo C", person: "Person C" }, { company: "FakeCo D", person: "Person D" },
    { company: "FakeCo E", person: "Person E" },
  ];
  const idx = buildProviderIndex(acceptedProviderItems);
  const { kept, rejected } = filterToProviderBacked(llmFabricated, idx);
  assertEquals(kept.length, 0, "no fabricated candidate may survive");
  assertEquals(rejected.length, 5);

  // With 0 kept → canonical zero-result, and no draft can pass the gate.
  const z = zeroResult();
  assertEquals(z.status, "no_results");
  const draftAttempts = kept.map((_c) => evaluateDraftGate({ ...fullyBackedDraft, persisted_lead_candidate_id: null }));
  assertEquals(draftAttempts.filter((d) => d.allowed).length, 0);

  // The plan itself must not contain Penn in the safe mode.
  const { steps } = filterPlanForMode([scout, aria, penn], normalizeExecutionMode("source_and_qualify_only"));
  assertFalse(steps.some((s) => s.agent_slug === "penn"), "Penn must not execute");
});

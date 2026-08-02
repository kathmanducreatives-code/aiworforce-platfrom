// OBSERVATION, BOTTLENECK, NEXT-ACTION LOOP AND THE OFFLINE ACCEPTANCE SCENARIOS.
//
// OFFLINE ONLY. Every "Claude response" below is a literal object. No Actor runs,
// no Firecrawl call, no model call, no database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSourceStepObservation, classifyAdaptiveBottleneck, projectValidActions,
  observationIsBounded, ADAPTIVE_ACTIONS,
  type AdaptiveAction, type ObservationInput, type SourceStepObservation,
} from "../../supabase/functions/_shared/leadAdaptiveObservation.ts";
import {
  parseNextAction, validateNextAction, resolveNextAction, deterministicNextAction,
  assessSourceQuality, actionSignature,
} from "../../supabase/functions/_shared/leadAdaptiveAction.ts";
import { validateRoleTaxonomy } from "../../supabase/functions/_shared/leadRoleTaxonomy.ts";
import { validateQueryPacks, type QueryPack } from "../../supabase/functions/_shared/leadQueryPacks.ts";
import { deterministicRevenueOpsTaxonomy, deterministicRevenueOpsPacks } from "../../supabase/functions/_shared/leadAdaptiveContext.ts";
import { decideDiscoveryBatchSize } from "../../discoveryBatchSize.ts";
import { schemaFixtureFor, isDocumentedEnumValue } from "../../actorSchemaFixtures.ts";
import { validateFinalActorPayload } from "../../finalActorPayload.ts";

const APPROVED = ["yc_job_discovery", "linkedin_job_discovery", "indeed_job_discovery", "glassdoor_job_discovery"];

function validatedPacks(): QueryPack[] {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  return validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED }).packs;
}

function obsInput(over: Partial<ObservationInput> = {}): ObservationInput {
  return {
    source_step_id: "s1", source_capability: "linkedin_job_discovery",
    query_pack_ids: ["sales_ops_leadership"], titles_used: ["Director of Sales Operations"],
    provider_rows: 25, normalized_jobs: 25, jobs_within_recency_window: 25,
    title_matches: 23, title_rejections: 2,
    companies_resolved: 25, companies_qualified: 0,
    company_rejection_reasons: { employee_count: 18, business_model: 7 },
    decision_makers_verified: 0, contact_ready_leads: 0, requested_leads: 5,
    completed_query_packs: ["sales_ops_leadership"],
    unused_query_packs: ["revenue_ops_leadership", "direct_ops_ic"],
    completed_sources: ["linkedin_job_discovery"],
    remaining_sources: ["yc_job_discovery", "indeed_job_discovery"],
    budget_remaining_usd: 4, provider_calls_remaining: 6,
    direct_adjacent_packs_available: 2, evidence_gated_packs_available: 1,
    seniority_broadening_available: true, recency_broadening_available: true,
    people_search_completed_for_qualified: false, people_needing_contact: 0,
    ...over,
  };
}

function ctxFor(o: SourceStepObservation, over: Record<string, unknown> = {}) {
  return {
    observation: o, approvedCapabilities: APPROVED, packs: validatedPacks(),
    executedSignatures: [] as string[], budgetRemainingUsd: 4, providerCallsRemaining: 6,
    maximumAgeDays: 30,
    directAdjacentAvailable: 2, evidenceGatedAvailable: 1,
    nextCapability: "yc_job_discovery" as string | null,
    ...over,
  };
}

// ============================================================ OBSERVATION (25,27) ==

Deno.test("25. the observation reports Agentory's own counts, and derives rejections", () => {
  const o = buildSourceStepObservation(obsInput());
  assertEquals(o.provider_rows, 25);
  assertEquals(o.title_matches, 23);
  assertEquals(o.companies_resolved, 25);
  assertEquals(o.companies_qualified, 0);
  // DERIVED — resolved minus qualified, never a caller-supplied number and never
  // jobs-minus-companies (the units mismatch that invented phantom rejections).
  assertEquals(o.companies_rejected, 25);
  assertEquals(o.remaining_leads, 5);
});

Deno.test("25b. companies_qualified can never exceed companies_resolved", () => {
  const o = buildSourceStepObservation(obsInput({ companies_resolved: 3, companies_qualified: 99 }));
  assertEquals(o.companies_qualified, 3);
  assertEquals(o.companies_rejected, 0);
});

Deno.test("27. the observation is bounded — no raw provider payload reaches the model", () => {
  const o = buildSourceStepObservation(obsInput());
  assert(observationIsBounded(o));
  const blob = JSON.stringify(o);
  assertFalse(blob.includes("jobDescription"));
  assertFalse(blob.includes("provider_payload"));
});

// ============================================================= BOTTLENECK (26) ==

Deno.test("26. resolved companies that none qualify is company_brain_rejection", () => {
  const o = buildSourceStepObservation(obsInput());
  assertEquals(o.bottleneck, "company_brain_rejection");
});

Deno.test("26b. matching titles that resolve NO company is a resolution failure, not a Brain verdict", () => {
  // Production task c30fbc6d: 25 rows, 23 title matches, and zero companies ever
  // resolved because 21 rows were dropped upstream at `missing_occurred_at`.
  // Reporting that as a Company Brain rejection sends the next decision after a
  // bottleneck that never happened.
  const o = buildSourceStepObservation(obsInput({ companies_resolved: 0, companies_qualified: 0 }));
  assertEquals(o.bottleneck, "insufficient_company_resolution");
  assert(o.bottleneck !== "company_brain_rejection");
});

Deno.test("26c. title coverage is judged on titles, never on a downstream company metric", () => {
  const noTitles = buildSourceStepObservation(obsInput({ title_matches: 0, title_rejections: 25 }));
  assertEquals(noTitles.bottleneck, "insufficient_title_coverage");

  // 23 of 25 titles matched — title coverage is emphatically NOT the problem,
  // even though zero companies qualified.
  const goodTitles = buildSourceStepObservation(obsInput());
  assert(goodTitles.bottleneck !== "insufficient_title_coverage");
});

Deno.test("26d. the remaining bottleneck labels are reachable", () => {
  const base = {
    provider_rows: 25, title_matches: 20, title_rejections: 2,
    companies_resolved: 10, companies_qualified: 8,
    decision_makers_verified: 2, contact_ready_leads: 1,
    remaining_leads: 4, people_needing_contact: 0,
    budget_remaining_usd: 4, provider_calls_remaining: 6,
    unused_query_packs: ["a"], remaining_sources: ["b"],
  };
  assertEquals(classifyAdaptiveBottleneck({ ...base, remaining_leads: 0 }).bottleneck, "quota_reached");
  assertEquals(classifyAdaptiveBottleneck({ ...base, budget_remaining_usd: 0 }).bottleneck, "execution_window_reached");
  assertEquals(classifyAdaptiveBottleneck({ ...base, provider_rows: 0 }).bottleneck, "insufficient_raw_coverage");
  assertEquals(classifyAdaptiveBottleneck({ ...base, title_matches: 5, title_rejections: 20 }).bottleneck, "excessive_title_noise");
  assertEquals(classifyAdaptiveBottleneck({ ...base, decision_makers_verified: 0 }).bottleneck, "insufficient_decision_maker_coverage");
  assertEquals(
    classifyAdaptiveBottleneck({ ...base, contact_ready_leads: 0, people_needing_contact: 3 }).bottleneck,
    "insufficient_contact_coverage",
  );
  assertEquals(
    classifyAdaptiveBottleneck({ ...base, contact_ready_leads: 0, people_needing_contact: 0 }).bottleneck,
    "current_employer_verification_failure",
  );
  assertEquals(
    classifyAdaptiveBottleneck({ ...base, unused_query_packs: [], remaining_sources: [] }).bottleneck,
    "source_exhausted",
  );
});

// ================================================== ACTION MENU + CHOICE (28,29,30) ==

Deno.test("28/29. exactly one action is parsed per observation, and only a known one", () => {
  const one = parseNextAction({ action: "advance_source", reason: "corpus mismatch" });
  assertEquals(one!.action, "advance_source");
  // Unknown verbs are not coerced into something adjacent.
  assertEquals(parseNextAction({ action: "call_actor_directly", reason: "x" }), null);
  assertEquals(parseNextAction({ action: ["advance_source"], reason: "x" }), null);
  assertEquals(parseNextAction(null), null);
});

Deno.test("30. an action outside valid_next_actions is refused", () => {
  const o = buildSourceStepObservation(obsInput());
  assertFalse(o.valid_next_actions.includes("begin_people_search"));   // nothing qualified yet
  const v = validateNextAction({ action: "begin_people_search", reason: "try people" }, ctxFor(o));
  assertFalse(v.valid);
  assert(v.violations.some((x) => x.code === "action_not_in_menu"));
});

Deno.test("30b. the menu only offers what the current state actually supports", () => {
  const o = buildSourceStepObservation(obsInput());
  for (const a of o.valid_next_actions) assert((ADAPTIVE_ACTIONS as readonly string[]).includes(a));
  // Evidence-gated activation is not offered while exact packs remain unused.
  assertFalse(o.valid_next_actions.includes("activate_evidence_gated_pack"));

  const exactSpent = buildSourceStepObservation(obsInput({
    unused_query_packs: [], direct_adjacent_packs_available: 0, evidence_gated_packs_available: 1,
  }));
  assert(exactSpent.valid_next_actions.includes("activate_evidence_gated_pack"));
});

Deno.test("ATS verification is absent from the entire action vocabulary", () => {
  const blob = JSON.stringify(ADAPTIVE_ACTIONS);
  assertFalse(blob.includes("ats"));
  assertFalse(blob.includes("verify_selected_jobs"));
});

// ==================================== SOURCE-QUALITY ADAPTATION (31,32,33,34) ==

Deno.test("31. high company rejection with good titles recommends switching source", () => {
  const o = buildSourceStepObservation(obsInput());
  const q = assessSourceQuality(o);
  assert(q.sourceUnsuitedToIcp);
  assertEquals(q.recommended, "advance_source");
  assert(o.valid_next_actions.includes("advance_source"));
});

Deno.test("32. high company rejection does NOT recommend broadening role titles", () => {
  const o = buildSourceStepObservation(obsInput());
  const q = assessSourceQuality(o);
  assert(q.preserveExactTitleIntent, "exact role intent must be preserved");
  assertFalse(q.recommended === "activate_direct_adjacent_pack");
  assertFalse(q.recommended === "activate_evidence_gated_pack");
  assertFalse(q.recommended === "broaden_direct_seniority");

  // And the deterministic fallback agrees, rather than reaching for adjacency.
  const fb = deterministicNextAction(ctxFor(o));
  assertEquals(fb.action, "advance_source");
});

Deno.test("32b. noisy titles against a fine corpus wants a tighter pack, not a new source", () => {
  const o = buildSourceStepObservation(obsInput({
    title_matches: 5, title_rejections: 20, companies_resolved: 4, companies_qualified: 3,
  }));
  const q = assessSourceQuality(o);
  assertFalse(q.sourceUnsuitedToIcp);
  assertEquals(q.recommended, "run_unused_query_pack");
});

Deno.test("33. qualified companies with no verified people triggers people search", () => {
  const o = buildSourceStepObservation(obsInput({
    companies_resolved: 12, companies_qualified: 9, decision_makers_verified: 0,
  }));
  assertEquals(o.bottleneck, "insufficient_decision_maker_coverage");
  assert(o.valid_next_actions.includes("begin_people_search"));
  assertEquals(assessSourceQuality(o).recommended, "begin_people_search");
});

Deno.test("34. verified people without contacts triggers enrichment", () => {
  const o = buildSourceStepObservation(obsInput({
    companies_resolved: 12, companies_qualified: 9,
    decision_makers_verified: 6, people_needing_contact: 6,
    people_search_completed_for_qualified: true,
  }));
  assertEquals(o.bottleneck, "insufficient_contact_coverage");
  assert(o.valid_next_actions.includes("run_contact_enrichment"));
  assertEquals(assessSourceQuality(o).recommended, "run_contact_enrichment");
});

// ============================================== VALIDATION + FALLBACK (35,36) ==

Deno.test("35. an invalid action falls back deterministically", () => {
  const o = buildSourceStepObservation(obsInput());
  // Generic Business Operations pack + a capability that is not approved.
  const bad = {
    action: "advance_source" as AdaptiveAction, reason: "try something broader",
    target_capability_key: "monster_job_discovery",
  };
  const r = resolveNextAction(bad, ctxFor(o));
  assertEquals(r.source, "deterministic_fallback");
  assert(r.violations.some((x) => x.code === "unapproved_capability"));
  assert((ADAPTIVE_ACTIONS as readonly string[]).includes(r.action.action));
});

Deno.test("35b. a null or unparseable response falls back without stalling", () => {
  const o = buildSourceStepObservation(obsInput());
  const r = resolveNextAction(null, ctxFor(o));
  assertEquals(r.source, "deterministic_fallback");
  assertEquals(r.action.action, "advance_source");
});

Deno.test("35c. a raw Actor ID in the action is rejected", () => {
  const o = buildSourceStepObservation(obsInput());
  const r = resolveNextAction({
    action: "advance_source", reason: "switch", target_capability_key: "parsebird/yc-jobs-scraper",
  }, ctxFor(o));
  assertEquals(r.source, "deterministic_fallback");
  assert(r.violations.some((x) => x.code === "raw_actor_id"));
});

Deno.test("36. a duplicate input is rejected", () => {
  const o = buildSourceStepObservation(obsInput());
  const action = {
    action: "advance_source" as AdaptiveAction, reason: "switch corpus",
    target_capability_key: "yc_job_discovery",
  };
  const sig = actionSignature(action);
  const fresh = validateNextAction(action, ctxFor(o));
  assert(fresh.valid);

  const repeat = validateNextAction(action, ctxFor(o, { executedSignatures: [sig] }));
  assertFalse(repeat.valid);
  assert(repeat.violations.some((x) => x.code === "duplicate_input"));
});

Deno.test("36b. quota met and an exhausted execution window both block provider actions", () => {
  const met = buildSourceStepObservation(obsInput({ contact_ready_leads: 5 }));
  assertEquals(met.valid_next_actions, ["stop_success"]);

  const broke = buildSourceStepObservation(obsInput({ budget_remaining_usd: 0 }));
  assertEquals(broke.valid_next_actions, ["stop_partial"]);
});

Deno.test("an evidence-gated pack cannot be activated without evidence", () => {
  const o = buildSourceStepObservation(obsInput({
    unused_query_packs: [], direct_adjacent_packs_available: 0, evidence_gated_packs_available: 1,
  }));
  const packs = validatedPacks().map((p) =>
    p.pack_id === "commercial_ops_gated" ? { ...p, description_evidence: [] } : p);
  const v = validateNextAction(
    { action: "activate_evidence_gated_pack", reason: "widen", query_pack_ids: ["commercial_ops_gated"] },
    ctxFor(o, { packs }),
  );
  assertFalse(v.valid);
  assert(v.violations.some((x) => x.code === "evidence_gated_without_evidence"));
});

Deno.test("a secondary-signal pack is never runnable as hiring evidence", () => {
  const o = buildSourceStepObservation(obsInput({
    unused_query_packs: [], direct_adjacent_packs_available: 0, evidence_gated_packs_available: 1,
  }));
  const v = validateNextAction(
    { action: "activate_evidence_gated_pack", reason: "widen", query_pack_ids: ["commercial_leadership_signal"] },
    ctxFor(o),
  );
  assertFalse(v.valid);
  assert(v.violations.some((x) => x.code === "pack_not_eligible"));
});

Deno.test("people search cannot begin without a qualified company", () => {
  const o = buildSourceStepObservation(obsInput({ companies_qualified: 0 }));
  const v = validateNextAction({ action: "begin_people_search", reason: "go" }, ctxFor(o));
  assertFalse(v.valid);
  assert(v.violations.some((x) => x.code === "people_search_prerequisite_missing"));
});

// ============================== EXISTING SYSTEMS REMAIN INTACT (37,38,39,40,41,42) ==

Deno.test("37. the final provider-payload validator is untouched and still binding", () => {
  const bad = validateFinalActorPayload("indeed_job_discovery", { position: "RevOps", datePosted: "14" });
  assertFalse(bad.ok, "an undocumented datePosted value must still be refused");
  // Nothing in the adaptive layer can produce provider JSON at all.
  const o = buildSourceStepObservation(obsInput());
  assertFalse(JSON.stringify(o).includes("datePosted"));
});

Deno.test("38. verified Actor schema fixtures remain intact", () => {
  const indeed = schemaFixtureFor("indeed_job_discovery");
  assert(indeed, "the Indeed fixture must still exist");
  // Live-actor truth (run b59b422b): the enum is "14", never "14 days".
  assert(isDocumentedEnumValue("indeed_job_discovery", "datePosted", "14"));
  assertFalse(isDocumentedEnumValue("indeed_job_discovery", "datePosted", "14 days"));
});

Deno.test("39. existing batch sizing remains the authority for how many rows to fetch", () => {
  const d = decideDiscoveryBatchSize({
    requestedLeads: 5, remainingLeads: 5, sourceMaximum: 200,
    costPerCallUsd: 0.25, remainingBudgetUsd: 5, completedSources: 0,
  });
  assert(d.count > 0);
  assertEquals(
    decideDiscoveryBatchSize({
      requestedLeads: 5, remainingLeads: 0, sourceMaximum: 200,
      costPerCallUsd: 0.25, remainingBudgetUsd: 5, completedSources: 0,
    }).reason,
    "quota_met",
  );
});

Deno.test("40. Company Brain remains the qualification authority — the loop only reports it", () => {
  const o = buildSourceStepObservation(obsInput());
  // The observation carries the Brain's verdict and its reasons; it never restates
  // or recomputes a constraint.
  assertEquals(o.company_rejection_reasons.employee_count, 18);
  assertFalse(Object.keys(o).includes("company_constraints"));
  // No action in the vocabulary can alter a constraint.
  const mutate = validateNextAction(
    { action: "advance_source", reason: "loosen the size band", target_capability_key: "yc_job_discovery" },
    ctxFor(o),
  );
  assert(mutate.valid, "the action is legal — but it carries no constraint to change");
  assertFalse(JSON.stringify(mutate.action).includes("employee_count"));
});

Deno.test("41. current-employer verification remains upstream of contact enrichment", () => {
  const unverified = buildSourceStepObservation(obsInput({
    companies_qualified: 9, decision_makers_verified: 0, people_needing_contact: 4,
    people_search_completed_for_qualified: true,
  }));
  const v = validateNextAction({ action: "run_contact_enrichment", reason: "enrich" }, ctxFor(unverified));
  assertFalse(v.valid, "enrichment must not run ahead of employer verification");
  assert(v.violations.some((x) => x.code === "people_search_prerequisite_missing"));
});

Deno.test("42. only CONTACT-ready leads count against the quota", () => {
  // Verified people and qualified companies do not reduce remaining_leads; only
  // contact_ready_leads does.
  const many = buildSourceStepObservation(obsInput({
    companies_qualified: 20, decision_makers_verified: 20, contact_ready_leads: 0,
    people_needing_contact: 20, people_search_completed_for_qualified: true,
  }));
  assertEquals(many.remaining_leads, 5);
  assertFalse(many.valid_next_actions.includes("stop_success"));

  const done = buildSourceStepObservation(obsInput({ contact_ready_leads: 5 }));
  assertEquals(done.remaining_leads, 0);
  assertEquals(done.valid_next_actions, ["stop_success"]);
});

// ================================================= OFFLINE SCENARIOS A–G ==

Deno.test("Scenario B — poor LinkedIn company quality drives a source switch", () => {
  // 25 rows, 23 relevant titles, every resolved company rejected.
  const o = buildSourceStepObservation(obsInput({
    source_capability: "linkedin_job_discovery",
    provider_rows: 25, title_matches: 23, title_rejections: 2,
    companies_resolved: 25, companies_qualified: 0,
  }));
  assertEquals(o.bottleneck, "company_brain_rejection");

  const claude = { action: "advance_source" as AdaptiveAction, reason: "Employers failed the SaaS startup constraints; preserve role intent and switch to a startup-relevant corpus.", target_capability_key: "yc_job_discovery", expected_improvement: "Increase startup and SaaS company precision." };
  const r = resolveNextAction(claude, ctxFor(o));
  assertEquals(r.source, "claude");
  assertEquals(r.action.action, "advance_source");
  assertEquals(r.action.target_capability_key, "yc_job_discovery");
  // Exact intent preserved: no adjacency or seniority broadening was chosen.
  assert(assessSourceQuality(o).preserveExactTitleIntent);
});

Deno.test("Scenario C — a limited first source advances to the next with exact packs", () => {
  const o = buildSourceStepObservation(obsInput({
    source_capability: "yc_job_discovery", provider_rows: 4, normalized_jobs: 4,
    title_matches: 3, title_rejections: 1, companies_resolved: 3, companies_qualified: 2,
    completed_sources: ["yc_job_discovery"], remaining_sources: ["linkedin_job_discovery"],
    unused_query_packs: [],
  }));
  const r = resolveNextAction(
    { action: "advance_source", reason: "YC coverage is thin; broaden corpus with exact packs.", target_capability_key: "linkedin_job_discovery" },
    ctxFor(o, { nextCapability: "linkedin_job_discovery" }),
  );
  assertEquals(r.source, "claude");
  assertEquals(r.action.target_capability_key, "linkedin_job_discovery");
});

Deno.test("Scenario D — exact packs exhausted activates adjacent, gated stays gated", () => {
  // The people stage is deliberately already spent here. Otherwise qualified
  // companies with no verified decision maker would — correctly — make people
  // search the next action, and this scenario would not be testing pack tiers.
  const o = buildSourceStepObservation(obsInput({
    unused_query_packs: [], remaining_sources: [],
    companies_resolved: 8, companies_qualified: 3,
    decision_makers_verified: 2, contact_ready_leads: 1,
    people_search_completed_for_qualified: true, people_needing_contact: 0,
    direct_adjacent_packs_available: 2, evidence_gated_packs_available: 1,
  }));
  assert(o.valid_next_actions.includes("activate_direct_adjacent_pack"));
  // Evidence-gated must NOT be offered while direct-adjacent remains.
  assertFalse(o.valid_next_actions.includes("activate_evidence_gated_pack"));

  const fb = deterministicNextAction(ctxFor(o, { nextCapability: null }));
  assertEquals(fb.action, "activate_direct_adjacent_pack");
});

Deno.test("Scenario E — a people bottleneck chooses people search over another job source", () => {
  const o = buildSourceStepObservation(obsInput({
    companies_resolved: 14, companies_qualified: 11, decision_makers_verified: 0,
  }));
  const r = resolveNextAction(
    { action: "begin_people_search", reason: "Enough qualified companies; the constriction is decision-maker coverage." },
    ctxFor(o),
  );
  assertEquals(r.source, "claude");
  assertEquals(r.action.action, "begin_people_search");
  // The deterministic path reaches the same conclusion.
  assertEquals(assessSourceQuality(o).recommended, "begin_people_search");
});

Deno.test("Scenario F — a generic-Operations pack or 90-day recency is refused", () => {
  const o = buildSourceStepObservation(obsInput());
  const packs = [...validatedPacks(), {
    pack_id: "generic_bizops", label: "Business Operations", functional_family_ids: [],
    confidence_tier: "exact" as const, titles: ["Business Operations Manager", "Operations Manager"],
    aliases: [], negative_patterns: [], description_evidence: [], recommended_capabilities: [],
    priority: 1, broadening_level: 1, initially_eligible: true, maximum_attempts: 1,
    expected_precision: "high" as const, expected_coverage: "high" as const,
  }];
  const generic = validateNextAction(
    { action: "run_unused_query_pack", reason: "widen", query_pack_ids: ["generic_bizops"] },
    ctxFor(o, { packs }),
  );
  assertFalse(generic.valid);
  assert(generic.violations.some((x) => x.code === "generic_operations_pack"));

  // 90-day recency: the mission ceiling is already at the maximum.
  const stale = validateNextAction(
    { action: "broaden_recency", reason: "look back 90 days" },
    ctxFor(o, { maximumAgeDays: 60 }),
  );
  assertFalse(stale.valid);
  assert(stale.violations.some((x) => x.code === "recency_exceeded"));

  // Both land on the deterministic path rather than stalling.
  assertEquals(resolveNextAction({ action: "broaden_recency", reason: "90 days" }, ctxFor(o, { maximumAgeDays: 60 })).source, "deterministic_fallback");
});

Deno.test("Scenario G — everything exhausted with 3 of 5 leads stays an honest Partial", () => {
  const o = buildSourceStepObservation(obsInput({
    contact_ready_leads: 3, companies_resolved: 20, companies_qualified: 12,
    decision_makers_verified: 8, people_needing_contact: 0,
    people_search_completed_for_qualified: true,
    unused_query_packs: [], remaining_sources: [],
    direct_adjacent_packs_available: 0, evidence_gated_packs_available: 0,
    seniority_broadening_available: false, recency_broadening_available: false,
  }));
  assertEquals(o.remaining_leads, 2);
  assertEquals(o.bottleneck, "source_exhausted");
  assert(o.valid_next_actions.includes("stop_partial"));
  assertFalse(o.valid_next_actions.includes("stop_success"));

  const fb = deterministicNextAction(ctxFor(o, { nextCapability: null, directAdjacentAvailable: 0, evidenceGatedAvailable: 0 }));
  assertEquals(fb.action, "stop_partial");
});

Deno.test("projectValidActions never returns an action outside the vocabulary", () => {
  for (const over of [
    {}, { contact_ready_leads: 5 }, { budget_remaining_usd: 0 },
    { companies_qualified: 9, decision_makers_verified: 0 },
    { unused_query_packs: [], remaining_sources: [] },
  ] as Partial<ObservationInput>[]) {
    const input = obsInput(over);
    const o = buildSourceStepObservation(input);
    const menu = projectValidActions(input, o.bottleneck);
    assert(menu.length > 0, "there is always at least one honest action");
    for (const a of menu) assert((ADAPTIVE_ACTIONS as readonly string[]).includes(a));
  }
});

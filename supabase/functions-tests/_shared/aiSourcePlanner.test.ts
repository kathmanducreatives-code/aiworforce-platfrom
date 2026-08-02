import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDeterministicPlan } from "../../functions/_shared/actorInputPlanner.ts";
import {
  validateActorInputAgainstSchema,
  sanitizeActorInput,
  validateStrictConstraints,
} from "../../functions/_shared/actorInputValidator.ts";
import { getActorInputSchema } from "../../functions/_shared/actorInputSchemas.ts";
import { planBroadening, guardBroadenedTerms } from "../../functions/_shared/actorBroadeningPlanner.ts";
import { classifyResults, summarizeSourceQuality, topRejectReasons } from "../../functions/_shared/sourceQuality.ts";
import type { SourcingCriteria, StrictConstraints } from "../../functions/_shared/sourcingRetry.ts";

const STRICT_NONE: StrictConstraints = { location: false, industry: false, stage: false, count_exact: false };

// ============ Actor input planning (deterministic) ============

Deno.test("plan: hiring prompt → valid apify_jobs input", () => {
  const plan = buildDeterministicPlan({ user_request: "Find 5 companies hiring GTM roles in B2B SaaS in USA", actor_key: "apify_jobs", source_type: "hiring_signal", count: 5, normalized: { role: "GTM", industry: "B2B SaaS", location: "USA" } });
  const schema = getActorInputSchema("apify_jobs")!;
  assertEquals(plan.actor_key, "apify_jobs");
  assertEquals(plan.expected_entity_type, "account");
  assert((plan.input.role_keywords as string[]).length > 0);
  assertEquals(plan.input.max_results, 5);
  assert(validateActorInputAgainstSchema(plan.input, schema).ok, JSON.stringify(validateActorInputAgainstSchema(plan.input, schema).errors));
});

Deno.test("plan: GGTM normalizes to GTM before input generation", () => {
  const plan = buildDeterministicPlan({ user_request: "Find 5 companies hiring GGTM roles in B2B SaaS in USA", actor_key: "apify_jobs", source_type: "hiring_signal", count: 5, normalized: { role: "GGTM", industry: "B2B SaaS", location: "USA" } });
  assertEquals(plan.normalized_request.role, "GTM");
  assert(!JSON.stringify(plan.input).includes("GGTM"), "no literal typo in input");
});

Deno.test("plan: healthcare AI founder → people_profiles input", () => {
  const plan = buildDeterministicPlan({ user_request: "Find 5 healthcare AI founders in London", actor_key: "apify_people_search", source_type: "people_profiles", count: 5, normalized: { role: "Founder", industry: "Healthcare", location: "London" } });
  assertEquals(plan.expected_entity_type, "contact");
  assert(/founder/i.test(String(plan.input.query)));
  const schema = getActorInputSchema("apify_people_search")!;
  assert(validateActorInputAgainstSchema(plan.input, schema).ok);
});

Deno.test("plan: Clay alternatives → linkedin posts input with competitor keywords", () => {
  const plan = buildDeterministicPlan({ user_request: "Find people talking about Clay alternatives", actor_key: "apify_linkedin_posts", source_type: "competitor_engagement", count: 5, competitors: ["Clay"], normalized: { topic: "Clay alternatives" } });
  const ui = (plan.input.user_input ?? {}) as Record<string, unknown>;
  const kws = (ui.keywords as string[]) ?? [];
  assert(kws.length > 0, "keywords present");
  assert((ui.companies as string[]).includes("Clay"));
  const schema = getActorInputSchema("apify_linkedin_posts")!;
  assert(validateActorInputAgainstSchema(plan.input, schema).ok);
});

Deno.test("plan: comments without post URL flags missing_info; with URL valid", () => {
  const missing = buildDeterministicPlan({ user_request: "Find people commenting on AI posts", actor_key: "apify_linkedin_post_comments", source_type: "linkedin_comments", count: 20 });
  assert(missing.missing_info.some((m) => /post url/i.test(m)));
  const ok = buildDeterministicPlan({ user_request: "x", actor_key: "apify_linkedin_post_comments", source_type: "linkedin_comments", count: 20, post_urls: ["https://linkedin.com/posts/abc"] });
  const schema = getActorInputSchema("apify_linkedin_post_comments")!;
  assert(validateActorInputAgainstSchema(ok.input, schema).ok, JSON.stringify(validateActorInputAgainstSchema(ok.input, schema).errors));
});

Deno.test("plan: count capped to actor max_safe_results", () => {
  const plan = buildDeterministicPlan({ user_request: "x", actor_key: "apify_people_search", source_type: "people_profiles", count: 999, normalized: { role: "Founder" } });
  assertEquals(plan.input.max_results, 25); // people_search cap
});

// ============ Validator ============

Deno.test("validator: unknown top-level field rejected, stripped by sanitize", () => {
  const schema = getActorInputSchema("apify_jobs")!;
  const bad = { query: "GTM", max_results: 5, evil: true } as Record<string, unknown>;
  assert(!validateActorInputAgainstSchema(bad, schema).ok);
  const clean = sanitizeActorInput(bad, schema);
  assertEquals(clean.evil, undefined);
  assert(validateActorInputAgainstSchema(clean, schema).ok);
});

Deno.test("validator: unknown user_input key rejected", () => {
  const schema = getActorInputSchema("apify_jobs")!;
  const bad = { query: "GTM", max_results: 5, user_input: { sendEmail: true } };
  const v = validateActorInputAgainstSchema(bad, schema);
  assert(!v.ok);
});

Deno.test("validator: forbidden outbound field rejected", () => {
  const schema = getActorInputSchema("apify_jobs")!;
  const v = validateActorInputAgainstSchema({ query: "GTM", max_results: 5, post: true } as Record<string, unknown>, schema);
  assert(!v.ok);
  assert(v.errors.some((e) => /forbidden|unknown/.test(e)));
});

Deno.test("validator: empty query rejected", () => {
  const schema = getActorInputSchema("apify_jobs")!;
  const v = validateActorInputAgainstSchema({ max_results: 5 } as Record<string, unknown>, schema);
  assert(!v.ok);
  assert(v.errors.some((e) => /empty query/.test(e)));
});

Deno.test("validator: raw paragraph query rejected", () => {
  const schema = getActorInputSchema("apify_jobs")!;
  const v = validateActorInputAgainstSchema({ query: "Find me five companies that are currently hiring go to market leaders in the b2b saas space across the united states please", max_results: 5 }, schema);
  assert(!v.ok);
  assert(v.errors.some((e) => /raw-paragraph/.test(e)));
});

Deno.test("validator: max_results capped by sanitize", () => {
  const schema = getActorInputSchema("apify_people_search")!;
  const clean = sanitizeActorInput({ query: "Founder", max_results: 999 }, schema);
  assertEquals(clean.max_results, 25);
});

Deno.test("validator: strict location preserved", () => {
  const ok = validateStrictConstraints({ location: "London", max_results: 5, query: "SDR" }, { strict: { location: true }, strict_location_value: "London" });
  assert(ok.ok);
  const bad = validateStrictConstraints({ location: "UK", max_results: 5, query: "SDR" }, { strict: { location: true }, strict_location_value: "London" });
  assert(!bad.ok);
});

// ============ Broadening ============

const SDR_CRIT: SourcingCriteria = { requested: 5, role: "SDR", industry: "B2B SaaS", location: "London", source_type: "hiring_signal" };

Deno.test("broaden: accepted 2/5 → broadens role aliases (attempt 2)", () => {
  const p = planBroadening({ accepted: 2, requested: 5, attempt: 2, criteria: SDR_CRIT, strict: STRICT_NONE });
  assert(p.next_attempt_allowed);
  assert(p.changed_fields.includes("role_keywords"));
});

Deno.test("broaden: goal met → no further attempt", () => {
  const p = planBroadening({ accepted: 5, requested: 5, attempt: 2, criteria: SDR_CRIT, strict: STRICT_NONE });
  assert(!p.next_attempt_allowed);
});

Deno.test("broaden: strict London never relaxes location", () => {
  const strict: StrictConstraints = { location: true, industry: false, stage: false, count_exact: true };
  for (let a = 2; a <= 5; a++) {
    const p = planBroadening({ accepted: 2, requested: 5, attempt: a, criteria: SDR_CRIT, strict });
    assert(!p.changed_fields.includes("location"), `attempt ${a} must not change location`);
    assert(p.preserved_strict_fields.includes("location"));
  }
});

Deno.test("broaden: non-strict USA can relax location at terminal attempt", () => {
  const crit: SourcingCriteria = { requested: 5, role: "GTM", location: "USA", source_type: "hiring_signal" };
  const p = planBroadening({ accepted: 2, requested: 5, attempt: 4, criteria: crit, strict: STRICT_NONE });
  assert(p.changed_fields.includes("location"));
});

Deno.test("broaden: strict constraints block → user_permission_required", () => {
  // strict everything, no industry/stage to broaden, terminal with no change.
  const strict: StrictConstraints = { location: true, industry: true, stage: true, count_exact: true };
  const crit: SourcingCriteria = { requested: 5, role: "SDR", location: "London", source_type: "hiring_signal" };
  const p = planBroadening({ accepted: 2, requested: 5, attempt: 4, criteria: crit, strict });
  assert(p.user_permission_required);
  assert(!p.next_attempt_allowed);
});

Deno.test("guardBroadenedTerms: drops strict location terms, keeps role aliases", () => {
  const strict: StrictConstraints = { location: true, industry: false, stage: false, count_exact: false };
  const g = guardBroadenedTerms({ role_keywords: ["SDR", "BDR"], location_terms: ["UK", "Europe"] }, strict, { role: "SDR", location: "London" });
  assertEquals(g.location_terms.length, 0);
  assert(g.dropped.some((d) => /location\(strict\)/.test(d)));
});

// ============ Source quality ============

Deno.test("quality: raw 10 accepted 0 → failed; Aria-skip implied", () => {
  const q = summarizeSourceQuality({ attempts: [{ result_count: 10, accepted_count: 0 }], accepted_count: 0, requested_count: 5 });
  assertEquals(q.status, "failed");
  assertEquals(q.raw_result_count, 10);
  assertEquals(q.accepted_count, 0);
  assertEquals(q.persisted_count, 0);
});

Deno.test("quality: raw 10 accepted 4 requested 5 → partial; persisted==accepted", () => {
  const q = summarizeSourceQuality({ attempts: [{ result_count: 6, accepted_count: 2 }, { result_count: 4, accepted_count: 2 }], accepted_count: 4, requested_count: 5 });
  assertEquals(q.status, "partial");
  assertEquals(q.raw_result_count, 10);
  assertEquals(q.persisted_count, q.accepted_count);
  assertEquals(q.rejected_count, 6);
});

Deno.test("quality: raw 8 accepted 5 requested 5 → complete", () => {
  const q = summarizeSourceQuality({ attempts: [{ result_count: 8, accepted_count: 5 }], accepted_count: 5, requested_count: 5 });
  assertEquals(q.status, "complete");
});

Deno.test("quality: classifyResults rejects junk, removes duplicates, records reasons", () => {
  const crit: SourcingCriteria = { requested: 5, role: "Sales", location: "London", source_type: "hiring_signal" };
  const strict: StrictConstraints = { location: true, industry: false, stage: false, count_exact: false };
  const items = [
    { name: "Acme", title: "Sales Manager", source_url: "a.com", location: "London" },
    { name: "", title: "x" },                                   // missing name
    { name: "Beta", title: "Chef", source_url: "b.com", location: "London" }, // wrong role
    { name: "Acme", title: "Sales Manager", source_url: "a.com", location: "London" }, // duplicate
    { name: "Gamma", title: "Sales", source_url: "g.com", location: "Paris" },  // wrong location strict
  ];
  const c = classifyResults(items, crit, strict);
  assertEquals(c.accepted.length, 1); // only Acme
  assertEquals(c.duplicates.length, 1);
  assert(c.reject_reason_counts["missing name/company"] >= 1);
  assert(c.reject_reason_counts["wrong role"] >= 1);
  // "London" is a city requirement; a "Paris" candidate is rejected with the
  // country-aware gate's distinct, more accurate reason.
  assert(c.reject_reason_counts["wrong city/region (strict)"] >= 1);
  assert(topRejectReasons(c.reject_reason_counts).length > 0);
});

// ============ Provider override + budget (Claude switch) ============
import { resolveSourcePlannerProvider } from "../../functions/_shared/providerRouting.ts";
import { planActorInput, _resetPlannerBudget } from "../../functions/_shared/actorInputPlanner.ts";

Deno.test("provider: SOURCE_PLANNER_PROVIDER=anthropic|claude → anthropic", () => {
  assertEquals(resolveSourcePlannerProvider("anthropic"), "anthropic");
  assertEquals(resolveSourcePlannerProvider("claude"), "anthropic");
  assertEquals(resolveSourcePlannerProvider("Claude"), "anthropic");
  assertEquals(resolveSourcePlannerProvider("gemini"), undefined);
  assertEquals(resolveSourcePlannerProvider(""), undefined);
  assertEquals(resolveSourcePlannerProvider(null), undefined);
});

Deno.test("planner: deterministic fallback works without any AI provider", async () => {
  _resetPlannerBudget();
  // No AI keys in deno test → generateJson returns no_provider → deterministic.
  const res = await planActorInput({ user_request: "Find 5 companies hiring GTM roles in B2B SaaS in USA", actor_key: "apify_jobs", source_type: "hiring_signal", count: 5, normalized: { role: "GTM", industry: "B2B SaaS", location: "USA" } });
  assertEquals(res.planner_mode, "deterministic_fallback");
  assertEquals(res.provider_used, "none");
  assert(res.validation.ok, "deterministic input must be valid");
  assertEquals(res.input.max_results, 5);
});

Deno.test("planner: unknown actor → deterministic, no AI call", async () => {
  _resetPlannerBudget();
  const res = await planActorInput({ user_request: "x", actor_key: "apify_unknown_actor", source_type: "hiring_signal", count: 5 });
  assertEquals(res.planner_mode, "deterministic_fallback");
  assertEquals(res.ai_calls, 0); // no schema → never attempts AI
});

Deno.test("planner: AI call budget capped at 3 per run", async () => {
  _resetPlannerBudget();
  for (let i = 0; i < 5; i++) {
    await planActorInput({ user_request: "Find 5 companies hiring GTM in USA", actor_key: "apify_jobs", source_type: "hiring_signal", count: 5, normalized: { role: "GTM" } });
  }
  const res = await planActorInput({ user_request: "Find 5 companies hiring GTM in USA", actor_key: "apify_jobs", source_type: "hiring_signal", count: 5, normalized: { role: "GTM" } });
  assert(res.ai_calls <= 3, `ai_calls must be capped at 3, got ${res.ai_calls}`);
});

// ============ Outcome report + next-action pills (Workbench UX) ============
import { buildOutcomeReport, acceptanceRate } from "../../functions/_shared/sourceQuality.ts";

Deno.test("outcome: complete copy + forward actions", () => {
  const r = buildOutcomeReport({ counts: { raw_result_count: 8, accepted_count: 5, rejected_count: 3, duplicate_count: 0, persisted_count: 5, requested_count: 5, reject_reason_counts: {}, status: "complete" }, requested: 5, has_contacts: false });
  assertEquals(r.status, "complete");
  assert(/Complete/.test(r.outcome_line));
  assert(r.next_actions.includes("find_contacts"));
  assert(!r.next_actions.includes("broaden_search"), "complete should not offer broaden");
});

Deno.test("outcome: partial copy + Broaden search action", () => {
  const r = buildOutcomeReport({ counts: { raw_result_count: 10, accepted_count: 4, rejected_count: 6, duplicate_count: 0, persisted_count: 4, requested_count: 5, reject_reason_counts: { "wrong role": 6 }, status: "partial" }, requested: 5 });
  assertEquals(r.status, "partial");
  assert(/Partial — Scout found 4 of 5/.test(r.outcome_line), r.outcome_line);
  assert(r.next_actions.includes("broaden_search"));
  assert(r.next_actions.includes("use_results"));
  assert(r.quality_lines.some((l) => /Main reject reason: wrong role/.test(l)));
});

Deno.test("outcome: failed copy + recovery actions", () => {
  const r = buildOutcomeReport({ counts: { raw_result_count: 10, accepted_count: 0, rejected_count: 10, duplicate_count: 0, persisted_count: 0, requested_count: 5, reject_reason_counts: { "wrong role": 10 }, status: "failed" }, requested: 5 });
  assertEquals(r.status, "failed");
  assert(/No qualified matches/.test(r.outcome_line));
  for (const a of ["broaden_search", "edit_criteria", "change_source", "view_details", "done"]) {
    assert(r.next_actions.includes(a), `failed should offer ${a}`);
  }
});

Deno.test("acceptanceRate: percent of raw accepted (0 when no raw)", () => {
  assertEquals(acceptanceRate({ raw_result_count: 10, accepted_count: 5 }), 50);
  assertEquals(acceptanceRate({ raw_result_count: 0, accepted_count: 0 }), 0);
});

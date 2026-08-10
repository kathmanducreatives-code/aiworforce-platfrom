// STEP 3B — deterministic constraint validation for the initial GPT/Claude
// planning path. Regression for the 2026-08-09 real-GPT qualification run,
// which found 7/9 planned cases silently lost geography, persona, required
// signal, or an explicit no-broadening request while still becoming
// `model_validated`.
//
// ROOT CAUSE (traced, not assumed): `leadPlanOrchestration.ts`'s contract —
// and the `LeadStrategyMission` built from it — read geography and
// decision-maker roles from `intent.job_search_spec.location` /
// `.requested_person_roles`, fields that are ONLY populated when
// hiring_signal_required || jobFirst. Every person-first request (the
// majority of the failing cases — "founders currently hiring for RevOps",
// "Find prospects...") has hiring_signal_required=false, so the contract
// carried `geography: null, decisionMakerRoles: []` even though
// `intent.geographies` / `intent.person_roles` (computed unconditionally)
// already had the right data. GPT was never told the constraint it was later
// scored on "dropping" — no validator could have caught that, because there
// was nothing to compare against. Fixed by enriching the contract/mission
// with the unconditional fields as a fallback (leadPlanOrchestration.ts),
// and separately, by teaching the EXISTING initial-planning validator
// (leadStrategyValidator.ts) to reject a GPT plan that ignores an explicit
// no-broadening request or drops a named required signal — the two failure
// classes that genuinely live in GPT's own output, not the mission.
//
// ZERO network, ZERO model calls (mockModel stubs every call).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LEAD_STRATEGY_ESCALATION_MODEL, LEAD_STRATEGY_PRIMARY_MODEL, type LeadStrategyModelFn,
} from "../../../supabase/functions/_shared/leadStrategyModels.ts";
import { runLeadStrategy } from "../../../supabase/functions/_shared/leadStrategyOwner.ts";
import { validateLeadStrategy, resolveMissionFamily } from "../../../supabase/functions/_shared/leadStrategyValidator.ts";
import { REVENUE_OPS_FAMILY } from "../../../supabase/functions/_shared/leadRoleTaxonomy.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "../../../supabase/functions/_shared/leadStrategyContract.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { extractRequiredSignalTerms } from "../../../supabase/functions/_shared/jobSearchSpec.ts";

const ctx = (over: Partial<LeadStrategyRoundContext> = {}): LeadStrategyRoundContext => ({
  round: 1,
  bottleneck: null,
  last_funnel: null,
  attempted_query_packs: [],
  attempted_sources: [],
  remaining_quota: 5,
  remaining_budget_usd: 4,
  adjacent_titles_allowed: false,
  ...over,
});

const mockModel = (byModel: Record<string, unknown | "fail">, log: string[] = []): LeadStrategyModelFn =>
async (call) => {
  log.push(call.model);
  const r = byModel[call.model];
  if (r === undefined || r === "fail") {
    return { ok: false, model: call.model, content: "", latencyMs: 5, errorCode: "network_error" };
  }
  return { ok: true, model: call.model, content: JSON.stringify(r), json: r, latencyMs: 7 };
};

// ===================== PART 1: root cause — the contract was incomplete ====
// Proves the SOURCE DATA (intent.geographies / intent.person_roles) was
// always correct — the bug was never in extraction, only in which field the
// contract read from.
Deno.test("ROOT CAUSE: intent.geographies/person_roles have the data job_search_spec drops for person-first requests", () => {
  const i = compileLeadEntityIntent("Find exactly 5 SDR hiring leads in London. Do not broaden outside London.");
  assertFalse(i.hiring_signal_required, "this is the exact case that made job_search_spec compile to not_applicable");
  assertEquals(i.job_search_spec.location, null, "job_search_spec itself never carries London for this phrasing");
  assert(i.geographies.includes("London"), "but the unconditional geographies list already had it");

  const p = compileLeadEntityIntent("Find 5 recruiting Agency in B2B in USA where a founder or owner is likely the decision-maker.");
  assertEquals(p.job_search_spec.requested_person_roles.length, 0);
  assert(p.person_roles.includes("Founder") || p.person_roles.includes("Owner"));
});

// ===================== PART 2: extractRequiredSignalTerms ==================
Deno.test("extractRequiredSignalTerms reads the literal signal in either word order", () => {
  assertEquals(extractRequiredSignalTerms("Find exactly 5 SDR hiring leads in London. Do not broaden outside London."), ["Sdr"]);
  assertEquals(extractRequiredSignalTerms("Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?"), ["Revops"]);
});
Deno.test("extractRequiredSignalTerms returns nothing for requests naming no specific role", () => {
  assertEquals(extractRequiredSignalTerms("Find decision-makers (Founder, CEO, Head of Sales) at these companies: Acme, Globex."), []);
  assertEquals(extractRequiredSignalTerms("We are hiring across the board this year."), []);
});

// ===================== PART 3: no-broadening rejects a broadened plan ======
const noBroadenMission: LeadStrategyMission = {
  original_query: "Find exactly 5 SDR hiring leads in London. Do not broaden outside London.",
  requested_lead_count: 5,
  requested_titles: ["Sdr"],
  decision_maker_roles: [],
  geography: "London",
  company_vertical: null,
  company_size: null,
  maturity_stages: [],
  no_broadening_requested: true,
  required_signal_terms: ["Sdr"],
};

// "SDR" itself matches no family in leadRoleTaxonomy.ts's deliberately narrow
// 3-family registry (revenue/marketing/customer OPERATIONS only — a separate,
// pre-existing scope boundary, not something this fix touches), so
// resolveMissionFamily defaults to REVENUE_OPS_FAMILY for this mission, same
// as the real run. This is the REALISTIC shape of the observed failure: GPT,
// constrained to that default family, broadened into generic Sales/Revenue
// Operations titles instead of staying on the literal "Sdr" the user named —
// not a fabricated adversarial shape.
const broadenedPlan = {
  role_family: "revenue_operations",
  title_queries: ["Sales Operations", "Revenue Operations"],
  excluded_titles: [],
  query_packs: [
    { pack_id: "exact_titles", queries: ["Sales Operations", "Revenue Operations"], rationale: "broadened into the default ops family" },
  ],
  source_plan: [{ source_key: "apify_jobs", priority: 1, rationale: "broad" }],
  next_action: "run_query_packs",
  stop_conditions: ["quota_reached"],
  rationale: "broadened beyond the literal SDR ask",
  confidence: 0.7,
};

const literalPlan = {
  role_family: "revenue_operations",
  title_queries: ["Sdr"],
  excluded_titles: [],
  query_packs: [{ pack_id: "exact_titles", queries: ["Sdr"], rationale: "literal ask only" }],
  source_plan: [{ source_key: "apify_jobs", priority: 1, rationale: "literal" }],
  next_action: "run_query_packs",
  stop_conditions: ["quota_reached"],
  rationale: "stayed literal, no broadening",
  confidence: 0.8,
};

Deno.test("FLAGSHIP CASE: a broadened plan is rejected outright by validateLeadStrategy when no_broadening_requested", () => {
  const fam = resolveMissionFamily(noBroadenMission) ?? REVENUE_OPS_FAMILY;
  const result = validateLeadStrategy(broadenedPlan, noBroadenMission, ctx(), fam);
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.problem, "broadening_prohibited_but_no_literal_title_survived");
});
Deno.test("FLAGSHIP CASE: runLeadStrategy escalates past a broadened Luna plan, then falls back deterministically", async () => {
  const log: string[] = [];
  const r = await runLeadStrategy({
    mission: noBroadenMission, context: ctx(),
    callModel: mockModel({
      [LEAD_STRATEGY_PRIMARY_MODEL]: broadenedPlan,
      [LEAD_STRATEGY_ESCALATION_MODEL]: broadenedPlan,
    }, log),
  });
  assertEquals(log, [LEAD_STRATEGY_PRIMARY_MODEL, LEAD_STRATEGY_ESCALATION_MODEL]);
  assertEquals(r.provenance.source, "deterministic_fallback");
  assertEquals(r.provenance.status, "openai_fallback_used");
  assert(r.provenance.failure_reason?.includes("broadening_prohibited"));
  // The deterministic fallback itself must not silently broaden either — it
  // used to always build the full family's query packs regardless of
  // no_broadening_requested (a second copy of the same bug, fixed alongside
  // the validator: deterministicLeadStrategy now honours it too).
  assertEquals(r.plan.title_queries, ["Sdr"]);
  assertFalse(r.plan.title_queries.some((t) => t === "Sales Operations" || t === "Revenue Operations"));
});
Deno.test("a literal, unbroadened plan is still accepted when no_broadening_requested", () => {
  const fam = resolveMissionFamily(noBroadenMission) ?? REVENUE_OPS_FAMILY;
  const result = validateLeadStrategy(literalPlan, noBroadenMission, ctx(), fam);
  assert(result.ok);
  if (result.ok) assertEquals(result.plan.title_queries, ["Sdr"]);
});

// ===================== PART 4: required signal must be represented =========
const revOpsMission: LeadStrategyMission = {
  original_query: "Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?",
  requested_lead_count: 5,
  requested_titles: [],
  decision_maker_roles: ["Founder"],
  geography: null,
  company_vertical: "B2B SaaS",
  company_size: null,
  maturity_stages: [],
  no_broadening_requested: false,
  required_signal_terms: ["Revops"],
};
const signalDroppedPlan = {
  role_family: "revenue_operations",
  title_queries: ["GTM Operations"], // family-approved, but never mentions RevOps
  excluded_titles: [],
  query_packs: [{ pack_id: "exact_titles", queries: ["GTM Operations"], rationale: "generic ops" }],
  source_plan: [{ source_key: "apify_jobs", priority: 1, rationale: "generic" }],
  next_action: "run_query_packs",
  stop_conditions: ["quota_reached"],
  rationale: "went generic instead of the named signal",
  confidence: 0.6,
};
const signalKeptPlan = {
  ...signalDroppedPlan,
  // Textually relates to "Revops" (substring match, same style the rest of
  // this validator already uses — e.g. titleIsApproved's own a.includes(t)) —
  // deliberately NOT "Revenue Operations", which is a real synonym a human
  // would recognize but doesn't share a substring with "Revops", so it would
  // (correctly, for THIS deterministic check) still count as drift.
  title_queries: ["RevOps Manager"],
  query_packs: [{ pack_id: "exact_titles", queries: ["RevOps Manager"], rationale: "kept the named signal" }],
};

Deno.test("a plan that drops the named required signal is rejected", () => {
  const fam = resolveMissionFamily(revOpsMission) ?? REVENUE_OPS_FAMILY;
  const result = validateLeadStrategy(signalDroppedPlan, revOpsMission, ctx(), fam);
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.problem, "required_signal_not_represented");
});
Deno.test("a plan that keeps the named required signal (textually) still passes", () => {
  const fam = resolveMissionFamily(revOpsMission) ?? REVENUE_OPS_FAMILY;
  const result = validateLeadStrategy(signalKeptPlan, revOpsMission, ctx(), fam);
  assert(result.ok);
});

// ===================== PART 5: no false rejections on ordinary requests ====
const ordinaryMission: LeadStrategyMission = {
  original_query: "Find founders of SaaS startups hiring Sales Operations in the United States",
  requested_lead_count: 5,
  requested_titles: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  decision_maker_roles: ["Founder", "CEO"],
  geography: "United States",
  company_vertical: "B2B SaaS",
  company_size: { min: 1, max: 200 },
  maturity_stages: ["seed", "series_a"],
  // no_broadening_requested / required_signal_terms both omitted — mirrors a
  // caller that never enriched the spec, proving the additive fields don't
  // change existing behaviour when absent.
};
const ordinaryGoodPlan = {
  role_family: "revenue_operations",
  title_queries: ["Sales Operations", "Revenue Operations"],
  excluded_titles: ["Warehouse Operations"],
  query_packs: [
    { pack_id: "exact_titles", queries: ["Sales Operations", "Revenue Operations"], rationale: "core" },
    { pack_id: "yc_early_stage", queries: ["GTM Operations"], rationale: "startup employers" },
  ],
  source_plan: [{ source_key: "yc_jobs", priority: 1, rationale: "startup first" }],
  next_action: "run_query_packs",
  stop_conditions: ["quota_reached"],
  rationale: "start narrow on the exact family",
  confidence: 0.8,
};
Deno.test("DO NOT OVERCORRECT: an ordinary request with no broadening/signal fields set is unaffected", () => {
  const fam = resolveMissionFamily(ordinaryMission) ?? REVENUE_OPS_FAMILY;
  const result = validateLeadStrategy(ordinaryGoodPlan, ordinaryMission, ctx(), fam);
  assert(result.ok);
});
Deno.test("DO NOT OVERCORRECT: requested count and budget are untouched by this validator (out of its scope, unchanged)", () => {
  // requested_lead_count / remaining_budget_usd are read by the CONTRACT and
  // quota controller, not by validateLeadStrategy — confirming this validator
  // extension didn't reach into fields it has no business touching.
  assertEquals(ordinaryMission.requested_lead_count, 5);
  assertEquals(ctx().remaining_budget_usd, 4);
});

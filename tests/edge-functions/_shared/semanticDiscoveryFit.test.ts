// A NAME MATCHER MAY NOT DISCOVER A CONCEPT.
//
// ── THE RUN THIS ENCODES ────────────────────────────────────────────────────
//
// 2026-08-17, task e01dbd5b. Mission: "Find 2 qualified AI startups in the
// United States that are currently hiring software engineers." Everything
// upstream worked for the first time — `gpt_validated`, verticals
// `["AI","startup"]` from `gpt_inference`, Company Brain no longer overriding,
// GPT selecting the actor and writing its JSON, no YC fallback.
//
// GPT chose `apify_linkedin_company_search`, whose own catalog card says:
//
//     not_for: ["ICP qualification", "semantic/concept search", …]
//
// It is a company-NAME matcher. Asked to discover a concept, it returned 20
// LinkedIn pages whose NAMES contain the words:
//
//     AI Central | ChatGPT & Generative AI Tutorials …   (a newsletter)
//     Startup San Diego, StartUp Vegas,
//     Startup Champions Network                          (communities)
//     AWS AI, NVIDIA AI                                  (big-co sub-pages)
//     Leena AI, Saxon AI                                 (2 real companies)
//
// 6 enriched, 0 evaluated, 0 qualified. Read as a budget problem for a while;
// it was never a budget. The pool contained almost no companies.
//
// `not_for` was in the catalog and in the planner prompt the whole time. Nobody
// checked it. This file is that check.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateDiscoveryStrategy, strategyActorKeys,
  missionNeedsSemanticDiscovery, declaresUnfitForSemantic, conceptTermsOf,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const base = {
  version: "lead_mission_v1",
  requested_count: 2,
  required_signals: [], decision_makers: { roles: [], current_employment_required: true },
  hard_constraints: {}, soft_preferences: {},
  required_capabilities: [], prohibited_capabilities: [],
  field_provenance: {}, confidence: 0.9,
};

/** The exact mission the live run compiled. */
const AI_STARTUPS = {
  ...base,
  original_user_query:
    "Find 2 qualified AI startups in the United States that are currently hiring software engineers.",
  company_profile: {
    business_models: [], verticals: ["AI", "startup"], stages: ["startup"],
    locations: ["United States"], employee_range: { min: null, max: null },
  },
  known_companies: [],
} as unknown as LeadMissionV1;

/** A mission that NAMES its companies — the case a name matcher is right for. */
const NAMED = {
  ...base,
  original_user_query: "Find hiring contacts at Anthropic and Figma.",
  company_profile: {
    business_models: [], verticals: [], stages: [],
    locations: ["United States"], employee_range: { min: null, max: null },
  },
  known_companies: ["Anthropic", "Figma"],
} as unknown as LeadMissionV1;

const NAME_MATCHER = "apify_linkedin_company_search";

Deno.test("1. the catalog already declares the actor unfit for concept search", () => {
  // The premise. If this ever changes the rule below should be revisited, not
  // silently weakened — so it is asserted rather than assumed.
  const card = hiringActorCard(NAME_MATCHER)!;
  assert(
    card.not_for.some((n) => /semantic|concept/i.test(n)),
    `${NAME_MATCHER}.not_for must still declare it unfit for concept search`,
  );
  assert(declaresUnfitForSemantic(card));
});

Deno.test("2. 'AI startups' is a concept cohort, 'Anthropic and Figma' is not", () => {
  assert(missionNeedsSemanticDiscovery(AI_STARTUPS), "a cohort must need semantic discovery");
  assertEquals(conceptTermsOf(AI_STARTUPS).includes("AI"), true);
  assertEquals(
    missionNeedsSemanticDiscovery(NAMED), false,
    "a mission that NAMES its companies is a lookup, not a concept search",
  );
});

Deno.test("3. THE REGRESSION: a name matcher cannot discover 'AI startups'", () => {
  const s = validateDiscoveryStrategy([{
    actor_key: NAME_MATCHER, role: "primary",
    input: { searchQuery: "AI startup" },
    rationale: "memo23 cannot express AI, so use LinkedIn company search",
  }], AI_STARTUPS);

  assertEquals(
    strategyActorKeys(s).includes(NAME_MATCHER), false,
    "the actor that produced `AI Central` and `Startup San Diego` must be refused",
  );
  assert(s.violations.some((v) => v.code === "actor_not_for_semantic_discovery"));
  // Nothing else survives, so the run BLOCKS rather than sourcing junk.
  assertEquals(s.source, "blocked");
});

Deno.test("4. the refusal explains itself in terms of the mission", () => {
  const v = validateDiscoveryStrategy([{
    actor_key: NAME_MATCHER, role: "primary", input: { searchQuery: "AI" },
  }], AI_STARTUPS).violations.find((x) => x.code === "actor_not_for_semantic_discovery")!;

  assert(v.message.includes("semantic/concept search"), "it must quote the actor's own claim");
  assert(v.message.includes("AI"), "and name the concept the mission asked for");
});

Deno.test("5. the SAME actor is still allowed where it is the right tool", () => {
  // The rule must not become "this actor is banned". Resolving named companies
  // is exactly what it is `best_for`, and that path is untouched.
  const s = validateDiscoveryStrategy([{
    actor_key: NAME_MATCHER, role: "primary",
    input: { searchQuery: "Anthropic" },
    rationale: "the request names its companies",
  }], NAMED);

  assertEquals(s.source === "blocked", false, "a named-company mission must not block");
  assert(strategyActorKeys(s).includes(NAME_MATCHER));
});

Deno.test("6. blocking is preferred to a junk pool", () => {
  // THE ARCHITECTURAL CLAIM, stated as a test. For "AI startups" the registry
  // currently has no concept-capable discovery source — memo23's `industries`
  // enum has no "AI" value, and the name matcher is unfit. The honest outcome
  // is a blocked run naming that gap, not 20 rows and 7 spent cost units.
  const s = validateDiscoveryStrategy([
    { actor_key: NAME_MATCHER, role: "primary", input: { searchQuery: "AI startup" } },
    { actor_key: NAME_MATCHER, role: "breadth", input: { searchQuery: "artificial intelligence" } },
  ], AI_STARTUPS);

  assertEquals(s.source, "blocked");
  assertEquals(s.selections, []);
  assert(
    s.violations.some((v) => v.code === "actor_not_for_semantic_discovery"),
    "and the block must name the capability gap, not a generic failure",
  );
});

// "US companies" means US-HEADQUARTERED unless the request itself speaks of presence.
//
// TEST smoke on ea30436 ("Find 5 US B2B companies actively hiring salespeople …"): the
// model proposed geography_scope "presence", and the proposal's scope always won, so
// the hard requirement became US *presence* (geography_person) — the reading under
// which a Canadian-HQ company with a US office qualifies. The model's "presence" is now
// kept only when the user's words speak of offices / presence / operations in a place.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { requirementsFromMission } from "../../../supabase/functions/_shared/discoveryProviders/requirements.ts";

const BLANK = {
  requested_opportunity_count: null, requested_contact_ready_count: null, company_types: [], geographies: [], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: null, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: null, strategies: [],
};
const hardGeo = (query: string, geography_scope: string | null) => {
  const m = compileLeadMission({
    originalUserQuery: query, requestedCount: 5,
    proposal: {
      ...BLANK, geographies: ["United States"], ...(geography_scope ? { geography_scope } : {}),
      hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
      preferred_signals: ["hiring"], signal_recency_days: 30, strategies: ["hiring"], output_intent: "companies", required_signal_terms: ["salespeople"],
    },
  }).final_mission;
  return requirementsFromMission(m as never).hard.filter((h) => h.key.startsWith("geography")).map((h) => h.key);
};

const SMOKE = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range.";

Deno.test("the model's 'presence' for a bare 'US companies' compiles as US headquarters (TEST smoke on ea30436)", () => {
  assertEquals(hardGeo(SMOKE, "presence"), ["geography_hq"]);
  assertEquals(hardGeo("Find 3 US companies actively hiring Account Executives.", "presence"), ["geography_hq"]);
});

Deno.test("presence stays presence when the request itself speaks of it", () => {
  for (const q of [
    "Find 5 companies with offices in the United States that are hiring salespeople.",
    "Find companies with operations in the United States hiring salespeople.",
    "Find companies with a presence in the United States hiring salespeople.",
  ]) {
    assertEquals(hardGeo(q, "presence"), ["geography_person"], q);
    assertEquals(hardGeo(q, null), ["geography_person"], `${q} (no model scope: the words decide)`);
  }
});

Deno.test("headquarters is always kept, and the words decide when the model gives no scope", () => {
  assertEquals(hardGeo(SMOKE, "headquarters"), ["geography_hq"]);
  assertEquals(hardGeo("Find companies with offices in the United States hiring salespeople.", "headquarters"), ["geography_hq"], "the stricter reading is never loosened");
  assertEquals(hardGeo(SMOKE, null), ["geography_hq"]);
});

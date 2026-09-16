// LEAD V2 P1 — THE CONFIRMATION CARD SHOWS WHAT THE MISSION MEANS.
//
// Both ends of the seam at once: the backend builder that derives the sections
// from the compiled mission, and the frontend reader the card renders from.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMissionConfirmation } from "../../supabase/functions/_shared/missionConfirmationCard.ts";
import { compileLeadMission } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  CRITERIA_SECTION_LABELS, criteriaSectionsOf,
} from "../../src/lib/leadMission/missionView.ts";

const PREVIEW = {
  version: "mission-preview-v1", summary: "", steps: [], estimated_cost_units: 7, spends: true,
  feasible: true, gaps: [{ code: "stage0_gap:gap", detail: "stage:seed (unsupported)" }], narration: "",
} as never;

function card(query: string, over: Record<string, unknown>) {
  const { final_mission } = compileLeadMission({
    originalUserQuery: query,
    proposal: {
      requested_opportunity_count: 1, requested_contact_ready_count: null, company_types: [], geographies: [],
      employee_range: { min: null, max: null }, decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
      preferred_signals: [], adjacent_signals: [], excluded_signals: [],
      allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
      disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
      evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [], ...over,
    },
  });
  return buildMissionConfirmation(final_mission, PREVIEW, query);
}

Deno.test("the card labels the six P1 sections in order", () => {
  assertEquals(CRITERIA_SECTION_LABELS.map(([, l]) => l), [
    "Hard constraints", "Target criteria", "Opportunity signals",
    "Hypotheses / assumptions", "Time windows", "Unsupported / unprovable",
  ]);
});

Deno.test("an ONLY seed-stage hiring request shows hard, signal, window and unprovable", () => {
  const c = card("Find ONLY seed-stage B2B SaaS startups in the US hiring their first growth marketer.", {
    company_types: ["B2B SaaS"], geographies: ["United States"], preferred_signals: ["hiring growth marketer"],
  });
  const s = criteriaSectionsOf(c)!;
  assert(s, "sections present on the payload");
  assert(s.hard.some((l) => l.startsWith("Geography: United States")));
  assert(s.hard.some((l) => l.includes("seed")));
  assert(s.opportunity_signals.some((l) => l.startsWith("Hiring")));
  assert(s.time_windows.some((l) => l.startsWith("Hiring: last 30 days")));
  assert(s.unsupported.some((l) => l.includes("seed")));
  assert(s.unsupported.includes("stage:seed (unsupported)"), "Stage 0's own gaps are folded in");
});

Deno.test("a hypothesis request shows the thesis under hypotheses, not as a signal", () => {
  const s = criteriaSectionsOf(card("Find B2B SaaS startups likely to need a growth marketer soon.", {
    company_types: ["B2B SaaS"], preferred_signals: ["hiring growth marketer"],
  }))!;
  assertEquals(s.hypotheses.length, 1);
  assert(s.opportunity_signals.every((l) => l.includes("(proxy)")), s.opportunity_signals.join(" | "));
});

Deno.test("a payload without sections renders nothing extra (pre-P1 conversations)", () => {
  assertEquals(criteriaSectionsOf({}), null);
  assertEquals(criteriaSectionsOf({ criteria_sections: { hard: [], target: [] } }), null);
});

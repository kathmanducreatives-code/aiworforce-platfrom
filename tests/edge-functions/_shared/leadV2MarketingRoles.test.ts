// LEAD V2 RUN 4250f181 — "FIRST GROWTH MARKETER" AND THE TITLES STARTUPS USE.
//
// The audited mission carried `required_signal_terms: ["growth marketer"]` and
// `role_families: ["marketing_growth"]`. Prequalification then labelled Lab0's
// "Founding Product Marketer (AI-native)" as insufficient_commercial and
// SafetyKit's "Growth Lead" as technical_only: the family's aliases named the
// disciplines ("Product Marketing") and not the people who do them ("Product
// Marketer"), and titles are matched by substring.
//
// Pinned here with the exact audited titles, and the other direction too: the
// fix widens marketing/growth only — engineering and SDR/AE titles stay out.
//
// PURE.

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { classifyTitle } from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";
import { classifyJobTitle } from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";
import { roleMatchesFamily } from "../../../supabase/functions/_shared/roleFamilies.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

/** The role fields of the audited mission, as persisted on the task. */
const AUDITED_MISSION = {
  original_user_query:
    "Find 3 seed-stage B2B SaaS startups in the US hiring their first growth marketer.",
  target_entity: "company",
  required_signal_terms: ["growth marketer"],
  required_signals: [{ type: "hiring", event: "hiring", subject: "company", role_families: ["marketing_growth"] }],
  company_profile: { stages: ["startup"], employee_range: { min: null, max: null } },
  hard_constraints: { stage: { value: "seed-stage" } },
} as unknown as LeadMissionV1;

const vocab = () => buildQualificationContext(AUDITED_MISSION).role_vocabulary;

Deno.test("the audited mission qualifies against its own marketing vocabulary", () => {
  assertEquals(vocab().source, "mission");
});

for (const title of [
  "Founding Product Marketer (AI-native)", // Lab0
  "Growth Lead",                           // SafetyKit
  "Head of Growth Marketing",
  "Founding Growth Marketer",
  "Head of Growth",
  "Founding Marketer",
]) {
  Deno.test(`"${title}" is a tier-A signal for a growth-marketer mission`, () => {
    assertEquals(classifyTitle(title, vocab()), "A");
    // The prequalification pass reads the same classifier with the same vocabulary.
    assertEquals(classifyJobTitle(title, vocab()), "A");
    assertEquals(roleMatchesFamily(title, "marketing_growth"), true);
  });
}

for (const title of [
  "Senior Software Engineer",
  "Founding Engineer",
  "Growth Engineer",
  "Sales Development Representative",
  "SDR",
  "Founding Account Executive",
  "Customer Success Manager",
]) {
  Deno.test(`"${title}" is NOT a growth-marketer signal — no broad relaxation`, () => {
    assertNotEquals(classifyTitle(title, vocab()), "A");
    assertNotEquals(classifyJobTitle(title, vocab()), "A");
  });
}

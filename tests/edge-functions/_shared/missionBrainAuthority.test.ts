// WHO WINS WHEN THE MISSION AND THE WORKSPACE DISAGREE.
//
// The codebase held two answers at once, and they disagreed on the case that
// mattered:
//
//   `companyBrainEffectivePolicy`  "a mission may narrow a hard Brain
//                                   constraint, never widen it"    → INTERSECTION
//   `missionQualificationContext`  "the Brain is supplementary: hard ONLY
//                                   where the Mission is silent"   → SUPPLEMENT
//
// For "AI startups in the United States hiring software engineers" — a Mission
// that states no employee range — the first keeps the workspace's 10-150
// ceiling hard and discards a 220-person AI startup that satisfies every stated
// requirement. The second keeps it and ranks it lower. Both ran in TEST run
// d787cfc7, in different stages of the same pipeline.
//
// These tests pin the resolution, and its SCOPE: `resolveBrainAuthority`
// governs qualification. `companyBrainEffectivePolicy` is untouched and keeps
// its own semantics for Scout Radar, Content and Outreach.
//
// ZERO network, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationContext, resolveBrainAuthority, brainMayReject,
  BRAIN_AUTHORITY_VERSION,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";

const QUERY = "Find 10 AI startups in the United States that are hiring software engineers";

function mission(profile: Record<string, unknown> = {}): LeadMissionV1 {
  return {
    ...parseLeadMissionDeterministic(QUERY),
    original_user_query: QUERY,
    target_entity: "company",
    strategies: ["hiring"],
    company_profile: {
      verticals: ["AI startups"], stages: ["startup"],
      locations: ["united states"], business_models: [],
      ...profile,
    },
    required_signals: [{ type: "hiring software engineers" }],
    required_signal_terms: ["hiring software engineers"],
    hard_constraints: { geography: { value: "United States", operator: "equals" } },
    soft_preferences: {},
  } as unknown as LeadMissionV1;
}

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
  excluded_industries: ["Manufacturing", "Government", "Hospital"],
  disqualifier_keywords: ["plant operations", "warehouse operations"],
  business_models: ["SaaS"],
  buyer_roles: ["Founder", "CEO"],
  target_signals: ["hiring RevOps", "founder-led sales"],
  required_geography: "United States",
};

const authorityFor = (m: LeadMissionV1, brain = BRAIN) =>
  resolveBrainAuthority(buildQualificationContext(m), brain);

// ═══════════════════════════════════════════ tier 3: preferences ══

Deno.test("1. THE LOCKED DECISION: employee range is a preference, never a gate", () => {
  const a = authorityFor(mission());

  // It is present — it must still be able to rank.
  assertEquals(a.preferences.employee_range, { min: 10, max: 150 });
  // And it is nowhere in the rejecting set.
  assertFalse(
    JSON.stringify(a.rejecting).includes("employee"),
    "no employee bound may appear among the constraints that reject");
});

Deno.test("2. AfterQuery survives: 220 employees against a preferred 150", () => {
  const a = authorityFor(mission());
  const { min, max } = a.preferences.employee_range;

  assert(max !== null && 220 > max, "the fixture must actually exceed the preference");
  // The ONLY thing that may consult it is ranking. Nothing in `rejecting`
  // mentions size, so no gate can read it.
  assertEquals(Object.keys(a.rejecting).sort(),
    ["disqualifier_keywords", "excluded_industries", "required_geography"]);
  assertEquals(min, 10, "and the preference itself is preserved for scoring");
});

Deno.test("3. positive industries rank; they never reject", () => {
  const a = authorityFor(mission());
  assertEquals([...a.preferences.target_industries],
    ["B2B SaaS", "AI SaaS", "Recruiting Agencies"]);
  assertFalse(JSON.stringify(a.rejecting).includes("B2B SaaS"),
    "an ICP wording match may not be a gate — LinkedIn has no such label");
});

// ═══════════════════════════════════════════ tier 2: brain hard ══

Deno.test("4. excluded industries stay HARD, even though the Mission named a vertical", () => {
  const a = authorityFor(mission());
  assertEquals([...a.rejecting.excluded_industries],
    ["Manufacturing", "Government", "Hospital"]);
  assertEquals([...a.rejecting.disqualifier_keywords],
    ["plant operations", "warehouse operations"]);
  // A Mission naming "AI startups" is not a Mission authorising Manufacturing.
  assert(a.mission_owned.includes("industry"),
    "the Mission does own the industry axis");
});

Deno.test("5. a Brain hard constraint applies where the Mission is silent", () => {
  // No locations, so the Mission does not own geography.
  const m = mission({ locations: [] });
  const withoutHardGeo = { ...m, geography_is_hard: false } as LeadMissionV1;
  const a = authorityFor(withoutHardGeo);

  assertEquals(a.rejecting.required_geography, "United States",
    "the workspace default governs an axis the user never mentioned");
  assertFalse(a.mission_owned.includes("geography"));
  // No GEOGRAPHY conflict — nothing was overridden on that axis. The Mission
  // still names verticals, so an industry conflict is correctly recorded, and
  // asserting `conflicts.length === 0` would be asserting the wrong thing.
  assertFalse(a.conflicts.some((c) => c.axis === "geography_value"),
    "an axis the Mission never mentioned cannot have been overridden");
});

// ═══════════════════════════════════════════ tier 4: conflicts ══

Deno.test("6. the Mission wins on geography, and the override is RECORDED", () => {
  const a = authorityFor(mission());

  assertEquals(a.rejecting.required_geography, null,
    "the workspace default may not narrow a geography the Mission stated");
  const c = a.conflicts.find((x) => x.axis === "geography_value");
  assert(c, "the override must be recorded, never silent");
  assertEquals(c!.resolved_to, "mission");
  assertEquals(c!.brain_value, "United States");
});

Deno.test("7. an explicit Mission employee range overrides the Brain's, and records it", () => {
  const m = mission({ employee_range: { min: 200, max: 500 } });
  const a = authorityFor(m);

  const c = a.conflicts.find((x) => x.axis === "employee_count");
  assert(c, "two stated ranges must produce a recorded conflict");
  assertEquals(c!.resolved_to, "mission");
  assertEquals(c!.mission_value, { min: 200, max: 500 });
  assertEquals(c!.brain_value, { min: 10, max: 150 });
});

Deno.test("8. a Mission vertical overrides workspace industries, and records it", () => {
  const a = authorityFor(mission());
  const c = a.conflicts.find((x) => x.axis === "industry");
  assert(c, "the Mission naming verticals must record the override");
  assertEquals(c!.resolved_to, "mission");
  assertEquals(c!.mission_value, ["ai startups"]);
});

// ═══════════════════════════════════════════ totality & shape ══

Deno.test("9. brainMayReject agrees with the resolved authority", () => {
  const ctx = buildQualificationContext(mission());
  // The Mission decided these, so the Brain may not reject on them.
  assertFalse(brainMayReject(ctx, "industry"));
  assertFalse(brainMayReject(ctx, "geography"));
  assertFalse(brainMayReject(ctx, "stage"));
  assertFalse(brainMayReject(ctx, "hiring_role"));
  // It said nothing about size — but size is a preference regardless.
  assert(brainMayReject(ctx, "employee_count"));
});

Deno.test("10. an absent Brain yields an authority that rejects nothing", () => {
  const a = authorityFor(mission(), null as never);
  assertEquals(a.rejecting.excluded_industries.length, 0);
  assertEquals(a.rejecting.disqualifier_keywords.length, 0);
  assertEquals(a.rejecting.required_geography, null);
  assertEquals(a.preferences.employee_range, { min: null, max: null });
  assertEquals(a.version, BRAIN_AUTHORITY_VERSION);
});

Deno.test("11. every conflict resolves to the Mission — there is no other value", () => {
  for (const m of [mission(), mission({ employee_range: { min: 1, max: 5 } }), mission({ locations: [] })]) {
    for (const c of authorityFor(m).conflicts) {
      assertEquals(c.resolved_to, "mission",
        `${c.axis}: the Mission is the task being executed`);
      assert(c.reason.length > 0, `${c.axis}: an override must explain itself`);
    }
  }
});

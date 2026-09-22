// THE ROUND THE USER REQUIRED, AND WHO OWNS THE RUNG.
//
// "Find 1 US B2B SaaS company that recently raised Seed funding" compiled with
// the Seed rung missing as a requirement. Two independent reasons:
//
//   B. `push` in `deriveMissionCriteria` is FIRST-WINS on `dimension:value`,
//      and the Company Brain's ICP rungs are pushed BEFORE the stated one. A
//      Brain whose ICP also lists Seed therefore decided the criterion — as a
//      `target`, which ranks and never rejects — and the user's hard rung was
//      discarded silently.
//
//   C. The rung never became an intent at all. `readStageIntent` deliberately
//      skips a stage word next to "raised"/"closed" (an EVENT, not a company
//      kind), and the event's `round_type` qualifier is dropped by the
//      canonical signal reader and by `PROJECTABLE_QUALIFIER_FIELDS`. The card
//      said so — `unrepresented:qualifier:round_type` — and nothing downstream
//      could require the rung.
//
// Only HARD unknown claims become evidence gaps, so together these meant the
// funding verifier was never selected for any real Pilot mission.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveMissionCriteria, readFundedStageIntent, readStageIntent,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const QUERY = "Find 1 US B2B SaaS company with 11-50 employees that recently raised Seed funding and is currently hiring a growth role.";

/** A compiled mission, optionally given the Company Brain's own ICP rungs. */
function mission(brainStages: string[] = [], query = QUERY): LeadMissionV1 {
  const m = compileLeadMission({
    originalUserQuery: query,
    proposal: {
      requested_opportunity_count: 1, requested_contact_ready_count: null,
      company_types: ["B2B SaaS"], geographies: ["United States"],
      employee_range: { min: 11, max: 50 },
      decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
      preferred_signals: ["funding", "hiring"], adjacent_signals: [], excluded_signals: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      disallowed_broadening: [], required_evidence: [], required_capabilities: [],
      preferred_source_strategy: [], evaluation_instructions: "",
      founder_unlock_recommended: false, confidence: 1, unknowns: [],
      required_signal_terms: ["growth role"], geography_is_hard: true, known_companies: [],
    },
  }).final_mission;
  // The Brain's ICP rungs land on company_profile.stages WITH `company_brain`
  // provenance — that provenance is what makes them `target`, and the pair is
  // the shape that used to win the rung by being pushed first.
  return {
    ...m,
    company_profile: { ...m.company_profile, stages: brainStages },
    ...(brainStages.length
      ? { field_provenance: { ...(m.field_provenance ?? {}), "company_profile.stages": "company_brain" } }
      : {}),
  } as LeadMissionV1;
}

const stages = (m: LeadMissionV1) =>
  deriveMissionCriteria(m, PRODUCTION_READINESS).filter((c) => c.dimension === "company_stage");
const seed = (m: LeadMissionV1) => stages(m).find((c) => c.value === "seed");

// ═══ C. the rung is read from "raised <round>" ═════════════════════════════

Deno.test("C1. the two readers split the sentence cleanly and never both claim a rung", () => {
  // "raised Seed" is an event: the stage reader refuses it, the funded reader takes it.
  assertEquals(readStageIntent(QUERY), null, "the stage reader must still skip a raised-round");
  const funded = readFundedStageIntent(QUERY)!;
  assertEquals(funded.value, "seed");
  assertEquals(funded.kind, "hard");

  // "seed-stage company" is a company kind: the stage reader takes it, the funded reader refuses.
  const kindQuery = "Find seed-stage B2B SaaS companies in the US.";
  assertEquals(readFundedStageIntent(kindQuery), null, "no raised/closed context, so not a round");
  assert(readStageIntent(kindQuery), "the stage reader still owns a descriptive rung");
});

Deno.test("C2. a HARD seed rung now reaches the criteria", () => {
  const c = seed(mission())!;
  assert(c, "the rung the user required must exist as a criterion");
  assertEquals(c.kind, "hard", "a round the company must have RAISED is a requirement, not a ranking");
  assertEquals(c.value, "seed");
});

Deno.test("C3. a round mentioned WITHOUT a funding requirement is not a filter", () => {
  // No funding signal on the mission ⇒ the rung is not read. A passing mention
  // in an unrelated sentence must not silently become a hard filter.
  const m = mission();
  const noFunding = {
    ...m, required_signals: (m.required_signals ?? []).filter((s) => s.type !== "funding"),
  } as LeadMissionV1;
  assertFalse(stages(noFunding).some((c) => c.value === "seed" && c.kind === "hard"),
    "without a funding requirement the round is not a requirement either");
});

Deno.test("C4. a hedged round is not a requirement", () => {
  const hedged = "Find US SaaS companies, ideally ones that recently raised Seed funding.";
  assertEquals(readFundedStageIntent(hedged), null, "a hedge makes it a preference, not a filter");
});

Deno.test("C5. series rounds read too, and non-round stages do not", () => {
  assertEquals(readFundedStageIntent("companies that raised Series B recently")?.value, "series_b");
  // `early_stage` is not a funding round, so a raised-context mention is not a rung.
  assertEquals(readFundedStageIntent("raised money as an early-stage company"), null);
});

// ═══ B. the stated rung outranks the Brain's preference for the SAME rung ══

Deno.test("B1. THE USER'S RUNG WINS the rung it names", () => {
  // The Brain's ICP also lists seed — the exact collision that used to lose.
  const c = seed(mission(["seed"]))!;
  assertEquals(c.kind, "hard", "a Brain preference must not overwrite a stated requirement");
  assertEquals(c.source, "user_explicit");
});

Deno.test("B2. …and every OTHER Brain rung is untouched", () => {
  const all = stages(mission(["seed", "series_a"]));
  const a = all.find((c) => c.value === "series_a")!;
  assert(a, "the Brain's other rungs must still be compiled");
  assertEquals(a.kind, "target", "a rung the user did not state stays a ranking preference");
  assertEquals(all.filter((c) => c.value === "seed").length, 1, "and the rung is not duplicated");
});

Deno.test("B3. with NO stated rung the Brain still owns its ICP entirely", () => {
  // Production behaviour for a mission that names no round: unchanged.
  const m = mission(["seed", "series_a"], "Find US B2B SaaS companies hiring a growth role.");
  for (const c of stages(m)) {
    assertEquals(c.kind, "target", `${c.value} must remain a Brain preference`);
  }
});

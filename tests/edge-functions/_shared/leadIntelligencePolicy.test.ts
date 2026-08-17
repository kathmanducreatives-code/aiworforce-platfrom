// A WORKSPACE IS EITHER IN THE NEW ARCHITECTURE OR IT IS NOT.
//
// On TEST the five Stage 1-4 allow-lists held the QA workspace and
// `SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES` held My Company — inverted, not
// merely inconsistent. My Company therefore ran the stage that spends model
// calls classifying companies and none of the stages that make a
// classification mean anything, and spent real money doing it.
//
// These prove the combination can no longer reach a provider.
//
// ZERO network, provider, model or database access. Env is injected.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getLeadIntelligenceCapabilities, REQUIRED_FOR_PAID_SOURCING,
} from "../../../supabase/functions/_shared/leadIntelligencePolicy.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const QA = "11111111-2222-4333-8444-555555555555";
const MY = "00000000-0000-0000-0000-000000000001";

/** Every Stage 1-4 flag on, for the given workspaces. */
const allOn = (ws: string) => ({
  GPT_LEAD_MISSION_COMPILER: "true", GPT_LEAD_MISSION_COMPILER_WORKSPACES: ws,
  GROUNDED_COMPANY_BRAIN: "true", GROUNDED_COMPANY_BRAIN_WORKSPACES: ws,
  GROUNDED_COMPANY_BRAIN_MODE: "enforce",
  FULL_POOL_GROUNDED_EVALUATION: "true", FULL_POOL_GROUNDED_EVALUATION_WORKSPACES: ws,
  GPT_POOL_RANKING: "true", GPT_POOL_RANKING_WORKSPACES: ws,
  GPT_POOL_RANKING_MODE: "shadow",
  MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: ws,
});
const env = (o: Record<string, string>) => (k: string) => o[k];

/** A mission with a real qualification contract, so only architecture is tested. */
function hiringMission(over: Partial<LeadMissionV1> = {}): LeadMissionV1 {
  const base = parseLeadMissionDeterministic(
    "Find 10 founders at B2B SaaS companies that are hiring their sales teams. Return 10 leads.");
  return { ...base, ...over } as LeadMissionV1;
}

/** A compiled mission — `directives` is the provenance marker. */
function compiled(m: LeadMissionV1): LeadMissionV1 {
  return {
    ...m,
    directives: {
      preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
      required_evidence: ["open_sales_role"], disallowed_broadening: [],
      allowed_broadening: {
        role_families: ["revenue operations"], company_types: [], geographies: [],
        employee_range: { min: 5, max: 500 },
      },
      evaluation_instructions: "", source_strategy: [],
      requested_contact_ready_count: null, founder_unlock_recommended: true,
    },
  } as LeadMissionV1;
}

const preflight = (
  mission: LeadMissionV1 | null,
  intelligence: ReturnType<typeof getLeadIntelligenceCapabilities> | null,
) => {
  const plan = mission ? buildCapabilityGraph(mission) : null;
  return buildPaidExecutionPreflight({
    mission, plan,
    firstProvider: plan?.allowed_providers[0] ?? null,
    firstProviderCompileOk: true,
    intelligence,
  });
};

// ═════════════════════════════ A. workspace consistency ══

Deno.test("A1. the production inversion is detected and refuses to spend", () => {
  // EXACTLY what TEST held: Stage 1-4 for QA only, and My Company gets none of
  // them while other model-spending features are on for it.
  const live = env(allOn(QA));
  const my = getLeadIntelligenceCapabilities(MY, live);

  assertEquals(my.mode, "deterministic",
    "with every required stage off, the deterministic path is intended");
  assertFalse(my.paid_new_architecture_allowed);
  // ── UPDATED 2026-08-17: EVERY WORKSPACE EXPECTS A COMPILED MISSION ─────
  //
  // This asserted `expects_compiled_mission` followed the flag. That is what
  // made the preflight's `mission_not_model_compiled` block dead on every live
  // run: flag unset ⇒ no compiled mission expected ⇒ spending against a regex
  // reading was permitted. Compilation is now unconditional, so the
  // expectation is too.
  assert(my.expects_compiled_mission, "compilation is no longer optional");

  // And QA gets the whole thing.
  const qa = getLeadIntelligenceCapabilities(QA, live);
  assertEquals(qa.mode, "new_architecture");
  assert(qa.paid_new_architecture_allowed);
  assert(qa.expects_compiled_mission);
});

Deno.test("A2. a PARTIAL architecture is unsupported and blocks paid execution", () => {
  // The dangerous shape: compiler on, evaluation and rounds off.
  const partial = getLeadIntelligenceCapabilities(MY, env({
    ...allOn(MY),
    FULL_POOL_GROUNDED_EVALUATION: "false",
    MULTI_ROUND_SOURCING: "false",
  }));

  assertEquals(partial.mode, "inconsistent");
  assertFalse(partial.paid_new_architecture_allowed, "half-in must never spend");
  assertEquals(partial.missing_required.sort(),
    ["full_pool_evaluation", "multi_round"]);
  assert(partial.reason.includes("unsupported partial architecture"));

  // …and the preflight refuses it, on a mission that is otherwise perfect.
  const pf = preflight(compiled(hiringMission()), partial);
  assertFalse(pf.ok);
  assert(pf.blocked.some((b) => b.code === "inconsistent_intelligence_configuration"));

  let threw = false;
  try { assertPaidExecutionAllowed(pf); } catch { threw = true; }
  assert(threw, "the block must be enforced, not merely recorded");
});

Deno.test("A3. every required stage together is what makes a workspace whole", () => {
  const full = allOn(MY);
  // Turning off ANY ONE required stage breaks the whole.
  for (const stage of REQUIRED_FOR_PAID_SOURCING) {
    const flag: string = {
      mission_compiler: "GPT_LEAD_MISSION_COMPILER",
      grounded_brain: "GROUNDED_COMPANY_BRAIN",
      full_pool_evaluation: "FULL_POOL_GROUNDED_EVALUATION",
      multi_round: "MULTI_ROUND_SOURCING",
      pool_ranking: "GPT_POOL_RANKING",
    }[stage];
    const c = getLeadIntelligenceCapabilities(MY, env({ ...full, [flag]: "false" }));
    assertEquals(c.mode, "inconsistent", `${stage} off must be inconsistent`);
    assertFalse(c.paid_new_architecture_allowed);
  }
  // Ranking is deliberately NOT required — it has a shadow mode.
  const noRanking = getLeadIntelligenceCapabilities(MY, env({
    ...full, GPT_POOL_RANKING: "false",
  }));
  assertEquals(noRanking.mode, "new_architecture",
    "ranking must not block: shadow rollout depends on it being optional");
});

// ═══════════════════════════════ B. compiler failure ══

Deno.test("B1. compiler enabled + no directives ⇒ compilation failed ⇒ zero spend", () => {
  const whole = getLeadIntelligenceCapabilities(MY, env(allOn(MY)));
  assertEquals(whole.mode, "new_architecture");

  // The mission has a real hiring contract, so ONLY provenance is being tested.
  const fellBack = hiringMission();
  assertEquals(fellBack.directives, undefined, "the deterministic parse sets none");

  const pf = preflight(fellBack, whole);
  assertFalse(pf.ok, "a failed compilation must not be spent against");
  assert(pf.blocked.some((b) => b.code === "mission_compilation_failed"));

  let threw = false;
  try { assertPaidExecutionAllowed(pf); } catch { threw = true; }
  assert(threw, "provider call count must be zero");
});

Deno.test("B2. compiler enabled + directives present ⇒ the run proceeds", () => {
  const whole = getLeadIntelligenceCapabilities(MY, env(allOn(MY)));
  const pf = preflight(compiled(hiringMission()), whole);
  assertFalse(pf.blocked.some((b) => b.code === "mission_compilation_failed"));
  assertFalse(pf.blocked.some((b) => b.code === "inconsistent_intelligence_configuration"));
});

// ═════════════════════ C. deterministic paths still work ══

// ── REPLACED 2026-08-17: THERE IS NO "INTENTIONALLY DETERMINISTIC" WORKSPACE
//
// This asserted that a workspace with the compiler off could spend against a
// deterministic mission, because that was "what was designed". It is no longer
// designed: there is one canonical interpretation path, and it is GPT. A
// workspace cannot opt out of understanding the user's request.
//
// What survives is the part that was always right — a mission the model DID
// compile must not be accused of a failed compilation.
Deno.test("C1. a model-compiled mission is not accused of failing to compile", () => {
  const det = getLeadIntelligenceCapabilities(MY, env(allOn(QA)));
  assertEquals(det.mode, "deterministic", "the legacy mode label is unchanged");
  assert(det.expects_compiled_mission, "but a compiled mission is expected regardless");

  // `compiled()` adds `directives`, the provenance marker of a real model
  // reading. The bare `hiringMission()` fixture is a DETERMINISTIC mission, and
  // blocking that is now the correct answer — which is the whole change.
  const pf = preflight(compiled(hiringMission()), det);
  assertFalse(pf.blocked.some((b) => b.code === "mission_compilation_failed"),
    "a mission carrying directives must not be accused of a failed compilation");
  assertFalse(pf.blocked.some((b) => b.code === "inconsistent_intelligence_configuration"));

  // The negative control, so the assertion above cannot pass vacuously: an
  // uncompiled mission IS refused now, in every workspace.
  const bare = preflight(hiringMission(), det);
  assert(
    bare.blocked.some((b) => b.code === "mission_compilation_failed"),
    "an uncompiled mission must be refused regardless of workspace configuration",
  );
  // It still has to satisfy the qualification contract — a different guard.
  assert(pf.ok, "a deterministic mission with a real signal may still run");
});

Deno.test("C2. absent policy leaves every existing caller unchanged", () => {
  // Optional by design: existing callers and tests pass no `intelligence`.
  const pf = preflight(hiringMission(), null);
  assertFalse(pf.blocked.some((b) => b.code === "inconsistent_intelligence_configuration"));
  assertFalse(pf.blocked.some((b) => b.code === "mission_compilation_failed"));
  assert(pf.ok);
});

Deno.test("C3. the policy names no Actor and reads only stage bindings", async () => {
  const src = await Deno.readTextFile(new URL(
    "../../../supabase/functions/_shared/leadIntelligencePolicy.ts", import.meta.url));
  for (const banned of ["apify_", "memo23", "harvestapi", "solidcode", "fetch("]) {
    assertFalse(src.includes(banned), `the policy must not contain ${banned}`);
  }
  // It delegates to each stage's own binding rather than re-reading env, so it
  // cannot drift from the stage it describes.
  for (const fn of [
    "isMissionCompilerEnabled", "isGroundedBrainEnabled",
    "isFullPoolEvaluationEnabled", "isMultiRoundEnabled",
  ]) {
    assert(src.includes(fn), `the policy must delegate to ${fn}`);
  }
});

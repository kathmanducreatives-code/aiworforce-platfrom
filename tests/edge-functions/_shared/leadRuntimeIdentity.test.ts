// PLANNER AND EXECUTOR ARE DIFFERENT BUILDS. THAT MUST BE VISIBLE AND SAFE.
//
// On 2026-08-07 a pilot-chat bundle from Aug 6 handed a mission to a run-agent
// bundle from Aug 7. Nothing on the task said so, and half a day went into
// inferring it from behaviour. These pin the two properties that prevent a
// repeat: the runtime is recorded, and an incompatible contract fails closed
// before the paid boundary.
//
// ZERO network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkContractCompatibility, runtimeIdentity,
  LEAD_INTELLIGENCE_CONTRACT_VERSION, SUPPORTED_CONTRACT_VERSIONS,
} from "../../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

function compiledMission(): LeadMissionV1 {
  const base = parseLeadMissionDeterministic(
    "Find 10 founders at B2B SaaS companies that are hiring their sales teams. Return 10 leads.");
  return {
    ...base,
    directives: {
      preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
      required_evidence: ["open_sales_role"], disallowed_broadening: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      evaluation_instructions: "", source_strategy: [],
      requested_contact_ready_count: null, founder_unlock_recommended: true,
    },
  } as LeadMissionV1;
}

const preflight = (contract: ReturnType<typeof checkContractCompatibility> | null) => {
  const mission = compiledMission();
  const plan = buildCapabilityGraph(mission);
  return buildPaidExecutionPreflight({
    mission, plan,
    firstProvider: plan.allowed_providers[0] ?? null,
    firstProviderCompileOk: true,
    contract,
  });
};

Deno.test("1. a runtime identity names the build, never a Supabase version", () => {
  const id = runtimeIdentity("executor", "run-agent");
  assertEquals(id.role, "executor");
  assertEquals(id.function, "run-agent");
  assertEquals(id.lead_intelligence_contract_version, LEAD_INTELLIGENCE_CONTRACT_VERSION);
  // Undeployed code is OBVIOUSLY undeployed rather than silently plausible.
  assertEquals(id.git_sha, "local");
  assert(id.dirty);
  assert(typeof id.build_timestamp === "string");
  // The thing that misled us is absent by construction.
  assertFalse(Object.keys(id).some((k) => /version$/.test(k) && k !== "lead_intelligence_contract_version"));
});

Deno.test("2. matching contracts pass, and different BUILDS are fine", () => {
  const c = checkContractCompatibility(LEAD_INTELLIGENCE_CONTRACT_VERSION, "some-other-sha");
  assert(c.ok, "separate deploys speaking the same contract must be allowed");
  if (c.ok) {
    assertEquals(c.planner_version, LEAD_INTELLIGENCE_CONTRACT_VERSION);
    assertFalse(c.same_build, "a different SHA is reported, not refused");
  }
  assertEquals(preflight(c).blocked.filter((b) =>
    b.code === "incompatible_planner_contract").length, 0);
});

Deno.test("3. an ABSENT contract version fails closed", () => {
  // A mission compiled before the guard existed. Assuming it is compatible is
  // exactly the assumption that costs money.
  for (const v of [null, undefined, "", "   "]) {
    const c = checkContractCompatibility(v);
    assertFalse(c.ok);
    if (!c.ok) assertEquals(c.reason, "unknown_planner_contract");
  }
  const pf = preflight(checkContractCompatibility(null));
  assertFalse(pf.ok);
  assert(pf.blocked.some((b) => b.code === "incompatible_planner_contract"));

  let threw = false;
  try { assertPaidExecutionAllowed(pf); } catch { threw = true; }
  assert(threw, "provider attempts must be zero");
});

Deno.test("4. an UNSUPPORTED contract generation fails closed", () => {
  const c = checkContractCompatibility("v0");
  assertFalse(c.ok);
  if (!c.ok) {
    assertEquals(c.reason, "unsupported_planner_contract");
    assert(c.detail.includes("v0"));
  }
  const pf = preflight(c);
  assertFalse(pf.ok);
  assert(pf.blocked.some((b) => b.code === "incompatible_planner_contract"));
  // NO LEGACY FALLBACK. The only outcome is a refusal.
  assertFalse(pf.ok && pf.blocked.length === 0);
});

Deno.test("5. the guard is optional, so existing callers are unaffected", () => {
  const pf = preflight(null);
  assertFalse(pf.blocked.some((b) => b.code === "incompatible_planner_contract"));
  assert(pf.ok);
});

Deno.test("6. the supported set includes the current contract", () => {
  assert(SUPPORTED_CONTRACT_VERSIONS.includes(LEAD_INTELLIGENCE_CONTRACT_VERSION),
    "an executor must understand the contract it itself emits");
});

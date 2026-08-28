// THE COMPILED MISSION MUST REACH EXECUTION, AND NOTHING MAY INVENT ONE.
//
// pilot-chat compiled a canonical LeadMission, showed it on the confirmation
// card, and then dropped it: `delegateToOrchestrate` sent only `tool_input`.
// Orchestrate filled the gap with `parseLeadMissionDeterministic`, producing
// confidence 0.6, no directives, no planner runtime and no contract — and that
// is what reached run-agent on live task 1d73e23f.
//
// These pin the corrected contract at both ends: the mission is put on the
// wire, and a missing one is refused rather than fabricated.
//
// ZERO network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isLeadMissionV1, parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  getLeadIntelligenceCapabilities,
} from "../../../supabase/functions/_shared/leadIntelligencePolicy.ts";
import {
  checkContractCompatibility, runtimeIdentity,
  LEAD_INTELLIGENCE_CONTRACT_VERSION,
} from "../../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import {
  buildPaidExecutionPreflight,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const PILOT = new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url);
const ORCH = new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url);

const QUERY =
  "Find 10 founders at B2B SaaS companies currently building or hiring their sales teams. " +
  "Save them to Signal Feed. Do not send outreach.";

const MY = "00000000-0000-0000-0000-000000000001";
const QA = "11111111-2222-4333-8444-555555555555";
const BOTH = `${MY},${QA}`;
const newArchEnv = (k: string) => ({
  GPT_LEAD_MISSION_COMPILER: "true", GPT_LEAD_MISSION_COMPILER_WORKSPACES: BOTH,
  GROUNDED_COMPANY_BRAIN: "true", GROUNDED_COMPANY_BRAIN_WORKSPACES: BOTH,
  GROUNDED_COMPANY_BRAIN_MODE: "enforce",
  FULL_POOL_GROUNDED_EVALUATION: "true", FULL_POOL_GROUNDED_EVALUATION_WORKSPACES: BOTH,
  GPT_POOL_RANKING: "true", GPT_POOL_RANKING_WORKSPACES: BOTH, GPT_POOL_RANKING_MODE: "shadow",
  MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: BOTH,
}[k]);

/** A canonical mission as pilot-chat now produces it. */
function canonicalMission(): LeadMissionV1 {
  const base = parseLeadMissionDeterministic(QUERY, { requestedCount: 10 });
  return {
    ...base,
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
    planner_runtime: runtimeIdentity("planner", "pilot-chat") as unknown as Record<string, unknown>,
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION,
  } as LeadMissionV1;
}

// ═══════════════════════════════ A. the mission is on the wire ══

Deno.test("A. the delegate payload carries the canonical mission", async () => {
  const src = await Deno.readTextFile(PILOT);
  // The field that was missing. Its absence WAS the defect.
  assert(src.includes("lead_mission: a.leadMission ?? null"),
    "delegateToOrchestrate must put the mission on the HTTP body");
  assert(/leadMission\?:\s*LeadMissionV1\s*\|\s*null/.test(src),
    "DelegateArgs must carry a typed mission, not `unknown`");
  // And the primary lead path supplies one. That used to be the classifier's
  // `company_hiring_sourcing` branch (`leadMission: compiledLeadMission`); it is
  // now the Chat Brain route, which compiles `route.lead` through the same
  // `compileLeadMission` and delegates the result.
  assert(src.includes("leadMission: mission"),
    "the Chat Brain lead route must pass the compiled mission");
  assert(src.includes("compileRequestMission("),
    "and must compile it from the projection rather than re-reading the sentence");
});

Deno.test("B. the mission is compiled exactly once per request path", async () => {
  const src = await Deno.readTextFile(PILOT);
  // ONE compiler invocation site, inside the shared helper. A second call
  // anywhere would mean two missions per request and two model calls.
  const compileCalls = [...src.matchAll(/\bcompileLeadMission\s*\(/g)].length;
  assertEquals(compileCalls, 1,
    `compileLeadMission must be invoked from exactly one place, found ${compileCalls}`);
  // And it is NOT invoked inside the transport function.
  const delegateStart = src.indexOf("async function delegateToOrchestrate");
  const delegateEnd = src.indexOf("\n}", delegateStart);
  const delegateBody = src.slice(delegateStart, delegateEnd);
  assertFalse(delegateBody.includes("compileLeadMission("),
    "the transport function must never compile a mission");
  assertFalse(delegateBody.includes("parseLeadMissionDeterministic("),
    "the transport function must never parse a mission");
});

// ═══════════════════ C. the canonical fields survive transport ══

Deno.test("C. every contract-bearing field survives the wire", () => {
  const mission = canonicalMission();
  // The exact object is transported, so a JSON round-trip is the wire.
  const onWire = JSON.parse(JSON.stringify({
    user_instruction: QUERY, workspace_id: MY,
    lead_mission: mission, tool_input: { tool_name: "source_with_apify" },
  }));
  // Typed as the untrusted wire payload it is — orchestrate receives JSON.
  const received = onWire.lead_mission as Record<string, any>;

  assert(isLeadMissionV1(received), "orchestrate must accept it as a real mission");
  // Separate binding: the guard above narrows `received`, and these fields are
  // deliberately being read as untyped wire data.
  const raw = onWire.lead_mission as Record<string, any>;
  for (const f of [
    "original_user_query", "requested_count", "requested_output", "target_entity",
    "directives", "required_signals", "required_capabilities",
    "prohibited_capabilities", "confidence", "planner_runtime",
    "lead_intelligence_contract_version",
  ]) {
    assert(raw[f] !== undefined, `${f} must survive transport`);
  }
  assertEquals(raw.lead_intelligence_contract_version, "v1");
  assertEquals(raw.planner_runtime.function, "pilot-chat");
  assert(raw.required_signals.some((s: { type: string }) => s.type === "hiring"),
    "the hiring signal must survive");
  assertEquals(raw.directives.allowed_broadening.employee_range.min, 5);
  // NOT reconstructed from tool_input — the user's own words are intact.
  assertEquals(raw.original_user_query, QUERY);
});

Deno.test("C2. run-agent accepts the transported mission end to end", () => {
  const mission = canonicalMission();
  const policy = getLeadIntelligenceCapabilities(MY, newArchEnv);
  assertEquals(policy.mode, "new_architecture");

  const contract = checkContractCompatibility(
    mission.lead_intelligence_contract_version,
    (mission.planner_runtime as { git_sha?: string })?.git_sha ?? null);
  assert(contract.ok, "planner v1 and executor v1 must be compatible");

  const graph = buildCapabilityGraph(mission);
  assert(graph.steps.some((s) => String(s.capability) === "hiring_verification"),
    "the hiring query must schedule hiring verification");

  const pf = buildPaidExecutionPreflight({
    mission, plan: graph,
    firstProvider: graph.allowed_providers[0] ?? null,
    firstProviderCompileOk: true,
    intelligence: policy, contract,
  });
  assert(pf.ok, `preflight must pass, blocked: ${JSON.stringify(pf.blocked)}`);
  // None of the three guards that blocked the live tasks may fire.
  for (const code of [
    "mission_not_compiled", "mission_compilation_failed", "incompatible_planner_contract",
  ]) {
    assertFalse(pf.blocked.some((b) => b.code === code), `${code} must not fire`);
  }
});

// ═════════════════════ D/E. fail closed, but not for everyone ══

Deno.test("D. new_architecture without a mission fails closed, no parser", async () => {
  const src = await Deno.readTextFile(ORCH);
  // The fail-closed branch exists and returns the honest code.
  assert(src.includes("mission_not_compiled"),
    "orchestrate must refuse a new-architecture request with no mission");
  assert(src.includes('orchestrateIntelligence.mode === "new_architecture"'),
    "the refusal must be gated on the intelligence mode");

  // The deterministic parser is reachable ONLY from the else branch — i.e. it
  // is no longer error recovery. Assert it sits after the new_architecture
  // refusal, which is what makes it unreachable for that mode.
  const refusal = src.indexOf("mission_not_compiled");
  const parse = src.indexOf("parseLeadMissionDeterministic(user_instruction", refusal);
  assert(parse > refusal,
    "parseLeadMissionDeterministic must follow the fail-closed branch, not precede it");
});

// ── INVERTED 2026-08-17: THE "BLUNT RULE" IS NOW THE ARCHITECTURE ─────────
//
// This protected a workspace that had deliberately not adopted the compiler.
// No workspace ever adopted it — the flag was unset everywhere — so the
// exemption was the rule, and every run spent against a regex reading.
Deno.test("E. an uncompiled mission is refused even in a legacy workspace", () => {
  const deterministic = getLeadIntelligenceCapabilities(MY, () => undefined);
  assertEquals(deterministic.mode, "new_architecture", "one mode, everywhere");
  assert(deterministic.expects_compiled_mission, "but compilation is now expected");

  const mission = parseLeadMissionDeterministic(QUERY, { requestedCount: 10 });
  const graph = buildCapabilityGraph(mission);
  const pf = buildPaidExecutionPreflight({
    mission, plan: graph,
    firstProvider: graph.allowed_providers[0] ?? null,
    firstProviderCompileOk: true,
    intelligence: deterministic, contract: null,
  });
  assert(
    pf.blocked.some((b) => b.code === "mission_compilation_failed"),
    "a mission the model never produced must not reach a paid boundary",
  );
});

// ══════════════════════════ F/G/H. no bypass may execute ══

Deno.test("F-H. every lead-capable delegate carries a mission, and the rest fail closed", async () => {
  const src = await Deno.readTextFile(PILOT);

  // The four lead-sourcing branches each supply one.
  const supplied = [...src.matchAll(/leadMission:\s*(\w+)/g)].map((m) => m[1]);
  assert(supplied.includes("briefMission"), "submitted lead brief supplies a mission");
  assert(supplied.includes("intakeMission"), "lead intake supplies a mission");
  // `people_sourcing` and `company_hiring_sourcing` used to supply their own
  // (`peopleMission`, `compiledLeadMission`). Both branches are deleted: a
  // people or company sourcing request is now the same lead route as any other,
  // compiled once from what Chat Brain understood.
  // ── AND THE FIFTH: THE ONE THE OTHERS EXIST TO BE REPLACED BY ──────────
  //
  // The Chat Brain route compiles `RequestV1` -> `projectToLeadMission` ->
  // `compileLeadMission` and delegates the result. It is counted here for the
  // same reason as the other four: a lead-capable delegate that carries no
  // mission is refused at the chokepoint, so every one of them must supply one.
  //
  // `missionToRun`, not `mission`: on a confirmed Start the route executes the
  // mission the CARD carried rather than re-compiling from a second reading of
  // the sentence, and falls back to the compiled one when that payload is
  // unreadable. Either way a mission is supplied, which is what this asserts.
  assert(supplied.includes("missionToRun"),
    "the Chat Brain request route supplies a compiled or approved mission");
  assertEquals(new Set(supplied).size, 3,
    "three lead paths remain, and each supplies a mission");

  // ANY OTHER BRANCH THAT REACHES ORCHESTRATE WITH LEAD INTENT IS STILL SAFE,
  // because orchestrate is the chokepoint: under new_architecture a request
  // with no mission is refused, not executed. That is what makes the remaining
  // delegate branches — the confident-tool_input shortcut and the final
  // generic delegate — incapable of running lead sourcing on `tool_input`
  // alone. They fail visibly at zero cost rather than silently succeeding.
  const orch = await Deno.readTextFile(ORCH);
  assert(orch.includes("mission_not_compiled"), "the chokepoint refuses");
  assertFalse(orch.includes("?? parseLeadMissionDeterministic("),
    "the old unconditional fallback expression must be gone");
});

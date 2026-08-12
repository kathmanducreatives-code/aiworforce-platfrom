// THE MISSION ARCHITECTURE IS THE ONLY LEAD-SOURCING ARCHITECTURE.
//
// These tests exist to fail loudly if anyone reintroduces the legacy
// lead-sourcing workflow, in whole or in part.
//
// WHAT WAS REMOVED, AND WHY IT CANNOT COME BACK QUIETLY.
//
// run-agent used to contain two sourcing architectures under one `shouldRun`
// guard. The second — 1,893 lines — held the Claude source planner
// (`actorInputPlanner.planActorInput`), `runAdaptiveSourcing` and its
// broadening ladder, the Aria/Brain-ICP qualification stack, and a
// `lead_type='company'` persistence path that wrote straight to
// `lead_candidates` for the frontend to read.
//
// On TEST run 16952bd6-7d9d-4ce6-a09f-439a48568623 a valid GPT-compiled
// LeadMissionV1 reached that block and was silently downgraded:
// `geography_is_hard: true` was relaxed, the Mission's
// `verticals: ["AI startups"]` never reached the provider payload, and eight
// companies that all matched the request were scored 28/100 against the
// workspace's generic sales ICP. The run still spent Apify credits and still
// looked like a success in the Workbench.
//
// A second architecture that can lose the first one's meaning is not a
// fallback; it is the failure mode. So it was deleted rather than guarded.
//
// PURE AND OFFLINE. No network, no provider, no model, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const RUN_AGENT_URL = new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url);

/** run-agent source with comments stripped — prose about the deletion must not
 * count as the deleted thing still being present. */
const CODE = Deno.readTextFileSync(RUN_AGENT_URL)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

// ═══ 1. A MISSION RUN CANNOT INVOKE THE OLD PLANNER ════════════════════════

Deno.test("cutover: the legacy Claude source planner is unreachable", () => {
  assert(!/actorInputPlanner/.test(CODE), "actorInputPlanner must not be imported or called");
  assert(!/planActorInput/.test(CODE), "planActorInput was the legacy source planner entry point");
  assert(!/planner_mode/.test(CODE), "planner_mode was its provider-transparency field");
  assert(!/sourcePlanMeta/.test(CODE), "sourcePlanMeta carried its result to the task record");
});

// ═══ 2. A MISSION RUN CANNOT INVOKE runAdaptiveSourcing ════════════════════

Deno.test("cutover: the adaptive sourcing loop is unreachable", () => {
  assert(!/runAdaptiveSourcing/.test(CODE), "the adaptive loop must have no call site");
  assert(!/sourcingRetry\.ts/.test(CODE), "and its module must not be imported");
  assert(!/adaptiveAttempts/.test(CODE), "its attempt log must not be assembled");
  // NOTE: `scoutResult.attempt_log` survives deliberately. That is a READ of a
  // previously-persisted task result (the ranking step summarising an earlier
  // scout run), not the adaptive loop writing a new one. Back-compatible reads
  // of historical rows are not the legacy execution path.
  assert(
    !/attempt_log: adaptiveAttempts/.test(CODE),
    "the adaptive loop must not publish a new attempt log",
  );
});

// ═══ 3. NO LEGACY apify_jobs EXECUTION PATH ════════════════════════════════

Deno.test("cutover: provider calls exist only at mission-driven entry points", () => {
  // Two remain, both inside the mission-driven branch: company-first jobs and
  // company-first people. The generic adaptive entry point is gone.
  const providerCalls = CODE.split('runTool("source_with_apify"').length - 1;
  assertEquals(
    providerCalls, 2,
    "exactly two provider entry points may exist, both mission-driven",
  );

  // Every one of them must sit before the refusal, i.e. inside the branch that
  // only a mission-accepted run reaches.
  const refusalAt = CODE.indexOf("sourcing-not-accepted");
  assert(refusalAt > 0, "the refusal must exist");
  let idx = CODE.indexOf('runTool("source_with_apify"');
  while (idx !== -1) {
    assert(idx < refusalAt, "a provider call may not appear after the refusal boundary");
    idx = CODE.indexOf('runTool("source_with_apify"', idx + 1);
  }
});

// ═══ 4. NO LEGACY QUALIFICATION ════════════════════════════════════════════

Deno.test("cutover: the legacy qualification stack is unreachable", () => {
  for (const gone of [
    "ariaScoring",       // the 28/100 scorer that used the generic sales ICP
    "aria_score",
    "leadAnalyst",       // the legacy analyst narrative
    "leadPreRank",
    "leadQuality.ts",
    "sourceGates",       // the legacy per-candidate source gate
    "scoutStrategy",
    "scoutSourcingPlan",
    "qualificationObservability", // the legacy funnel report
  ]) {
    assert(!new RegExp(gone.replace(".", "\\.")).test(CODE), `${gone} must not be reachable`);
  }
});

Deno.test("cutover: the legacy qualification modules are deleted from the tree", async () => {
  for (const mod of [
    "ariaScoring", "leadAnalyst", "leadPreRank", "leadQuality",
    "scoutSourcingPlan", "scoutStrategy", "sourceGates",
  ]) {
    const url = new URL(`../../../supabase/functions/_shared/${mod}.ts`, import.meta.url);
    let exists = true;
    try { await Deno.stat(url); } catch { exists = false; }
    assert(!exists, `_shared/${mod}.ts must be deleted, not merely unreferenced`);
  }
});

// ═══ 5. NO LEGACY lead_type='company' PERSISTENCE ══════════════════════════

Deno.test("cutover: run-agent cannot write the legacy company-row shape", () => {
  assert(
    !/lead_type:\s*["']company["']/.test(CODE),
    "the legacy lead_type='company' persistence shape must not be written",
  );
  // The Lead Library projection is the only company-row writer left.
  assert(
    /projectMissionCompanyRows/.test(CODE),
    "the Mission→Lead Library projection must still be present",
  );
});

// ═══ 6. THE MISSION RUN REACHES THE NEW CAPABILITY ARCHITECTURE ════════════

Deno.test("cutover: the mission architecture is present and ordered", () => {
  const stages = [
    "readPersistedLeadMission",     // mission is read
    "applyMissionEntityAuthority",  // mission decides the entity
    "selectResearchPlaybooks",      // playbook selection
    "buildCapabilityGraph",         // capability graph
    "authorizePlaybookExecution",   // authorization
    "buildPaidExecutionPreflight",  // paid preflight
    "runCapabilityPlan",            // capability engine
    "projectMissionCompanyRows",    // lead library persistence
  ];
  for (const s of stages) {
    assert(new RegExp(s).test(CODE), `${s} must be present in run-agent`);
  }

  // Order matters: the mission must be read before the playbook is selected,
  // and the playbook authorized before the engine runs. Compare CALL SITES,
  // not import statements — the import block lists them in a different order.
  const callAt = (s: string) => {
    const i = CODE.indexOf(s);
    assert(i > 0, `${s} must have a call site`);
    return i;
  };
  assert(
    callAt("const routingMission = readPersistedLeadMission(") < callAt("selectResearchPlaybooks(persistedMission)"),
    "the mission must be read before a playbook is selected",
  );
  assert(
    callAt("selectResearchPlaybooks(persistedMission)") < callAt("authorizePlaybookExecution(playbookSelection"),
    "selection must precede authorization",
  );
  assert(
    callAt("authorizePlaybookExecution(playbookSelection") < callAt("await runCapabilityPlan({"),
    "authorization must precede the capability engine",
  );
});

// ═══ 7. THE MISSION IS PASSED THROUGH, NOT RECONSTRUCTED FROM RAW TEXT ═════

Deno.test("cutover: no raw-text semantic reader remains in run-agent", () => {
  for (const reader of [
    "extractLeadIntent",
    "separateIntent({",
    "extractRequestedLeadCount",
    "resolveRequestedCount",
    "parseStrictConstraints",
    "parsePeopleSearchIntent",
  ]) {
    assert(
      !CODE.includes(reader),
      `${reader} re-reads the user's sentence; the Mission already decided it`,
    );
  }
});

Deno.test("cutover: the mission's presence is what routes the run", () => {
  assert(
    /if \(routingMission \|\| bodyDeclaresCompanyFirst \|\| \(!raw_source_type && !planned_actor_key\)\)/.test(CODE),
    "a compiled Mission must route itself regardless of any pinned actor",
  );
  // And the read must happen before the gate uses it.
  assert(
    CODE.indexOf("const routingMission = readPersistedLeadMission(")
      < CODE.indexOf("if (routingMission ||"),
    "the Mission must be read before the routing gate evaluates it",
  );
});

// ═══ 8. THERE IS NO FALLBACK, ONLY A REFUSAL ═══════════════════════════════

Deno.test("cutover: an unaccepted sourcing run refuses and spends nothing", () => {
  const start = CODE.indexOf("sourcing-not-accepted");
  assert(start > 0, "an explicit refusal must exist");
  const end = CODE.indexOf("}, 422);", start);
  assert(end > start, "the refusal must return 422");
  const refusal = CODE.slice(start, end);

  assert(/providers_called: 0/.test(refusal), "the refusal must state no provider ran");
  assert(/status: "failed"/.test(refusal), "the task must be recorded as failed");
  assert(!/runTool\(/.test(refusal), "no provider call may appear in the refusal path");
  assert(
    /sourcing_requires_mission_architecture/.test(refusal),
    "the refusal must name its reason so it is machine-classifiable",
  );
});

Deno.test("cutover: the f8680136 band-aid was removed with the block it guarded", () => {
  // The interim guard refused a Mission at the head of the legacy block. Once
  // the block is deleted there is nothing to guard, and keeping the guard would
  // imply the block might return.
  assert(!/legacyBlockMission/.test(CODE), "the interim mission guard is obsolete");
  assert(!/mission_requires_new_architecture/.test(CODE), "so is its reason code");
});

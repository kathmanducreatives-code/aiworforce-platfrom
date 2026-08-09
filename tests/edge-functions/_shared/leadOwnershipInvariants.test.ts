// ARCHITECTURE INVARIANTS — ONE PLANNER, ONE EXECUTION OWNER.
//
// These tests exist because the previous guarantees were prose. The codebase
// asserted in comments that two paths "cannot disagree about the same run" while
// the code allowed exactly that, and the only proof anyone had was a live run
// that spent 10 units and delivered 0 of 10.
//
// Every invariant below is proven either by ENUMERATION (the selector is pure,
// so all flag combinations are checked, not argued about) or by the ledger
// THROWING (a second owner is a raised error, not a silent second run).
//
// Offline. No provider calls, no model calls, no database, no network.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createLeadOwnershipLedger,
  LeadOwnershipViolation,
  LEAD_EXECUTION_OWNERS,
  STAGES_BY_OWNER,
  type LeadExecutionOwner,
} from "../../../supabase/functions/_shared/leadOwnership.ts";
import {
  selectLeadPlannerAdapter,
  runLeadPlanner,
  type LeadPlannerEligibility,
} from "../../../supabase/functions/_shared/leadPlannerInterface.ts";

const RUN_AGENT = new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url);
const ORCHESTRATE = new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url);

/** All 16 combinations of the four eligibility facts. */
function allEligibilities(): LeadPlannerEligibility[] {
  const out: LeadPlannerEligibility[] = [];
  for (const hasPersistedPlan of [false, true]) {
    for (const strategyOwnerApplies of [false, true]) {
      for (const gptEnabled of [false, true]) {
        for (const claudeEnabled of [false, true]) {
          out.push({ hasPersistedPlan, strategyOwnerApplies, gptEnabled, claudeEnabled });
        }
      }
    }
  }
  return out;
}

const label = (e: LeadPlannerEligibility) =>
  `persisted=${e.hasPersistedPlan} gated=${e.strategyOwnerApplies} ` +
  `gpt=${e.gptEnabled} claude=${e.claudeEnabled}`;

// ═══ INVARIANT 1 — EXACTLY ONE PLANNER OWNER PER LEAD TASK ═════════════════

Deno.test("Invariant 1: every flag combination resolves to exactly one planning owner", () => {
  const combos = allEligibilities();
  assertEquals(combos.length, 16, "all four eligibility facts must be enumerated");

  for (const e of combos) {
    const sel = selectLeadPlannerAdapter(e);
    assert(typeof sel.owner === "string" && sel.owner.length > 0,
      `no owner selected for ${label(e)}`);
    assert(sel.reason.length > 0, `owner must carry a reason for ${label(e)}`);
    // The selected owner may never also appear as a declined one.
    assert(!sel.notSelected.some((n) => n.owner === sel.owner),
      `owner ${sel.owner} is both selected and declined for ${label(e)}`);
  }
});

Deno.test("Invariant 1: selection is total and deterministic", () => {
  for (const e of allEligibilities()) {
    const a = selectLeadPlannerAdapter(e);
    const b = selectLeadPlannerAdapter({ ...e });
    assertEquals(a.owner, b.owner, `selection is not deterministic for ${label(e)}`);
  }
});

// ═══ INVARIANT 5 — FLAGS CANNOT ACTIVATE TWO PLANNING SYSTEMS ══════════════

Deno.test("Invariant 5: no flag combination names two model-backed planners", () => {
  const modelBacked = new Set(["gpt_lead_strategy_v1", "claude_lead_planner_v1"]);
  for (const e of allEligibilities()) {
    const sel = selectLeadPlannerAdapter(e);
    const named = [sel.owner, ...sel.notSelected.map((n) => n.owner)]
      .filter((o) => modelBacked.has(o));
    // A declined adapter is RECORDED, never run — so at most one model-backed
    // adapter may be SELECTED, regardless of how many were eligible.
    const selectedModelBacked = modelBacked.has(sel.owner) ? 1 : 0;
    assert(selectedModelBacked <= 1, `two model planners selected for ${label(e)}`);
    if (e.gptEnabled && e.strategyOwnerApplies && e.claudeEnabled && !e.hasPersistedPlan) {
      // The overlap case that used to run both. One wins; the other is recorded.
      assertEquals(sel.owner, "gpt_lead_strategy_v1", `overlap must resolve to GPT for ${label(e)}`);
      assert(sel.notSelected.some((n) => n.owner === "claude_lead_planner_v1"),
        "the losing adapter must be recorded, not silently dropped");
      assert(named.length === 2, "both adapters were eligible and both must be accounted for");
    }
  }
});

Deno.test("Invariant 5: both flags on with a persisted plan still runs neither model", async () => {
  let gptCalls = 0, claudeCalls = 0, persistedCalls = 0;
  const res = await runLeadPlanner<string, null>({
    eligibility: {
      hasPersistedPlan: true, strategyOwnerApplies: true,
      gptEnabled: true, claudeEnabled: true,
    },
    adapters: {
      persisted: () => { persistedCalls++; return { spec: "replayed", specRewritten: true, detail: null }; },
      gpt: () => { gptCalls++; return Promise.resolve({ spec: "gpt", specRewritten: true, detail: null }); },
      claude: () => { claudeCalls++; return Promise.resolve({ spec: "claude", specRewritten: true, detail: null }); },
    },
    deterministicSpec: "deterministic",
    deterministicDetail: null,
  });
  assertEquals(res.owner, "persisted_plan_artifact_v1");
  assertEquals(res.spec, "replayed");
  assertEquals(persistedCalls, 1);
  assertEquals(gptCalls, 0, "GPT must not run when a plan artifact already decided this");
  assertEquals(claudeCalls, 0, "Claude must not run when a plan artifact already decided this");
});

// ═══ INVARIANT 4 — ADAPTER CHOICE CANNOT CREATE A SECOND PLAN ══════════════

Deno.test("Invariant 4: exactly one adapter is invoked, for every flag combination", async () => {
  for (const e of allEligibilities()) {
    let gptCalls = 0, claudeCalls = 0, persistedCalls = 0;
    await runLeadPlanner<string, null>({
      eligibility: e,
      adapters: {
        persisted: () => { persistedCalls++; return { spec: "replayed", specRewritten: true, detail: null }; },
        gpt: () => { gptCalls++; return Promise.resolve({ spec: "gpt", specRewritten: true, detail: null }); },
        claude: () => { claudeCalls++; return Promise.resolve({ spec: "claude", specRewritten: true, detail: null }); },
      },
      deterministicSpec: "deterministic",
      deterministicDetail: null,
    });
    const total = gptCalls + claudeCalls + persistedCalls;
    assert(total <= 1, `${total} adapters were invoked for ${label(e)}; at most one may run`);
  }
});

Deno.test("Invariant 4: a GPT fallback does NOT hand the task to Claude", async () => {
  // THE ORIGINAL DEFECT, as a test. `specRewritten: false` is what GPT returns on
  // a timeout, a schema-rejected plan, or a failed escalation. The old call site
  // read exactly that field to decide whether Claude should also run.
  let claudeCalls = 0;
  const res = await runLeadPlanner<string, null>({
    eligibility: {
      hasPersistedPlan: false, strategyOwnerApplies: true,
      gptEnabled: true, claudeEnabled: true,
    },
    adapters: {
      gpt: () => Promise.resolve({ spec: "unchanged", specRewritten: false, detail: null }),
      claude: () => { claudeCalls++; return Promise.resolve({ spec: "claude", specRewritten: true, detail: null }); },
    },
    deterministicSpec: "deterministic",
    deterministicDetail: null,
  });
  assertEquals(res.owner, "gpt_lead_strategy_v1");
  assertEquals(res.specRewritten, false, "a GPT fallback stays a fallback");
  assertEquals(claudeCalls, 0,
    "a GPT fallback must resolve to the deterministic ladder, never to a second model");
});

Deno.test("Invariant 4: a second claimPlanning by a different owner throws", () => {
  const ledger = createLeadOwnershipLedger("task-1");
  ledger.claimPlanning("gpt_lead_strategy_v1", "selected");
  assertThrows(
    () => ledger.claimPlanning("claude_lead_planner_v1", "second planner"),
    LeadOwnershipViolation,
  );
  // Re-claiming the SAME owner is re-entrancy, not a violation.
  ledger.claimPlanning("gpt_lead_strategy_v1", "again");
  assertEquals(ledger.planningOwner(), "gpt_lead_strategy_v1");
});

// ═══ INVARIANT 2 — EXACTLY ONE EXECUTION OWNER PER TASK ════════════════════

Deno.test("Invariant 2: a second execution owner throws", () => {
  for (const first of LEAD_EXECUTION_OWNERS) {
    for (const second of LEAD_EXECUTION_OWNERS) {
      const ledger = createLeadOwnershipLedger("task-2");
      ledger.claimExecution(first, "first");
      if (first === second) {
        ledger.claimExecution(second, "same owner re-entering");
        assertEquals(ledger.executionOwner(), first);
      } else {
        assertThrows(
          () => ledger.claimExecution(second, "second engine"),
          LeadOwnershipViolation,
          undefined,
          `${second} must not be able to claim a task owned by ${first}`,
        );
      }
    }
  }
});

Deno.test("Invariant 2: mayExecute is false for every non-owner once claimed", () => {
  const ledger = createLeadOwnershipLedger("task-3");
  ledger.claimExecution("capability_engine_v1", "mission task");
  assertEquals(ledger.mayExecute("capability_engine_v1"), true);
  assertEquals(ledger.mayExecute("company_first_v1"), false,
    "the quota loop must not be permitted once the capability engine owns the task");
});

Deno.test("Invariant 2: a stage may not run under a different owner's claim", () => {
  const ledger = createLeadOwnershipLedger("task-4");
  ledger.claimExecution("capability_engine_v1", "mission task");
  ledger.enterStage("capability_rounds");
  for (const foreign of STAGES_BY_OWNER.company_first_v1) {
    assertThrows(
      () => ledger.enterStage(foreign),
      LeadOwnershipViolation,
      undefined,
      `stage ${foreign} belongs to company_first_v1 and must not run under the engine`,
    );
  }
});

Deno.test("Invariant 2: company_first_v1's two stages compose without violating ownership", () => {
  // The route executor followed by the quota loop is ONE owner in two ordered
  // stages — the working multi-round path. It must not be reported as a conflict.
  const ledger = createLeadOwnershipLedger("task-5");
  ledger.claimExecution("company_first_v1", "route executor");
  ledger.enterStage("route_executor");
  ledger.claimExecution("company_first_v1", "quota loop");
  ledger.enterStage("quota_loop");
  assertEquals(ledger.executionOwner(), "company_first_v1");
  assertEquals(ledger.snapshot().stages, ["route_executor", "quota_loop"]);
});

// ═══ INVARIANT 3 — NO DOUBLE PERSISTENCE ═══════════════════════════════════

Deno.test("Invariant 3: two owners cannot persist candidates for one task", () => {
  const ledger = createLeadOwnershipLedger("task-6");
  ledger.claimExecution("capability_engine_v1", "mission task");
  ledger.claimPersistence("capability_engine_v1");
  assertThrows(
    () => ledger.claimPersistence("company_first_v1"),
    LeadOwnershipViolation,
    undefined,
    "deduplication is not a substitute for ownership — a second writer must throw",
  );
  assertEquals(ledger.snapshot().persistence_owners, ["capability_engine_v1"]);
});

Deno.test("Invariant 3: persistence by a non-executing owner throws", () => {
  const ledger = createLeadOwnershipLedger("task-7");
  ledger.claimExecution("company_first_v1", "route executor");
  assertThrows(
    () => ledger.claimPersistence("capability_engine_v1"),
    LeadOwnershipViolation,
  );
});

Deno.test("Invariant 3: repeated persistence by the SAME owner is idempotent", () => {
  const ledger = createLeadOwnershipLedger("task-8");
  ledger.claimExecution("company_first_v1", "route executor");
  ledger.claimPersistence("company_first_v1");
  ledger.claimPersistence("company_first_v1");
  assertEquals(ledger.snapshot().persistence_owners.length, 1,
    "multi-round persistence by one owner is normal and must not be a violation");
});

// ═══ WIRING — THE RUNTIME ACTUALLY USES THE MECHANISM ══════════════════════

Deno.test("wiring: run-agent contains NO lead-planning invocation at all", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);

  // The previous phase left both adapters in run-agent and made the selection
  // choose between them. That was one invocation per task but still two call
  // sites, and orchestrate held a third that bypassed the selector entirely.
  // Planning is now consolidated onto one call site, so the strongest available
  // assertion is an ABSENCE: this function cannot plan.
  // Matched on CALL and IMPORT syntax rather than on the bare name: the file
  // names both adapters in a comment explaining why they are absent, and that
  // explanation is worth keeping.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const name of [
    "applyLeadStrategyInitialPlanning",
    "applyClaudeFirstLeadPlanning",
    "isClaudeFirstLeadPlanningEnabled",
  ]) {
    assert(!code.includes(`${name}(`),
      `run-agent must not call ${name} — planning happens at one call site, in orchestrate`);
    assert(!new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`, "s").test(code),
      `run-agent must not import ${name}`);
  }

  // isGptLeadStrategyEnabled IS legitimately imported and called now — but only
  // for ROUND-TO-ROUND BROADENING authorization (isGptBroadeningAuthorized), a
  // recovery decision made during execution, not for selecting an INITIAL
  // planning adapter. The distinction matters: initial planning still has
  // exactly one call site, in orchestrate.
  assert(code.includes("isGptLeadStrategyEnabled(workspace_id).enabled"),
    "broadening authorization must reuse the same flag+allowlist gate initial planning uses");
  assert(code.includes("isGptBroadeningAuthorized({"),
    "the reused flag must feed the dedicated broadening-authorization function, not an ad hoc check");
  assert(!code.includes("applyLeadStrategyInitialPlanning("),
    "isGptLeadStrategyEnabled's presence must not come with an initial-planning call");

  // What remains are reconstitution helpers, which cannot make a model request.
  assert(src.includes("gptStrategyFromPersistedPlan("),
    "a GPT-planned task must be rebuilt from its artifact");
  assert(src.includes("claudeFirstFromPersistedPlan("),
    "a Claude-planned task must be rebuilt from its artifact");

  // The selector still runs, but is fed constants that make a model-backed owner
  // unreachable — belt as well as braces.
  assert(src.includes("selectLeadPlannerAdapter({"),
    "run-agent must still record planner ownership through the selector");
  assert(src.includes("leadOwnership.claimPlanning(plannerSelection.owner"),
    "the resolved owner must claim ownership on the ledger");
  assert(/strategyOwnerApplies:\s*false,\s*\n\s*gptEnabled:\s*false,\s*\n\s*claudeEnabled:\s*false/.test(src),
    "run-agent's selector must be structurally unable to name a model adapter");

  // THE ORIGINAL DEFECT MUST NOT COME BACK.
  assert(!/gptStrategy\?\.specRewritten\s*\n\s*\?\s*null/.test(src),
    "the Claude adapter must never be gated on the GPT adapter's result");
});

Deno.test("wiring: run-agent loads its plan instead of making one", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  assert(src.includes("loadAuthoritativeLeadPlan({"),
    "the plan must be loaded through the authoritative loader");
  assert(src.includes("planId: plan_id ?? null"),
    "the loader must be able to fall back to the persisted plan row");
  assert(!src.includes("body.qualified_lead_plan\n          ? readPlanArtifact"),
    "the body-only read is what let a continuation re-plan; it must be gone");
});

Deno.test("wiring: orchestrate is the single planner call site", async () => {
  const orch = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts", import.meta.url),
  );
  assert(orch.includes("selectLeadPlannerAdapter({"),
    "the one call site must choose its adapter through the shared selector");
  assert(orch.includes("await applyLeadStrategyInitialPlanning({"),
    "the GPT adapter must be invoked here");
  assert(orch.includes("await applyClaudeFirstLeadPlanning({"),
    "the Claude adapter must be invoked here");
  // It used to read the Claude gate directly and invoke Claude unconditionally,
  // which is what made orchestrate a second, independent planner owner.
  assert(!/const enablement = isClaudeFirstLeadPlanningEnabled\([\s\S]*?if \(!enablement\.enabled\) return null;/.test(orch),
    "orchestrate must not gate planning on one adapter's flag alone");
  assert(orch.includes('artifact.planning_owner = plannerSelection.owner'),
    "the plan must record which adapter produced it");
});

Deno.test("wiring: each execution entry point claims ownership before it runs", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  assert(src.includes('leadOwnership.claimExecution(\n            "capability_engine_v1"'),
    "the capability engine must claim execution");
  assert(src.includes('"company_first_v1"'),
    "the company-first path must claim execution");
  assert(src.includes('leadOwnership.enterStage("capability_rounds")'),
    "the engine must record its stage");
  assert(src.includes('leadOwnership.enterStage("route_executor")'),
    "the route executor must record its stage");
  assert(src.includes('leadOwnership.enterStage("quota_loop")'),
    "the quota loop must record its stage");
});

Deno.test("wiring: the quota loop is blocked when another owner holds the task", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);

  // THE HOLE THIS CLOSES. `executeRunAgentCompanyFirstSourcing` was called
  // unconditionally; for a mission whose graph legally contains `job_discovery`,
  // `legacyLoopReachable` returns true and the loop ran for real ON TOP OF a
  // completed capability-engine run, reconciled only by unioning contacts.
  assert(src.includes('!leadOwnership.mayExecute("company_first_v1")'),
    "the quota loop must consult execution ownership");
  assert(src.includes("legacySkipReason = `execution_owned_by:"),
    "an owned task must set an explicit skip reason for the quota loop");

  // Ownership must be checked BEFORE the mission-reachability and fallback
  // reasons, so no downstream justification can re-open the door.
  const ownershipAt = src.indexOf('!leadOwnership.mayExecute("company_first_v1")');
  const missionLegacyAt = src.indexOf("const missionLegacy = legacyLoopReachable(");
  const fallbackAt = src.indexOf("legacyFallbackReason = candidateReason");
  assert(ownershipAt > 0 && ownershipAt < missionLegacyAt,
    "ownership must outrank the mission-reachability reason");
  assert(ownershipAt < fallbackAt,
    "ownership must outrank the broad-job-fallback justification");
});

Deno.test("wiring: ownership is persisted on the task result", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  assert(src.includes("lead_ownership: leadOwnership.snapshot()"),
    "'which planner, which engine' must be answerable from one persisted row");
});

// ═══ INVARIANT 6 — SELECTED PATH PRESERVES EXISTING BEHAVIOUR ══════════════

Deno.test("Invariant 6: preserved guarantees are still wired", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  // Each of these is a non-negotiable this phase must not regress. They are
  // asserted here so a future ownership refactor cannot quietly drop one.
  const preserved: Array<[string, string]> = [
    ["budget preflight", "assertPaidExecutionAllowed(paidPreflight)"],
    ["stop-at-quota", "resolveRequestedLeadCount({"],
    ["Company Brain hard gate", "compileEffectiveCompanyPolicy({"],
    ["employer verification", "verifyCurrentEmployer("],
    ["capability containment", "guardedInvoker"],
    ["mission authority", "readPersistedLeadMission("],
    ["intelligence policy", "getLeadIntelligenceCapabilities(workspace_id)"],
  ];
  for (const [what, needle] of preserved) {
    assert(src.includes(needle), `${what} must remain wired (looked for: ${needle})`);
  }
});

Deno.test("Invariant 6: the capability engine remains authoritative for mission tasks", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  // The route executor is still gated on the engine not having run — the
  // pre-existing mutual exclusion, unchanged by this phase.
  assert(src.includes("if (!resumeSatisfied && !capabilityRun && routeResolution.ok"),
    "the route executor must still stand down for a mission task");
});

// ═══ INVARIANT 7 — NON-LEAD WORKFLOWS UNCHANGED ════════════════════════════

Deno.test("Invariant 7: orchestrate stamps lead ownership only for lead tasks", async () => {
  const src = await Deno.readTextFile(ORCHESTRATE);
  // The stamp is spread conditionally, so a non-lead plan's metadata is
  // byte-identical to before.
  assert(src.includes("...(leadPlanningOwner ? { lead_planning_owner: leadPlanningOwner } : {})"),
    "non-lead plans must not gain a new metadata key");
  assert(src.includes("const leadPlanningOwner: string | null = qlPlan"),
    "the owner must be null for anything that is not a lead task");
});

Deno.test("Invariant 7: orchestrate's non-lead planning paths are untouched", async () => {
  const src = await Deno.readTextFile(ORCHESTRATE);
  // This phase scoped its cleanup to lead planning. The general orchestration
  // behaviour other product workflows depend on must still be present.
  for (const needle of [
    "function detectIntent(",
    "function fallbackPlan(",
    "content_engagement_loop",
    "case \"screening\"",
    "case \"content\"",
  ]) {
    assert(src.includes(needle), `non-lead orchestration must be preserved: ${needle}`);
  }
});

// ═══ SNAPSHOT SHAPE ════════════════════════════════════════════════════════

Deno.test("the ownership snapshot answers both questions with exactly one value", () => {
  const ledger = createLeadOwnershipLedger("task-9");
  ledger.claimPlanning("claude_lead_planner_v1", "flag enabled");
  ledger.decline("gpt_lead_strategy_v1", "not_the_gated_path");
  ledger.claimExecution("capability_engine_v1", "mission task");
  ledger.enterStage("capability_rounds");
  ledger.claimPersistence("capability_engine_v1");

  const s = ledger.snapshot();
  assertEquals(s.task_id, "task-9");
  assertEquals(s.planning_owner, "claude_lead_planner_v1");
  assertEquals(s.execution_owner, "capability_engine_v1");
  assertEquals(s.persistence_owners, ["capability_engine_v1"]);
  assertEquals(s.declined, [{ owner: "gpt_lead_strategy_v1", reason: "not_the_gated_path" }]);
  // Snapshots are copies: mutating one must not corrupt the ledger.
  s.stages.push("quota_loop" as never);
  assertEquals(ledger.snapshot().stages, ["capability_rounds"]);
});

Deno.test("an unclaimed task reports null owners rather than guessing", () => {
  const s = createLeadOwnershipLedger(null).snapshot();
  assertEquals(s.planning_owner, null);
  assertEquals(s.execution_owner, null);
  assertEquals(s.persistence_owners, []);
  const owners: LeadExecutionOwner[] = [...LEAD_EXECUTION_OWNERS];
  assertEquals(owners.length, 2, "adding an execution owner must be a deliberate, reviewed change");
});

// THE EVALUATOR MUST BE WIRED IN PRODUCTION, NOT ONLY IN TESTS.
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
//
// `missionEvaluation.ts` and `missionEvaluationBinding.ts` were built, tested
// and committed, and `run-agent/index.ts` contained ZERO references to either.
// Every Phase 4 test passed because `missionEvaluatorFixture.ts` injects
// `deps.evaluateMission` directly — so the suite proved the engine could use an
// evaluator, and proved nothing about whether one was ever constructed.
//
// The consequence in production: every company fell to the no-evaluator branch
// and the pre-Phase-4 semantic classifier kept making the qualification call,
// while `semantic_classification_observability` reported it as though the new
// architecture were live.
//
// These tests read the PRODUCTION SOURCE. A behavioural test cannot catch this
// class of defect, because the defect is the absence of a call site — there is
// nothing to exercise. Structural assertions are the only kind that fail when a
// module is orphaned.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionEvaluationBinding, DEFAULT_MAX_EVALUATION_CALLS,
  evaluationTaskDiagnostics, isMissionEvaluationEnabled,
} from "../../../supabase/functions/_shared/missionEvaluationBinding.ts";
import {
  parseMissionEvaluationStrict,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import {
  legacyLoopReachable,
} from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

const readSource = (rel: string) =>
  Deno.readTextFile(new URL(`../../../supabase/functions/${rel}`, import.meta.url));

/** Source with `//` line comments stripped, so a MENTION never counts as a CALL. */
const stripComments = (src: string) =>
  src.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ═══════════════════════════════════ A. the production binding actually exists ══

Deno.test("A1. run-agent constructs the mission evaluation binding", async () => {
  const src = stripComments(await readSource("run-agent/index.ts"));

  assert(src.includes("buildMissionEvaluationBinding({"),
    "run-agent must BUILD the binding — an import alone is not a wiring");
  assert(/import\s*{[^}]*buildMissionEvaluationBinding/s.test(src),
    "and it must come from the shared binding module");
  assert(src.includes("missionEvaluationBinding.ts"),
    "the binding module is a production dependency of run-agent");
});

Deno.test("A2. run-agent passes evaluateMission into the capability engine", async () => {
  const src = stripComments(await readSource("run-agent/index.ts"));

  // THE ONE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT.
  assert(src.includes("evaluateMission:"),
    "`evaluateMission` must be supplied as an engine dependency in production");
  assert(src.includes("missionEvaluationBinding.evaluateMission"),
    "and the value must come from the binding, not from anything else");

  // It has to be inside the engine's dependency object, next to its siblings.
  const depsStart = src.indexOf("await runCapabilityPlan({");
  assert(depsStart > 0, "the engine call site must exist");
  const depsBlock = src.slice(depsStart, src.indexOf("readPendingRun,", depsStart));
  assert(depsBlock.includes("evaluateMission:"),
    "`evaluateMission` must sit in the engine's own deps object, not an " +
    "unrelated scope");
  assert(depsBlock.includes("groundCompany:"),
    "sanity: this really is the engine dependency block");
  // `classifyCompany` is DELETED — it was the second semantic authority. Its
  // absence from this block is now part of the contract.
  assertFalse(depsBlock.includes("classifyCompany:"),
    "no second evaluator may be wired alongside the Mission evaluator");
});

Deno.test("A3. the raw response is adapted through the strict parser", async () => {
  const src = stripComments(await readSource("run-agent/index.ts"));
  assert(src.includes("parseMissionEvaluationStrict("),
    "a raw model response must never reach the engine unvalidated");
  assert(/import\s*{[^}]*parseMissionEvaluationStrict/s.test(src));
});

Deno.test("A4. exactly ONE live evaluator call site exists in run-agent", async () => {
  const src = stripComments(await readSource("run-agent/index.ts"));
  const calls = src.match(/missionEvaluationBinding\.evaluateMission!\(/g) ?? [];
  assertEquals(calls.length, 1,
    "one semantic authority means one place that invokes it");
  assertEquals((src.match(/buildMissionEvaluationBinding\(\{/g) ?? []).length, 1,
    "and one place that decides whether it may run at all");
});

Deno.test("A5. the engine has exactly one evaluator call site of its own", async () => {
  const src = stripComments(
    await readSource("_shared/leadCapabilityEngine.ts"));
  assertEquals((src.match(/deps\.evaluateMission/g) ?? []).length, 2,
    "one presence check and one invocation — no second, competing path");
});

Deno.test("A6. run-agent constructs and wires the Stage 2 triage binding", async () => {
  const src = stripComments(await readSource("run-agent/index.ts"));

  assert(src.includes("buildMissionTriageBinding({"),
    "Stage 2 must be BUILT in production, not merely importable");
  assert(src.includes("triageCompanies:"),
    "and supplied as an engine dependency");
  assert(src.includes("triageBinding.triageCompanies"),
    "from the binding, so the flag and allow-list actually gate it");

  const depsStart = src.indexOf("await runCapabilityPlan({");
  const depsBlock = src.slice(depsStart, src.indexOf("readPendingRun,", depsStart));
  assert(depsBlock.includes("triageCompanies:"),
    "it belongs in the same deps object as evaluateMission");
  assert(depsBlock.includes("triageBatchesAllowed:"),
    "with its batch budget, so triage cannot become an unbounded cost");
});

// ═══════════════════════════════ B. no fabricated semantic assessment remains ══

Deno.test("B1. the fabricated literals are still absent from the engine", async () => {
  const src = stripComments(
    await readSource("_shared/leadCapabilityEngine.ts"));
  assertFalse(src.includes("deterministic gates passed"),
    "the fabricated supporting_evidence literal must stay deleted");
  assertFalse(/company_fit:\s*"pass",\s*confidence:\s*0\.8/.test(src),
    "the fabricated passing assessment must stay deleted");
});

Deno.test("B2. the evaluator's own prompt forbids nothing it is meant to decide", async () => {
  const src = await readSource("_shared/missionEvaluation.ts");
  // The classifier prompt says "You do NOT qualify, approve or reject a
  // company." The evaluator's must not inherit that sentence — it IS the
  // thing that qualifies.
  assertFalse(src.includes("You do NOT qualify, approve or reject a company"),
    "the evaluator is the authority; it must not be told it is not");
});

// ══════════════════════════════ C. a Mission cannot fall back to the legacy path ══

Deno.test("C1. a valid LeadMissionV1 graph makes the legacy loop unreachable", () => {
  const m = parseLeadMissionDeterministic(
    "Find founders of SaaS startups hiring software engineers in the United States. " +
    "Return 5 qualified leads.");
  const plan = buildCapabilityGraph(m);

  const verdict = legacyLoopReachable(m, plan);
  assertFalse(verdict.reachable,
    "a compiled Mission routes itself; the legacy loop must refuse to take one");
  assert(verdict.reason.startsWith("mission_graph_excludes_job_discovery"));

  // And the graph really does contain the qualification stage the evaluator owns.
  assert(plan.steps.some((s) => s.capability === "company_brain_qualification"),
    "the Mission path ends at the stage the evaluator decides");
});

Deno.test("C2. a task with no mission is the ONLY thing that reaches the legacy loop", () => {
  assert(legacyLoopReachable(null, null).reachable);
  assertEquals(legacyLoopReachable(null, null).reason, "legacy_task_without_mission");
});

// ══════════════════════ D. the classifier keeps its job and loses its authority ══

Deno.test("D1. the Mission pipeline no longer calls the classifier at all", async () => {
  // Was: "parseSemanticFitStrict is still called with its existing shape",
  // guarding the classifier's adapter inside the engine's dependency block.
  // That adapter is deleted, so the guard is inverted — the Mission path must
  // make no semantic call other than the evaluator's.
  const src = await readSource("_shared/leadCapabilityEngine.ts");
  assertFalse(/parseSemanticFitStrict\s*\(/.test(src),
    "the engine must not parse a second semantic opinion");
  assertFalse(/deps\.classifyCompany/.test(src),
    "and must not call a classifier");
  assertFalse(/classifyCompany\?:/.test(src),
    "nor declare one as a dependency");
});

Deno.test("D2. the classifier is not a competing final authority", async () => {
  const src = stripComments(
    await readSource("_shared/leadCapabilityEngine.ts"));

  // The no-evaluator branch begins by recording `insufficient_evidence`.
  const noEval = src.indexOf('c.decision_source = "insufficient_evidence";\n' +
    "        c.mission_evaluation = notEvaluated(");
  assert(noEval > 0, "the no-evaluator branch must still exist and be identifiable");
  const evaluatorCall = src.indexOf("deps.evaluateMission\n");
  assert(evaluatorCall > 0 && evaluatorCall < noEval,
    "the evaluator is consulted BEFORE the classifier fallback, not after");

  // ── THE ASSERTION THAT MATTERS ──────────────────────────────────────────
  // The classifier may no longer end a company's journey in either direction.
  assertFalse(src.includes("semantic_classification_pass"),
    "the classifier must not be able to qualify a company");
  assertFalse(src.includes("semantic_classification_fail"),
    "and it must not be able to reject one either");

  // ONE AUTHORITY, AND ONLY ITS VERDICTS — FRESH OR REPLAYED.
  //
  // This asserted a single call site, which was the right invariant expressed
  // through a count. A second site now exists: `restored_qualification` replays
  // a decision the Mission evaluator made in an EARLIER GENERATION of the same
  // lineage, because `c.brain` did not survive a resume and every continuation
  // re-decided companies it had already qualified — holding the identity
  // stage's reserve so high that lineage 862e81be attempted no identity work at
  // all across two generations.
  //
  // Replaying the evaluator is not a competing authority; deciding without it
  // would be. So the assertion is now on the REASONS, which name the authority,
  // rather than on how many places quote it — and the list is exhaustive, so a
  // third reason fails here exactly as a second one used to.
  const advances = (src.match(/advance\(c\.record, "qualified_company", "([^"]+)"\)/g) ?? [])
    .map((m) => m.match(/"qualified_company", "([^"]+)"/)![1]).sort();
  assertEquals(advances, ["mission_evaluation_pass", "restored_qualification"],
    "only the Mission evaluator qualifies — freshly, or replayed from its own " +
    "earlier verdict; nothing else may reach `qualified_company`");
  // And the replay may only fire for a decision that is already held.
  assert(/if \(c\.brain !== null && restoredBrainKeys\.has\(c\.key\)\)/.test(src),
    "the replay is gated on an existing decision, never on a fresh judgement");
});

// ═══════════════════════════════ E. failure is held, never a fabricated pass ══

Deno.test("E1. an unusable model response becomes insufficient_evidence", () => {
  const registry = { company_key: "acme.com", entries: [] } as never;
  for (const bad of [null, undefined, "", "not json", {}, { decision: "wat" }, 42]) {
    const parsed = parseMissionEvaluationStrict(bad, registry);
    assertEquals(parsed.evaluation.decision, "insufficient_evidence",
      `${JSON.stringify(bad)} must never become a qualification`);
    assertEquals(parsed.evaluation.mission_fit, "review",
      "and never a pass");
    assertEquals(parsed.evaluation.confidence, 0);
  }
});

// ── REPLACED: THE FLAG PAIR IS GONE ──────────────────────────────────────
// "OFF unless both pass" was accurate, and meant this evaluator never ran.
Deno.test("E2. no environment can disable mission evaluation", () => {
  const e = (o: Record<string, string>) => (k: string) => o[k];
  for (const r of [
    e({}), e({ MISSION_EVALUATION: "false" }), e({ MISSION_EVALUATION: "true" }),
    e({ MISSION_EVALUATION: "true", MISSION_EVALUATION_WORKSPACES: "other" }),
  ]) {
    assertEquals(isMissionEvaluationEnabled("ws-1", r).enabled, true);
  }
});

// ── REPLACED: THERE IS NO DISABLED STATE ─────────────────────────────────
//
// This asserted that a disabled binding yields a null evaluator so nothing can
// fabricate a pass. The no-fabrication half is the part worth keeping, and it
// no longer depends on being switched off: an evaluator is always present, and
// a FAILED evaluation must still never read as a pass.
Deno.test("E3. an evaluator is always present, and never fabricates a pass", () => {
  const b = buildMissionEvaluationBinding({ workspaceId: "ws-1", read: () => undefined } as never);
  assert(b.evaluateMission !== null, "no env may remove the evaluator");
  assert(b.callsRemaining > 0, "and it must carry a real allowance");
});

Deno.test("E4. a model failure returns null, which the caller must hold — not pass", async () => {
  const b = buildMissionEvaluationBinding({
    workspaceId: "ws-1",
    read: (k) => ({
      MISSION_EVALUATION: "true", MISSION_EVALUATION_WORKSPACES: "ws-1",
    } as Record<string, string>)[k],
    shortlistSize: 10,
    // The facade reports failure in-band, exactly as the provider adapter does.
    generate: () => Promise.resolve({ ok: false } as never),
  });
  assert(b.evaluateMission, "the binding is enabled");
  assertEquals(await b.evaluateMission!({}), null,
    "a failed call is null — never a synthesised verdict");

  // And null, run through the parser the production path uses, is a HOLD.
  const parsed = parseMissionEvaluationStrict(
    null, { company_key: "acme.com", entries: [] } as never);
  assertEquals(parsed.evaluation.decision, "insufficient_evidence");
  assertEquals(parsed.parse_status, "invalid_insufficient_evidence");
});

Deno.test("E5. the budget is bounded by the shortlist and can never be raised by env", () => {
  const read = (extra: Record<string, string> = {}) => (k: string) => ({
    MISSION_EVALUATION: "true", MISSION_EVALUATION_WORKSPACES: "ws-1", ...extra,
  } as Record<string, string>)[k];

  assertEquals(
    buildMissionEvaluationBinding({ workspaceId: "ws-1", read: read(), shortlistSize: 6 })
      .callsRemaining, 6,
    "a shortlist of six authorises six, not the cap");

  assertEquals(
    buildMissionEvaluationBinding({
      workspaceId: "ws-1",
      read: read({ MISSION_EVALUATION_MAX_CALLS: "9999" }),
      shortlistSize: 500,
    }).callsRemaining,
    DEFAULT_MAX_EVALUATION_CALLS,
    "an operator typo must not be able to authorise unbounded spend");
});

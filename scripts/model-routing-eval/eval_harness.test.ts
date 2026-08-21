// THE HARNESS THAT DECIDES THE ROUTING MUST ITSELF BE CORRECT.
//
// An eval is a measuring instrument, and a broken one is worse than none — it
// produces a number that looks like evidence. Three of these tests exist because
// the first draft of this harness WAS broken and reported false findings against
// the incumbent:
//
//   test 6   `textuallySupported` stringified objects, so `required_signals` —
//            `[{type:"hiring"}]` — was tested by asking whether the request
//            contains "[object Object]". It flagged gpt-4.1 for the one
//            provenance label it had unambiguously got right, the user having
//            written the words "currently hiring".
//
//   test 9   the broadening check asked whether the request text contains the
//            words "company types". No request ever will, so it flagged the
//            incumbent for forbidding exactly the broadenings it should forbid.
//
//   test 12  the differ compared geography strings raw. gpt-4.1 wrote "United
//            States" on one run and "US" on the next, so the only two runs in
//            the history known to be equivalent compared as different.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gradeOf, isUngraded, MISSION_FIELD_IMPACT } from "./missionImpact.ts";
import { checkMissionInvariants, requestedCountIn } from "./invariants.ts";
import { compareMissions } from "./compare.ts";
import { scoreDiscoveryProposal, readPersistedDiscoveryScore } from "./discoveryScore.ts";
import { EVAL_CASES, harvestedCases, syntheticCases } from "./corpus.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import { authorizeRun, type HarvestedRun, outcomeVariance, scoreOffline } from "./run.ts";

const FIXTURE = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/anchor-runs.json", import.meta.url)),
);
const RUNS = FIXTURE.runs as HarvestedRun[];
const run = (id: string): HarvestedRun =>
  RUNS.find((r) => r.run_id === id) ?? (() => {
    throw new Error(`fixture has no run ${id}`);
  })();

/**
 * The harvested mission, typed.
 *
 * Cast rather than validated: this object came out of `tasks.result` verbatim
 * and IS a `LeadMissionV1` — it is the one the live run executed. Building a
 * hand-typed copy to satisfy the compiler would be a copy that could drift from
 * the thing being tested.
 */
const missionOf = (id: string) => run(id).mission as unknown as LeadMissionV1;

// ═══ 1. THE IMPACT PARTITION IS TIED TO THE SOURCE ═════════════════════════

Deno.test("1. every DIRECT field is one buildDiscoveryPlannerPayload actually reads", () => {
  // The partition's whole claim is that it was derived from code rather than
  // opinion. If that function stops reading a field, the grade is a lie and the
  // comparison silently starts weighting the wrong things.
  const src = Deno.readTextFileSync(new URL(
    "../../supabase/functions/_shared/leadDiscoveryStrategy.ts", import.meta.url));
  const payload = src.slice(
    src.indexOf("export function buildDiscoveryPlannerPayload"),
    src.indexOf("export function strategyActorKeys"),
  );
  assert(payload.length > 200, "the payload builder must still be findable");

  for (const f of MISSION_FIELD_IMPACT.filter((x) => x.grade === "direct")) {
    // Read as the leaf, because the builder destructures `company_profile`
    // into `p` and then names `p.locations`.
    const leaf = f.path.split(".").pop()!;
    assert(payload.includes(leaf),
      `\`${f.path}\` is graded DIRECT but buildDiscoveryPlannerPayload never names ${leaf}`);
  }
});

Deno.test("2. an untraced field grades GATING, never inert", () => {
  // The conservative direction for a cost question. A field nobody has traced
  // is a field nobody has cleared, and grading it inert would let a real
  // difference disappear into the noise column.
  assertEquals(gradeOf("some_field_invented_next_quarter"), "gating");
  assert(isUngraded("some_field_invented_next_quarter"));
  assert(!isUngraded("requested_count"));
});

Deno.test("3. a child inherits its parent's grade", () => {
  assertEquals(gradeOf("company_profile.locations"), "direct");
  assertEquals(gradeOf("company_profile.employee_range.min"), "direct");
  assertEquals(gradeOf("hard_constraints.geographies.value"), "gating");
});

Deno.test("4. a PROSE leaf is inert wherever it hangs", () => {
  // `hard_constraints.geographies.reason` is a sentence explaining a
  // constraint, not the constraint. Verified in missionQualificationContext:
  // the record is passed through whole and only its KEYS are diagnosed.
  assertEquals(gradeOf("hard_constraints.geographies.reason"), "inert");
  assertEquals(gradeOf("hard_constraints.geographies.value"), "gating",
    "the value beside it is still gating");
  assert(!isUngraded("hard_constraints.anything.reason"));
});

// ═══ 2. THE INVARIANTS NEED NO GOLDEN ANSWER ═══════════════════════════════

Deno.test("5. the count is read from the request, and ambiguity yields null", () => {
  assertEquals(requestedCountIn("Find 10 qualified AI startups in the US currently hiring"), 10);
  assertEquals(requestedCountIn("Get me ten healthtech companies"), 10);
  assertEquals(requestedCountIn("Find AI startups that are hiring"), null,
    "no count stated is not a count of zero, and must not become an expectation");
});

Deno.test("6. a provenance value nested in objects is found, not stringified", () => {
  // THE BUG. `[{type:"hiring"}]` was tested as "[object Object]".
  const r = checkMissionInvariants(
    "Find 10 qualified AI startups in the US currently hiring",
    {
      requested_count: 10,
      required_signals: [{ type: "hiring" }],
      field_provenance: { required_signals: "explicit_user_request" },
    },
  );
  assertEquals(
    r.violations.filter((v) => v.check === "provenance_claim_is_honest").length, 0,
    "the user wrote the words 'currently hiring'; that label is honest",
  );
});

Deno.test("7. a provenance claim with NO textual basis is caught", () => {
  const r = checkMissionInvariants(
    "Find 10 companies that are hiring",
    {
      requested_count: 10,
      company_profile: { locations: ["Germany"] },
      field_provenance: { "company_profile.locations": "explicit_user_request" },
    },
  );
  assert(
    r.violations.some((v) => v.check === "provenance_claim_is_honest"),
    "the request names no country; calling Germany explicit makes the audit trail lie",
  );
  assert(!r.passed, "a dishonest provenance label is major, and majors fail");
});

Deno.test("8. an ENUM-valued provenance claim is skipped and SAID to be skipped", () => {
  // `target_entity: "company"` cannot be found by searching a request that says
  // "startups". Containment is a fair test only where the value is the user's
  // own vocabulary; here the model is classifying, not quoting.
  const r = checkMissionInvariants(
    "Find 10 qualified AI startups in the US currently hiring",
    {
      requested_count: 10,
      target_entity: "company",
      // Present because the request says "currently hiring" and check 6
      // requires it. Omitting it made the first version of this test fail on a
      // FATAL from a different check — the checker was right and the fixture
      // was incomplete.
      required_signals: [{ type: "hiring" }],
      field_provenance: { target_entity: "explicit_user_request" },
    },
  );
  assertEquals(r.violations.length, 0);
  assertEquals(r.provenance_paths_not_testable, ["target_entity"],
    "reported, so its absence from violations is not misread as checked-and-cleared");
});

Deno.test("9. a broadening ban is judged against the MISSION, not the request text", () => {
  const backed = checkMissionInvariants(
    "Find 10 AI startups in the US currently hiring",
    {
      requested_count: 10,
      company_profile: { locations: ["United States"], verticals: ["AI"] },
      required_signals: [{ type: "hiring" }],
      directives: { disallowed_broadening: ["geographies", "company_types", "hiring"] },
    },
  );
  assertEquals(
    backed.violations.filter((v) => v.check === "broadening_ban_has_a_constraint").length, 0,
    "each ban protects a constraint the mission actually holds",
  );

  const unbacked = checkMissionInvariants(
    "Find 20 companies hiring senior backend engineers",
    {
      requested_count: 20,
      company_profile: { locations: [], verticals: [] },
      required_signals: [{ type: "hiring" }],
      directives: { disallowed_broadening: ["geographies"] },
    },
  );
  assert(
    unbacked.violations.some((v) => v.check === "broadening_ban_has_a_constraint"),
    "forbidding a widening the mission has no constraint on protects nothing " +
    "and costs a short run a legal route to quota",
  );
});

Deno.test("10. an uncanonical signal type is FATAL", () => {
  const r = checkMissionInvariants("Find 5 companies that are hiring", {
    requested_count: 5,
    required_signals: [{ type: "actively_recruiting" }],
  });
  assert(r.violations.some((v) => v.check === "signal_type_is_canonical"));
  assert(!r.passed, "a signal outside the vocabulary matches no actor and no predicate");
});

Deno.test("11. a miscompiled count is FATAL and lands on a DIRECT field", () => {
  const r = checkMissionInvariants("Find 10 AI startups", { requested_count: 100 });
  const v = r.violations.find((x) => x.check === "requested_count_matches_request");
  assertEquals(v?.severity, "fatal");
  assertEquals(v?.grade, "direct", "this is the field that sizes every purchase");
});

// ═══ 3. THE DIFFER COMPARES THE WAY THE CONSUMER DOES ══════════════════════

Deno.test("12. geography spellings the pipeline normalises are NOT a difference", () => {
  // THE BUG. Verified against locationMatch.normalizeCountry, which maps all of
  // these to "US".
  const r = compareMissions(
    { hard_constraints: { geographies: { value: "United States" } } },
    { hard_constraints: { geographies: { value: "US" } } },
  );
  assertEquals(r.counts.gating, 0);
  assert(r.cost_equivalent);
});

Deno.test("13. a REAL geography difference still is one", () => {
  const r = compareMissions(
    { company_profile: { locations: ["United States"] } },
    { company_profile: { locations: ["Germany"] } },
  );
  assertEquals(r.counts.direct, 1, "normalising must not hide a different country");
  assert(!r.cost_equivalent);
});

Deno.test("14. list ORDER is not a difference; list CONTENT is", () => {
  const same = compareMissions(
    { company_profile: { verticals: ["AI", "startup"] } },
    { company_profile: { verticals: ["startup", "AI"] } },
  );
  assertEquals(same.differences.length, 0, "these are read as sets downstream");

  const differs = compareMissions(
    { company_profile: { verticals: ["AI"] } },
    { company_profile: { verticals: ["AI", "fintech"] } },
  );
  assertEquals(differs.counts.direct, 1);
});

Deno.test("15. fields no model authors never enter a comparison", () => {
  const r = compareMissions(
    { planner_runtime: { git_sha: "aaa" }, version: "v1", requested_count: 10 },
    { planner_runtime: { git_sha: "bbb" }, version: "v2", requested_count: 10 },
  );
  assertEquals(r.differences.length, 0,
    "a build stamp differing is not a model difference, and would put a " +
    "permanent floor under every diff");
});

Deno.test("16. prose differs without costing anything", () => {
  const r = compareMissions(
    { directives: { evaluation_instructions: "Qualify only AI startups in the US." } },
    { directives: { evaluation_instructions: "Only qualify US-based AI startups." } },
  );
  assertEquals(r.counts.inert, 1);
  assert(r.cost_equivalent, "two phrasings buy identical provider work");
});

// ═══ 4. THE DISCOVERY SCORE, WHICH IS THE COST NUMBER ══════════════════════

Deno.test("17. the incumbent's real proposal needed a repair — and this says so", () => {
  // Harvested verbatim from run 4fe98f5c. gpt-4.1 put `maxItems` on an actor
  // whose schema has no such field. The validator repaired it, which is the
  // architecture working — but a repair is a SECOND reasoning-tier model call,
  // and that is the mechanism by which a cheap planner stops being cheap.
  const s = readPersistedDiscoveryScore(run("4fe98f5c").discovery);
  assertEquals(s.needed_repair, true);
  assertEquals(s.dropped_filters, 1);
  assertEquals(s.clean, false);
  assert(s.violations.some((v) => v.code === "filter_dropped"));
});

Deno.test("18. a proposal naming an actor that does not exist is BLOCKED, not clean", () => {
  const s = scoreDiscoveryProposal(
    [{ actor_key: "apify_nonexistent_actor", role: "primary", input: {} }],
    missionOf("4fe98f5c"),
  );
  assertEquals(s.usable_actors, 0);
  assertEquals(s.blocked, true);
  assertEquals(s.clean, false, "a run with nothing to buy is not a clean proposal");
});

Deno.test("19. a proposal of the WRONG SHAPE is scored, not thrown", () => {
  // A cheap model returning prose instead of a list is a result the harness
  // must be able to report. Crashing on it would lose the finding.
  for (const junk of [null, "not a list", { actors: [] }, 42]) {
    const s = scoreDiscoveryProposal(junk, missionOf("4fe98f5c"));
    assertEquals(s.blocked, true, `${JSON.stringify(junk)} must score as blocked`);
    assertEquals(s.clean, false);
  }
});

Deno.test("20. a validated strategy is NOT re-run through the validator", () => {
  // The persisted object is post-validation: its illegal filter has already
  // been stripped. Feeding it back through would report CLEAN for a run that
  // actually needed a repair — reading the fix as if it were the proposal.
  const persisted = run("4fe98f5c").discovery;
  assertEquals(readPersistedDiscoveryScore(persisted).needed_repair, true,
    "read from the validator's own recorded verdict, not recomputed");
  assertEquals(persisted.source, "model_repaired", "which the fixture records verbatim");
});

// ═══ 5. THE CORPUS IS HONEST ABOUT WHAT IT IS ══════════════════════════════

Deno.test("21. every case declares its provenance, and most are SYNTHETIC", () => {
  for (const c of EVAL_CASES) {
    assert(c.probes.length > 20, `${c.id} must say what it probes`);
    assert(c.grounding.length > 20, `${c.id} must say where the failure was observed`);
  }
  assertEquals(harvestedCases().length, 1);
  assert(syntheticCases().length >= 5);
  // The fact the plan was rewritten around: the persisted history holds ONE
  // distinct request, so there was no corpus to harvest.
  assertEquals(
    new Set(harvestedCases().map((c) => c.request)).size, 1,
    "if a second real request ever lands, harvest it and shrink the synthetic half",
  );
});

Deno.test("22. only HARVESTED cases carry a reference outcome", () => {
  for (const c of syntheticCases()) {
    assertEquals(c.reference, undefined,
      `${c.id} is synthetic; giving it a reference outcome would dress an ` +
      "invention up as ground truth");
  }
  assertEquals(harvestedCases()[0].reference?.qualified, 10);
});

Deno.test("23. a synthetic case is LISTED unscored, never scored as a pass", () => {
  const results = scoreOffline(RUNS);
  for (const r of results.filter((x) => x.provenance === "synthetic")) {
    assertEquals(r.invariants, null, "an empty score would read as a pass");
    assert(r.note.includes("--live"), "and it must say what would score it");
  }
  const anchor = results.find((r) => r.provenance === "harvested")!;
  assert(anchor.invariants !== null, "the harvested case has a real output to score");
});

// ═══ 6. THE FINDING THE HARNESS WAS BUILT TO ESTABLISH ═════════════════════

Deno.test("24. the two 10/10 missions buy the same thing", () => {
  const r = compareMissions(run("3a231901").mission, run("4fe98f5c").mission);
  assertEquals(r.counts.direct, 0, "nothing that decides the purchase differs");
  assert(r.cost_equivalent);
});

Deno.test("25. THE NOISE FLOOR: same purchase, 2.4x the identity misses", () => {
  // Why this harness scores model OUTPUT rather than lead counts. Two runs of
  // one mission that buys one thing, three hours apart, on one model:
  //   3a231901   10 qualified,  5 identity_unresolved,  9 cost units
  //   4fe98f5c   10 qualified, 12 identity_unresolved, 17 cost units
  // An A/B at one run per arm would read that spread as a model difference.
  const v = outcomeVariance(RUNS);
  assert(v.cost_equivalent_missions, "the premise: the input did not change");
  assertEquals(v.qualified, [10, 10], "the headline metric is stable");
  const spread = Math.max(...v.identity_unresolved) - Math.min(...v.identity_unresolved);
  assert(spread >= 7,
    `identity_unresolved spread is ${spread}; a model comparison must clear it`);
  assert(v.verdict.includes("provider variance"));
});

// ═══ 7. SPENDING MONEY TAKES TWO DELIBERATE ACTS ═══════════════════════════

Deno.test("26. offline is the default and needs no authorization", () => {
  const a = authorizeRun({ live: false, authorized: false, hasApiKey: false, model: null });
  assertEquals(a.mayCallModels, false);
  assertEquals(a.blockers, [], "not calling a model is the ordinary path, not an error");
});

Deno.test("27. --live alone does NOT authorize spending", () => {
  const a = authorizeRun({ live: true, authorized: false, hasApiKey: true, model: "gpt-5.6-luna" });
  assertEquals(a.mayCallModels, false);
  assert(a.blockers.some((b) => b.includes("--i-authorize-model-spend")));
});

Deno.test("28. the harness never picks a model for you", () => {
  const a = authorizeRun({ live: true, authorized: true, hasApiKey: true, model: null });
  assertEquals(a.mayCallModels, false);
  assert(a.blockers.some((b) => b.includes("--model")),
    "a default model in an eval that compares models is the answer smuggled " +
    "into the question");
});

Deno.test("29. fully authorized clears every blocker", () => {
  const a = authorizeRun({ live: true, authorized: true, hasApiKey: true, model: "gpt-5.6-luna" });
  assertEquals(a.mayCallModels, true);
  assertEquals(a.blockers, []);
});

// ═══ 8. PHASE 3 CHANGED NO ROUTING ═════════════════════════════════════════

Deno.test("30. PHASE 3 IS MEASUREMENT ONLY", () => {
  // The harness exists to decide the routing question. Deciding it in the same
  // change would make the evidence and the action indistinguishable.
  const provider = Deno.readTextFileSync(new URL(
    "../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  assert(provider.includes('export const GPT_MODEL = "gpt-4.1"'));
  assert(provider.includes('export const GPT_FAST_MODEL = "gpt-4.1-mini"'));

  const config = Deno.readTextFileSync(new URL(
    "../../supabase/functions/_shared/leadStrategy/config.ts", import.meta.url));
  assert(config.includes('DEFAULT_PRIMARY_MODEL = "openai/gpt-5.6-luna"'));

  // And nothing in this directory is imported by production code.
  const engine = Deno.readTextFileSync(new URL(
    "../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assert(!engine.includes("model-routing-eval"),
    "the harness must never become a runtime dependency");
});

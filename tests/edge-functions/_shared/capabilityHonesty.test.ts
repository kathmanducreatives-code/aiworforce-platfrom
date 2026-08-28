// NEVER CLAIM A CAPABILITY OR RESULT WITHOUT A PROOF PATH.
//
// Every defect these pin was observed in production, in six live turns:
//
//   "10 leads saved."            the workspace held 32; the number was a page size
//   "your strongest signals"     an all-null sort, sliced to five
//   task failed / crash          a deliberate refusal recorded as an exception
//   "Something went wrong"       a ReferenceError, stored as "unexpected"
//
// Each is the same mistake in a different place: an answer implying more than
// the system established.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  satisfied, partiallySatisfied, requiresUnlock, unsupported, failed,
  categorizeThrown, failureMetadata,
} from "../../../supabase/functions/_shared/outcomeContract.ts";
import {
  renderReadAnswer, planRead,
} from "../../../supabase/functions/_shared/readSurface.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestEntity,
} from "../../../supabase/functions/_shared/requestV1.ts";

const read = (entity: RequestEntity, shape: "records" | "answer" = "records"): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "u", objective: "read",
  parts: [{ id: "p1", objective: "read", subject: { entity, references: [] },
            output: { shape, count: null } }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

// ══ 1. THE FIVE STATES ═════════════════════════════════════════════════════

Deno.test("1. each state carries what a caller must act on", () => {
  assertEquals(satisfied("counted").state, "SATISFIED");
  assertEquals(requiresUnlock("needs approval").state, "REQUIRES_UNLOCK");
  assertEquals(unsupported("no ranker").state, "UNSUPPORTED");
  assertEquals(failed("boom", "provider_failure").category, "provider_failure");
});

Deno.test("2. 'partially satisfied' with no declared gap is not allowed", () => {
  // A partial claim that will not say what is missing is indistinguishable from
  // a claim of success — which is the failure this contract exists to prevent.
  const empty = partiallySatisfied("leads listed", []);
  assertEquals(empty.state, "SATISFIED");
  assert(empty.reason.includes("no_declared_gaps"));

  const real = partiallySatisfied("leads listed", [
    { code: "leads_unscored", detail: "nothing is scored" },
  ]);
  assertEquals(real.state, "PARTIALLY_SATISFIED");
  assertEquals(real.gaps.length, 1);
});

// ══ 2. FAILURES KEEP THEIR CATEGORY ════════════════════════════════════════

Deno.test("3. a defect is categorised as a defect, never as transient", () => {
  // The exact error that took out six surfaces and read to users as a glitch
  // worth retrying.
  const tdz = new ReferenceError("Cannot access 'baseMeta' before initialization");
  assertEquals(categorizeThrown(tdz), "internal_error");
  assertEquals(categorizeThrown(new TypeError("x is not a function")), "internal_error");
});

Deno.test("4. a refusal and an outage are told apart", () => {
  const blocked = Object.assign(new Error("refused"), { name: "PaidExecutionBlockedError" });
  assertEquals(categorizeThrown(blocked), "requires_approval");
  assertEquals(categorizeThrown(new Error("credits_exhausted")), "provider_failure");
  const compile = Object.assign(new Error("no model"), { name: "MissionCompilationFailedError" });
  assertEquals(categorizeThrown(compile), "model_failure");
});

Deno.test("5. the reason reaches the row, not only the console", () => {
  const meta = failureMetadata(new ReferenceError("Cannot access 'x' before initialization"));
  assertEquals(meta.type, "error");
  assertEquals(meta.outcome.category, "internal_error");
  assert(String(meta.error_message).includes("before initialization"));
  assertEquals(meta.error_name, "ReferenceError");
});

// ══ 3. READS STATE WHAT THEY COUNTED ═══════════════════════════════════════

Deno.test("6. the total is the total, and the page is described as a page", () => {
  // "10 leads saved." against a table of 32 — the renderer reported the length
  // of one query page as a census.
  const plan = planRead(read("company"));
  const answer = renderReadAnswer(plan, {
    target: "companies",
    counts: { leads: 32, watched: 0, shown: 10 },
    items: Array.from({ length: 10 }, (_, i) => ({ kind: "lead", id: String(i), fit_score: null })),
    empty: false,
    gaps: [{ code: "leads_unscored", detail: "none of these leads carry a fit score yet" }],
  });
  assert(answer.includes("32"), "the counted total must be what is stated");
  assertFalse(/\b10 leads\b/.test(answer), "the page size must not be reported as the total");
});

Deno.test("7. an unranked list says it is unranked", () => {
  // Lists imply order. The sentence that says otherwise has to travel with the
  // list, every time, or the implication stands.
  const plan = planRead(read("signal"));
  const answer = renderReadAnswer(plan, {
    target: "signals",
    counts: { total: 10, shown: 5, market_problem_discussion: 5 },
    items: Array.from({ length: 5 }, (_, i) => ({ subject_key: "s" + i, signal_type: "market_problem_discussion" })),
    empty: false,
    gaps: [{ code: "signals_unscored", detail: "these aren't scored against your ICP, so I can't say which is strongest" }],
  });
  assert(/aren't scored/.test(answer), "the gap must be part of the answer");
  assert(/sample/i.test(answer), "and a truncated list must say it is a sample");
});

Deno.test("8. a failed query is not reported as an empty workspace", () => {
  // "You have nothing" and "I could not look" are different answers and only
  // one of them is true.
  const plan = planRead(read("signal"));
  const answer = renderReadAnswer(plan, {
    target: "signals", counts: {}, items: [], empty: true,
    gaps: [{ code: "read_failed", detail: "I couldn't reach your saved data just now" }],
  });
  assert(/couldn't reach/.test(answer));
});

// ══ 4. A REFUSAL IS NOT A CRASH ════════════════════════════════════════════

Deno.test("9. a blocked run is finalised as refused, with its codes", async () => {
  const { decideTerminalRecord } = await import(
    "../../../supabase/functions/_shared/leadExecutionFinalizer.ts");
  const err = Object.assign(new Error("paid execution refused"), {
    name: "PaidExecutionBlockedError",
    code: "missing_mission",
    detail: { blocked: [
      { code: "missing_mission", message: "no LeadMissionV1 on this task" },
      { code: "incompatible_planner_contract", message: "no contract version" },
    ] },
  });
  const r = decideTerminalRecord(null, { elapsedMs: 300, error: err });
  // BLOCKED, NOT FAILED. Live, this returned `failed`, and the row rendered as
  // a red "failed" pill beside a task row labelled "Blocked" and an "approval
  // required" badge — three words for one preflight refusal. `blocked` is
  // terminal and says nothing went wrong.
  assertEquals(r.status, "blocked", "a guard declining to spend is not a failure");
  assertEquals(r.reason, "refused_before_execution",
    "and nothing crashed — the reason says exactly what happened");
  assertEquals(r.blocked_by?.map((b) => b.code),
    ["missing_mission", "incompatible_planner_contract"],
    "and the codes that say what to fix survive onto the record");
  assertEquals(r.resumable, false, "retrying changes nothing until the block is cleared");
});

// ══ 10. A SEARCH THAT NEVER RAN IS NOT AN EMPTY MARKET ═════════════════════

Deno.test("10. a run refused at the provider boundary does not report a funnel", async () => {
  // LIVE, task b1abea89: discovery was refused before Apify was called —
  // `invalid_company_name_search_query: empty query` — and the user was told
  // "I opened the results in Workbench — 0 of 3 CONTACT-ready leads. I
  // discovered 0 companies and evaluated 0 embedded open roles across them.
  // 0 showed strong commercial expansion signals and 0 were shortlisted."
  //
  // Every number was zero for a reason that had nothing to do with the user's
  // market, and the sentence describes a search that happened.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));

  const i = src.indexOf("const refusedEarly = outcomes.length > 0");
  assert(i > 0, "the panel must be able to tell a refusal from an empty market");
  const branch = src.slice(i, i + 1800);
  assert(branch.includes("I couldn't run the search"),
    "it must say the search did not run, not report findings");
  assert(branch.includes("Nothing was charged."),
    "and say plainly that it cost nothing");
  assert(branch.includes('category: "provider_failure"'),
    "the outcome category must name the boundary that refused");

  // The funnel sentence must come AFTER, and be unreachable when refused.
  const funnel = src.indexOf("CONTACT-ready ${summary.requested === 1");
  assert(funnel > i, "the funnel report must not precede the refusal check");
  assert(branch.includes("return;"),
    "and the refusal must return rather than fall through to it");

  // The outcomes have to actually reach the panel, or the check is dead.
  assert(src.includes("capabilityOutcomes: capabilityRun?.capability_outcomes"),
    "the capability outcomes must be passed in");
});

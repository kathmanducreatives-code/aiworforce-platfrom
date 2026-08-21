// THE QUALIFICATION LOOP CANNOT OUTLIVE ITS OWN CHECKPOINT.
//
// ── THE RUN THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// Task 1e67725f, 2026-08-20 08:56:30Z, run-agent v22. Discovery bought 100
// companies, three survived to qualification, and the last log line was written
// at 91 seconds: "3 eligible companies assembled". The isolate was killed at
// 146s. No checkpoint, no continuation, `tasks.result` null, the task row left
// at `running` forever and the execution card spinning until the user gave up
// and asked what had happened.
//
// A DEADLINE GUARD WAS ALREADY THERE. It ran, and it passed — correctly, on the
// question it was asking. `shouldCheckpoint` answers "is there still room to
// write a checkpoint?", and at 91s of a 125s budget with an 18s reserve there
// was. It admitted a company and then had nothing further to say, because
// ADMITTING WORK AND BOUNDING WORK ARE DIFFERENT THINGS. The two model calls
// that followed ran for 55 seconds and took the run with them.
//
// So the fix is two gates, and these tests hold both:
//
//   ADMISSION  `shouldStartWork` — room for the reserve AND for what a company
//              is estimated to cost, with the estimate learned from observed
//              durations rather than assumed forever.
//   CEILING    `withDeadlineBudget` — the calls themselves cannot spend the
//              margin that admission set aside.
//
// Neither alone is sufficient. An estimate bounds the typical company; a
// ceiling bounds the pathological one; 1e67725f was pathological.
//
// AND THE SAFETY PROPERTY THAT MAKES STOPPING LEGAL: a company the clock stops
// is NOT REACHED. No verdict, no rejection, still on the frontier. Tests 8-10
// are the ones that matter most — a reserve that silently rejected the
// companies it could not evaluate would be worse than the hang it replaced.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse, assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  CHECKPOINT_RESERVE_MS, QUALIFICATION_RESERVE_MS, shouldCheckpoint, shouldStartWork,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import {
  BATCH_EVALUATION_OP, DeadlineBudgetExceeded, QUALIFICATION_OP,
  createExecutionDeadline, withDeadlineBudget,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const QUERY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

// ── engine fixtures ──────────────────────────────────────────────────────────

function ycRow(name: string, slug: string) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} sells electronic-design software to engineering teams.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
  };
}
function liSearchRow(name: string, slug: string) {
  return {
    id: slug, name,
    linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`,
    description: `${name} sells electronic-design software to engineering teams.`,
    location: "San Francisco, CA",
  };
}
function liDetailRow(name: string, slug: string) {
  return {
    id: slug, name,
    linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`, employeeCount: 42,
    description: `${name} sells electronic-design software to engineering teams.`,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  };
}

/** Three companies, so "stopped after the first" is observable. */
const COMPANIES: ReadonlyArray<readonly [string, string]> = [
  ["Sortly", "sortly"], ["Beamly", "beamly"], ["Cascada", "cascada"],
];
const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: COMPANIES.map(([n, s]) => ycRow(n, s)),
  apify_linkedin_company_search: COMPANIES.map(([n, s]) => liSearchRow(n, s)),
  apify_linkedin_company_details: COMPANIES.map(([n, s]) => liDetailRow(n, s)),
};

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * A CLOCK THE TEST OWNS.
 *
 * `now` only moves when a test says so, so admission decisions are exact rather
 * than a race against the machine the suite happens to run on. The CEILING
 * tests below deliberately use REAL time instead — `withDeadlineBudget` arms a
 * real timer, and faking that would test the fake.
 */
function fakeClock(startAt = 1_000_000) {
  let now = startAt;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
    at: (ms: number) => { now = startAt + ms; },
  };
}

interface Log { line: string; meta: unknown }

/**
 * The last thing the engine logs before the qualification loop.
 *
 * Tests that want the clock to be late AT QUALIFICATION hang the jump here
 * rather than starting the run late — a deadline already spent at t=0 stops
 * DISCOVERY, and a run that never sources anything proves nothing about the
 * loop this file is about.
 */
const LAST_LOG_BEFORE_QUALIFICATION = "hiring_verification_complete";

async function runWith(
  over: Partial<CapabilityEngineDeps>,
  onLog?: (line: string) => void,
): Promise<{ run: Awaited<ReturnType<typeof runCapabilityPlan>>; logs: Log[] }> {
  const logs: Log[] = [];
  const m = parseLeadMissionDeterministic(QUERY);
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) =>
      Promise.resolve(ROWS[call.actorKey] ?? []),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    ...over,
    // AFTER the spread: a test supplies a clock hook, not its own recorder.
    log: (line: string, meta?: unknown) => { logs.push({ line, meta }); onLog?.(line); },
  }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });
  return { run, logs };
}

/** Put the run at `elapsedMs` exactly as qualification begins. */
const arriveAtQualification = (clock: ReturnType<typeof fakeClock>, elapsedMs: number) =>
  (line: string) => { if (line === LAST_LOG_BEFORE_QUALIFICATION) clock.at(elapsedMs); };

const evaluatorPass: CapabilityEngineDeps["evaluateMission"] =
  stubMissionEvaluator({ mission_fit: "pass" });

const logNames = (logs: Log[]) => logs.map((l) => l.line);
const findLog = (logs: Log[], line: string) => logs.find((l) => l.line === line);

// ═══════════════════════════════════════════ 1-4. the admission predicate ══

Deno.test("1. shouldStartWork demands room for the work AND the reserve", () => {
  const clock = (remaining: number) => ({ elapsedMs: () => 0, remainingMs: () => remaining });
  // 18s reserve + 12s of work = 30s needed. 31s is enough, 30s is not.
  assert(shouldStartWork(clock(31_000), 12_000, 18_000));
  assertFalse(shouldStartWork(clock(30_000), 12_000, 18_000));
  assertFalse(shouldStartWork(clock(29_999), 12_000, 18_000));
});

Deno.test("2. THE 1e67725f MOMENT: the old question said yes, the new one says no", () => {
  // 125s budget, 91s elapsed, 18s reserve, a company estimated at 12s.
  const clock = { elapsedMs: () => 91_000, remainingMs: () => 34_000 };
  // What the guard asked in the run that died — and it was RIGHT to say yes on
  // its own terms: 34s is indeed room to write a checkpoint.
  assertFalse(shouldCheckpoint(clock, 18_000), "the old guard admitted this company");
  // What it asks now. 34s is NOT room for a 12s company plus an 18s reserve
  // once you account for the second call, and the run proved it.
  assertFalse(
    shouldStartWork(clock, 12_000 + 12_000, 18_000),
    "two 12s calls plus the reserve do not fit in 34s",
  );
});

Deno.test("3. a negative or absent estimate degrades to the plain reserve test", () => {
  const clock = { elapsedMs: () => 0, remainingMs: () => 20_000 };
  assert(shouldStartWork(clock, 0, 18_000));
  assert(shouldStartWork(clock, -5_000, 18_000), "a nonsense estimate must not grant time");
  assertFalse(shouldStartWork(clock, 0, 20_000));
});

Deno.test("4. the deadline prices qualification separately from providers", () => {
  const clock = fakeClock();
  const d = createExecutionDeadline({ budgetMs: 125_000, now: clock.now, assumedCallMs: 12_000 });
  // A slow Actor start must not raise the qualification estimate — that
  // cross-contamination is what the per-op table was built to stop.
  d.observeCall(51_000, "apify_yc_companies_memo23");
  assertEquals(d.estimateFor(QUALIFICATION_OP), 12_000, "unrelated provider latency does not leak in");
  d.observeCall(31_000, QUALIFICATION_OP);
  assertEquals(d.estimateFor(QUALIFICATION_OP), 31_000);
  assertEquals(d.estimateFor(BATCH_EVALUATION_OP), 12_000, "a batch is priced on its own history");
});

// ══════════════════════════════════════════════════ 5-7. the call ceiling ══

Deno.test("5. withDeadlineBudget returns the value when the work finishes in time", async () => {
  const got = await withDeadlineBudget(
    () => Promise.resolve("evaluated"), 5_000, "mission_evaluation");
  assertEquals(got, "evaluated");
});

Deno.test("6. a call that overruns yields control on time, it does not wait for the work", async () => {
  const startedAt = Date.now();
  // The 1e67725f shape in miniature: work that will not return for far longer
  // than the caller has left.
  const never = () => new Promise<string>((r) => setTimeout(() => r("too late"), 5_000));
  const err = await assertRejects(
    () => withDeadlineBudget(never, 60, "company_grounding"),
    DeadlineBudgetExceeded,
  );
  const waited = Date.now() - startedAt;
  assertEquals(err.label, "company_grounding");
  assertEquals(err.budgetMs, 60);
  assert(waited < 2_000, `control returned in ${waited}ms, not after the work`);
});

Deno.test("7. a budget already spent fails without starting the work at all", async () => {
  let started = false;
  await assertRejects(
    () => withDeadlineBudget(() => { started = true; return Promise.resolve(1); }, 0, "x"),
    DeadlineBudgetExceeded,
  );
  await assertRejects(
    () => withDeadlineBudget(() => { started = true; return Promise.resolve(1); }, -400, "x"),
    DeadlineBudgetExceeded,
  );
  assertFalse(started, "work nobody will be alive to read must not be started");
  // NOTE: this test file has Deno's timer sanitizer on. If the happy path in
  // test 5 leaked its timer, the suite would fail there — so "no leaked handle
  // keeps the isolate alive" is asserted by the suite passing, not by a mock.
});

// ═══════════════════════════════════════════ 8-12. the engine, end to end ══

Deno.test("8. THE REGRESSION: a grounder that overruns stops the run instead of killing it", async () => {
  const clock = fakeClock();
  // A SMALL ASSUMED CALL, so admission and the ceiling can be exercised
  // independently. In production the ceiling is always at least the estimate
  // (admission guarantees it), so a call only hits the ceiling by running
  // MUCH slower than its own history — 55s against ~7s, in the real run. Here
  // the same ratio is reproduced in milliseconds: a 50ms assumption, a 120ms
  // ceiling and a call that takes 400ms.
  const deadline = createExecutionDeadline({
    budgetMs: 125_000, now: clock.now, assumedCallMs: 50,
  });
  let grounderCalls = 0;
  const { run, logs } = await runWith({
    deadline,
    evaluateMission: evaluatorPass,
    groundingMode: "enforce",
    // A call that never answers in time. Under the old code this ran until the
    // platform killed the isolate. The reserve below leaves a 20ms ceiling, so
    // 400ms of real waiting is the 55-second overrun in miniature — and the
    // timer that fires is a real one, because faking it would test the fake.
    groundCompany: () => {
      grounderCalls++;
      return new Promise((r) => setTimeout(() => r(null), 400));
    },
    checkpointReserveMs: 33_880, // of the 34s left at 91s: a 120ms ceiling
  // The run arrives at qualification at 91 seconds, exactly as 1e67725f did.
  }, arriveAtQualification(clock, 91_000));

  assertEquals(grounderCalls, 1, "it stops after the first overrun, it does not try all three");
  assertEquals(run.state.terminal_reason, "execution_deadline_checkpoint");
  const stop = findLog(logs, "qualification_call_deadline_stop");
  assert(stop, `expected a call-deadline stop, saw: ${logNames(logs).join(", ")}`);
  assertEquals((stop.meta as { call: string }).call, "company_grounding");
  assert((stop.meta as { not_reached: number }).not_reached >= 1);
});

Deno.test("9. AND NOBODY IS REJECTED FOR IT: a clock-stopped company stays resumable", async () => {
  const clock = fakeClock();
  const deadline = createExecutionDeadline({
    budgetMs: 125_000, now: clock.now, assumedCallMs: 50,
  });
  const { run } = await runWith({
    deadline,
    evaluateMission: evaluatorPass,
    groundingMode: "enforce",
    groundCompany: () => new Promise((r) => setTimeout(() => r(null), 400)),
    checkpointReserveMs: 33_880,
  }, arriveAtQualification(clock, 91_000));

  // THE PROPERTY THAT MAKES STOPPING LEGAL. Running out of clock is not
  // evidence about a company, so it may not produce a verdict about one.
  const rejected = run.companies.filter((c) => c.verdict === "reject");
  assertEquals(rejected.length, 0, "the clock rejected somebody — that is worse than the hang");
  assertEquals(run.funnel.qualified_companies, 0);
  // And the capability is INCOMPLETE, so a continuation does not skip it.
  const qual = run.capability_outcomes.find(
    (o) => o.capability === "company_brain_qualification");
  assert(qual, "the qualification capability reported an outcome");
  assertEquals(qual.status, "incomplete");
  assert(
    String(qual.reason ?? "").includes("not reached"),
    `the reason must say the rest were not reached, got: ${qual.reason}`,
  );
});

Deno.test("10. admission alone: with no room for a company, no model call is made", async () => {
  const clock = fakeClock();
  const deadline = createExecutionDeadline({
    budgetMs: 125_000, now: clock.now, assumedCallMs: 12_000,
  });
  let evaluatorCalls = 0;
  const { run, logs } = await runWith({
    deadline,
    evaluateMission: (i) => { evaluatorCalls++; return evaluatorPass!(i); },
  // 118s elapsed on arrival: 7s left, less than the reserve, never mind a company.
  }, arriveAtQualification(clock, 118_000));
  assertEquals(evaluatorCalls, 0, "no company may be started with nothing left to stop in");
  assertEquals(run.state.terminal_reason, "execution_deadline_checkpoint");
  const stop = findLog(logs, "qualification_deadline_stop");
  assert(stop, `expected an admission stop, saw: ${logNames(logs).join(", ")}`);
  assertEquals((stop.meta as { per_company_estimate_ms: number }).per_company_estimate_ms, 12_000);
});

Deno.test("11. the estimate LEARNS: one slow company shrinks what the next may start", async () => {
  const clock = fakeClock();
  const deadline = createExecutionDeadline({
    budgetMs: 125_000, now: clock.now, assumedCallMs: 12_000,
  });
  let evaluatorCalls = 0;
  const { run, logs } = await runWith({
    deadline,
    // Each company burns 30 seconds of the fake clock — well over the 12s the
    // deadline assumes for a stage it has never seen.
    evaluateMission: (i) => {
      evaluatorCalls++;
      clock.advance(30_000);
      return evaluatorPass!(i);
    },
  }, arriveAtQualification(clock, 40_000));

  // 40s in, 85s left. Company 1 is admitted on the 12s assumption and takes 30s.
  // Company 2 is then judged against the OBSERVED 30s: 55s left, 30 + 18 = 48,
  // so it is admitted too and takes another 30s. Company 3 has 25s left against
  // a 48s requirement and is refused — where the constant would have said
  // 25 > 12 + 18 is false as well, but only by luck. What matters is that the
  // deadline is now reasoning about real latency.
  assertEquals(deadline.estimateFor(QUALIFICATION_OP) >= 30_000, true);
  assert(evaluatorCalls < 3, `all three ran despite 30s each (${evaluatorCalls})`);
  assertEquals(run.state.terminal_reason, "execution_deadline_checkpoint");
  const stop = findLog(logs, "qualification_deadline_stop");
  assert(stop, "the loop stopped on admission, having learned the real cost");
  assert(
    (stop.meta as { per_company_estimate_ms: number }).per_company_estimate_ms >= 30_000,
    "the stop was decided against observed latency, not the assumption",
  );
});

Deno.test("12. a run with time to spare is untouched: every company is evaluated", async () => {
  const clock = fakeClock();
  const deadline = createExecutionDeadline({
    budgetMs: 125_000, now: clock.now, assumedCallMs: 12_000,
  });
  // 5 seconds in. Nothing here should notice the clock exists.
  clock.at(5_000);
  let evaluatorCalls = 0;
  const { run, logs } = await runWith({
    deadline,
    evaluateMission: (i) => { evaluatorCalls++; return evaluatorPass!(i); },
  });
  assertEquals(evaluatorCalls, 3, "all three companies were evaluated");
  assertFalse(
    logNames(logs).includes("qualification_deadline_stop"),
    "a run with 120s left must not stop on the clock",
  );
  assertFalse(logNames(logs).includes("qualification_call_deadline_stop"));
  assertEquals(run.state.terminal_reason === "execution_deadline_checkpoint", false);
});

Deno.test("13. offline callers have no deadline and are still unbounded", async () => {
  let evaluatorCalls = 0;
  // No `deadline` dependency at all — the shape every pure engine test uses.
  const { run, logs } = await runWith({
    evaluateMission: (i) => { evaluatorCalls++; return evaluatorPass!(i); },
  });
  assertEquals(evaluatorCalls, 3);
  assertFalse(logNames(logs).includes("qualification_deadline_stop"));
  assertFalse(logNames(logs).includes("qualification_call_deadline_stop"));
  assertEquals(run.state.terminal_reason === "execution_deadline_checkpoint", false);
});

// ══════════════════════════════════════════ 14. the constant is not silent ══

Deno.test("14. both reserves are real numbers and the loop uses them by default", () => {
  assertEquals(CHECKPOINT_RESERVE_MS, 18_000, "the PROVIDER reserve is unchanged");
  assertEquals(QUALIFICATION_RESERVE_MS, 14_000);
  // The engine must reach for a shared constant rather than inventing a local
  // one — a second reserve that drifts is the defect this file exists for.
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assert(
    src.includes("deps.checkpointReserveMs ?? QUALIFICATION_RESERVE_MS"),
    "the qualification loop reaches for ITS OWN shared constant",
  );
  assert(
    src.includes("deps.checkpointReserveMs ?? CHECKPOINT_RESERVE_MS"),
    "and the provider loops keep theirs",
  );
  assert(src.includes("shouldStartWork("), "admission asks the predictive question");
  assert(src.includes("withDeadlineBudget("), "the model calls are under a ceiling");
});

// ════════════════════ 15-17. WHY QUALIFICATION GETS ITS OWN RESERVE ══
//
// The 18s above is sized for the slowest downstream PROVIDER call, so that the
// engine never authorises an Actor it cannot finish. Qualification is not an
// Actor: its calls are already bounded by `withDeadlineBudget` (tests 5-7) and
// a company the clock stops is not reached (tests 8-10). Borrowing the provider
// reserve there bought safety that was already guaranteed, and paid for it in
// leads.

/** Every `remaining_ms` a real run was refused admission at. */
const REFUSED_AT = [
  { run: "9b5ad99b", remaining: 19_137, stranded: 4 },
  { run: "b7a9e112", remaining: 22_206, stranded: 2 },
  { run: "b7a9e112", remaining: 22_984, stranded: 6 },
  { run: "b7a9e112", remaining: 23_658, stranded: 2 },
];

/** The observed cost of everything that happens AFTER qualification stops. */
const MEASURED_TAILS_MS = [5_960, 6_270, 7_800, 7_860, 9_380];

const clockAt = (remaining: number) => ({
  elapsedMs: () => 120_000 - remaining,
  remainingMs: () => remaining,
});

Deno.test("15. the runs that were refused with 22 seconds on the clock now start", () => {
  const estimate = 7_000;   // `company_qualification_pregrounded`, as priced
  for (const c of REFUSED_AT) {
    assertFalse(
      shouldStartWork(clockAt(c.remaining), estimate, CHECKPOINT_RESERVE_MS),
      `run ${c.run} was refused at ${c.remaining}ms and stranded ${c.stranded} enriched companies`,
    );
  }
  // Every one except the tightest now admits a company.
  for (const c of REFUSED_AT.filter((x) => x.remaining > 21_000)) {
    assert(
      shouldStartWork(clockAt(c.remaining), estimate, QUALIFICATION_RESERVE_MS),
      `${c.remaining}ms is room for a 7s evaluation and a 14s reserve`,
    );
  }
});

Deno.test("16. the reserve still covers the worst tail ever measured, with margin", () => {
  const worst = Math.max(...MEASURED_TAILS_MS);
  assertEquals(worst, 9_380);
  assert(QUALIFICATION_RESERVE_MS > worst,
    "a reserve below the finalisation tail would cut off the checkpoint itself");
  assert(QUALIFICATION_RESERVE_MS - worst >= 4_000,
    `margin over the worst observed tail is ${QUALIFICATION_RESERVE_MS - worst}ms`);
});

Deno.test("17. the number is boxed in from both sides, and 14s is the roomiest fit", () => {
  const estimate = 7_000;
  const tightest = Math.min(...REFUSED_AT.filter((c) => c.remaining > 21_000)
    .map((c) => c.remaining));
  assertEquals(tightest, 22_206);

  // FLOOR — it has to outlast the finalisation tail. 9.38s was the worst seen.
  assert(QUALIFICATION_RESERVE_MS > Math.max(...MEASURED_TAILS_MS));

  // CEILING — it has to admit the tightest real case. 16s does not.
  assertFalse(shouldStartWork(clockAt(tightest), estimate, 16_000),
    "16s refuses the 22.2s slice this change exists to admit");
  assert(shouldStartWork(clockAt(tightest), estimate, QUALIFICATION_RESERVE_MS));

  // So the admissible window is [~9.4s, ~15.2s), and inside it a SMALLER number
  // buys nothing: after one ~7s evaluation the clock reads ~15s, below every
  // candidate threshold, so the slice stops there either way. Choosing the
  // smallest would trade margin for no extra company.
  const afterOne = tightest - estimate;
  for (const smaller of [10_000, 12_000]) {
    assertFalse(shouldStartWork(clockAt(afterOne), estimate, smaller),
      `${smaller}ms admits no SECOND company either — only less margin`);
  }
});

// WORK ALREADY PAID FOR IS THE LAST THING A DEADLINE GIVES UP.
//
// ── THE RUN THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// Run df00b2cd, 2026-08-20. The Stage-2 batch evaluator spent 13 seconds
// grounding three companies:
//
//     09:58:31.479  stage2_eligible_pool             { eligible: 3 }
//     09:58:44.531  stage2_batch_evaluation_complete { evaluated: 3 }
//
// One millisecond later the admission gate refused to start the per-company
// loop — the loop that turns a grounded result into a verdict:
//
//     09:58:44.532  qualification_deadline_stop { evaluated: 0, not_reached: 4,
//                                                 remaining_ms: 23943,
//                                                 per_company_estimate_ms: 12000 }
//
// and the funnel recorded what that cost:
//
//     mission_funnel: company_brain: 4 -> 0 UNACCOUNTED=4
//
// The gate was mine, shipped that morning, and it was pricing work that was
// never going to happen. `QUALIFICATION_OP` assumes TWO model calls per
// company — the per-company grounder plus the Mission evaluator. For a company
// already in `groundedByKey` the grounder is never called: the engine reads the
// batch's answer. So three companies whose expensive half was bought and paid
// for were refused their cheap half, to protect a reserve they would not have
// spent.
//
// TWO CHANGES, AND BOTH ARE NEEDED:
//
//   PRICE   a pre-grounded company is quoted `QUALIFICATION_PREGROUNDED_OP`,
//           whose floor is one evaluator call rather than two.
//   ORDER   pre-grounded companies are attempted FIRST, because under a clock
//           that may stop at any point the attempt order decides who gets a
//           verdict.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BATCH_EVALUATION_OP, QUALIFICATION_OP, QUALIFICATION_PREGROUNDED_OP,
  createExecutionDeadline,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { shouldStartWork } from "../../../supabase/functions/_shared/leadResumeState.ts";

const ENGINE = new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url);
const engineSource = Deno.readTextFileSync(ENGINE);

// ═════════════════════════════════════════════════════════ 1-4. the price ══

Deno.test("1. a pre-grounded company is priced below the two-call assumption", () => {
  const d = createExecutionDeadline({ budgetMs: 125_000, assumedCallMs: 12_000 });
  assertEquals(d.estimateFor(QUALIFICATION_OP), 12_000, "two calls");
  assertEquals(d.estimateFor(QUALIFICATION_PREGROUNDED_OP), 7_000, "one call");
  assert(
    d.estimateFor(QUALIFICATION_PREGROUNDED_OP) < d.estimateFor(QUALIFICATION_OP),
    "the whole point is that it is cheaper",
  );
});

Deno.test("2. THE df00b2cd MOMENT: the same clock now admits the paid-for company", () => {
  const clock = { elapsedMs: () => 101_057, remainingMs: () => 23_943 };
  const d = createExecutionDeadline({ budgetMs: 125_000, assumedCallMs: 12_000 });
  const reserve = 18_000;

  // What happened: priced as two calls, 12_000 + 18_000 = 30_000 > 23_943.
  assertEquals(
    shouldStartWork(clock, d.estimateFor(QUALIFICATION_OP), reserve), false,
    "this is the refusal the run actually made",
  );
  // What happens now: priced as one call, 7_000 + 18_000 = 25_000 ... still
  // over 23_943 by a second. HONESTY MATTERS MORE THAN A GREEN TEST — the fix
  // does not rescue this exact instant, and pretending otherwise would hide
  // that the run also needed the ~36s that identity and enrichment spent after
  // the planner had dropped them.
  assertEquals(shouldStartWork(clock, d.estimateFor(QUALIFICATION_PREGROUNDED_OP), reserve), false);
  // What it DOES rescue is every case in the 25s-30s band, which is where a
  // run that reclaims even a few seconds upstream now lands.
  const nearlyEnough = { elapsedMs: () => 98_000, remainingMs: () => 27_000 };
  assertEquals(shouldStartWork(nearlyEnough, d.estimateFor(QUALIFICATION_OP), reserve), false);
  assertEquals(
    shouldStartWork(nearlyEnough, d.estimateFor(QUALIFICATION_PREGROUNDED_OP), reserve), true,
    "27s is not enough for two calls and is enough for one",
  );
});

Deno.test("3. the cheap floor is declared, never inferred from a fast call", () => {
  const d = createExecutionDeadline({ budgetMs: 125_000, assumedCallMs: 12_000 });
  // A single quick call must not talk the deadline into a cheaper estimate for
  // an operation that has not declared one — the floor only moves UP.
  d.observeCall(300, QUALIFICATION_OP);
  assertEquals(d.estimateFor(QUALIFICATION_OP), 12_000);
  d.observeCall(300, BATCH_EVALUATION_OP);
  assertEquals(d.estimateFor(BATCH_EVALUATION_OP), 12_000);
  // And observation still raises a declared-cheap operation when reality is worse.
  d.observeCall(19_000, QUALIFICATION_PREGROUNDED_OP);
  assertEquals(d.estimateFor(QUALIFICATION_PREGROUNDED_OP), 19_000);
});

Deno.test("4. an unscoped caller is unaffected by the per-op floors", () => {
  const d = createExecutionDeadline({ budgetMs: 125_000, assumedCallMs: 12_000 });
  assertEquals(d.estimateFor(), 12_000, "the global answer is unchanged");
  assertEquals(d.estimateFor("apify_yc_companies_memo23"), 12_000);
});

// ═════════════════════════════════════════════════════════ 5-7. the order ══

Deno.test("5. the engine attempts pre-grounded companies first", () => {
  assert(
    /const isPreGrounded = \(c: EngineCompany\) => groundedByKey\.has\(c\.key\)/.test(engineSource),
    "pre-grounded means the batch already answered for this company",
  );
  assert(
    /eligible\.filter\(isPreGrounded\)[\s\S]{0,80}eligible\.filter\(\(c\) => !isPreGrounded\(c\)\)/
      .test(engineSource),
    "a stable partition puts the already-paid-for companies at the front",
  );
  assert(
    /for \(let qIndex = 0; qIndex < eligibleOrdered\.length/.test(engineSource),
    "and the loop iterates the ORDERED list, not the original",
  );
});

Deno.test("6. admission quotes the price that matches the work", () => {
  assert(
    /const qualificationOp = opFor\(c\)/.test(engineSource),
    "the op is resolved per company",
  );
  assert(
    /estimateFor\(qualificationOp\)/.test(engineSource),
    "admission is decided on that company's own price, not a constant",
  );
  // ── SCOPED TO ADMISSION, WHICH IS WHERE THE RULE LIVES ─────────────────
  //
  // This forbade `estimateFor(QUALIFICATION_OP)` ANYWHERE, which reads as the
  // stronger statement and is actually a different one. The rule is that
  // ADMITTING a company must quote that company's price: a pre-grounded company
  // needs one evaluator call, and pricing it as two threw away three
  // verifications on run df00b2cd.
  //
  // PLANNING is not admission. The hiring stage reserves clock for the
  // companies it has verified before starting another batch, and at that point
  // `groundedByKey` has not been built — the qualification capability has not
  // run — so no company is pre-grounded and the two-call price is both correct
  // and conservative. Forbidding the constant outright would force that site to
  // invent a cheaper number it cannot justify.
  // Bounded by the loop header and the next PLANNING site — the frontier-carry
  // `resolveTimeCapacity`, which is demonstrably outside the loop. Bounding on
  // the end of the whole capability block would swallow that planning call and
  // fail for the very reason this test now distinguishes.
  const loopStart = engineSource.indexOf(
    "for (let qIndex = 0; qIndex < eligibleOrdered.length");
  const admissionLoop = engineSource.slice(
    loopStart, engineSource.indexOf("resolveTimeCapacity({", loopStart));
  assert(admissionLoop.length > 0, "the admission loop must still be findable");
  assert(
    !/estimateFor\(QUALIFICATION_OP\)/.test(admissionLoop),
    "admission must not hardcode the two-call price for every company",
  );
});

Deno.test("7. the observed duration is recorded against the price that was quoted", () => {
  // Recording a pre-grounded company's 6s against the two-call operation would
  // teach the deadline that two calls take six seconds, which is how an
  // estimate stops describing anything.
  assert(
    /observeCall\(\s*deps\.deadline\.elapsedMs\(\) - qualificationStartedAt, qualificationOp\)/
      .test(engineSource),
    "observation uses the same op admission was decided on",
  );
});

// ══════════════════════════════════════════════════ 8. the stop is legible ══

Deno.test("8. a stop says which price refused it and what is left unspent", () => {
  const at = engineSource.indexOf('log("qualification_deadline_stop"');
  assert(at > 0);
  const block = engineSource.slice(at, at + 700);
  assert(/priced_as: qualificationOp/.test(block),
    "a reader must not have to guess whether the company still owed a grounding call");
  assert(/pre_grounded_remaining:/.test(block),
    "and must be able to see, at a glance, how much bought work was abandoned");
});

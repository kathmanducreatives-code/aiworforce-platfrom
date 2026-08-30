// HIRING MAY NOT SPEND THE CLOCK THAT QUALIFICATION IS OWED.
//
// ── WHAT ACTUALLY STARVED, FROM THE LOGS ───────────────────────────────────
//
// The audit inferred that Company Brain never ran because
// `company_brain_qualification` sat in `pending_capabilities`. It ran. Three
// times. And evaluated nobody:
//
//   11:14:08  qualification_deadline_stop  eligible 3, evaluated 0,
//             remaining_ms  2,187   per_company_estimate_ms 12,000
//   11:15:40  qualification_deadline_stop  eligible 2, evaluated 0,
//             remaining_ms      0   per_company_estimate_ms 12,000
//   11:22:44  qualification_deadline_stop  eligible 3, evaluated 0,
//             remaining_ms 23,375   per_company_estimate_ms 12,000
//
// Two different defects in one symptom. The first two are starvation: hiring
// spent the slice and left 2.2s and 0s behind. The third is not — 23.4s was
// available and the work was refused, because admission needs
// `QUALIFICATION_RESERVE_MS` (14,000) plus the estimate (12,000) = 26,000.
//
// And the estimate itself was two numbers for one stage: `ExecutionDeadline`
// gated at 12,000 ms while `resolveTimeCapacity` planned at 7,000 ms.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canStartHiringBatch, resolveTimeCapacity,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  HIRING_MS_PER_COMPANY, HIRING_VERIFICATION_BATCH_SIZE,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  DURABLE_START_MS,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import {
  QUALIFICATION_RESERVE_MS,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

/** The slice production actually had: `investigation_capacity`, verbatim. */
const LIVE = {
  remainingMs: 123_489,
  reserveMs: 18_000,
  concurrency: 4,
  enrichmentBatchSize: 10,
  read: () => undefined,
  observedIdentityMs: 12_000,
};

// ── THE CAPACITY MODEL ──────────────────────────────────────────────────────

Deno.test("THE OLD MODEL PRICED A COMPANY AT AN EIGHTH OF ITS COST", () => {
  // Reproduced exactly: identity/4 + enrichment/10 + qualification
  // = 3000 + 1200 + 7000 = 11,200 ms, and `capacity: 9` on a 105s budget.
  const old = resolveTimeCapacity(LIVE);
  assertEquals(old.per_company_ms, 11_200);
  assertEquals(old.capacity, 9);
});

Deno.test("HIRING IS THE DOMINANT COST AND IS NOW IN THE MODEL", () => {
  const now = resolveTimeCapacity({
    ...LIVE,
    hiringMsPerCompany: HIRING_MS_PER_COMPANY,
    hiringBatchSize: HIRING_VERIFICATION_BATCH_SIZE,
    qualificationMs: 12_000,
  });
  // 3000 + 1200 + 80000/3 + 12000
  assertEquals(now.per_company_ms, Math.round(3000 + 1200 + 80_000 / 3 + 12_000));
  assert(now.capacity < 9, "an honest model authorises less than a wrong one");
  assert(now.capacity >= 1, "and still enough to make progress");
  assertEquals(now.hiring_call_ms, HIRING_MS_PER_COMPANY);
  assertEquals(now.hiring_batch_size, HIRING_VERIFICATION_BATCH_SIZE);
});

Deno.test("hiring is AMORTISED over the batch — one call answers three companies", () => {
  const one = resolveTimeCapacity({
    ...LIVE, hiringMsPerCompany: 90_000, hiringBatchSize: 1, qualificationMs: 0 });
  const three = resolveTimeCapacity({
    ...LIVE, hiringMsPerCompany: 90_000, hiringBatchSize: 3, qualificationMs: 0 });
  assertEquals(one.per_company_ms - three.per_company_ms, 60_000);
});

Deno.test("ONE NUMBER FOR QUALIFICATION, and it is the gate's", () => {
  // The model planned at 7,000 while admission gated at 12,000. Whichever is
  // right, they cannot be different — a plan that budgets less than the gate
  // spends authorises work the gate will refuse.
  const planned = resolveTimeCapacity({ ...LIVE, qualificationMs: 12_000 });
  assertEquals(planned.qualification_ms, 12_000);
});

Deno.test("the gate's number is a floor, not an override", () => {
  // A deployment that has measured something SLOWER keeps its own figure; the
  // model takes the larger, because under-budgeting is the direction that
  // starves.
  const slower = resolveTimeCapacity({
    ...LIVE, read: (k) => k === "LEAD_QUALIFICATION_PER_COMPANY_MS" ? "20000" : undefined,
    qualificationMs: 12_000,
  });
  assertEquals(slower.qualification_ms, 20_000);
});

Deno.test("a caller that supplies nothing gets exactly the old behaviour", () => {
  // Every non-sourcing caller of this model must be unaffected.
  const bare = resolveTimeCapacity(LIVE);
  assertEquals(bare.hiring_call_ms, 0);
  assertEquals(bare.per_company_ms, 11_200);
});

// ── THE DOWNSTREAM RESERVE ──────────────────────────────────────────────────

const gate = (over: Partial<Parameters<typeof canStartHiringBatch>[0]> = {}) =>
  canStartHiringBatch({
    remainingMs: 100_000,
    qualificationDebtMs: 0,
    reserveMs: QUALIFICATION_RESERVE_MS,
    durableStartMs: DURABLE_START_MS,
    ...over,
  });

Deno.test("HIRING IS GREEDY UNTIL IT PRODUCES SOMETHING", () => {
  // Nothing verified yet means nothing to starve. A batch may start on the old
  // rule alone — otherwise a slice that begins with an empty frontier would
  // never buy the evidence it exists to buy.
  const v = gate({ qualificationDebtMs: 0, remainingMs: 20_000 });
  assertEquals(v.start, true);
  assertEquals(v.reason, "ok");
});

Deno.test("…AND THEN IT YIELDS", () => {
  // Three companies verified, each owing a 12s evaluation, with a 14s reserve:
  // 36,000 + 14,000 = 50,000 must remain. This is the rule that would have kept
  // 11:14:08 from arriving with 2,187 ms left.
  const v = gate({ qualificationDebtMs: 36_000, remainingMs: 49_000 });
  assertEquals(v.start, false);
  assertEquals(v.reason, "would_starve_qualification");
  assertEquals(v.required_ms, 50_000);
});

Deno.test("and starts when the debt genuinely fits", () => {
  const v = gate({ qualificationDebtMs: 36_000, remainingMs: 51_000 });
  assertEquals(v.start, true);
});

Deno.test("REPLAY 11:14:08 — the batch that emptied the clock is refused", () => {
  // The slice held 3 verified companies. Hiring started another batch and the
  // Brain was left 2,187 ms. Under the reserve, that batch does not start.
  const beforeTheFatalBatch = gate({
    qualificationDebtMs: 3 * 12_000,
    // Whatever remained when the last batch was considered, it was less than
    // the 50s the three verified companies were owed.
    remainingMs: 45_000,
  });
  assertEquals(beforeTheFatalBatch.start, false);
  assertEquals(beforeTheFatalBatch.reason, "would_starve_qualification");
});

Deno.test("a call that cannot be DURABLY RECORDED is never made", () => {
  // Unchanged and independent: below `DURABLE_START_MS` a POST would be a charge
  // with no row naming the run.
  const v = gate({ remainingMs: DURABLE_START_MS - 1, qualificationDebtMs: 0 });
  assertEquals(v.start, false);
  assertEquals(v.reason, "no_durable_start");
});

Deno.test("the durable-start floor outranks an empty debt", () => {
  // Order matters: "nothing owed" must not let a call start that cannot be
  // written down.
  const v = gate({ remainingMs: 1_000, qualificationDebtMs: 0 });
  assertEquals(v.start, false);
  assertEquals(v.reason, "no_durable_start");
});

Deno.test("it is NOT `can this batch finish`", () => {
  // A job search is ~80s per company and longer than a slice at any batch size.
  // Requiring it to finish would defer hiring for ever — the reason the batch
  // loop documents for using `expiredForDurableStart` in the first place.
  const v = gate({ remainingMs: 30_000, qualificationDebtMs: 0 });
  assertEquals(v.start, true, "starting is safe; the run id is durable and adoptable");
});

// ── THE WIRING ──────────────────────────────────────────────────────────────

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

Deno.test("the batch loop asks BOTH questions", () => {
  assert(code.includes("canStartHiringBatch({"), "the reserve must be consulted");
  assert(/expiredForDurableStart\(\) \|\| !batchGate\.start/.test(code),
    "and neither question may replace the other");
});

Deno.test("every capacity site prices hiring", () => {
  // Three sites compute capacity; one of them omitting hiring would produce a
  // different answer at a different point in the slice.
  const sites = code.split("resolveTimeCapacity({").length - 1;
  const priced = code.split("hiringMsPerCompany: HIRING_MS_PER_COMPANY").length - 1;
  assertEquals(priced, sites, "every capacity computation must include hiring");
});

Deno.test("the deferral says WHY, and what it was protecting", () => {
  // `hiring_batch_deferred_for_deadline { remaining: 1 }` could not distinguish
  // "no time to start a call" from "not spending what the Brain is owed".
  const block = code.slice(code.indexOf("hiring_batch_deferred_for_deadline"));
  for (const field of ["reason", "awaiting_qualification", "required_ms", "remaining_ms"]) {
    assert(block.slice(0, 400).includes(field), `the deferral must record ${field}`);
  }
});

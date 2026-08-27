// A DEFERRED CANDIDATE IS NOT AN INVESTIGATED ONE.
//
// Live run e3b7d3a7, the first Lead run to complete end to end. It discovered
// 29 companies, resolved ONE identity, and stopped:
//
//   investigation_capacity  { capacity: 1, usable_ms: 26756, identity_call_ms: 22702 }
//   company_identity_resolution  "1 resolved, 9 deferred, 0 provider error;
//                                 9 of 10 target(s) never reached a terminal state"
//   auto_continuation  { decision: "frontier_exhausted", continuing: false,
//                        detail: "every discovered candidate has been investigated" }
//
// That detail is false. Nineteen candidates were deferred for time capacity,
// never investigated, and the run told the user the frontier was exhausted —
// then abandoned 28 of 29 companies. Nothing qualified, so no canonical event
// was written, so Phase 8's chain could not be proven.
//
// `decideAutoContinuation` was right: `frontierRemaining <= 0` IS exhaustion.
// The count handed to it was wrong. `isFrontier` recognises only
// `pending_investigation`, and a deferred company has already been moved to
// `in_flight`/`investigated` by the slice that budgeted it — so it disappears
// from the frontier without ever having been looked at.
//
// The engine already records the distinction: `stage_block.reason === "deferred"`,
// which its own comment calls "budgeted and abandoned". This reads it.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFrontier,
  isUnfinishedFrontier,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

const base = {
  qualified: 0, requestedCount: 3, continuationsUsed: 0, maxContinuations: 5,
  costUnitsUsed: 3, maxCostUnits: 100, barrenSlices: 0,
};

Deno.test("a deferred company is still on the frontier", () => {
  // The exact live shape: budgeted, moved out of `pending_investigation` by the
  // slice, then never reached because capacity ran out.
  assertEquals(isFrontier("investigated"), false, "precondition");
  assert(
    isUnfinishedFrontier("investigated", true),
    "a company that was budgeted and abandoned has not been investigated",
  );
  assert(isUnfinishedFrontier("in_flight", true));
});

Deno.test("a genuinely investigated company is NOT on the frontier", () => {
  assertEquals(isUnfinishedFrontier("investigated", false), false);
  assertEquals(isUnfinishedFrontier("in_flight", false), false);
});

Deno.test("a permanently excluded company never returns to the frontier", () => {
  // GPT said irrelevant, or a mission constraint closed it. Re-queueing that
  // would spend again on a decision already made.
  assertEquals(isUnfinishedFrontier("excluded_permanently", true), false);
  assertEquals(isUnfinishedFrontier("excluded_permanently", false), false);
});

Deno.test("pending_investigation is on the frontier either way", () => {
  assert(isUnfinishedFrontier("pending_investigation", false));
  assert(isUnfinishedFrontier("pending_investigation", true));
});

// ── what the corrected count does to the decision ──────────────────────────

Deno.test("deferred candidates continue the run instead of ending it", () => {
  // 19 deferred, quota unmet — the live case. This must not stop.
  const d = decideAutoContinuation({ ...base, frontierRemaining: 19 });
  assertEquals(d.continue, true);
  assertEquals(d.reason, "quota_unmet_frontier_remains");
});

Deno.test("a truly empty frontier still ends the run honestly", () => {
  const d = decideAutoContinuation({ ...base, frontierRemaining: 0 });
  assertEquals(d.continue, false);
  assertEquals(d.reason, "frontier_exhausted");
});

Deno.test("the ceilings still stop a run with candidates left", () => {
  // Continuing is not unconditional: a frontier that remains must still respect
  // the continuation and cost ceilings, or a capacity-limited run would loop.
  assertEquals(
    decideAutoContinuation({
      ...base, frontierRemaining: 19, continuationsUsed: 5, maxContinuations: 5,
    }).continue, false);
  assertEquals(
    decideAutoContinuation({
      ...base, frontierRemaining: 19, costUnitsUsed: 100, maxCostUnits: 100,
    }).continue, false);
});

// ── THE CALL SITE, NOT JUST THE HELPER ─────────────────────────────────────
//
// The tests above exercise `isUnfinishedFrontier` directly, so they pass even
// when run-agent computes the frontier the old way — which is precisely the bug
// that shipped. The same hole appeared in the compiler fold and cost a live run
// there too, so the call site is pinned by source.

Deno.test("run-agent counts deferred companies into the frontier", () => {
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const block = RUN.slice(
    RUN.indexOf("const sliceFrontier"),
    RUN.indexOf("const sliceFrontier") + 700,
  );
  assert(
    block.includes("isUnfinishedFrontier"),
    "the continuation frontier must use the deferred-aware predicate",
  );
  assert(
    /stage_block\?\.reason === "deferred"/.test(block),
    "and it must read the engine's own deferral signal",
  );
  assertEquals(
    /\(c\) => isFrontier\(c\.investigation_state\)\)\.length/.test(block), false,
    "the pending-only count is what reported an exhausted frontier for 19 deferred candidates",
  );
});

// ── NO-ONE-ASKED IS NOT NOTHING-THERE, FOR THE NEW DISCOVERY PATH ─────────
//
// `hiring_verification` skips its paid check when the free assessment finds no
// openings, scoped by `jobEvidenceNeverCollected`. That scope was
// `source_provenance === "mission_supplied"`, on the stage's stated reasoning
// that every other company "arrived from a discovery provider that either
// answered the jobs question or was chosen knowing it would not".
//
// True while general discovery meant YC. False the moment it became
// `apify_linkedin_company_search`, which returns no job data at all — so its
// companies carry an empty job list because nothing looked.
//
// Run 93218483, live: 11 identities resolved, ZERO paid hiring calls, "no
// company had a relevant commercial role", 27 companies reaching qualification
// with no hiring assessment.

import { actorAnsweredHiring } from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";

Deno.test("the LinkedIn company search never answers the jobs question", () => {
  // By actor_key and by the actor_id carried in `source_provenance`.
  assertEquals(actorAnsweredHiring("apify_linkedin_company_search"), false);
  assertEquals(actorAnsweredHiring("harvestapi/linkedin-company-search"), false);
});

Deno.test("the YC scraper DOES answer it, so its empty list is a real absence", () => {
  assert(actorAnsweredHiring("apify_yc_companies_memo23"));
  assert(actorAnsweredHiring("memo23/y-combinator-scraper"));
});

Deno.test("an unknown or supplied provenance answers false", () => {
  // A supplied row had no Actor produce it, so nobody asked.
  assertEquals(actorAnsweredHiring("mission_supplied"), false);
  assertEquals(actorAnsweredHiring(""), false);
});

Deno.test("the hiring gate derives the scope instead of listing provenances", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("const jobEvidenceNeverCollected");
  const block = ENGINE.slice(i, i + 400);
  assert(
    block.includes("actorAnsweredHiring"),
    "the scope must be derived from ACTOR_EVIDENCE",
  );
  assertEquals(
    block.includes("SUPPLIED_COMPANY_PROVENANCE"), false,
    "a provenance allow-list cannot keep step with new discovery Actors",
  );
});

// ── A CALL THAT CANNOT FINISH MUST NOT BE STARTED ─────────────────────────
//
// Run 78cff5e5 hung. The hiring fix worked — `harvestapi/linkedin-job-search`
// was finally called, for a real staffing firm, with twenty sales titles — but
// it began at 09:13:05 with ~29s of budget left, was hard-killed mid-call, and
// left the task `running` with no terminal record and `updated_at` frozen at
// creation.
//
// Measured on the real payload: 2 titles finished in 13.9s; the production
// 20-title call was still running at 46s. The operation had no entry in
// `ASSUMED_MS_BY_OP`, so it inherited the generic ~12s assumption, and the call
// site asked `expired()` with no operation — which compares against the slowest
// estimate observed so far, i.e. some other, faster stage.

import { createExecutionDeadline } from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";

Deno.test("a job search is refused when it cannot fit the remaining budget", () => {
  let now = 0;
  const d = createExecutionDeadline({ budgetMs: 125_000, now: () => now });
  now = 96_000; // the live moment: ~29s left
  assertEquals(
    d.expired("apify_linkedin_job_search"), true,
    "29s cannot hold a call measured still running at 46s",
  );
});

Deno.test("the same moment looks fine without naming the operation", () => {
  // The exact hole: the unscoped question compares against a faster stage.
  let now = 0;
  const d = createExecutionDeadline({ budgetMs: 125_000, now: () => now });
  now = 96_000;
  assertEquals(
    d.expired(), false,
    "this is why the call was started — the check was asked the wrong question",
  );
});

Deno.test("a fresh continuation has room for the job search", () => {
  let now = 0;
  const d = createExecutionDeadline({ budgetMs: 125_000, now: () => now });
  now = 10_000; // early in a continuation slice
  assertEquals(d.expired("apify_linkedin_job_search"), false);
});

// ── AND THEN THE OPERATION TURNED OUT NOT TO FIT ANY SLICE ────────────────
//
// The two tests above still hold: 29s cannot complete a 20-title job search,
// and the unscoped question wrongly says it can. What changed is the CONCLUSION
// drawn from that.
//
// Task 783fa163 measured the operation properly — 72.0s for one company
// (Ot2Jpwe8ezMvbe6Eu), 796.4s for ten (Zs5bYFGlnua1hJWYg), linear in
// company×title queries. Even ONE company exceeds the 60s estimate, so
// `expired("apify_linkedin_job_search")` is true from the moment the stage
// begins and hiring verification would be deferred for ever.
//
// Persist-on-start is what makes the right question answerable. The run id
// reaches `lead_execution_calls` before any polling, so a slice killed while
// waiting loses nothing and the next slice adopts the run with a free GET. The
// call site therefore asks whether it can START the call durably, not whether
// it can finish it.

Deno.test("the hiring call site asks whether it can start durably", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  assert(
    ENGINE.includes("deps.deadline?.expiredForDurableStart()"),
    "the paid hiring check must ask a question that can be true",
  );
  assertEquals(
    ENGINE.includes('deps.deadline?.expired("apify_linkedin_job_search")'), false,
    "no batch of any size completes in a slice; asking that defers hiring for ever",
  );
});

Deno.test("starting durably is affordable at the moment completing is not", () => {
  let clock = 0;
  const d = createExecutionDeadline({ budgetMs: 125_000, now: () => clock });
  clock = 96_000; // run 78cff5e5's exact moment: ~29s left
  assertEquals(d.expired("apify_linkedin_job_search"), true);
  assertEquals(
    d.expiredForDurableStart(), false,
    "29s is ample to POST a run and persist its id, which is all that is at risk now",
  );
});

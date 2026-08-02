// TITLE EXHAUSTION IS NOT SEARCH EXHAUSTION.
//
// Production plan 43fb7313-138e-4496-83de-92c3e0b7392f (2026-07-29 09:08Z):
// dynamic source planning enabled, ordered plan accepted as
// indeed → linkedin → glassdoor → ats, Indeed ran once, the duplicate second
// Indeed input was correctly blocked, and the state read
//
//   active_step_id:      s2-linkedin_job_discovery
//   pending_next_action: advance_to_next_source
//
// with LinkedIn, Glassdoor and ATS all `pending`. The controller nevertheless
// returned `terminal_status: search_exhausted` at 0 of 5.
//
// Two separate causes, both covered here:
//   1. every `search_exhausted` branch was really "this SOURCE's titles are
//      spent" and never asked whether another source remained;
//   2. the delta-title ledger was GLOBAL, so even after advancing, LinkedIn
//      would have found zero new titles and exhausted immediately.
//
// OFFLINE ONLY. No provider, no model, no network, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  newSourcingState, deltaTitles, recordAttemptedTitles,
} from "../../supabase/functions/_shared/companyFirstSourcingState.ts";
import { isStepFinished, type SourceStepRecord } from "../../supabase/functions/_shared/sourceExecutionState.ts";

const TITLES = ["Sales Operations", "Revenue Operations", "GTM Operations"];

function state() {
  return newSourcingState({
    workspaceId: "e510c1a6-2bb8-4aa4-95f7-0beb786ed995",
    taskId: "a79bc246-8341-4311-8f14-18de5bce29be",
    requestedLeadCount: 5,
    quotaPolicy: "contact_only",
  });
}

// ================================= the per-source delta ledger (cause 2) ====

Deno.test("1./9. a title Indeed searched is still new to LinkedIn", () => {
  const s = state();
  recordAttemptedTitles(s, TITLES, "apify_indeed_jobs_automation_lab");

  // Indeed will not repeat its own titles.
  assertEquals(deltaTitles(s, TITLES, "apify_indeed_jobs_automation_lab"), []);
  // LinkedIn has searched nothing, so all three are available to it. Under the
  // global ledger this returned [] and ended the mission.
  assertEquals(deltaTitles(s, TITLES, "apify_linkedin_jobs_crawlworks"), TITLES);
  // The global audit trail still records everything.
  assertEquals(s.attempted_titles, TITLES);
});

Deno.test("2. Glassdoor is likewise unaffected by what Indeed and LinkedIn searched", () => {
  const s = state();
  recordAttemptedTitles(s, TITLES, "apify_indeed_jobs_automation_lab");
  recordAttemptedTitles(s, TITLES, "apify_linkedin_jobs_crawlworks");
  assertEquals(deltaTitles(s, TITLES, "apify_glassdoor_jobs"), TITLES);
  assertEquals(deltaTitles(s, TITLES, "apify_linkedin_jobs_crawlworks"), []);
});

Deno.test("the global ledger is preserved for callers that pass no source", () => {
  // Single-source behaviour must be untouched.
  const s = state();
  recordAttemptedTitles(s, TITLES);
  assertEquals(deltaTitles(s, TITLES), []);
  assertEquals(deltaTitles(s, [...TITLES, "RevOps"]), ["RevOps"]);
});

Deno.test("18. recording the same titles twice is idempotent", () => {
  const s = state();
  recordAttemptedTitles(s, TITLES, "apify_indeed_jobs_automation_lab");
  recordAttemptedTitles(s, TITLES, "apify_indeed_jobs_automation_lab");
  recordAttemptedTitles(s, ["sales operations"], "apify_indeed_jobs_automation_lab");
  assertEquals(s.attempted_titles.length, 3, "case-insensitive, no duplicates");
  assertEquals(s.attempted_titles_by_source?.["apify_indeed_jobs_automation_lab"]?.length, 3);
});

Deno.test("a restored pre-multi-source checkpoint keeps working", () => {
  // `attempted_titles_by_source` absent — fall back to the global ledger rather
  // than treating every title as unsearched.
  const s = state();
  s.attempted_titles = [...TITLES];
  delete s.attempted_titles_by_source;
  assertEquals(deltaTitles(s, TITLES), []);
  // A source-scoped query on a legacy state finds no per-source history, which is
  // the correct answer: that source has provably not run in this task.
  assertEquals(deltaTitles(s, TITLES, "apify_linkedin_jobs_crawlworks"), TITLES);
});

// ============================ the pending-source oracle (cause 1) ===========

/** The production step list, verbatim from the run's `sequential_source_execution`. */
function steps(overrides: Partial<Record<string, SourceStepRecord["status"]>> = {}): SourceStepRecord[] {
  const mk = (order: number, id: string, cap: string, actor: string): SourceStepRecord => ({
    step_id: id, capability: cap, actor_key: actor, order,
    status: overrides[id] ?? "pending",
    attempts: 0, broadening_used: [], input_hashes: [], idempotency_keys: [],
    contact_ready_delta: 0, cost: 0, failure_category: null, inactive_reason: null,
  });
  return [
    mk(1, "s1-indeed_job_discovery", "indeed_job_discovery", "apify_indeed_jobs_automation_lab"),
    mk(2, "s2-linkedin_job_discovery", "linkedin_job_discovery", "apify_linkedin_jobs_crawlworks"),
    mk(3, "s3-glassdoor_job_discovery", "glassdoor_job_discovery", "apify_glassdoor_jobs"),
    mk(4, "s4-ats_job_verification", "ats_job_verification", "apify_ats_verification"),
  ];
}

/** The bridge's accessor, reproduced: lowest-order unfinished DISCOVERY step. */
function nextPendingDiscovery(all: SourceStepRecord[], verificationStepIds: string[]) {
  const excluded = new Set(verificationStepIds);
  const next = [...all].sort((a, b) => a.order - b.order)
    .find((s) => !excluded.has(s.step_id) && !isStepFinished(s));
  return next
    ? { pending: true, stepId: next.step_id, capability: next.capability, actorKey: next.actor_key }
    : { pending: false, stepId: null, capability: null, actorKey: null };
}

const ATS = ["s4-ats_job_verification"];

Deno.test("5. with LinkedIn pending, a source is available — search must not be exhausted", () => {
  // Production's exact state: Indeed completed, the rest pending.
  const next = nextPendingDiscovery(steps({ "s1-indeed_job_discovery": "completed" }), ATS);
  assert(next.pending, "another discovery source remained the whole time");
  assertEquals(next.stepId, "s2-linkedin_job_discovery");
  assertEquals(next.actorKey, "apify_linkedin_jobs_crawlworks");
});

Deno.test("1./2. progression follows plan order: indeed → linkedin → glassdoor", () => {
  const afterIndeed = nextPendingDiscovery(steps({ "s1-indeed_job_discovery": "exhausted" }), ATS);
  assertEquals(afterIndeed.capability, "linkedin_job_discovery");

  const afterLinkedIn = nextPendingDiscovery(steps({
    "s1-indeed_job_discovery": "exhausted", "s2-linkedin_job_discovery": "exhausted",
  }), ATS);
  assertEquals(afterLinkedIn.capability, "glassdoor_job_discovery");
});

Deno.test("6./17. only after every DISCOVERY source is terminal is the search exhausted", () => {
  // ATS still pending — but it is verification, not discovery, so it is not a
  // reason to keep searching. It needs a known company identity.
  const allDiscoveryDone = nextPendingDiscovery(steps({
    "s1-indeed_job_discovery": "exhausted",
    "s2-linkedin_job_discovery": "exhausted",
    "s3-glassdoor_job_discovery": "exhausted",
  }), ATS);
  assertFalse(allDiscoveryDone.pending, "a pending ATS step must not extend discovery");
  assertEquals(allDiscoveryDone.stepId, null);
});

Deno.test("every terminal step status counts as finished", () => {
  for (const status of ["completed", "exhausted", "failed", "inactive_quota_met"] as const) {
    const next = nextPendingDiscovery(steps({
      "s1-indeed_job_discovery": status,
      "s2-linkedin_job_discovery": status,
      "s3-glassdoor_job_discovery": status,
    }), ATS);
    assertFalse(next.pending, status);
  }
});

Deno.test("10. once the quota is met every remaining source is inactive", () => {
  // `inactive_quota_met` is the runtime's own marker for "stopped because we are
  // done", and it must terminate progression like any other finished state.
  const next = nextPendingDiscovery(steps({
    "s1-indeed_job_discovery": "completed",
    "s2-linkedin_job_discovery": "inactive_quota_met",
    "s3-glassdoor_job_discovery": "inactive_quota_met",
  }), ATS);
  assertFalse(next.pending);
});

Deno.test("8. a continuation resumes at the next source, not back at Indeed", () => {
  // Indeed finished in the prior invocation; the restored state must not offer it
  // again, and must not repeat its completed input.
  const restored = steps({ "s1-indeed_job_discovery": "completed" });
  restored[0].input_hashes = ["b0420d06a07d"];
  const next = nextPendingDiscovery(restored, ATS);
  assertEquals(next.stepId, "s2-linkedin_job_discovery");
  assertFalse(next.stepId === "s1-indeed_job_discovery");
  // The completed input is still recorded, so it cannot be re-paid.
  assertEquals(restored[0].input_hashes, ["b0420d06a07d"]);
});

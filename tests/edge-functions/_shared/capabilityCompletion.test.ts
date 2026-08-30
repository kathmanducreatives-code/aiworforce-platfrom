// A COMPLETED CAPABILITY IS NOT NECESSARILY A FINISHED ONE.
//
// ── WHAT IT COST, GENERATION 21 ────────────────────────────────────────────
//
// Every capability reported `skipped_resumed / "completed in an earlier run"`,
// `evidence_satisfied: true`, `pending: []`. The run declared itself finished.
// The twenty-one resolved companies stood like this:
//
//    4  verified_externally  qualified   ← the four leads
//    2  verified_externally  rejected    (attribution: a client's roles)
//    4  not_verified         —           settled, a real finding
//   11  evidence_unavailable not_started ← never asked
//
// `evidence_unavailable` is the state Phase 3 created so a company WOULD be
// asked again; `nextStageFor` routes every one of those eleven to "hiring". The
// stage was skipped before it could look, so a run with eleven unexamined
// candidates stopped at 4 of 5 leads and called itself complete.
//
// `completed_capabilities` records that a stage RAN. It does not record that
// every company reached a terminal state, and those are different facts — the
// same conflation `not_verified` carried before Phase 3 split it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  capabilityStillOwed, CAPABILITY_STAGE, nextStageFor, shouldSkipProviderCall,
  type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const rec = (over: Partial<CompanyResumeRecord> = {}): CompanyResumeRecord => ({
  company_key: "k", company_name: "C",
  identity: "resolved", enrichment: "completed", hiring: "verified_externally",
  brain: "qualified", founder: "not_eligible",
  linkedin_company_url: null, completed_operations: [],
  updated_at: "2026-08-30T16:23:00.000Z", ...over,
});

// ══ GENERATION 21 ═════════════════════════════════════════════════════════

Deno.test("THE ELEVEN ARE STILL OWED, whatever the capability says", () => {
  const set = [
    ...Array.from({ length: 4 }, () => rec()),                                  // qualified
    ...Array.from({ length: 2 }, () => rec({ brain: "rejected" })),             // attribution
    ...Array.from({ length: 4 }, () => rec({ hiring: "not_verified", brain: "not_started" })),
    ...Array.from({ length: 11 }, () =>
      rec({ hiring: "evidence_unavailable", brain: "not_started" })),
  ];
  assertEquals(set.filter((r) => nextStageFor(r) === "hiring").length, 11);
  assert(capabilityStillOwed("hiring_verification", set),
    "the stage must reopen for companies that never got their evidence");
});

Deno.test("a settled finding does NOT reopen the stage", () => {
  // `not_verified` is an answer — a settled call covered the company and
  // returned nothing matching. Reopening it would re-ask a question already
  // answered, which is what Phase 3 drew the line to prevent.
  const settled = [
    ...Array.from({ length: 4 }, () => rec({ hiring: "not_verified", brain: "not_started" })),
    ...Array.from({ length: 4 }, () => rec()),
  ];
  assertEquals(capabilityStillOwed("hiring_verification", settled), false);
});

Deno.test("a fully finished set leaves every capability closed", () => {
  const done = Array.from({ length: 6 }, () => rec());
  for (const cap of Object.keys(CAPABILITY_STAGE)) {
    assertEquals(capabilityStillOwed(cap, done), false, cap);
  }
});

// ══ WHAT MAY NEVER REOPEN ═════════════════════════════════════════════════

Deno.test("DISCOVERY IS NOT REOPENABLE — re-running it re-pays for the Actor", () => {
  // Deliberately absent from CAPABILITY_STAGE. Discovery fills the working set
  // and has no per-company frontier; a company cannot "still owe" it.
  for (const cap of ["general_company_discovery", "startup_company_discovery",
                     "job_discovery", "known_company_resolution", "persistence"]) {
    assert(!(cap in CAPABILITY_STAGE), `${cap} must have no stage`);
    assertEquals(capabilityStillOwed(cap, [rec({ identity: "not_started" })]), false, cap);
  }
});

Deno.test("an unknown capability never reopens", () => {
  assertEquals(capabilityStillOwed("wishful_thinking", [rec({ hiring: "not_started" })]), false);
});

// ══ THE SAFETY THIS RESTS ON ══════════════════════════════════════════════

Deno.test("REOPENING CANNOT RE-BUY — the finer guard is per company, per key", () => {
  // This is the fact that makes the stage-level skip removable rather than
  // load-bearing: the money is protected at the CALL, keyed on
  // `completed_operations`, not at the stage.
  const OP = "lead-resume-state-v1|ws|lin|k|hiring_verification|apify_linkedin_job_search|de62e507";
  const alreadyPaid = rec({ hiring: "evidence_unavailable", completed_operations: [OP] });
  assertEquals(shouldSkipProviderCall(alreadyPaid, OP),
    { skip: true, reason: "already_completed" },
    "a search already paid for is refused even though the stage reopened");
  // And a company that genuinely never had the call still gets one.
  const neverAsked = rec({ hiring: "evidence_unavailable" });
  assertEquals(shouldSkipProviderCall(neverAsked, OP).skip, false);
});

Deno.test("every stage in the map is one `nextStageFor` actually returns", () => {
  // A stage name that never appears would make its capability permanently
  // closed — silently, which is how this defect looked from the outside.
  const reachable = new Set([
    nextStageFor(rec({ identity: "not_started" })),
    nextStageFor(rec({ enrichment: "deferred" })),
    nextStageFor(rec({ hiring: "evidence_unavailable", brain: "not_started" })),
    nextStageFor(rec({ brain: "not_started" })),
    nextStageFor(rec({ brain: "qualified", founder: "not_started" })),
  ]);
  for (const stage of Object.values(CAPABILITY_STAGE)) {
    assert(reachable.has(stage), `${stage} is never routed to`);
  }
});

// ══ THE WIRING ════════════════════════════════════════════════════════════

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("THE SKIP GATE CONSULTS THE WORKING SET", () => {
  assert(/const owedByCompanies = state\.completed_capabilities\.includes\(cap\) &&\s*capabilityStillOwed\(cap, companies\.map\(toResumeRecord\)\)/.test(code),
    "completion must be checked against what companies still owe");
  assert(/includes\(cap\) && !owedByCompanies\) \{/.test(code),
    "and the skip must yield to it");
});

Deno.test("reopening is logged — a silent reopen is as bad as a silent skip", () => {
  assert(code.includes("capability_reopened_for_outstanding_companies"));
});

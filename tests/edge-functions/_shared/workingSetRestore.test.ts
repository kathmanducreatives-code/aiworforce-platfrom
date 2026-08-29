// THE COMPANIES CAME BACK. THEIR EVIDENCE DID NOT.
//
// Task 02ea3aed, 2026-08-29 09:48, on the build that had just fixed Continue.
// The resume worked exactly as designed:
//
//   general_company_discovery    skipped_resumed  "completed in an earlier run"
//   50 companies restored, 21 shortlisted
//   0 Actor calls, 0 charged
//
// and then produced nothing:
//
//   company_identity_resolution  "0 resolved, 10 deferred; 10 of 21 targets"
//   hiring_verification          skipped_resumed
//   company_brain_qualification  "the eligible set was empty
//                                 (50 companies carried no hiring assessment)"
//
// Eleven of those records carry a real `snapshot.identity` with
// `status: "verified_match"`. The parent had four companies verified from 148
// paid job rows. Every stage after identity selects on the OBJECT — so a pool
// restored with `identity: null` is a pool no downstream stage can see.
//
// ── THE INVARIANT ──────────────────────────────────────────────────────────
//
//   A capability may be marked completed only if every piece of state the
//   capabilities after it require is durably checkpointed.
//
// `checkpointSnapshot` checked one instance of it — discovery must have
// produced companies — and that is how the next instance shipped. It is a table
// now, so a capability added later is a row rather than an incident.
//
// Pure. No network, no database, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RUN_02EA3AED_COMPANIES, RUN_02EA3AED_RESULT,
} from "../../fixtures/run02ea3aedCheckpoint.ts";
import {
  RUN_43355471_COMPANIES, RUN_43355471_RESULT,
} from "../../fixtures/run43355471Checkpoint.ts";
import {
  checkpointCoherence, checkpointSnapshot, restoreWorkingSet, toResumeRecord,
  type CapabilityExecutionState,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type {
  CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import {
  assessCheckpointResume,
} from "../../../supabase/functions/_shared/workflowContinuation.ts";

const records = (rows: unknown[]) => rows as unknown as CompanyResumeRecord[];

// ── 1. the boundary, named ─────────────────────────────────────────────────

Deno.test("1. the checkpoint really does carry the identities", () => {
  const withIdentity = RUN_02EA3AED_COMPANIES.filter((c) => c.snapshot?.identity);
  assertEquals(withIdentity.length, 11, "eleven resolved identity objects were saved");
  assertEquals(withIdentity[0].snapshot.identity.status, "verified_match");
  assertEquals(RUN_02EA3AED_COMPANIES.filter(
    (c) => c.snapshot?.shortlisted === true).length, 21);
});

Deno.test("2. REGRESSION: restoring must bring the identity back, not just the company", () => {
  const restored = restoreWorkingSet(records(RUN_02EA3AED_COMPANIES));
  assertEquals(restored.length, 50, "every company restores");

  const resolved = restored.filter((c) => c.identity !== null);
  assertEquals(resolved.length, 11,
    "and the eleven that had a resolved identity come back WITH it — " +
    "restored as null, every stage after identity sees an empty pool");

  const storm4 = restored.find((c) => c.key.endsWith("/storm4"));
  assert(storm4, "storm4 must be in the working set");
  assertEquals(storm4!.identity?.status, "verified_match");
  assertEquals(storm4!.identity?.linkedin_company_url,
    "https://www.linkedin.com/company/storm4");
});

Deno.test("3. and the shortlist and triage survive with it", () => {
  const restored = restoreWorkingSet(records(RUN_02EA3AED_COMPANIES));
  // `shortlisted` is derived from the investigation state on restore, so the
  // assertion is on what the identity stage actually targets.
  assertEquals(restored.filter((c) => c.shortlisted).length, 21);
  assertEquals(restored.filter((c) => c.triage !== null).length,
    RUN_02EA3AED_COMPANIES.filter((c) => c.snapshot?.triage).length);
});

// ── 4. the round trip ──────────────────────────────────────────────────────

Deno.test("4. a hiring verdict survives write → read → write", () => {
  const restored = restoreWorkingSet(records(RUN_02EA3AED_COMPANIES));
  const c = restored.find((x) => x.key.endsWith("/storm4"))!;
  // Give it the verdict the parent actually earned from 148 paid job rows.
  c.hiring_assessment = {
    verdict: "hiring_verified", evidence_source: "external_job_search",
    reason: 'Tier A commercial role "Account Executive" is sufficient on its own',
    supporting_signals: [], commercial_roles: 3,
    // deno-lint-ignore no-explicit-any
  } as any;
  c.hiring_jobs = [{ title: "Account Executive", job_url: "https://x/1",
    // deno-lint-ignore no-explicit-any
    company_linkedin_url: "https://www.linkedin.com/company/storm4" } as any];

  const rec = toResumeRecord(c);
  assertEquals(rec.hiring, "verified_externally", "the LABEL is written");
  assert(rec.snapshot?.hiring_assessment,
    "and so is the VERDICT — the label alone is what the Brain cannot read");
  assertEquals(rec.snapshot!.hiring_jobs?.length, 1,
    "with the rows it cites, or the citation has no evidence");

  const back = restoreWorkingSet(records([rec]))[0];
  assertEquals(back.hiring_assessment?.verdict, "hiring_verified");
  assertEquals(back.hiring_jobs.length, 1);
});

// ── 5. the invariant, enforced ─────────────────────────────────────────────

const stateWith = (completed: string[]): CapabilityExecutionState => ({
  ...RUN_02EA3AED_RESULT.capability_execution_state,
  completed_capabilities: completed,
}) as CapabilityExecutionState;

Deno.test("5. a record that claims a resolution it did not save is INCOHERENT", () => {
  const restored = restoreWorkingSet(records(RUN_02EA3AED_COMPANIES));
  const written = checkpointSnapshot(
    stateWith(["general_company_discovery", "company_identity_resolution"]), restored);
  assertEquals(written.coherent, true, "written in full, the checkpoint is coherent");

  // Strip the identity OBJECT and keep the "resolved" LABEL — the exact
  // divergence a resume cannot see through, and the shape the pre-fix restore
  // produced on every continuation.
  const lying = written.resume_records.map((r) =>
    r.identity === "resolved" ? { ...r, snapshot: { ...r.snapshot!, identity: null } } : r);

  const verdict = checkpointCoherence(
    ["general_company_discovery", "company_identity_resolution"], lying);
  assertEquals(verdict.coherent, false,
    "such a checkpoint must never be advertised as safely resumable");
  assert(verdict.incoherence?.includes("company_identity_resolution"));
  assert(verdict.incoherence?.includes("11 company(ies)"),
    `eleven records claim a resolution: ${verdict.incoherence}`);
});

Deno.test("6. and so does one that claims a hiring verdict it did not save", () => {
  const restored = restoreWorkingSet(records(RUN_02EA3AED_COMPANIES));
  const c = restored.find((x) => x.key.endsWith("/storm4"))!;
  // deno-lint-ignore no-explicit-any
  c.hiring_assessment = { verdict: "hiring_verified",
    evidence_source: "external_job_search", supporting_signals: [] } as any;

  const written = checkpointSnapshot(
    stateWith(["general_company_discovery", "hiring_verification"]), restored);
  assertEquals(written.coherent, true, "the verdict IS saved now");

  const lying = written.resume_records.map((r) =>
    r.hiring === "verified_externally"
      ? { ...r, snapshot: { ...r.snapshot!, hiring_assessment: null } } : r);
  const verdict = checkpointCoherence(
    ["general_company_discovery", "hiring_verification"], lying);
  assertEquals(verdict.coherent, false,
    "this is the shape task 02ea3aed resumed from, and it was called safe");
  assert(verdict.incoherence?.includes("hiring_verification"));
});

Deno.test("6b. a capability NOT marked complete is never held to the rule", () => {
  const restored = restoreWorkingSet(records(RUN_02EA3AED_COMPANIES));
  const written = checkpointSnapshot(stateWith(["general_company_discovery"]), restored);
  const lying = written.resume_records.map((r) =>
    r.identity === "resolved" ? { ...r, snapshot: { ...r.snapshot!, identity: null } } : r);
  assertEquals(
    checkpointCoherence(["general_company_discovery"], lying).coherent, true,
    "a stage still pending owes the checkpoint nothing — it has not claimed anything",
  );
});

// ── 7. and the promise the user is shown ───────────────────────────────────

Deno.test("7. both production checkpoints are advertised truthfully", () => {
  const a = assessCheckpointResume(RUN_43355471_RESULT);
  assertEquals(a.resumable, true);
  assertEquals(a.restorable_companies, 50);
  assertEquals(a.restorable_shortlisted, 10);
  assertEquals(a.next_capability, "company_identity_resolution");

  const b = assessCheckpointResume(RUN_02EA3AED_RESULT);
  assertEquals(b.resumable, true);
  assertEquals(b.restorable_companies, 50);
  assertEquals(b.restorable_shortlisted, 21);
  assertEquals(b.next_capability, "company_identity_resolution",
    "the first UNFINISHED capability, not the first in the plan");

  // The same verdict via the records, which is how run-agent asks it.
  assertEquals(
    assessCheckpointResume({ capability_execution_state:
      RUN_02EA3AED_RESULT.capability_execution_state }, RUN_02EA3AED_COMPANIES).resumable,
    true, "the notice and the gate must never disagree");
});

Deno.test("8. 43355471 restores its own 50 and 10 with identities intact", () => {
  const restored = restoreWorkingSet(records(RUN_43355471_COMPANIES));
  assertEquals(restored.length, 50);
  assertEquals(restored.filter((c) => c.shortlisted).length, 10);
  const withIdentity = RUN_43355471_COMPANIES.filter((c) => c.snapshot?.identity).length;
  assertEquals(restored.filter((c) => c.identity !== null).length, withIdentity,
    "whatever identity work was paid for comes back");
});

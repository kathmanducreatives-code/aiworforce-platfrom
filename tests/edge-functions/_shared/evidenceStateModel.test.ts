// ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE.
//
// ── WHAT THE OLD STATE MODEL COST ──────────────────────────────────────────
//
// `hiring: "not_verified"` meant two different things and `nextStageFor` treated
// both as final. On 2026-08-29, lineage 06d3544a, every company ended in it:
//
//   Blue Signal Search   83 rows bought, charged, never read   → not_verified
//   Pursuit / Coda        90 rows bought, timed out, never read → not_verified
//   Storm4                4 rows read by another generation     → not_verified
//   intelletec-ltd        covered by a settled call, 0 rows      → not_verified
//
// Only the last one is a finding. The other three are "we did not find out",
// and calling them a verdict is what turned a scheduling failure into a
// permanent business answer — a company nothing would ever revisit.
//
// The discriminator is NOT "did the assessment see rows for this company". A
// company can be legitimately negative with zero rows of its own, when the batch
// it was in settled and named somebody else. It is WHETHER A SETTLED PROVIDER
// CALL COVERED IT, which `completed_operations` records durably.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  nextStageFor, companyIsComplete, readCheckpointCompanies,
  RESUME_STATE_VERSION, type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import {
  hiringEvidenceWasInspected,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  reachesCompanyBrain,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";

const record = (over: Partial<CompanyResumeRecord> = {}): CompanyResumeRecord => ({
  company_key: "https://www.linkedin.com/company/storm4",
  company_name: "Storm4",
  identity: "resolved", enrichment: "completed", hiring: "not_started",
  brain: "not_started", founder: "not_eligible",
  linkedin_company_url: "https://www.linkedin.com/company/storm4",
  completed_operations: [], updated_at: new Date().toISOString(),
  ...over,
});

/** The real shape, from a production checkpoint. */
const HIRING_OP =
  "lead-resume-state-v1|e8af257d-4c42-4fc2-9d62-037cdfac27c4|" +
  "06d3544a-7ff4-483d-8d92-362ce1981e69|https://www.linkedin.com/company/storm4|" +
  "hiring_verification|apify_linkedin_job_search|de62e507";

// ── THE STATE MACHINE ───────────────────────────────────────────────────────

Deno.test("`evidence_unavailable` RESUMES — it is the frontier, not a verdict", () => {
  const r = record({ hiring: "evidence_unavailable" });
  assertEquals(nextStageFor(r), "hiring");
  assertEquals(companyIsComplete(r), false);
});

Deno.test("`not_verified` stays FINAL — a finding is a finding", () => {
  // The fix must not make the system unable to accept a negative answer.
  const r = record({ hiring: "not_verified" });
  assertEquals(nextStageFor(r), null);
  assertEquals(companyIsComplete(r), true);
});

Deno.test("a verified company still moves on to the Brain", () => {
  for (const hiring of ["verified_externally", "verified_from_existing_evidence"] as const) {
    assertEquals(nextStageFor(record({ hiring })), "brain", hiring);
  }
});

/** A checkpoint as it is actually stored on `tasks.result`. */
const checkpoint = (companies: unknown[]) => ({
  lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies },
});

Deno.test("the new state survives the checkpoint round trip", () => {
  // The parser validates each stage against an allowlist and falls back to
  // `not_started` for anything it does not know — so an unlisted state would be
  // silently erased on every restore, undoing the distinction each time a
  // continuation reads its own checkpoint back.
  const [parsed] = readCheckpointCompanies(
    checkpoint([record({ hiring: "evidence_unavailable" })]));
  assertEquals(parsed.hiring, "evidence_unavailable");
  assertEquals(nextStageFor(parsed), "hiring");
});

Deno.test("an UNKNOWN stage still falls back safely", () => {
  // A checkpoint is untrusted input; widening the allowlist must not weaken it.
  const [parsed] = readCheckpointCompanies(
    checkpoint([{ ...record(), hiring: "wishful_thinking" }]));
  assertEquals(parsed.hiring, "not_started");
});

// ── THE DISCRIMINATOR ───────────────────────────────────────────────────────

Deno.test("CITED EVIDENCE counts as having found out", () => {
  assert(hiringEvidenceWasInspected({
    hiring_assessment: { evidence_source: "external_job_search" },
    completed_operations: [],
  }));
  assert(hiringEvidenceWasInspected({
    hiring_assessment: { evidence_source: "yc_open_jobs" },
    completed_operations: [],
  }));
});

Deno.test("A SETTLED CALL counts even when it returned nothing for this company", () => {
  // intelletec-ltd, 2026-08-29: its batch completed and returned five rows, none
  // naming it. That is evidence of absence and it must stay a verdict — the
  // §16.1 replay proved the assessor reaches `hiring_not_verified` for it
  // legitimately.
  assert(hiringEvidenceWasInspected({
    hiring_assessment: { evidence_source: "none" },
    completed_operations: [HIRING_OP],
  }));
});

Deno.test("NOTHING AT ALL is not evidence", () => {
  // Blue Signal Search: 83 rows bought and never read. No cited source, no
  // settled operation.
  assertEquals(hiringEvidenceWasInspected({
    hiring_assessment: { evidence_source: "none" },
    completed_operations: [],
  }), false);
  // And a company whose only completed operations belong to other capabilities.
  assertEquals(hiringEvidenceWasInspected({
    hiring_assessment: { evidence_source: "none" },
    completed_operations: [HIRING_OP.replace("hiring_verification", "company_enrichment")],
  }), false);
});

Deno.test("a company with NO assessment at all has not been found out about", () => {
  assertEquals(hiringEvidenceWasInspected({ completed_operations: [] }), false);
});

// ── WHAT REACHES THE BRAIN ──────────────────────────────────────────────────

Deno.test("`watch` reaches the Brain, and that is what the loss also destroyed", () => {
  // Atlas Search should have been `watch`, which is Brain-eligible. Production
  // recorded `hiring_not_verified`, which is not. The loss was one company wider
  // than a count of verified companies suggests.
  for (const verdict of ["hiring_verified", "hiring_verification_needed", "watch"] as const) {
    assert(reachesCompanyBrain({
      verdict, tier: null, reason: "", commercial_jobs: [],
      evidence_source: "external_job_search", supporting_signals: [],
      needs_external_verification: false,
    } as never), verdict);
  }
  assertEquals(reachesCompanyBrain({
    verdict: "hiring_not_verified", tier: null, reason: "", commercial_jobs: [],
    evidence_source: "none", supporting_signals: [], needs_external_verification: false,
  } as never), false);
});

// ── THE ENGINE'S GUARDS, PINNED AT SOURCE ───────────────────────────────────
//
// Both are ordering and control-flow properties inside a 400KB function that no
// unit test can reach without standing up the whole engine. Pinned at source
// because each one is a single deletable line, and deleting either restores the
// exact production failure.

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

Deno.test("a verdict is only written when somebody found out", () => {
  assert(
    /\} else if \(hiringEvidenceWasInspected\(c\) \|\| asked\.has\(c\.key\)\)/.test(code),
    "the negative branch must require inspected evidence or a settled ask",
  );
  assert(code.includes("unavailable++"),
    "and the other case must be counted as the frontier, not as a verdict");
});

Deno.test("the record mapping distinguishes the two cases", () => {
  assert(
    /hiringEvidenceWasInspected\(c\) \? "not_verified"\s*:\s*"evidence_unavailable"/.test(code),
    "toResumeRecord must not collapse both into not_verified",
  );
});

Deno.test("A CITED VERDICT CANNOT BE OVERWRITTEN BY AN EMPTY ONE", () => {
  // Blue Signal Search held `hiring_verified` citing 13 rows; a later pass ran
  // the free assessor over a working set that no longer carried them and
  // replaced it with "No open roles at all".
  assert(code.includes("priorWasCited"), "the monotonic guard must exist");
  assert(/if \(priorWasCited && assessment\.evidence_source === "none"\)/.test(code),
    "and it must refuse exactly the empty-overwrites-cited case");
  // Narrow on purpose: a pass that DID inspect evidence may still change the
  // answer. Protecting a verdict from real evidence would be its own defect.
  assert(!/if \(priorWasCited\)\s*\{/.test(code),
    "the guard must not block a second opinion that actually looked");
});

// THE THIRD FIELD IN THIS SERIES, AND IT FAILED LIKE THE FIRST TWO.
//
//   identity            written, declared, not read back  → fixed after a run
//                       reported "no company had a relevant commercial role"
//   hiring_assessment   written, declared, not read back  → fixed after task
//                       02ea3aed reported "50 companies carried no hiring
//                       assessment"
//   brain               never written at all
//
// `CompanyResumeRecord.brain` is a STAGE ("qualified"). The engine's `c.brain`
// is the DECISION, set only by `decideCompanyBrain`. So every continuation began
// with `c.brain === null` for every company and re-decided what it had already
// qualified — and the identity stage's downstream reserve was charged for
// qualifying all of them again.
//
// Lineage 862e81be, generations 11 and 12: `model_evaluated: 3` both times, on
// the same three already-qualified companies. The reserve stayed at seven
// companies' worth — 114,000 ms against a 105,597 ms window — so identity
// resolution reported `targets: 21, attempted: 0` twice, while fourteen
// companies had never had a paid lookup. The run was capped at 3 of 5 leads.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readCheckpointCompanies, RESUME_STATE_VERSION, CHECKPOINT_RESERVE_MS,
  type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import {
  identityStopThreshold, resolveTimeCapacity,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";

/** A qualified company, as the engine holds it. */
const QUALIFIED_DECISION = {
  version: "company-semantic-fit-v1", outcome: "QUALIFIED",
  business_model: "b2b", confidence: 0.9, agentory_use_case: "outbound",
  failed_hard_gates: [], unknown_fields: [], supporting_evidence: ["hiring"],
  conflicting_evidence: [], reason: "strong ICP match", policy: {},
};

const rec = (over: Partial<CompanyResumeRecord> = {}): CompanyResumeRecord => ({
  company_key: "https://www.linkedin.com/company/storm4", company_name: "Storm4",
  identity: "resolved", enrichment: "completed", hiring: "verified_externally",
  brain: "qualified", founder: "not_started",
  linkedin_company_url: "https://www.linkedin.com/company/storm4",
  completed_operations: [], updated_at: "2026-08-30T15:43:00.000Z",
  snapshot: {
    company: {}, yc_open_jobs: [], prequalified: null, prequal_key: null,
    shortlisted: true, enriched: {}, hiring_jobs: [{ job_id: "1" }],
    hiring_assessment: { verdict: "hiring_verified", evidence_source: "external_job_search" },
    brain: QUALIFIED_DECISION,
  } as CompanyResumeRecord["snapshot"],
  ...over,
});

// ══ THE BOUNDARY ══════════════════════════════════════════════════════════

Deno.test("THE DECISION SURVIVES THE JSONB BOUNDARY", () => {
  // Through JSON on purpose — this state crosses a `jsonb` column, and the
  // previous two failures in this series were both invisible to a test that
  // handed typed objects straight to the restorer.
  const [parsed] = readCheckpointCompanies(JSON.parse(JSON.stringify({
    lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies: [rec()] },
  })));
  assert(parsed.snapshot?.brain, "the decision must come back");
  assertEquals((parsed.snapshot!.brain as Record<string, unknown>).outcome, "QUALIFIED");
  assertEquals((parsed.snapshot!.brain as Record<string, unknown>).reason, "strong ICP match");
});

Deno.test("a checkpoint written before this field simply has none", () => {
  const older = rec();
  delete (older.snapshot as unknown as Record<string, unknown>).brain;
  const [parsed] = readCheckpointCompanies(JSON.parse(JSON.stringify({
    lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies: [older] },
  })));
  assertEquals(parsed.snapshot?.brain, null, "absent degrades, never throws");
});

Deno.test("a malformed decision is dropped, not trusted", () => {
  for (const bad of ["QUALIFIED", 42, []]) {
    const c = rec();
    (c.snapshot as unknown as Record<string, unknown>).brain = bad;
    const [parsed] = readCheckpointCompanies(JSON.parse(JSON.stringify({
      lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies: [c] },
    })));
    assertEquals(parsed.snapshot?.brain, null, `${JSON.stringify(bad)}`);
  }
});

// ══ WHAT IT UNBLOCKS ══════════════════════════════════════════════════════

const CAPACITY = resolveTimeCapacity({
  remainingMs: 123_597, reserveMs: CHECKPOINT_RESERVE_MS,
  concurrency: 4, enrichmentBatchSize: 10, read: () => undefined,
  qualificationMs: 12_000,
});
const USABLE = 105_597;
const threshold = (n: number) => identityStopThreshold({
  resolvedSoFar: n, capacity: CAPACITY,
  checkpointReserveMs: CHECKPOINT_RESERVE_MS, perCallEstimateMs: 12_000,
});

Deno.test("GENERATION 12's RESERVE, BEFORE AND AFTER", () => {
  // The call site counts resolved identities that still owe enrichment or
  // qualification: `c.enriched === null || c.brain === null`.
  //
  // Without the restore, `c.brain` was null for all 7 → 7 counted → stage dead.
  assert(USABLE <= threshold(7), "this is what happened, twice");
  // With it, only the 4 that are genuinely unqualified count.
  assert(USABLE > threshold(4), "and this is what lets identity run");
});

// ══ THE LOOP HONOURS IT ═══════════════════════════════════════════════════

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("ALL FOUR PLACES, or the field does not survive", () => {
  assert(/brain: \(c\.brain \?\? null\)/.test(code), "1. the writer");
  assert(code.includes("c.brain = (s.brain ?? null)"), "3. the restore");
  const STATE = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadResumeState.ts", import.meta.url));
  assert(/brain\?: Record<string, unknown> \| null;/.test(STATE), "2. the interface");
  assert(/brain: asObjectOrNull\(s\.brain\)/.test(STATE), "4. the parser");
});

Deno.test("A RESTORED DECISION IS NOT RE-DECIDED", () => {
  assert(/if \(c\.brain !== null && restoredBrainKeys\.has\(c\.key\)\)/.test(code),
    "the loop must skip a decision this lineage already made");
  assert(code.includes('c.evaluation_path = "restored_decision"'),
    "and say so, rather than counting as a model evaluation it did not make");
});

Deno.test("the restored set is captured BEFORE the loop", () => {
  const setAt = code.indexOf("const restoredBrainKeys = new Set(");
  const loopAt = code.indexOf("for (let qIndex = 0; qIndex < eligibleOrdered.length");
  assert(setAt > -1 && loopAt > -1 && setAt < loopAt,
    "capturing it inside the loop would include verdicts the loop just made");
});

Deno.test("a QUALIFIED restore still counts as passed and persists", () => {
  const block = code.slice(code.indexOf("restoredBrainKeys.has(c.key)"));
  const body = block.slice(0, block.indexOf("continue;"));
  assert(/c\.brain\.outcome === "QUALIFIED"/.test(body));
  assert(/c\.verdict = "pass"/.test(body), "or the lead is never written");
  assert(/passed\+\+/.test(body), "and the count must include it");
});

Deno.test("a fresh company is still decided by the model", () => {
  // The fix must not make the engine unable to qualify anything new: only a
  // company that ALREADY carries a decision skips.
  const block = code.slice(code.indexOf("restoredBrainKeys.has(c.key)"));
  const body = block.slice(0, block.indexOf("continue;"));
  assert(body.length < 1400, "the skip is a narrow branch, not a rewrite");
  assert(code.includes("decideCompanyBrain({"), "fresh verdicts still go to the Brain");
});

Deno.test("restored decisions are reported separately from model evaluations", () => {
  assert(code.includes("restored_decisions: restoredDecisions"),
    "a continuation whose qualified count exceeds its evaluated count is " +
    "otherwise unreadable");
  assert(code.includes("restored_decision: 0"),
    "and the path must be counted in the telemetry totals");
});

// A DELIBERATELY INVALIDATED VERDICT MAY NOT BE RESURRECTED BY AN OLDER ROW.
//
// ── THE PREFLIGHT FINDING, 2026-08-30 ──────────────────────────────────────
//
// Storm4, Talentoma and Storm3 were rejected by the `staffing_or_aggregator`
// gate — the gate that was itself defective. The targeted repair cleared them
// back to `brain: not_started` on the lineage so the fixed gate could re-decide.
//
// Task `66ef37b7`'s row still said `brain: rejected`. Simulating the restore
// before spending showed:
//
//   parent 66ef37b7   lineage says not_started, row says rejected
//                     → merge clause 1 keeps "rejected"  → 0 companies to Brain
//   parent 862e81be   row also says not_started
//                     → 3 companies to Brain
//
// The acceptance run was only correct because the right parent was chosen. The
// merge cannot otherwise tell "this generation has not got there yet" from
// "somebody established this verdict was wrong" — both look unsettled.
//
// HIRING MONOTONICITY IS NOT WEAKENED. `hiring` is absent from
// INVALIDATABLE_STAGES, so cited evidence keeps clause 2's absolute protection.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeCompanyResumeRecords,
} from "../../../supabase/functions/_shared/lineageStateMerge.ts";
import {
  readCheckpointCompanies, nextStageFor, INVALIDATABLE_STAGES,
  RESUME_STATE_VERSION, type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const T0 = "2026-08-30T07:31:22.000Z";   // when 66ef37b7 wrote `rejected`
const T1 = "2026-08-30T09:32:02.000Z";   // when the repair cleared it
const T2 = "2026-08-30T10:50:39.000Z";   // a later generation

const rec = (over: Partial<CompanyResumeRecord> = {}): CompanyResumeRecord => ({
  company_key: "https://www.linkedin.com/company/storm4", company_name: "Storm4",
  identity: "resolved", enrichment: "completed", hiring: "verified_externally",
  brain: "not_started", founder: "not_eligible",
  linkedin_company_url: "https://www.linkedin.com/company/storm4",
  completed_operations: [], updated_at: T2,
  snapshot: {
    company: {}, yc_open_jobs: [], prequalified: null, prequal_key: null,
    shortlisted: true, enriched: {},
    hiring_jobs: [{ job_id: "1" }],
    hiring_assessment: { verdict: "hiring_verified", evidence_source: "external_job_search" },
  } as CompanyResumeRecord["snapshot"],
  ...over,
});

/** Task 66ef37b7's row: the stale `rejected`, written before the repair. */
const staleParent = rec({ brain: "rejected", updated_at: T0 });
/** The lineage after the repair: cleared, and stamped with when. */
const repairedLineage = rec({
  brain: "not_started", updated_at: T1,
  invalidated_stages: { brain: T1 },
});

// ══ THE EXACT 66ef37b7 → 862e81be REGRESSION ══════════════════════════════

Deno.test("66ef37b7's STALE `rejected` IS NOT RESURRECTED", () => {
  // run-agent's own call: lineage LEADS, parent row merged beneath.
  const m = mergeCompanyResumeRecords([staleParent], [repairedLineage]);
  assertEquals(m.records[0].brain, "not_started",
    "the invalidated verdict must not come back from the older row");
  assertEquals(nextStageFor(m.records[0]), "brain",
    "and the company must route to the Company Brain");
  assertEquals(m.summary.regressions_refused, 0);
});

Deno.test("WITHOUT the stamp, the old behaviour is preserved exactly", () => {
  // Proves the mechanism — not some unrelated change — is what fixes it, and
  // that clause 1 still protects a genuinely settled verdict.
  const unstamped = rec({ brain: "not_started", updated_at: T1 });
  const m = mergeCompanyResumeRecords([staleParent], [unstamped]);
  assertEquals(m.records[0].brain, "rejected");
  assertEquals(nextStageFor(m.records[0]), null);
  assertEquals(m.refused[0].why, "settled_beats_unsettled");
});

Deno.test("a verdict written AFTER the invalidation still wins", () => {
  // The stamp invalidates history, not the future. A generation that re-decided
  // the company post-repair holds a real verdict.
  const freshVerdict = rec({ brain: "rejected", updated_at: T2 });
  const m = mergeCompanyResumeRecords([freshVerdict], [repairedLineage]);
  assertEquals(m.records[0].brain, "rejected",
    "T2 > T1, so this verdict postdates the invalidation and stands");
});

Deno.test("THE STAMP TRAVELS, so the next generation cannot resurrect it either", () => {
  // The failure would otherwise recur one slice later: merge once, lose the
  // stamp, and the same old row wins next time.
  const m = mergeCompanyResumeRecords([staleParent], [repairedLineage]);
  assertEquals(m.records[0].invalidated_stages?.brain, T1);
  const again = mergeCompanyResumeRecords([staleParent], [m.records[0]]);
  assertEquals(again.records[0].brain, "not_started");
});

// ══ HIRING EVIDENCE IS NOT TOUCHED ════════════════════════════════════════

Deno.test("HIRING CANNOT BE INVALIDATED — evidence monotonicity is absolute", () => {
  assert(!INVALIDATABLE_STAGES.includes("hiring"),
    "a field that could un-settle hiring would be a way to destroy a paid citation");
  // Even a checkpoint that ASKS for it is refused at the parser.
  const forged = readCheckpointCompanies({
    lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies: [
      { ...rec(), invalidated_stages: { hiring: T1, brain: T1 } },
    ] },
  });
  assertEquals(forged[0].invalidated_stages, { brain: T1 },
    "`hiring` is dropped; `brain` survives");
});

Deno.test("a cited hiring verdict still beats an evidence-free one", () => {
  // Clause 2, unchanged, with an invalidation present on another stage.
  const uncited = rec({
    hiring: "not_verified", invalidated_stages: { brain: T1 },
    snapshot: { company: {}, yc_open_jobs: [], prequalified: null, prequal_key: null,
      shortlisted: true, enriched: {}, hiring_jobs: [],
      hiring_assessment: { verdict: "hiring_not_verified", evidence_source: "none" },
    } as CompanyResumeRecord["snapshot"],
  });
  const m = mergeCompanyResumeRecords([rec()], [uncited]);
  assertEquals(m.records[0].hiring, "verified_externally");
  assertEquals(m.refused[0].why, "cited_beats_uncited");
});

// ══ THE BOUNDARY ══════════════════════════════════════════════════════════

Deno.test("the stamp survives the jsonb round trip", () => {
  const parsed = readCheckpointCompanies(JSON.parse(JSON.stringify({
    lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies: [repairedLineage] },
  })));
  assertEquals(parsed[0].invalidated_stages?.brain, T1);
});

Deno.test("a malformed stamp is dropped, never trusted", () => {
  const parsed = readCheckpointCompanies({
    lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies: [
      { ...rec(), invalidated_stages: { brain: "whenever", wishful: T1 } },
    ] },
  });
  assertEquals(parsed[0].invalidated_stages, null);
});

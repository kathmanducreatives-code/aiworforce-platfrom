// ORDER IS NOT MONOTONICITY.
//
// ── THE REGRESSION, FROM PRODUCTION ────────────────────────────────────────
//
// Lineage 862e81be, 2026-08-30, lease enforced. Generation 2 bought a job search
// and wrote three cited verdicts. `resume-stalled-leads` then resumed the
// generation-1 task that had been KILLED before that evidence existed; it read
// its own row, concluded nothing was verified, and released last:
//
//   lineage current_state   Storm4/Talentoma/Storm3  not_verified   source: none
//   task 66ef37b7 row       Storm4/Talentoma/Storm3  verified_externally
//                                                    source: external_job_search
//
// `not_verified` is terminal, so three companies were finished for ever and the
// evidence they were bought with was stranded on a row nothing reads.
//
// The compare-and-swap did not fail. It could not: the sweeper's generation
// started AFTER generation 2 committed, so it read version 1 and quoted 1 back.
// The lease and the CAS serialise writers; a serialised writer carrying stale
// CONTENT still destroys newer content.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hiringIsCited, mergeCompanyResumeRecords, mergeLineageState, stageOwesWork,
} from "../../../supabase/functions/_shared/lineageStateMerge.ts";
import {
  nextStageFor, readCheckpointCompanies, RESUME_STATE_VERSION,
  type CompanyResumeRecord, type HiringStage, type IdentityStage,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const rec = (over: Partial<CompanyResumeRecord> = {}): CompanyResumeRecord => ({
  company_key: "https://www.linkedin.com/company/storm4",
  company_name: "Storm4",
  identity: "resolved", enrichment: "completed", hiring: "not_started",
  brain: "not_started", founder: "not_eligible",
  linkedin_company_url: "https://www.linkedin.com/company/storm4",
  completed_operations: [], updated_at: "2026-08-30T07:31:00.000Z",
  ...over,
});

/** A record whose verdict cites real rows, as the engine writes it. */
const cited = (hiring: HiringStage, source = "external_job_search") => rec({
  hiring,
  snapshot: {
    company: {}, yc_open_jobs: [], prequalified: null, prequal_key: null,
    shortlisted: true, enriched: {}, hiring_jobs: [{ job_id: "1", title: "Inside Sales Rep" }],
    hiring_assessment: { verdict: "hiring_verified", evidence_source: source },
  } as CompanyResumeRecord["snapshot"],
});

// ── THE REGRESSION ITSELF ───────────────────────────────────────────────────

Deno.test("STORM4'S CITED VERDICT SURVIVES THE STALE GENERATION", () => {
  const stored = [cited("verified_externally")];
  const incoming = [rec({
    hiring: "not_verified",
    snapshot: { company: {}, yc_open_jobs: [], prequalified: null, prequal_key: null,
      shortlisted: true, enriched: {},
      hiring_assessment: { verdict: "hiring_not_verified", evidence_source: "none" },
    } as CompanyResumeRecord["snapshot"],
  })];

  const m = mergeCompanyResumeRecords(stored, incoming);
  assertEquals(m.records.length, 1);
  assertEquals(m.records[0].hiring, "verified_externally");
  assertEquals(m.summary.regressions_refused, 1);
  assertEquals(m.refused[0].why, "cited_beats_uncited");
  assertEquals(m.refused[0].company_name, "Storm4");
  // THE CITATION TRAVELS WITH THE VERDICT. A verdict whose rows are gone is not
  // a verdict, and the incoming snapshot has neither rows nor a source.
  const snap = m.records[0].snapshot as Record<string, unknown>;
  assertEquals((snap.hiring_assessment as Record<string, unknown>).evidence_source,
    "external_job_search");
  assertEquals((snap.hiring_jobs as unknown[]).length, 1);
});

Deno.test("A SECOND OPINION THAT ACTUALLY LOOKED STILL WINS", () => {
  // Phase 3's principle, preserved exactly: only an EVIDENCE-FREE verdict is
  // refused. Freezing a citation against a better citation would be its own bug.
  const m = mergeCompanyResumeRecords(
    [cited("verified_externally")],
    [cited("not_verified", "external_job_search")]);
  assertEquals(m.records[0].hiring, "not_verified");
  assertEquals(m.summary.regressions_refused, 0);
});

Deno.test("progress in the other direction is never blocked", () => {
  // evidence_unavailable → verified is the whole point of resuming.
  const m = mergeCompanyResumeRecords(
    [rec({ hiring: "evidence_unavailable" })], [cited("verified_externally")]);
  assertEquals(m.records[0].hiring, "verified_externally");
  assertEquals(m.summary.regressions_refused, 0);
});

// ── SETTLED BEATS UNSETTLED ─────────────────────────────────────────────────

Deno.test("A SETTLED STAGE MAY NOT BECOME AN UNSETTLED ONE", () => {
  for (const [field, storedV, incomingV] of [
    ["hiring", "not_verified", "evidence_unavailable"],
    ["hiring", "verified_externally", "not_started"],
    ["identity", "resolved", "deferred"],
    ["identity", "resolved", "provider_error"],
    ["enrichment", "completed", "not_started"],
    ["brain", "rejected", "not_started"],
  ] as const) {
    const m = mergeCompanyResumeRecords(
      [rec({ [field]: storedV })], [rec({ [field]: incomingV })]);
    assertEquals((m.records[0] as Record<string, unknown>)[field], storedV,
      `${field}: ${storedV} must survive ${incomingV}`);
    assertEquals(m.refused[0].why, "settled_beats_unsettled");
  }
});

Deno.test("`empty` enrichment is an ANSWER and is not re-opened", () => {
  // Deliberate: retrying it spends money to be told the same thing.
  const m = mergeCompanyResumeRecords(
    [rec({ enrichment: "empty" })], [rec({ enrichment: "deferred" })]);
  assertEquals(m.records[0].enrichment, "empty");
});

Deno.test("THE MERGE AND THE RESUME AGREE ABOUT WHAT IS FINISHED", () => {
  // `stageOwesWork` must route exactly where `nextStageFor` does, or the merge
  // protects a stage the engine is about to redo — or fails to protect one it
  // will not.
  const identities: IdentityStage[] =
    ["not_started", "resolved", "unresolved", "mismatch", "deferred", "provider_error"];
  const hirings: HiringStage[] = ["not_started", "verified_from_existing_evidence",
    "verified_externally", "verification_needed", "not_verified",
    "evidence_unavailable", "failed"];
  for (const identity of identities) {
    const r = rec({ identity });
    assertEquals(stageOwesWork(r, "identity"), nextStageFor(r) === "identity", identity);
  }
  for (const hiring of hirings) {
    const r = rec({ hiring });
    assertEquals(stageOwesWork(r, "hiring"), nextStageFor(r) === "hiring", hiring);
  }
});

// ── WHAT MAY NEVER BE LOST ──────────────────────────────────────────────────

Deno.test("COMPLETED OPERATIONS ONLY EVER GROW", () => {
  // This is the record of what has been PAID FOR. Dropping an entry means
  // buying it again.
  const m = mergeCompanyResumeRecords(
    [rec({ completed_operations: ["op:hiring_verification:a", "op:enrichment:b"] })],
    [rec({ completed_operations: ["op:enrichment:b", "op:identity:c"] })]);
  assertEquals([...m.records[0].completed_operations].sort(),
    ["op:enrichment:b", "op:hiring_verification:a", "op:identity:c"]);
});

Deno.test("A COMPANY THE GENERATION NEVER LOADED IS NOT ONE IT DISCARDED", () => {
  // Task 528c2266's shape: a continuation restored nothing and wrote the
  // emptiness over a hundred companies. Under the merge that is impossible.
  const stored = Array.from({ length: 50 }, (_, i) =>
    rec({ company_key: `c${i}`, company_name: `C${i}` }));
  const m = mergeCompanyResumeRecords(stored, [rec({ company_key: "c3" })]);
  assertEquals(m.records.length, 50);
  assertEquals(m.summary.companies_only_in_stored, 49);
});

Deno.test("an empty release cannot erase the lineage", () => {
  const stored = [cited("verified_externally")];
  const m = mergeCompanyResumeRecords(stored, []);
  assertEquals(m.records.length, 1);
  assertEquals(m.records[0].hiring, "verified_externally");
});

// ── THE ENVELOPE ────────────────────────────────────────────────────────────

const envelope = (companies: CompanyResumeRecord[]) => ({
  lead_resume_checkpoint: { version: RESUME_STATE_VERSION, companies },
});

Deno.test("a FIRST generation writes its own state untouched", () => {
  const next = { ...envelope([rec()]), written_by_task: "t1" };
  const { state, merge } = mergeLineageState(null, next);
  assertEquals(state, next, "nothing to merge into is not a merge");
  assertEquals(merge.refused.length, 0);
});

Deno.test("THE FULL ENVELOPE ROUND TRIP REFUSES THE REGRESSION", () => {
  const storedState = envelope([cited("verified_externally")]);
  const next = {
    ...envelope([rec({ hiring: "not_verified" })]),
    written_by_task: "862e81be", terminal_status: "continuation_required",
  };
  const { state, merge } = mergeLineageState(storedState, next);
  assertEquals(merge.summary.regressions_refused, 1);
  // Everything else on the releasing generation's envelope passes through.
  assertEquals((state as Record<string, unknown>).written_by_task, "862e81be");
  assertEquals((state as Record<string, unknown>).terminal_status, "continuation_required");
  // And the checkpoint that lands is the merged one.
  assertEquals(readCheckpointCompanies(state)[0].hiring, "verified_externally");
});

Deno.test("hiringIsCited is narrower than 'somebody looked'", () => {
  // intelletec: a settled call covered it and named nobody. An honest
  // `not_verified` with no citation of its own, which a later better-evidenced
  // pass must still be able to change.
  assertEquals(hiringIsCited(rec({ hiring: "not_verified" })), false);
  assertEquals(hiringIsCited(cited("not_verified", "none")), false);
  assertEquals(hiringIsCited(cited("verified_externally")), true);
});

// ── THE FIELD THAT NEVER SURVIVED THE JOURNEY ───────────────────────────────

Deno.test("THE CITATION SURVIVES THE JSONB BOUNDARY", () => {
  // `buildCheckpoint` wrote `hiring_assessment` and `hiring_jobs`, the interface
  // declared them, and a comment on both cited task 02ea3aed — "four companies
  // verified from 148 paid job rows, resumed, and the Brain reported the eligible
  // set was empty (50 companies carried no hiring assessment)". The PARSER never
  // read either field back, so the fix for that incident could not work: the
  // evidence was persisted and then discarded on the way in.
  //
  // Confirmed against production on 2026-08-30: `tasks.result` for 66ef37b7 holds
  // `evidence_source: external_job_search` for Storm4, and
  // `readCheckpointCompanies` returned it with no assessment at all.
  //
  // Through JSON on purpose — this state crosses a `jsonb` column.
  const parsed = readCheckpointCompanies(JSON.parse(JSON.stringify(
    envelope([cited("verified_externally")]))));
  assertEquals(parsed.length, 1);
  assertEquals(
    (parsed[0].snapshot?.hiring_assessment as Record<string, unknown>)?.evidence_source,
    "external_job_search");
  assertEquals(parsed[0].snapshot?.hiring_jobs?.length, 1);
  // And therefore the merge can see it. Without the parser fix `hiringIsCited`
  // reads false on both sides and the whole protection above is inert.
  assertEquals(hiringIsCited(parsed[0]), true);
});

Deno.test("the restored citation is bounded like every other snapshot list", () => {
  const many = cited("verified_externally");
  (many.snapshot as Record<string, unknown>).hiring_jobs =
    Array.from({ length: 500 }, (_, i) => ({ job_id: String(i) }));
  const parsed = readCheckpointCompanies(JSON.parse(JSON.stringify(envelope([many]))));
  assert((parsed[0].snapshot?.hiring_jobs?.length ?? 0) < 500,
    "an unbounded restore is how a working set grows without limit");
});

// ── THE WIRING ──────────────────────────────────────────────────────────────

const RUN_AGENT = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url));
const code = RUN_AGENT.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("THE RELEASE WRITES A MERGE, NOT A REPLACEMENT", () => {
  assert(code.includes("const merged = mergeLineageState(leaseState,"),
    "the released state must be merged onto what the lineage held");
  assert(/nextState:\s*merged\.state/.test(code),
    "and it is the merged state that is written");
});

Deno.test("THE RESUME READS THE LINEAGE, NOT ONE TASK ROW", () => {
  assert(code.includes("mergeCompanyResumeRecords(resumeLoad.records, lineageRecords)"),
    "the lineage must lead the restore, with the parent row merged beneath it");
  assert(code.includes("readCheckpointCompanies(leaseState)"),
    "and the lineage state is where it comes from");
});

Deno.test("the merge basis is read under the lease, once", () => {
  // Read anywhere else it could be read after another generation wrote it.
  assert(/const leaseState = leaseOutcome\.acquired \? leaseOutcome\.currentState : null/
    .test(code));
  assertEquals(code.split("leaseOutcome.currentState").length - 1, 1);
});

Deno.test("a refused regression is logged", () => {
  assert(code.includes("[run-agent][lineage-merge] regressions refused"),
    "destroying-what-we-knew is the event an operator must be able to see");
});

// ONE AUTHORITATIVE OUTCOME, PERSISTED, READ BY EVERY SURFACE.
//
// ── WHY A SECOND FILE ──────────────────────────────────────────────────────
//
// `runOutcomeTruth.test.ts` pins the SENTENCES. This pins the CONTRACT: that the
// record is durable, that every surface reads the same one, and that the five
// false implications below cannot be reconstructed from it.
//
// The shapes are two real runs.
//
//   237717dd  2026-08-29  eligible 3, reached_evaluation 0, 10 credits charged,
//                         2 datasets bought and never read. The product said
//                         "none passed the Company Brain" and "No credits
//                         charged, nothing sent."
//
//   66ef37b7  2026-08-30  3 verified with 9 cited rows, 4 credits, 1 provider
//                         call REUSED from a killed generation, 1 company
//                         evidence_unavailable, continuation required.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRunOutcome, readFactsFromResult, readPersistedRunOutcome,
  renderCheckpointNotice, renderQualificationClause, renderRunHeadline,
  renderRunOutcome, renderSpendClause, RUN_OUTCOME_RESULT_KEY,
  RUN_OUTCOME_VERSION, type RunFacts,
} from "../../../supabase/functions/_shared/runOutcome.ts";

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  requested: 5,
  spend: { credits_charged: 0, provider_calls: 0, usd_reported: null,
           unsettled_operations: 0, reused_operations: 0 },
  funnel: {
    discovered: 50, shortlisted: 21, deferred: 10, identity_resolved: 11,
    enriched: 11, hiring_verified: 0, hiring_refuted: 0,
    hiring_evidence_unavailable: 0, cited_rows: 0, excluded: [],
  },
  qualification: { eligible: 0, evaluated: 0, qualified: 0, rejected: 0,
                   not_reached: 0, not_reached_reason: null },
  persistence: { leads_written: 0, signals_written: 0 },
  continuation: { required: false, resumable: false, reason: null },
  completed_capabilities: [], gaps: [],
  ...over,
});

// ══ THE FIVE FALSE IMPLICATIONS ═══════════════════════════════════════════

Deno.test("1. ZERO LEADS IS NOT ZERO CREDITS", () => {
  // 237717dd delivered nothing and had charged ten credits across ten calls.
  const o = buildRunOutcome(facts({
    persistence: { leads_written: 0, signals_written: 0 },
    spend: { credits_charged: 10, provider_calls: 10, usd_reported: 0.1191,
             unsettled_operations: 2, reused_operations: 0 },
  }));
  assertEquals(o.persistence.leads_written, 0);
  const said = renderSpendClause(o);
  assert(said.includes("10 credits"), said);
  assert(!/no credits/i.test(said), said);
  // And the reverse: spend is never derived from the lead count.
  const free = buildRunOutcome(facts({ persistence: { leads_written: 4, signals_written: 0 } }));
  assertEquals(renderSpendClause(free), "No credits were used.");
});

Deno.test("2. ZERO LEADS IS NOT 'THE BRAIN REJECTED EVERYONE'", () => {
  const o = buildRunOutcome(facts({
    qualification: { eligible: 3, evaluated: 0, qualified: 0, rejected: 0,
                     not_reached: 3, not_reached_reason: "execution_deadline_checkpoint" },
  }));
  const msg = renderRunOutcome(o);
  assert(!/none passed/i.test(msg), msg);
  assert(!/did not match/i.test(msg), msg);
  assert(msg.includes("stopped before"), msg);
});

Deno.test("3. EVALUATED ZERO IS NOT QUALIFIED ZERO", () => {
  // Same `qualified: 0` on both sides; the sentences must differ completely.
  const neverJudged = buildRunOutcome(facts({
    qualification: { eligible: 3, evaluated: 0, qualified: 0, rejected: 0,
                     not_reached: 3, not_reached_reason: "execution_deadline_checkpoint" },
  }));
  const judgedAndFailed = buildRunOutcome(facts({
    qualification: { eligible: 3, evaluated: 3, qualified: 0, rejected: 3,
                     not_reached: 0, not_reached_reason: null },
  }));
  assertEquals(neverJudged.qualification.qualified, judgedAndFailed.qualification.qualified);
  assert(renderQualificationClause(neverJudged) !== renderQualificationClause(judgedAndFailed));
  assert(renderQualificationClause(judgedAndFailed).includes("not match"));
  assert(!/not match/.test(renderQualificationClause(neverJudged)));
  // `not_reached` is CARRIED, not left to subtraction — a reader that must
  // compute it will not, and will say "none qualified" instead.
  assertEquals(neverJudged.qualification.not_reached, 3);
  assertEquals(judgedAndFailed.qualification.not_reached, 0);
});

Deno.test("4. EVIDENCE UNAVAILABLE IS NOT REJECTED", () => {
  const o = buildRunOutcome(facts({
    funnel: { ...facts().funnel, hiring_evidence_unavailable: 6, hiring_refuted: 2 },
  }));
  // Two distinct fields, never summed into one "failed" number.
  assertEquals(o.funnel.hiring_evidence_unavailable, 6);
  assertEquals(o.funnel.hiring_refuted, 2);
  const msg = renderRunOutcome(o);
  assert(msg.includes("6 still need a hiring check"), msg);
  assert(!/6 (rejected|failed|did not)/i.test(msg), msg);
});

Deno.test("5. CONTINUATION REQUIRED IS NOT FAILURE", () => {
  const o = buildRunOutcome(facts({
    continuation: { required: true, resumable: true, reason: "execution_deadline_checkpoint" },
  }));
  assertEquals(o.state, "PARTIALLY_SATISFIED");
  assert(o.state !== "FAILED");
  // A provider refusal IS a failure — the distinction must stay usable.
  assertEquals(buildRunOutcome(facts({
    gaps: [{ code: "provider_failure", detail: "input rejected" }],
  })).state, "FAILED");
});

// ══ SPEND: THE FOUR QUANTITIES ════════════════════════════════════════════

Deno.test("REUSED WORK IS REPORTED, NOT SILENTLY FREE", () => {
  // 66ef37b7 adopted a killed generation's paid job search. A user comparing two
  // slices against one charge is otherwise looking at an unexplained discrepancy.
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 4, provider_calls: 5, usd_reported: 0.08,
             unsettled_operations: 0, reused_operations: 1 },
  }));
  const said = renderSpendClause(o);
  assert(said.includes("4 credits"), said);
  assert(said.includes("1 result was reused"), said);
});

Deno.test("free BECAUSE an earlier slice paid is not the same as free", () => {
  const reused = buildRunOutcome(facts({
    spend: { credits_charged: 0, provider_calls: 0, usd_reported: null,
             unsettled_operations: 0, reused_operations: 3 },
  }));
  const said = renderSpendClause(reused);
  assert(said.includes("No new credits"), said);
  assert(said.includes("3 results were reused"), said);
  // The unqualified sentence stays reachable when nothing happened at all.
  assertEquals(renderSpendClause(buildRunOutcome(facts())), "No credits were used.");
});

Deno.test("unsettled work is spend the user has already paid for", () => {
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 10, provider_calls: 10, usd_reported: null,
             unsettled_operations: 2, reused_operations: 0 },
  }));
  assert(renderSpendClause(o).includes("2 results are still being collected"));
  assertEquals(o.spend.usd_reported, null, "unknown cost is null, never zero");
});

// ══ THE DURABLE RECORD ════════════════════════════════════════════════════

Deno.test("THE OUTCOME SURVIVES THE JSONB BOUNDARY INTACT", () => {
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 4, provider_calls: 5, usd_reported: 0.0812,
             unsettled_operations: 1, reused_operations: 1 },
    funnel: { ...facts().funnel, hiring_verified: 3, cited_rows: 9,
              hiring_evidence_unavailable: 1, excluded: [{ reason: "employee_size", count: 29 }] },
    qualification: { eligible: 3, evaluated: 0, qualified: 0, rejected: 0,
                     not_reached: 3, not_reached_reason: "execution_deadline_checkpoint" },
    continuation: { required: true, resumable: true, reason: "execution_deadline_checkpoint" },
  }));
  const row = JSON.parse(JSON.stringify({ [RUN_OUTCOME_RESULT_KEY]: o }));
  const back = readPersistedRunOutcome(row)!;
  assertEquals(back, o, "every field must round-trip through the column");
});

Deno.test("A ROW THAT RECORDED NOTHING RETURNS NULL, NEVER ZEROS", () => {
  // Zeros would be stated by a surface as though the run had reported them.
  assertEquals(readPersistedRunOutcome(null), null);
  assertEquals(readPersistedRunOutcome({}), null);
  assertEquals(readPersistedRunOutcome({ run_outcome: { version: "run-outcome-v0" } }), null);
});

Deno.test("an unknown cost stays unknown across the boundary", () => {
  const o = buildRunOutcome(facts());
  const back = readPersistedRunOutcome(
    JSON.parse(JSON.stringify({ [RUN_OUTCOME_RESULT_KEY]: o })))!;
  assertEquals(back.spend.usd_reported, null, "null must not be rounded to 0");
});

Deno.test("THE HEADLINE IS READ, NOT DERIVED FROM `status`", () => {
  // The Pilot listed runs as "complete — 2026-08-30", which is what let one word
  // stand for a run that saved nothing and charged ten credits.
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 10, provider_calls: 10, usd_reported: null,
             unsettled_operations: 0, reused_operations: 0 },
    continuation: { required: true, resumable: true, reason: "execution_deadline_checkpoint" },
  }));
  const line = renderRunHeadline(o);
  assert(line.includes("0 of 5 saved"), line);
  assert(line.includes("10 credits"), line);
  assert(line.includes("can be continued"), line);
});

Deno.test("a run with nothing left to do says what was not evaluated", () => {
  const line = renderRunHeadline(buildRunOutcome(facts({
    qualification: { eligible: 4, evaluated: 1, qualified: 0, rejected: 1,
                     not_reached: 3, not_reached_reason: null },
  })));
  assert(line.includes("3 not yet evaluated"), line);
});

// ══ READING THE REAL SHAPES ═══════════════════════════════════════════════

Deno.test("66ef37b7 — CITED ROWS ARE COUNTED FROM THE ROWS", () => {
  // Three verified companies citing 1, 6 and 2 job rows. A verdict count is not
  // an evidence count: three claims and zero rows is the state the lineage was
  // left in before the repair.
  const cited = (n: number, name: string) => ({
    company_key: `k${name}`, company_name: name, hiring: "verified_externally",
    identity: "resolved", enrichment: "completed", brain: "not_started",
    snapshot: {
      hiring_assessment: { evidence_source: "external_job_search" },
      hiring_jobs: Array.from({ length: n }, (_, i) => ({ job_id: String(i) })),
    },
  });
  const f = readFactsFromResult({
    lead_resume_checkpoint: { companies: [
      cited(1, "Storm4"), cited(6, "Talentoma"), cited(2, "Storm3"),
      // Uncited: contributes a verdict but no rows.
      { company_key: "kA", company_name: "Atlas", hiring: "not_verified",
        identity: "resolved", enrichment: "completed", brain: "not_started",
        snapshot: { hiring_assessment: { evidence_source: "none" }, hiring_jobs: [] } },
    ] },
  }, 5);
  assertEquals(f.funnel.hiring_verified, 3);
  assertEquals(f.funnel.cited_rows, 9, "1 + 6 + 2, and nothing from the uncited verdict");
  assertEquals(f.funnel.hiring_refuted, 1);
});

Deno.test("237717dd — the audited run, end to end from its own row", () => {
  const f = readFactsFromResult({
    terminal_status: "continuation_required",
    capability_execution_state: {
      terminal_reason: "execution_deadline_checkpoint",
      progress: { accounts_found: 50, shortlisted: 21, identity_resolved: 11,
                  companies_enriched: 11, qualified_companies: 0, eligible_opportunities: 21 },
    },
    evaluation_paths: { eligible: 3, reached_evaluation: 0 },
    lead_library_persistence: { persisted: 0 },
    lead_resume_checkpoint: { companies: [
      { company_key: "a", hiring: "evidence_unavailable", identity: "resolved" },
      { company_key: "b", hiring: "evidence_unavailable", identity: "resolved" },
      { company_key: "c", hiring: "not_verified", identity: "resolved" },
      { company_key: "d", hiring: "not_started", identity: "deferred" },
    ] },
  }, 5);
  const o = buildRunOutcome({ ...f,
    spend: { credits_charged: 10, provider_calls: 10, usd_reported: 0.1191,
             unsettled_operations: 2, reused_operations: 0 } });
  assertEquals(o.qualification.eligible, 3);
  assertEquals(o.qualification.evaluated, 0);
  assertEquals(o.qualification.not_reached, 3);
  assertEquals(o.funnel.hiring_evidence_unavailable, 2);
  assertEquals(o.funnel.cited_rows, 0);
  assertEquals(o.state, "PARTIALLY_SATISFIED");
  const msg = renderRunOutcome(o);
  for (const lie of ["none passed the Company Brain", "No credits charged"]) {
    assert(!msg.includes(lie), `"${lie}" must be unreachable: ${msg}`);
  }
});

Deno.test("the checkpoint card promises nothing it has not read", () => {
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 4, provider_calls: 5, usd_reported: null,
             unsettled_operations: 0, reused_operations: 1 },
  }));
  const card = renderCheckpointNotice(o, true);
  assert(!/nothing extra was charged/i.test(card), card);
  assert(card.includes("4 credits"), card);
  assert(card.includes("1 result was reused"), card);
});

// ══ THE WIRING: ONE RECORD, FOUR SURFACES ═════════════════════════════════

const strip = (src: string) => src.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");
const RUN_AGENT = strip(Deno.readTextFileSync(new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url)));
const READ_SURFACE = strip(Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/readSurface.ts", import.meta.url)));

Deno.test("RUN-AGENT PERSISTS THE OUTCOME", () => {
  assert(RUN_AGENT.includes("const runOutcome = buildRunOutcome({"),
    "the outcome must be computed at completion");
  assert(new RegExp(`\\[RUN_OUTCOME_RESULT_KEY\\]: runOutcome`).test(RUN_AGENT),
    "and written to the task row");
});

Deno.test("it is computed ONCE, from one read of the ledger", () => {
  // Two computations are two answers. The panel and the durable record must be
  // built from the same `lineageSpend`.
  assertEquals(RUN_AGENT.split("const lineageSpend = await readSpendFacts(").length - 1, 1);
  assert(RUN_AGENT.includes("spend: lineageSpend,"),
    "the panel must reuse the same facts, not re-read them");
});

Deno.test("THE WORKBENCH READS THE RECORD, and recomputes only visibly", () => {
  assert(RUN_AGENT.includes("const persistedOutcome = readPersistedRunOutcome("),
    "the panel must read the persisted outcome");
  assert(/const summaryOutcome = persistedOutcome \?\? buildRunOutcome\(\{/.test(RUN_AGENT),
    "recomputation must be an explicit fallback, not the default");
});

Deno.test("THE PILOT READS THE RECORD, not `tasks.status`", () => {
  assert(READ_SURFACE.includes("run_outcome:result->run_outcome"),
    "the runs query must select the outcome");
  assert(READ_SURFACE.includes("readPersistedRunOutcome({ run_outcome: r.run_outcome })"),
    "and render from it");
  assert(READ_SURFACE.includes("no outcome recorded"),
    "a run without a record must say so rather than be described from its status");
});

Deno.test("THE LINEAGE CARRIES THE LATEST OUTCOME", () => {
  assert(new RegExp(`\\[RUN_OUTCOME_RESULT_KEY\\]: committedResult\\[RUN_OUTCOME_RESULT_KEY\\]`)
    .test(RUN_AGENT), "the released lineage state must carry it");
});

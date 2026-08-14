// THE TABLE THAT CALLED EVERYTHING "NOT QUALIFIED".
//
// `EvaluatedCompaniesTable` rendered one banner over every row it received:
// "These companies were evaluated but not qualified." Most had not been. The
// backend had already separated a judged rejection from a company the budget
// never reached, one the deadline stopped mid-run, and one held for missing
// evidence — and this component was the single place that distinction was
// discarded, one sentence before the user read it.
//
// These tests hold the reader honest about two things:
//
//   1. `decided` is the ONLY thing that authorises the word "not qualified",
//      and it is confirmed against the status rather than trusted from the row.
//   2. A row from an older build — which has none of these fields — degrades to
//      "not judged". That is the safe direction: the failure being fixed is
//      calling something a rejection when it is not.
//
// Pure and structural — no DOM, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readEvaluationRows, notQualifiedRows, undecidedRows, resumableRows,
  notInvestigatedRows, LIFECYCLE_LABEL, type WorkbenchLifecycle,
} from "../../src/lib/workbench/evaluationRows.ts";

const row = (o: Record<string, unknown>) => ({
  company_key: "acme.com", company_name: "Acme", domain: "acme.com",
  employee_count: 40, strongest_signal: "Backend Engineer", signal_tier: "A",
  supporting_job_title: "Backend Engineer", supporting_job_url: null,
  prequalification_score: 80, explanation: "…", reasons: [], exclusion: null,
  ...o,
});

const read = (rows: unknown[]) => readEvaluationRows({ workbench_evaluation_rows: rows });

Deno.test("1. only a decided rejection may be shown as not qualified", () => {
  const rows = read([
    row({
      company_key: "judged.com", status: "not_qualified", decided: true,
      decision_source: "gpt_evaluation", mission_decision: "not_qualified",
      mission_reasoning: "no commercial hiring signal",
      mission_failed_requirements: ["hiring engineers: none open"],
    }),
    row({
      company_key: "starved.com", status: "not_investigated", decided: false,
      decision_source: "not_evaluated", shortlist_exclusion: "budget_exhausted",
      shortlist_exclusion_explanation: "The investigation budget ran out…",
    }),
    row({
      company_key: "stopped.com", status: "deferred", decided: false,
      decision_source: "not_evaluated", resumable: true,
      enrichment_state: "provider_error",
    }),
    row({
      company_key: "held.com", status: "held_for_evidence", decided: false,
      decision_source: "insufficient_evidence", resumable: true,
    }),
  ]);

  assertEquals(rows.length, 4);
  assertEquals(notQualifiedRows(rows).map((r) => r.company_key), ["judged.com"]);
  assertEquals(undecidedRows(rows).length, 3);
  assertEquals(resumableRows(rows).map((r) => r.company_key),
    ["stopped.com", "held.com"]);
  assertEquals(notInvestigatedRows(rows).map((r) => r.company_key), ["starved.com"]);

  // THE HEADLINE INVARIANT.
  for (const r of undecidedRows(rows)) {
    assertFalse(r.status === "not_qualified", r.company_key);
  }
});

Deno.test("1b. `decided` is confirmed against the status, not taken on trust", () => {
  // A row claiming a decision it does not have — a corrupted write, or a build
  // mismatch — must not be able to talk its way into the rejection group.
  const rows = read([
    row({ company_key: "liar.com", status: "deferred", decided: true }),
    row({ company_key: "honest.com", status: "not_qualified", decided: true }),
  ]);
  assertFalse(rows[0].decided, "a deferred row is not a decision, whatever it claims");
  assert(rows[1].decided);
  assertEquals(notQualifiedRows(rows).map((r) => r.company_key), ["honest.com"]);
});

Deno.test("2. a row from an older build degrades to NOT JUDGED", () => {
  // BACKWARD COMPATIBILITY IN THE SAFE DIRECTION. These rows have no `decided`,
  // no `decision_source` and no triage — exactly what a task written before this
  // change looks like. None of them may be captioned as a rejection.
  const rows = read([
    row({ company_key: "old1.com", status: "shortlisted" }),
    row({ company_key: "old2.com", status: "identity_unresolved" }),
    row({ company_key: "old3.com", status: "evaluated" }),
  ]);
  for (const r of rows) {
    assertFalse(r.decided, `${r.company_key}: absent evidence is not a decision`);
    assertEquals(r.decision_source, "not_evaluated");
    assertEquals(r.triage_relevance, null);
    assertEquals(r.enrichment_state, "not_attempted");
    assertEquals(r.mission_decision, null);
  }
  assertEquals(notQualifiedRows(rows).length, 0);
  assertEquals(undecidedRows(rows).length, 3);
});

Deno.test("2b. an OLD not_qualified row is still honoured", () => {
  // The other half of compatibility: a genuine historical rejection must not be
  // relabelled. It carries `status: not_qualified` with no `decided` field, and
  // the reader confirms it from the status.
  const rows = read([row({ company_key: "old.com", status: "not_qualified" })]);
  // Without `decided: true` the row cannot enter the rejection group — the
  // conservative reading. It is shown, explained, and simply not captioned as a
  // judgement the row cannot evidence.
  assertFalse(rows[0].decided);
  assertEquals(rows[0].status, "not_qualified");
});

Deno.test("3. an unknown status claims nothing", () => {
  // A row from a FUTURE build, or a corrupted one. It must not become a
  // rejection, and it must not crash the table.
  for (const bad of ["rejected", "", null, 42, "NOT_QUALIFIED"]) {
    const rows = read([row({ status: bad, decided: true })]);
    assertEquals(rows[0].status, "discovered", `${JSON.stringify(bad)}`);
    assertFalse(rows[0].decided);
  }
});

Deno.test("3b. malformed input never throws and never invents rows", () => {
  assertEquals(readEvaluationRows(null), []);
  assertEquals(readEvaluationRows({}), []);
  assertEquals(readEvaluationRows({ workbench_evaluation_rows: "nope" }), []);
  assertEquals(readEvaluationRows({ workbench_evaluation_rows: [null, 42, "x"] }), []);
});

Deno.test("4. the WHY reaches the row — triage, exclusion, enrichment, evaluation", () => {
  const rows = read([
    row({
      status: "not_investigated", decided: false,
      triage_relevance: "irrelevant", triage_signal_strength: 5,
      triage_reasons: ["staffing agency, not a product company"],
      shortlist_exclusion: "triage_irrelevant",
      shortlist_exclusion_explanation: "Mission triage read this as not what the mission asked for.",
      enrichment_state: "not_attempted",
      enrichment_explanation: "Enrichment was never attempted for this company.",
    }),
  ]);
  const r = rows[0];
  assertEquals(r.triage_relevance, "irrelevant");
  assertEquals(r.triage_signal_strength, 5);
  assertEquals(r.triage_reasons, ["staffing agency, not a product company"]);
  assertEquals(r.shortlist_exclusion, "triage_irrelevant");
  assert(r.shortlist_exclusion_explanation!.length > 0);
  assertEquals(r.enrichment_state, "not_attempted");
});

Deno.test("4b. an invalid triage or enrichment value falls back, never guesses", () => {
  const rows = read([row({
    triage_relevance: "REJECTED", triage_signal_strength: "high",
    enrichment_state: "completed", triage_reasons: [1, "ok", null],
  })]);
  assertEquals(rows[0].triage_relevance, null, "outside the vocabulary ⇒ nothing");
  assertEquals(rows[0].triage_signal_strength, null);
  assertEquals(rows[0].enrichment_state, "not_attempted");
  assertEquals(rows[0].triage_reasons, ["ok"], "non-strings are dropped, not coerced");
});

Deno.test("5. every lifecycle the backend can emit has a label", () => {
  // A missing label renders as `undefined` in the status column. Enumerated so
  // a state added to the backend without a label fails here rather than in the
  // user's face.
  const ALL: WorkbenchLifecycle[] = [
    "discovered", "evaluated", "not_investigated", "shortlisted",
    "identity_unresolved", "verifying", "deferred", "held_for_evidence",
    "qualified", "not_qualified", "contact_ready",
  ];
  for (const s of ALL) {
    assert(LIFECYCLE_LABEL[s] && LIFECYCLE_LABEL[s].length > 0, `${s} needs a label`);
  }
  // AND THE WORDING MATTERS. These three are the ones that must not read as a
  // rejection at a glance.
  assertEquals(LIFECYCLE_LABEL.not_investigated, "Not investigated");
  assertEquals(LIFECYCLE_LABEL.deferred, "Deferred");
  assertEquals(LIFECYCLE_LABEL.held_for_evidence, "Awaiting evidence");
});

Deno.test("6. the table groups by what happened, and captions only judged rows", async () => {
  // STRUCTURAL. The component is not rendered here; what is asserted is that it
  // routes its groups through the predicates above rather than assuming every
  // row it was handed is a rejection — which is exactly what it used to do.
  const src = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/workbench/EvaluatedCompaniesTable.tsx",
      import.meta.url),
  );
  assert(/notQualifiedRows\(rows\)/.test(src),
    "the rejection group must come from the predicate");
  assert(/resumableRows\(rows\)/.test(src), "unfinished work must be its own group");
  assert(/notInvestigatedRows\(rows\)/.test(src),
    "companies nothing was spent on must be their own group");
  assertFalse(
    /These companies were evaluated but <strong>not qualified<\/strong>/.test(src),
    "the blanket banner that mislabelled every row must be gone",
  );
});

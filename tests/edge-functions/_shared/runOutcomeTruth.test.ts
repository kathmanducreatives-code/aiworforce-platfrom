// NO CLAIM WITHOUT A ROW.
//
// Three things this product told a user on 2026-08-29, inside ninety seconds,
// none of them true and none of them read from anywhere:
//
//   11:13:03  "Nothing is lost and nothing extra was charged."
//   11:14:24  "11 identities resolved but none passed the Company Brain."
//   11:14:36  "No credits charged, nothing sent."
//
// Each test below replays the run that produced one of them and asserts the new
// sentence. The facts are the persisted ones: `eligible: 3,
// reached_evaluation: 0` from the qualification telemetry, ten charged rows from
// `credit_transactions`.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRunOutcome, readFactsFromResult, renderCheckpointNotice,
  renderOutstandingClause, renderQualificationClause, renderRunOutcome,
  renderSpendClause, type RunFacts,
} from "../../../supabase/functions/_shared/runOutcome.ts";

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  requested: 5,
  spend: { credits_charged: 0, provider_calls: 0, usd_reported: null, unsettled_operations: 0 },
  funnel: {
    discovered: 50, shortlisted: 21, deferred: 10, identity_resolved: 11,
    enriched: 11, hiring_verified: 0, hiring_refuted: 0,
    hiring_evidence_unavailable: 0, excluded: [{ reason: "employee_size", count: 29 }],
  },
  qualification: { eligible: 0, evaluated: 0, qualified: 0, rejected: 0, not_reached_reason: null },
  persistence: { leads_written: 0, signals_written: 0 },
  continuation: { required: true, resumable: true, reason: "execution_deadline_checkpoint" },
  completed_capabilities: [],
  gaps: [],
  ...over,
});

// ── LIE 1: "none passed the Company Brain" ──────────────────────────────────

Deno.test('THE RUN NEVER EVALUATED THEM, AND NOW SAYS SO', () => {
  // The exact persisted numbers: three companies eligible, zero evaluated.
  const o = buildRunOutcome(facts({
    qualification: {
      eligible: 3, evaluated: 0, qualified: 0, rejected: 0,
      not_reached_reason: "execution_deadline_checkpoint",
    },
  }));
  const said = renderQualificationClause(o);
  assert(said.includes("3 companies were ready for qualification"), said);
  assert(said.includes("stopped before"), said);
  // The specific falsehood must be unreachable from this state.
  assert(!/none passed/i.test(said), said);
  assert(!/did not match/i.test(said), said);
});

Deno.test("a company that WAS evaluated and rejected is reported as rejected", () => {
  // The fix must not make the system unable to report a real rejection.
  const o = buildRunOutcome(facts({
    qualification: { eligible: 3, evaluated: 3, qualified: 0, rejected: 3, not_reached_reason: null },
  }));
  const said = renderQualificationClause(o);
  assert(said.includes("3 companies were evaluated"), said);
  assert(said.includes("not match"), said);
});

Deno.test("and a pass is reported as a pass", () => {
  const o = buildRunOutcome(facts({
    qualification: { eligible: 3, evaluated: 3, qualified: 2, rejected: 1, not_reached_reason: null },
  }));
  assertEquals(renderQualificationClause(o), "3 evaluated, 2 qualified.");
});

Deno.test("nobody eligible is its own sentence, not a verdict", () => {
  const said = renderQualificationClause(buildRunOutcome(facts()));
  assertEquals(said, "No company reached qualification.");
});

// ── LIE 2 AND 3: the money ──────────────────────────────────────────────────

Deno.test('THE LINEAGE HAD CHARGED TEN CREDITS, AND NOW SAYS SO', () => {
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 10, provider_calls: 10, usd_reported: 0.1191, unsettled_operations: 2 },
  }));
  const said = renderSpendClause(o);
  assert(said.includes("10 credits"), said);
  assert(said.includes("10 provider calls"), said);
  // The two unread datasets are part of what was spent.
  assert(said.includes("2 results are still being collected"), said);
  assert(!/no credits/i.test(said), said);
});

Deno.test("'No credits were used' requires the ledger to say zero", () => {
  const free = buildRunOutcome(facts());
  assertEquals(renderSpendClause(free), "No credits were used.");
  // And one single charge is enough to make that sentence unreachable.
  const spent = buildRunOutcome(facts({
    spend: { credits_charged: 1, provider_calls: 1, usd_reported: null, unsettled_operations: 0 },
  }));
  assert(!/no credits/i.test(renderSpendClause(spent)));
  assertEquals(renderSpendClause(spent), "1 credit across 1 provider call.");
});

Deno.test("THE CHECKPOINT CARD NO LONGER PROMISES ANYTHING ABOUT MONEY IT HAS NOT READ", () => {
  const o = buildRunOutcome(facts({
    spend: { credits_charged: 3, provider_calls: 3, usd_reported: 0.06, unsettled_operations: 0 },
  }));
  const card = renderCheckpointNotice(o, true);
  assert(!/nothing extra was charged/i.test(card), card);
  assert(card.includes("3 credits"), card);
  assert(card.includes("Use Continue below"), card);
  // The half that was always true stays: the work is kept.
  assert(card.includes("reuses the work already paid for"), card);
});

// ── ABSENCE IS REPORTED AS ABSENCE ──────────────────────────────────────────

Deno.test("evidence never obtained is reported as outstanding, not as a failure", () => {
  // Phase 3 gave these companies their own state; this is the sentence that
  // makes it visible. They are not rejections and must not read as any.
  const o = buildRunOutcome(facts({
    funnel: { ...facts().funnel, hiring_evidence_unavailable: 6, deferred: 10 },
  }));
  const said = renderOutstandingClause(o);
  assert(said.includes("6 still need a hiring check"), said);
  assert(said.includes("10 not yet looked at"), said);
  assert(!/failed|rejected|no match/i.test(said), said);
});

Deno.test("nothing outstanding says nothing", () => {
  const o = buildRunOutcome(facts({
    funnel: { ...facts().funnel, hiring_evidence_unavailable: 0, deferred: 0 },
  }));
  assertEquals(renderOutstandingClause(o), "");
});

// ── THE STATE ───────────────────────────────────────────────────────────────

Deno.test("a run that delivered nothing but has work left is PARTIAL, not FAILED", () => {
  const o = buildRunOutcome(facts({
    continuation: { required: true, resumable: true, reason: "execution_deadline_checkpoint" },
  }));
  assertEquals(o.state, "PARTIALLY_SATISFIED");
});

Deno.test("a provider refusal IS a failure", () => {
  const o = buildRunOutcome(facts({
    gaps: [{ code: "provider_failure", detail: "input rejected" }],
  }));
  assertEquals(o.state, "FAILED");
});

Deno.test("delivering what was asked is SATISFIED", () => {
  const o = buildRunOutcome(facts({
    requested: 3, persistence: { leads_written: 3, signals_written: 0 },
  }));
  assertEquals(o.state, "SATISFIED");
});

// ── READING THE REAL SHAPE ──────────────────────────────────────────────────

Deno.test("THE AUDITED RUN, RE-RENDERED FROM ITS OWN PERSISTED STATE", () => {
  // `tasks.result` for 237717dd in the fields that decide, verbatim.
  const persisted = {
    terminal_status: "continuation_required",
    capability_execution_state: {
      terminal_reason: "execution_deadline_checkpoint",
      completed_capabilities: ["general_company_discovery", "company_enrichment"],
      progress: {
        accounts_found: 50, shortlisted: 21, identity_resolved: 11,
        companies_enriched: 11, qualified_companies: 0, eligible_opportunities: 21,
        exclusion_reasons: { employee_size: 29 },
      },
    },
    evaluation_paths: { eligible: 3, reached_evaluation: 0 },
    lead_library_persistence: { planned: 0, persisted: 0 },
    lead_resume_checkpoint: {
      companies: [
        { hiring: "evidence_unavailable", identity: "resolved" },
        { hiring: "evidence_unavailable", identity: "resolved" },
        { hiring: "not_verified", identity: "resolved" },
        { hiring: "verified_externally", identity: "resolved" },
        { hiring: "not_started", identity: "deferred" },
      ],
    },
  };
  const o = buildRunOutcome({
    ...readFactsFromResult(persisted, 5),
    spend: { credits_charged: 10, provider_calls: 10, usd_reported: 0.1191, unsettled_operations: 2 },
  });

  assertEquals(o.funnel.discovered, 50);
  assertEquals(o.funnel.hiring_verified, 1);
  assertEquals(o.funnel.hiring_evidence_unavailable, 2);
  assertEquals(o.funnel.hiring_refuted, 1);
  assertEquals(o.funnel.deferred, 1);
  assertEquals(o.qualification.eligible, 3);
  assertEquals(o.qualification.evaluated, 0);
  assertEquals(o.qualification.not_reached_reason, "execution_deadline_checkpoint");

  const message = renderRunOutcome(o);
  // Everything the old summary got wrong about this exact run.
  assert(!/none passed the Company Brain/i.test(message), message);
  assert(!/no credits charged/i.test(message), message);
  assert(message.includes("10 credits"), message);
  assert(message.includes("stopped before"), message);
  assert(message.includes("still need a hiring check"), message);
});

Deno.test("an unreadable result produces zeros, never a confident sentence", () => {
  // A reader that cannot see the row must not let the renderer assert anything.
  const o = buildRunOutcome(readFactsFromResult(null, 5));
  assertEquals(o.qualification.eligible, 0);
  assertEquals(o.spend.usd_reported, null, "unknown cost is null, not zero");
  assertEquals(renderQualificationClause(o), "No company reached qualification.");
});

// ── THE LITERALS ARE GONE ───────────────────────────────────────────────────

const RUN_AGENT = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url));
// COMMENTS STRIPPED, JSDOC INCLUDED. Every one of these strings is quoted in the
// comment that explains why it was removed, so a filter that only drops `//`
// lines finds the documentation and reports the code. The rule is about EMITTED
// text; prose describing a deleted lie is the opposite of the lie surviving.
const code = RUN_AGENT.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

Deno.test("NO SUMMARY PATH STILL CARRIES A MONEY LITERAL", () => {
  // Each of these was a string a renderer could emit without reading a row.
  for (const lie of [
    "No credits charged",
    "nothing extra was charged",
    "Nothing more was charged",
    "none passed the Company Brain",
  ]) {
    assert(!code.includes(lie), `the literal "${lie}" must not survive in emitted text`);
  }
});

Deno.test("every money sentence is rendered from the contract", () => {
  assert(code.includes("renderSpendClause("), "spend must be rendered, not written");
  assert(code.includes("readSpendFacts("), "and read from the ledger");
  assert(code.includes("renderQualificationClause("),
    "and qualification likewise");
});

Deno.test("spend is read for the LINEAGE, not one generation", () => {
  // Reporting one slice's spend as the request's is how "nothing extra was
  // charged" could be almost true and still wrong.
  assert(/\.eq\("lineage_id", lineageRootId\)/.test(code),
    "the ledger read must be scoped to the lineage");
});

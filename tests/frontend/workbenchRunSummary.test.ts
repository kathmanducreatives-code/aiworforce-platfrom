// ONE SET OF HEADLINE NUMBERS, AND AN HONEST ACCOUNT WHEN THEY DISAGREE.
//
// The Workbench rendered three counter systems at once — 24 numbers, of which
// "Qualified" appeared THREE times and four others appeared twice. They were
// not copies: they read three different persisted projections of the same run,
// and nothing compared them. A user seeing "Qualified 3" beside "Qualified
// companies 6" had no way to know which was the answer.
//
// These tests pin the two properties that fix costs nothing to get wrong and
// everything to get wrong quietly: ONE authority per number, and disagreement
// REPORTED rather than resolved by whoever renders last.
//
// ZERO network, ZERO React.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRunSummary, summaryCaption, summaryHeadline,
} from "../../src/lib/workbench/runSummary.ts";

const ROWS = { total: 0, qualified: 0, pending: 0 };

// deno-lint-ignore no-explicit-any
const quota = (o: Record<string, unknown>): any => o;
// deno-lint-ignore no-explicit-any
const portfolio = (counts: Record<string, unknown>): any => ({ counts });
// deno-lint-ignore no-explicit-any
const progress = (o: Record<string, unknown>): any => o;

// ═══ 1. PRECEDENCE: THE ENGINE'S OWN ANSWER WINS ═══════════════════════════

Deno.test("1. the engine's quota contract outranks every projection", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 3, delivered: 100, review: 12 }),
    progress: progress({ qualified_companies: 6, evaluated: 100 }),
    rows: { total: 100, qualified: 4, pending: 12 },
  });
  assertEquals(s.qualified.value, 10);
  assertEquals(s.qualified.source, "engine_quota");
});

Deno.test("2. a legacy run with no projections still counts its rows", () => {
  const s = buildRunSummary({
    quota: null, portfolio: null, progress: null,
    rows: { total: 40, qualified: 7, pending: 5 },
  });
  assertEquals(s.qualified.value, 7);
  assertEquals(s.qualified.source, "rows");
  assertEquals(s.reviewed.value, 40);
});

Deno.test("3. nothing known is zero FROM NO SOURCE, which is a distinct state", () => {
  const s = buildRunSummary({ quota: null, portfolio: null, progress: null, rows: ROWS });
  assertEquals(s.qualified.value, 0);
  assertEquals(s.qualified.source, "none",
    "a zero nobody vouched for must be distinguishable from a counted zero");
});

// ═══ 2. DISAGREEMENT IS REPORTED, NOT RESOLVED SILENTLY ════════════════════

Deno.test("4. THE HEADLINE CASE: three projections, three answers", () => {
  // Exactly the situation the old UI rendered side by side without comment.
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 3, delivered: 100, review: 12 }),
    progress: progress({ qualified_companies: 6, evaluated: 100 }),
    rows: { total: 100, qualified: 4, pending: 12 },
  });
  assertEquals(s.qualified.value, 10, "one number reaches the hero");
  assert(s.hasDisagreement, "and the fact that others disagree is not lost");
  assertEquals(
    s.qualified.disagreements.map((d) => d.value).sort((a, b) => a - b),
    [3, 4, 6],
    "every dissenting projection is named, so Run details can show the conflict",
  );
});

Deno.test("5. agreement produces NO disagreement noise", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 10, delivered: 100, review: 0 }),
    progress: progress({ qualified_companies: 10, evaluated: 100 }),
    rows: { total: 100, qualified: 10, pending: 0 },
  });
  assertEquals(s.qualified.disagreements, []);
  assertEquals(s.hasDisagreement, false, "the healthy path stays quiet");
});

Deno.test("6. a source that says nothing is not a dissenter", () => {
  // Absent is not zero. A projection that has not been written yet must not be
  // reported as disagreeing with one that has.
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 5 }),
    portfolio: null,
    progress: progress({ evaluated: 50 }),
    rows: { total: 50, qualified: 5, pending: 0 },
  });
  assertEquals(s.qualified.disagreements, []);
  assertEquals(s.hasDisagreement, false);
});

// ═══ 3. THE SCAR: ABSENCE OF A REJECTION IS NOT A PASS ═════════════════════

Deno.test("7. `not a fit` is DERIVED, never counted independently", () => {
  // A fourth independently-counted total is a fourth number that can disagree
  // with the other three, which is the whole defect being removed.
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 10, delivered: 100, review: 12 }),
    progress: progress({ evaluated: 100 }),
    rows: ROWS,
  });
  assertEquals(s.reviewed.value, 100);
  assertEquals(s.pending.value, 12);
  assertEquals(s.notAFit.value, 78, "100 reviewed − 10 qualified − 12 pending");
});

Deno.test("8. and it never goes negative when projections are inconsistent", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 90 }),
    portfolio: portfolio({ qualified: 90, delivered: 10, review: 40 }),
    progress: null, rows: ROWS,
  });
  assertEquals(s.notAFit.value, 0,
    "an impossible subtraction must read as zero, never as a negative count");
});

Deno.test("9. qualified and reviewed never collapse into each other", () => {
  // "5 found" once read as a met quota for a run that had zero leads.
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 0, requested: 5 }),
    portfolio: null,
    progress: progress({ evaluated: 5 }),
    rows: { total: 5, qualified: 0, pending: 0 },
  });
  assertEquals(s.reviewed.value, 5);
  assertEquals(s.qualified.value, 0);
  assertEquals(s.shortfall, 5, "the request is unmet and says so");
});

// ═══ 4. THE WORDS ON SCREEN ════════════════════════════════════════════════

Deno.test("10. the headline says QUALIFIED, never `found`", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 10 }), portfolio: null,
    progress: progress({ evaluated: 100 }), rows: ROWS,
  });
  assertEquals(summaryHeadline(s), "10 qualified leads");
  assert(!/found/i.test(summaryHeadline(s)),
    "a row being on the page has never meant it qualified");
});

Deno.test("11. one lead is singular", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 1 }), portfolio: null, progress: null, rows: ROWS,
  });
  assertEquals(summaryHeadline(s), "1 qualified lead");
});

Deno.test("12. zero reads differently while running than when finished", () => {
  const running = buildRunSummary({
    quota: null, portfolio: null, progress: progress({ in_progress: true }), rows: ROWS,
  });
  assertEquals(summaryHeadline(running), "Still looking");

  const done = buildRunSummary({
    quota: null, portfolio: null, progress: progress({ in_progress: false }), rows: ROWS,
  });
  assertEquals(summaryHeadline(done), "No qualified leads yet",
    "'we have not looked yet' and 'we looked and found none' are different statements");
});

Deno.test("13. the caption is one short sentence, not a counter wall", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 10, delivered: 100, review: 12 }),
    progress: progress({ evaluated: 100, in_progress: false }),
    rows: ROWS,
  });
  const c = summaryCaption(s);
  assertEquals(c, "100 companies reviewed · 12 still being checked");
  assert(c.split("·").length <= 3, "at most three facts — this replaced 24 numbers");
});

Deno.test("14. a finished run with nothing pending says only what happened", () => {
  const s = buildRunSummary({
    quota: quota({ qualifiedCompanies: 3 }), portfolio: null,
    progress: progress({ evaluated: 20, in_progress: false }), rows: ROWS,
  });
  assertEquals(summaryCaption(s), "20 companies reviewed");
});

Deno.test("15. one company reviewed is singular too", () => {
  const s = buildRunSummary({
    quota: null, portfolio: null, progress: progress({ evaluated: 1 }), rows: ROWS,
  });
  assert(summaryCaption(s).startsWith("1 company reviewed"));
});

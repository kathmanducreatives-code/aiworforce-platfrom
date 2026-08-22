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

/**
 * Every call now states the canonical LEAD counts explicitly.
 *
 * They used to be inferred through a precedence chain that preferred
 * `quota.qualifiedCompanies` — a count of COMPANIES — and rendered it under a
 * LEAD label. That is how the hero came to read "11 qualified leads" beside a
 * "Qualified 0" tab. The two entities are now separate inputs and cannot be
 * substituted for one another by any ordering.
 */
// deno-lint-ignore no-explicit-any
const summary = (o: Record<string, unknown>): any => buildRunSummary({
  qualifiedLeads: 0, leadsInReview: 0,
  quota: null, portfolio: null, progress: null, rows: ROWS,
  // deno-lint-ignore no-explicit-any
  ...(o as any),
});

// deno-lint-ignore no-explicit-any
const quota = (o: Record<string, unknown>): any => o;
// deno-lint-ignore no-explicit-any
const portfolio = (counts: Record<string, unknown>): any => ({ counts });
// deno-lint-ignore no-explicit-any
const progress = (o: Record<string, unknown>): any => o;

// ═══ 1. PRECEDENCE: THE ENGINE'S OWN ANSWER WINS ═══════════════════════════

Deno.test("1. A COMPANY COUNT CAN NEVER BECOME THE LEAD HEADLINE", () => {
  // THE BUG, PINNED. Persisted runs report 10 qualified COMPANIES and 0
  // contact-ready LEADS — every one of them. The hero rendered the first under
  // a label describing the second.
  const s = summary({
    qualifiedLeads: 0, leadsInReview: 11,
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 10, delivered: 100, review: 11 }),
    progress: progress({ qualified_companies: 10, evaluated: 100 }),
  });
  assertEquals(s.qualified.value, 0, "no lead qualified, so the headline count is 0");
  assertEquals(s.qualifiedCompanies.value, 10, "…and the company fact is kept, separately");
  assertEquals(summaryHeadline(s), "11 leads in review",
    "the headline states what is actually there");
});

Deno.test("2. the lead count comes from the rows and nothing overrides it", () => {
  const s = summary({ qualifiedLeads: 7, leadsInReview: 5, rows: { total: 40, qualified: 7, pending: 5 } });
  assertEquals(s.qualified.value, 7);
  assertEquals(s.qualified.source, "rows");
  assertEquals(s.qualified.disagreements, [],
    "there is no chain to disagree with — one source, by construction");
});

Deno.test("3. a company projection that says nothing is not a dissenter", () => {
  const s = summary({ qualifiedLeads: 0, quota: quota({ qualifiedCompanies: 5 }) });
  assertEquals(s.qualifiedCompanies.value, 5);
  assertEquals(s.qualifiedCompanies.source, "engine_quota");
});

// ═══ 2. DISAGREEMENT IS REPORTED, NOT RESOLVED SILENTLY ════════════════════

Deno.test("4. COMPANY projections still reconcile, and still report dissent", () => {
  // The reconciliation did not go away — it moved to the entity it was always
  // about. Three records of one run disagreeing about qualified COMPANIES is
  // still a data defect worth surfacing.
  const s = summary({
    qualifiedLeads: 0,
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 3, delivered: 100, review: 12 }),
    progress: progress({ qualified_companies: 6, evaluated: 100 }),
  });
  assertEquals(s.qualifiedCompanies.value, 10);
  assert(s.hasDisagreement);
  assertEquals(
    s.qualifiedCompanies.disagreements.map((d: { value: number }) => d.value).sort((a: number, b: number) => a - b),
    [3, 6],
  );
});

Deno.test("5. agreement produces NO disagreement noise", () => {
  const s = summary({
    qualifiedLeads: 10,
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 10, delivered: 100, review: 0 }),
    progress: progress({ qualified_companies: 10, evaluated: 100 }),
  });
  assertEquals(s.hasDisagreement, false);
});

Deno.test("6. an unwritten projection is absent, not zero", () => {
  const s = summary({
    qualifiedLeads: 5, quota: quota({ qualifiedCompanies: 5 }),
    portfolio: null, progress: progress({ evaluated: 50 }),
  });
  assertEquals(s.hasDisagreement, false);
});

// ═══ 3. THE SCAR: ABSENCE OF A REJECTION IS NOT A PASS ═════════════════════

Deno.test("7. `not a fit` is DERIVED from COMPANY counts, never independently", () => {
  // A fourth independently-counted total is a fourth number that can disagree
  // with the other three, which is the whole defect being removed.
  const s = summary({
    quota: quota({ qualifiedCompanies: 10 }),
    portfolio: portfolio({ qualified: 10, delivered: 100, review: 12 }),
    progress: progress({ evaluated: 100 }),
    rows: ROWS, leadsInReview: 12,
  });
  assertEquals(s.reviewed.value, 100);
  assertEquals(s.pending.value, 12);
  assertEquals(s.notAFit.value, 78,
    "100 companies reviewed − 10 qualified companies − 12 in review. All three " +
    "are company-shaped; subtracting a LEAD count here is the same category " +
    "error that produced the wrong headline.");
});

Deno.test("8. and it never goes negative when projections are inconsistent", () => {
  const s = summary({
    quota: quota({ qualifiedCompanies: 90 }),
    portfolio: portfolio({ qualified: 90, delivered: 10, review: 40 }),
    progress: null, rows: ROWS, leadsInReview: 40,
  });
  assertEquals(s.notAFit.value, 0,
    "an impossible subtraction must read as zero, never as a negative count");
});

Deno.test("9. qualified LEADS and reviewed COMPANIES never collapse", () => {
  // "5 found" once read as a met quota for a run that had zero leads.
  const s = summary({
    qualifiedLeads: 0, leadsInReview: 0,
    quota: quota({ qualifiedCompanies: 0, requested: 5 }),
    progress: progress({ evaluated: 5 }),
  });
  assertEquals(s.reviewed.value, 5);
  assertEquals(s.qualified.value, 0);
  assertEquals(s.shortfall, 5, "the request was for LEADS and is unmet");
});

// ═══ 4. THE WORDS ON SCREEN ════════════════════════════════════════════════

Deno.test("10. the headline says QUALIFIED when leads qualified", () => {
  const s = summary({ qualifiedLeads: 10, progress: progress({ evaluated: 100 }) });
  assertEquals(summaryHeadline(s), "10 qualified leads");
  assert(!/found/i.test(summaryHeadline(s)));
});

Deno.test("11. singulars everywhere", () => {
  assertEquals(summaryHeadline(summary({ qualifiedLeads: 1 })), "1 qualified lead");
  assertEquals(summaryHeadline(summary({ leadsInReview: 1 })), "1 lead in review");
  assertEquals(
    summaryHeadline(summary({ quota: quota({ qualifiedCompanies: 1 }) })),
    "1 company matched",
    "and a company is called a company",
  );
});

Deno.test("12. zero reads differently while running than when finished", () => {
  const running = summary({ progress: progress({ in_progress: true }) });
  assertEquals(summaryHeadline(running), "Still looking");

  const done = summary({ progress: progress({ in_progress: false }) });
  assertEquals(summaryHeadline(done), "No qualified leads yet",
    "'we have not looked yet' and 'we looked and found none' are different statements");
});

Deno.test("13. the caption is one short sentence, not a counter wall", () => {
  const s = summary({
    qualifiedLeads: 10, leadsInReview: 12,
    progress: progress({ evaluated: 100, in_progress: false }),
  });
  const c = summaryCaption(s);
  assertEquals(c, "100 companies reviewed · 12 still being checked");
  assert(c.split("·").length <= 3, "at most three facts — this replaced 24 numbers");
});

Deno.test("14. a finished run with nothing pending says only what happened", () => {
  const s = summary({
    qualifiedLeads: 3, progress: progress({ evaluated: 20, in_progress: false }),
  });
  assertEquals(summaryCaption(s), "20 companies reviewed");
});

Deno.test("15. one company reviewed is singular too", () => {
  const s = summary({ progress: progress({ evaluated: 1 }) });
  assert(summaryCaption(s).startsWith("1 company reviewed"));
});

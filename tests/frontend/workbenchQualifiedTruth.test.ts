// THE HERO AND THE TABS MUST NEVER DISAGREE AGAIN.
//
// ── THE BUG ─────────────────────────────────────────────────────────────────
//
// One screen said both:
//
//     11 qualified leads          ← hero
//     Qualified 0 · In review 11  ← tabs
//
// TWO ROOT CAUSES, one mine and one older.
//
// A. ENTITY CONFLATION. The hero ran through a precedence chain that preferred
//    `quota.qualifiedCompanies` — a count of COMPANIES — and rendered it under
//    a LEAD label. The persisted runs make the gap concrete: every one reports
//    10 qualified COMPANIES and 0 contact-ready LEADS. Both true; neither may
//    stand for the other. `workbenchCounts.ts` was written for exactly this:
//    "for a request asking for five CONTACT-ready LEADS, '5 FOUND' read as the
//    quota being met while zero leads existed."
//
// B. ABSENCE OF A REJECTION READ AS A PASS. `quotaProgress` fell back to
//    `level !== 'not_qualified'`. It fired on EVERY run, not rarely:
//    `backend.counts.verifiedCompanies` is null on all four runs in the
//    history, and `not_qualified` is 0 on all four — nothing is ever actively
//    rejected — so it counted everything evaluated. The identical defect had
//    already been found and fixed in `workbenchCounts.ts`; it survived here, in
//    the file whose answer the hero then preferred over every other source.
//
// ZERO network, ZERO React.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRunSummary, summaryHeadline } from "../../src/lib/workbench/runSummary.ts";
import { partitionLeads } from "../../src/lib/workbench/leadTabs.ts";
import { buildQuotaProgress } from "../../src/lib/qualifiedLead/quotaProgress.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
const VIEW = read("../../src/components/chat/workspace/workbench/LeadResultsView.tsx");
const HERO = read("../../src/components/chat/workspace/workbench/RunSummaryHero.tsx");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// deno-lint-ignore no-explicit-any
const S = (o: Record<string, unknown>): any => buildRunSummary({
  qualifiedLeads: 0, leadsInReview: 0,
  quota: null, portfolio: null, progress: null,
  rows: { total: 0, qualified: 0, pending: 0 },
  // deno-lint-ignore no-explicit-any
  ...(o as any),
});

/** A row evaluated but short of a decision-maker: "in review", not qualified. */
const IN_REVIEW = { quota_eligible: false, decision_maker_status: "missing", company_name: "C" };
/** A row that clears every gate. */
const QUALIFIED = {
  quota_eligible: true, decision_maker_status: "verified",
  contact_status: "verified", company_name: "C",
};

// ═══ 1. THE EXACT SCREEN THAT WAS WRONG ════════════════════════════════════

Deno.test("1. THE REPORTED STATE: 11 in review, 0 qualified, no contradiction", () => {
  const rows = Array.from({ length: 11 }, () => IN_REVIEW);
  const p = partitionLeads(rows);
  assertEquals(p.qualified.length, 0);
  assertEquals(p.inReview.length, 11);

  const s = S({
    qualifiedLeads: p.qualified.length,
    leadsInReview: p.inReview.length,
    // Every projection insisting on 10-11 COMPANIES must not move the headline.
    quota: { qualifiedCompanies: 11 },
    portfolio: { counts: { qualified: 11, delivered: 100, review: 11 } },
    progress: { qualified_companies: 11, evaluated: 100 },
  });

  assertEquals(s.qualified.value, 0, "the Qualified TAB and the hero agree at 0");
  assertEquals(summaryHeadline(s), "11 leads in review",
    "and the headline states what is actually there");
  assert(!/qualified lead/i.test(summaryHeadline(s)),
    "it must never claim a qualified lead that does not exist");
});

// ═══ 2. THE TWO SOURCES CANNOT BE SWAPPED ══════════════════════════════════

Deno.test("2. no projection can override the canonical lead count", () => {
  for (const projection of [
    { quota: { qualifiedCompanies: 99 } },
    { portfolio: { counts: { qualified: 99, delivered: 99, review: 0 } } },
    { progress: { qualified_companies: 99, evaluated: 99 } },
  ]) {
    const s = S({ qualifiedLeads: 2, leadsInReview: 0, ...projection });
    assertEquals(s.qualified.value, 2, `${Object.keys(projection)[0]} must not win`);
  }
});

Deno.test("3. companies and leads are separate fields, not one number", () => {
  const s = S({
    qualifiedLeads: 0, leadsInReview: 11, quota: { qualifiedCompanies: 10 },
  });
  assertEquals(s.qualified.value, 0);
  assertEquals(s.qualifiedCompanies.value, 10);
  assert(s.qualified !== s.qualifiedCompanies,
    "two entities, two fields — the conflation is structurally impossible");
});

Deno.test("4. a company count is LABELLED as companies when it is used", () => {
  // Only reachable when there are no leads at all either way.
  const s = S({ qualifiedLeads: 0, leadsInReview: 0, quota: { qualifiedCompanies: 6 } });
  assertEquals(summaryHeadline(s), "6 companies matched");
  assert(!/lead/i.test(summaryHeadline(s)));
});

// ═══ 3. ROOT CAUSE B — THE FALLBACK ════════════════════════════════════════

Deno.test("5. `quotaProgress` no longer counts un-rejected rows as qualified", () => {
  // Reproduces the live shape: no `verifiedCompanies` from the backend, and
  // nothing actively rejected.
  const q = buildQuotaProgress(
    { requested_leads: 10 },
    Array.from({ length: 11 }, (_, i) => ({
      company: `co-${i}`,
      // deno-lint-ignore no-explicit-any
      ...(IN_REVIEW as any),
    })),
  );
  assertEquals(q.qualifiedCompanies, 0,
    "eleven un-rejected, un-verified companies are not eleven qualified ones");
});

Deno.test("6. and an explicit backend count is still honoured", () => {
  const q = buildQuotaProgress(
    // deno-lint-ignore no-explicit-any
    ({ requested_leads: 10, counts: { verifiedCompanies: 7 } } as any),
    [],
  );
  assertEquals(q.qualifiedCompanies, 7);
});

Deno.test("7. the absence-of-rejection pattern is gone from the source", () => {
  const src = code(read("../../src/lib/qualifiedLead/quotaProgress.ts"));
  assert(!/level\s*!==\s*'not_qualified'/.test(src),
    "this pattern has now caused the same bug in two files; it must not return");
});

// ═══ 4. ROUTING BETWEEN THE TABS ═══════════════════════════════════════════

Deno.test("8. qualified rows appear in Qualified, review rows never do", () => {
  const p = partitionLeads([QUALIFIED, QUALIFIED, IN_REVIEW]);
  assertEquals(p.qualified.length, 2);
  assertEquals(p.inReview.length, 1);
  assert(!p.qualified.includes(IN_REVIEW as never),
    "a row still being checked must never be listed as qualified");
});

Deno.test("9. empty Qualified + non-empty In review opens on In review", () => {
  assert(VIEW.includes("partition.qualified.length === 0 && partition.inReview.length > 0"),
    "opening an empty hero tab shows a blank page for a run that worked");
  assert(VIEW.includes("setTab('in_review')"));
  // Decided ONCE, so it cannot yank the tab out from under someone mid-read.
  assert(VIEW.includes("tabChosen"), "the default is chosen once, not on every render");
});

Deno.test("10. the hero and the tabs read the SAME object", () => {
  const src = code(VIEW);
  assert(/qualifiedLeads:\s*partition\.qualified\.length/.test(src),
    "the hero's count is the tab's count");
  assert(/leadsInReview:\s*partition\.inReview\.length/.test(src));
  assertEquals((src.match(/partitionLeads\(/g) ?? []).length, 1,
    "one partition — a second would be a second answer");
});

// ═══ 5. THE HERO CTA BLOCK IS GONE ═════════════════════════════════════════

Deno.test("11. no large disabled CTA beside the hero", () => {
  const src = code(HERO);
  assert(!/disabled/.test(src),
    "the block was permanently disabled on every run in the history, carried a " +
    "paragraph explaining why, and sat beside the one number the page exists for");
  assert(!/cta\.hint/.test(src), "and the explanation went with it");
  // The action still exists — where it can actually run.
  assert(code(VIEW).includes("isRecommendationDispatchable(recommendation) ? {"),
    "the hero shows the action ONLY when it is dispatchable");
});

Deno.test("12. the action bar appears on selection, not permanently", () => {
  const src = code(VIEW);
  assert(/selectedRows\.length > 0 && \(tab === 'qualified'/.test(src),
    "four buttons, three of them disabled in the page's opening state, is chrome");
  assert(!src.includes("<BulkActionToolbar"),
    "with a contextual action bar the toolbar was the same bar twice");
});

// ═══ 6. THE LIST IS THE PAGE ═══════════════════════════════════════════════

Deno.test("13. nothing above or below the list has a fixed or percentage height", () => {
  const src = code(VIEW);
  const list = code(read(
    "../../src/components/chat/workspace/workbench/leadTable/LeadSpreadsheet.tsx"));
  assert(!/max-h-\[\d+%\]/.test(src), "no percentage sibling may squeeze the list");
  assert(!/\bh-\[\d+px\]/.test(src), "and no fixed pixel height either");
  assert(/flex-1 min-h-0 overflow-auto/.test(list),
    "the list takes what is left and scrolls inside it");
});

Deno.test("14. every remaining sibling is explicitly shrink-0", () => {
  // A sibling that can GROW competes with the list for the same pixels.
  const src = code(VIEW);
  for (const marker of ["py-2 flex items-center gap-1.5 text-[12.5px] shrink-0", "shrink-0 px-7 py-3 border-t"]) {
    assert(src.includes(marker), `missing shrink-0 on: ${marker}`);
  }
});

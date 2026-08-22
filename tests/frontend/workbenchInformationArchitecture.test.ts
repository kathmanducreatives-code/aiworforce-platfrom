// THE QUALIFIED LEADS ARE THE POINT OF THE PAGE.
//
// ── THE LAYOUT THIS REPLACES ────────────────────────────────────────────────
//
// In the leads path `WorkbenchPanel` stacked, top to bottom: a 40px header
// strip, a tab bar, ContinueVerificationBar, PortfolioSummary (11 counter
// cells), WorkflowProgressStrip (7 stage lines), the view's own header (title +
// six chips + filters), a dismissible helper banner, a recommendation banner, an
// insights panel, a bulk toolbar — THEN the leads — then an action bar, a
// footer note, and `EvaluatedCompaniesTable` at `max-h-[45%]`.
//
// The leads were the only element with no reserved height, competing with nine
// fixed-height siblings and a 45% one. In an 800px panel they got roughly 180px
// — about three rows — and could not be given more, because everything around
// them was sized first.
//
// The last of those siblings is the sharpest version of the problem: 45% of the
// remaining space went to companies that explicitly CANNOT be acted on. The
// projection's own comment says so — "these rows have no lead_candidate_id, so
// nothing can act on them".
//
// ZERO network, ZERO React rendering — these read source, like every other
// structural test in this directory.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
/**
 * Source with comments stripped.
 *
 * These tests describe what was REMOVED, so the prose explaining the fix names
 * the very strings the fix deletes. Matching raw source made two of them fail on
 * their own comments — the assertion has to read code, not commentary.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANEL = code(read("../../src/components/chat/workspace/workbench/WorkbenchPanel.tsx"));
const VIEW_RAW = read("../../src/components/chat/workspace/workbench/LeadResultsView.tsx");
const VIEW = code(VIEW_RAW);

/**
 * The main component's own render, excluding the helpers defined below it.
 *
 * `ConfirmDialog` is a MODAL — `absolute inset-0`, on its own layer — so its
 * 16px title does not compete with the headline for the reader's eye. Scoping
 * matters: the first version of test 5 flagged it and was wrong to.
 */
const VIEW_BODY = VIEW.slice(0, VIEW.indexOf("function LeadActionOutcomeCard"));
const HERO = read("../../src/components/chat/workspace/workbench/RunSummaryHero.tsx");
const DETAILS = read("../../src/components/chat/workspace/workbench/RunDetails.tsx");

// ═══ 1. NOTHING OUTRANKS THE LEADS ═════════════════════════════════════════

Deno.test("1. the panel no longer stacks counter blocks above the leads", () => {
  for (const gone of [
    "<PortfolioSummary",
    "<WorkflowProgressStrip",
    "<EvaluatedCompaniesTable",
  ]) {
    assert(!PANEL.includes(gone),
      `${gone} must not render as a sibling of the leads — that is what left ` +
      "them ~180px of an 800px panel");
  }
});

Deno.test("2. and nothing takes a PERCENTAGE of the leads' space", () => {
  // `max-h-[45%]` on the evaluated table was the single largest thief, and a
  // percentage sibling is the shape of the bug: it scales WITH the panel, so a
  // bigger window never gave the leads more.
  assert(!/max-h-\[\d+%\]/.test(PANEL),
    "a percentage-height sibling grows with the panel and never yields");
});

Deno.test("3. the leads are the only flex-1 child of the view", () => {
  // Held by `LeadTable`, then the card list, now the restored spreadsheet.
  // The property outlives all three: whatever renders the leads takes the
  // remaining height and scrolls inside it, and is the only thing that grows.
  const list = read("../../src/components/chat/workspace/workbench/leadTable/LeadSpreadsheet.tsx");
  assert(/flex-1 min-h-0 overflow-auto/.test(list),
    "the spreadsheet takes the remaining height and scrolls inside it");
});

Deno.test("4. Run details is bounded and cannot squeeze the table unbidden", () => {
  assert(DETAILS.includes("shrink-0"),
    "collapsed, it is a ~44px row and must never compress the leads");
  assert(/max-h-\[60%\]/.test(DETAILS),
    "expanded, it is bounded — and it only expands because the user asked");
  assert(DETAILS.includes("overflow-auto"), "…and scrolls inside that bound");
});

// ═══ 2. ONE ANSWER, SIZED LIKE ONE ═════════════════════════════════════════

Deno.test("5. the headline is the largest text on the page", () => {
  // Every size in the old header was 10–13.5px. The largest text was the panel
  // TITLE; the number the user came for rendered at 11px inside a chip row.
  assert(/text-\[28px\]/.test(HERO), "the answer is set at 28px");

  const sizes = [...VIEW_BODY.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)]
    .map((m) => Number(m[1]));
  const biggestInFlow = Math.max(...sizes);
  // 15.5px is the company name on a card — the largest thing in the LIST, and
  // deliberately so. It is still well under the 28px headline.
  assert(biggestInFlow <= 16,
    `the page flow's largest type is ${biggestInFlow}px; nothing in it may ` +
    "compete with the headline");
});

Deno.test("6. the six-chip counter row is gone from the header", () => {
  for (const chip of [
    "ACCOUNTS FOUND", "EVALUATED", "QUALIFIED COMPANIES",
    "DECISION-MAKERS VERIFIED", "CONTACT-READY", "REMAINING",
  ]) {
    assert(!VIEW_BODY.includes(chip),
      `"${chip}" belonged to one of three simultaneous counter systems`);
  }
});

Deno.test("7. and the recommendation is stated ONCE, as the hero action", () => {
  // RecommendationBanner and the hero CTA both rendered `recommendation`, in
  // two visual languages, ~60px apart.
  assert(!VIEW.includes("<RecommendationBanner"),
    "one next step, stated once");
  assert(VIEW.includes("<RunSummaryHero"), "and it is the hero's CTA");
  assert(VIEW.includes("isRecommendationDispatchable(recommendation)"),
    "a recommendation with an unmet prerequisite stays disabled, with its reason");
});

// ═══ 3. THE TECHNICAL SECTIONS SURVIVE, DEMOTED ════════════════════════════

Deno.test("8. nothing was deleted — the diagnostics moved into Run details", () => {
  // They answer "why only three?" and "did it skip anything?". Both are read
  // once, when a number looks wrong. That is what a details section is for.
  assert(DETAILS.includes("progressLines("), "stage-by-stage progress");
  assert(DETAILS.includes("EvaluatedCompaniesTable"), "the reviewed-and-set-aside companies");
  assert(DETAILS.includes("counts.tier_a"), "the grading breakdown");
  assert(VIEW.includes("<RunDetails"), "…rendered by the view, under the table");
});

Deno.test("9. a stage that has not run still shows `—`, never `0`", () => {
  // Carried over deliberately: "we have not looked yet" and "we looked and
  // found none" are different statements, and collapsing them once made a
  // working run indistinguishable from a hung one.
  assert(DETAILS.includes("l.reached ? l.value : '—'"));
});

// ═══ 4. THE CONFLICT IS SURFACED, NOT RESOLVED BY RENDER ORDER ═════════════

Deno.test("10. disagreeing counts are reported where a reader can see them", () => {
  // The three counter systems read three different persisted projections and
  // nothing compared them, so "Qualified 3" could sit beside "Qualified
  // companies 6" with no way to tell which was true.
  assert(VIEW.includes("buildRunSummary("), "one authority per number");
  assert(DETAILS.includes("summary.hasDisagreement"),
    "and a visible flag when two records of one run disagree");
  assert(DETAILS.includes("counts disagree"),
    "…surfaced on the COLLAPSED row, so it is seen without opening anything");
});

// ═══ 5. WORDING ════════════════════════════════════════════════════════════

Deno.test("11. internal vocabulary is out of the user-facing surface", () => {
  for (const [phrase, where] of [
    ["Company Brain", "an internal subsystem name"],
    ["credits estimated locally", "an implementation detail nobody can act on"],
  ] as const) {
    for (const [name, src] of [["hero", HERO], ["details", DETAILS]] as const) {
      assert(!src.includes(phrase), `${name} must not say "${phrase}" — ${where}`);
    }
  }
});

Deno.test("12. the headline says QUALIFIED, and the promise about drafts stays", () => {
  const lib = read("../../src/lib/workbench/runSummary.ts");
  assert(lib.includes("qualified ${n === 1 ? 'lead' : 'leads'}"),
    "a row being on the page has never meant it qualified");
  // MOVED, NOT DROPPED. It was a standing footer under every screen; it now
  // sits on the Draft outreach action, read at the moment it applies.
  assert(VIEW.includes("Drafts always need your approval"),
    "the approval promise is a commitment about their data — it stays, where it bites");
});

// ═══ 6. THE DATA MODEL IS THE REAL ONE ═════════════════════════════════════

Deno.test("13. the summary is built from the run's own projections", () => {
  // No invented shapes: the quota contract, the persisted portfolio, the stage
  // progress, and the result rows.
  for (const source of ["quota:", "portfolio,", "progress,", "rows:"]) {
    assert(VIEW.includes(source), `buildRunSummary must be fed ${source}`);
  }
  assertEquals(
    (VIEW.match(/buildRunSummary\(/g) ?? []).length, 1,
    "computed once — a second call is a second answer",
  );
});

// ═══ 7. PHASE 2 — ONE TAB ROW, OWNED BY WHOEVER HAS THE DATA ══════════════

Deno.test("14. the panel no longer renders tabs for the leads path", () => {
  // Two tab systems used to describe one screen: the panel's Table / Insights /
  // Activity, and — inside "Table" — every result state mixed into one list.
  assert(/\{!leadsPanel && \(/.test(PANEL),
    "the panel's tab bar is for the non-leads path only");
  assert(PANEL.includes("insightsSlot={"), "Insights is handed down…");
  assert(PANEL.includes("activitySlot={"), "…and so is Activity");
});

Deno.test("15. the leads are fetched ONCE, whatever the tab", () => {
  // `useLeadResults` holds plain state with no shared cache, so a tab that
  // called it again would double every query for the same rows.
  assertEquals((VIEW.match(/useLeadResults\(/g) ?? []).length, 1);
  assert(!PANEL.includes("useLeadResults"),
    "the panel builds the secondary views instead of re-fetching the leads");
});

Deno.test("16. Qualified is the default tab", () => {
  assert(/useState<LeadTabId>\('qualified'\)/.test(VIEW),
    "the hero view is what opens");
});

Deno.test("17. the body switches on the tab, and only leads get the table", () => {
  assert(VIEW.includes("tab === 'not_reached'"));
  assert(VIEW.includes("tab === 'insights'"));
  assert(VIEW.includes("tab === 'activity'"));
  // Filters and bulk selection are meaningless on a list of companies the run
  // never reached; a control that changes nothing is worse than no control.
  assertEquals(
    (VIEW.match(/tab === 'qualified' \|\| tab === 'in_review'/g) ?? []).length, 2,
    "filters and the bulk toolbar are both gated to the lead tabs",
  );
});

Deno.test("18. an empty tab explains the bucket", () => {
  assert(VIEW.includes("LEAD_TAB_EMPTY[tab]"),
    "'No leads' cannot distinguish a run that found nothing from a tab that " +
    "does not apply to this request");
});

Deno.test("19. selection does not survive a tab change", () => {
  // A toolbar reading "3 selected" for rows the user cannot see, or a count
  // that reappears after a detour, is worse than losing a one-click selection.
  const at = VIEW.indexOf("setSelected(new Set());\n  }, [tab]);");
  assert(at !== -1, "the selection is cleared when the tab changes");
});

Deno.test("20. and the secondary tabs cannot take the leads' space", () => {
  // Every secondary branch is a sibling of the lead table, never a stacked
  // block above it — the phase 1 defect, which a tab system makes easy to
  // reintroduce.
  const bodies = [...VIEW.matchAll(/tab === '(not_reached|insights|activity)' \?/g)];
  assertEquals(bodies.length, 3);
  assert(VIEW.includes('flex-1 min-h-0 overflow-auto px-6 py-5'),
    "each scrolls inside the space the table would have used");
});

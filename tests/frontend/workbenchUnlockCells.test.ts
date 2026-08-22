// THE SPREADSHEET IS THE PRODUCT, AND I DELETED IT.
//
// `LeadTable` (436 lines) and `LockedCell` (48) were removed in the card
// refactor earlier in this session. The fourteen columns WERE a real problem —
// Fit at 12 and Status at 14, past four padlocks, off the right edge — but the
// SHAPE was the product: a grid you work across row by row, unlocking what you
// do not yet know. Replacing it with stacked cards fixed the columns and
// removed the workspace.
//
// Worse, quietly: `accountViews` and `outreachHints` — the per-stage unlock
// state `LeadResultsView` hydrates on every load — kept being computed and were
// passed to nothing for two commits.
//
// ZERO network, ZERO React rendering.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { unlockFailureReason, unlockStateFor } from "../../src/lib/workbench/unlockState.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SHEET = code(read("../../src/components/chat/workspace/workbench/leadTable/LeadSpreadsheet.tsx"));
const VIEW = code(read("../../src/components/chat/workspace/workbench/LeadResultsView.tsx"));
const CELL = code(read("../../src/components/chat/workspace/workbench/leadTable/UnlockCell.tsx"));

// deno-lint-ignore no-explicit-any
const stage = (o: Record<string, unknown>): any => ({ attempt: null, last_success: null, ...o });

// ═══ 1. THE SIX STATES, FROM THE REAL STAGE MODEL ══════════════════════════

Deno.test("1. nothing asked for yet is an OFFER, not a fault", () => {
  assertEquals(unlockStateFor({ stage: stage({}) }), "not_researched");
  assertEquals(unlockStateFor({ stage: undefined }), "not_researched",
    "a row with no view yet is the same ordinary resting state");
});

Deno.test("2. a running attempt is `processing`", () => {
  assertEquals(unlockStateFor({ stage: stage({ attempt: { status: "running" } }) }), "processing");
});

Deno.test("3. HELD DATA OUTRANKS A LATER FAILURE", () => {
  // A failed retry does not un-hold what we already have, and showing "Try
  // again" over a value the user can see would be a lie about the screen.
  const s = unlockStateFor({
    stage: stage({ last_success: { full_name: "Dana" }, attempt: { status: "failed" } }),
  });
  assertEquals(s, "unlocked");
});

Deno.test("4. `unavailable` and `not_researched` are DIFFERENT", () => {
  // One is a provider the user must configure; the other is work nobody has
  // asked for. Rendering them alike either nags about impossible work or hides
  // a setup problem behind a button that can never succeed.
  assertEquals(unlockStateFor({ stage: stage({}), providerReady: false }), "unavailable");
  assertEquals(unlockStateFor({ stage: stage({}), providerReady: true }), "not_researched");
});

Deno.test("5. a provider that went away shadows an old attempt", () => {
  assertEquals(
    unlockStateFor({ stage: stage({ attempt: { status: "failed" } }), providerReady: false }),
    "unavailable",
    "the button would fail now, whatever happened before",
  );
});

Deno.test("6. a finished failure is retryable, and says why", () => {
  const st = stage({ attempt: { status: "no_match", failure_reason: "No profile found" } });
  assertEquals(unlockStateFor({ stage: st }), "failed");
  assertEquals(unlockFailureReason(st), "No profile found");
  assertEquals(unlockFailureReason(stage({ attempt: { status: "running" } })), null,
    "a call still running has not failed");
});

// ═══ 2. PRICE — THE THING THAT MUST NOT BE INVENTED ════════════════════════

Deno.test("7. NO CREDIT AMOUNT IS FABRICATED", () => {
  // Verified against the repo and the live database, not from a comment:
  // `unlock-founders` and `credits_reserve` have zero callers in src/;
  // `runAction` dispatches lead kinds and returns BEFORE `estimateCredits`;
  // workspace_credit_balances and credit_transactions are both empty. These
  // actions charge nothing, so a "· 2 credits" label would be a price invented
  // for the look of the thing.
  assert(/cost\s*=\s*null/.test(CELL), "cost defaults to null — free");
  assert(!/\d+\s+credits?/.test(CELL.replace(/cost === 1/g, "")),
    "no literal amount may be hardcoded in the cell");
  const usages = [...SHEET.matchAll(/<UnlockCell\b[\s\S]*?\/>/g)];
  assertEquals(usages.length, 3, "one per unlockable column");
  for (const u of usages) {
    assert(!/cost=/.test(u[0]), `a cost is being passed in:\n${u[0]}`);
  }
});

Deno.test("8. but the cell CAN render a real cost when one exists", () => {
  // The affordance is ready for a paid path; it just refuses to pretend one is
  // here. When credits are wired the number belongs here AND on the path that
  // reserves it — never on one without the other.
  assert(/cost != null && cost > 0/.test(CELL),
    "a supplied cost renders; zero and null do not");
});

// ═══ 3. THE UNLOCK DISPATCHES THE RIGHT ROW ════════════════════════════════

Deno.test("9. every unlock names its own row id", () => {
  const calls = [...SHEET.matchAll(/onUnlock\('([a-z_]+)',\s*([A-Za-z.]+)\)/g)];
  assertEquals(calls.length, 3, "decision-maker, research, outreach");
  for (const [, action, arg] of calls) {
    assertEquals(arg, "r.id", `${action} must spend against the row it sits on`);
  }
  assertEquals(
    calls.map((c) => c[1]).sort(),
    ["draft_outreach", "find_contacts", "research_company"],
  );
});

Deno.test("10. an UNLOCKED cell renders its value and offers no purchase", () => {
  // Buying what we already hold is the waste this guards. Each column checks
  // `=== 'unlocked'` with the held value before falling through to the offer.
  for (const held of ["dm", "research", "outreach"]) {
    assert(
      new RegExp(`State === 'unlocked' && ${held}`).test(SHEET),
      `the ${held} column must render held data instead of an unlock button`,
    );
  }
});

// ═══ 4. THE STATE THE VIEW WAS ALREADY KEEPING ═════════════════════════════

Deno.test("11. the hydrated stage state reaches the grid again", () => {
  // It was computed and passed to nothing for two commits.
  assert(VIEW.includes("accountViews={accountViews}"));
  assert(VIEW.includes("outreachHints={outreachHints}"));
  assert(SHEET.includes("accountViews[r.id]"), "and is read per row");
});

Deno.test("12. provider readiness is passed, not guessed", () => {
  assert(/people:\s*!!isApifyPeopleReady/.test(VIEW));
  assert(/research:\s*!!isFirecrawlReady/.test(VIEW));
  assert(SHEET.includes("providerReady: providers.people"));
  assert(SHEET.includes("providerReady: providers.research"));
});

// ═══ 5. ONE GRID, AND IT IS THE PAGE ═══════════════════════════════════════

Deno.test("13. exactly one grid implementation", () => {
  for (const gone of ["LeadTable.tsx", "LockedCell.tsx", "LeadCard.tsx", "LeadCardList.tsx"]) {
    let exists = true;
    try {
      read(`../../src/components/chat/workspace/workbench/leadTable/${gone}`);
    } catch { exists = false; }
    assert(!exists, `${gone} must not coexist with the spreadsheet`);
  }
  assert(!VIEW.includes("<LeadCardList"), "the card list is not a second grid");
});

Deno.test("14. the grid is the only growing region", () => {
  assert(/flex-1 min-h-0 overflow-auto/.test(SHEET));
  assert(!/max-h-\[\d+%\]/.test(VIEW), "no percentage sibling may squeeze it");
  // ONE scroll region, both axes. A nested vertical scroller inside a
  // horizontal one is how a sticky header comes unstuck.
  assertEquals((SHEET.match(/overflow-auto/g) ?? []).length, 1);
});

Deno.test("15. the company column stays put during a horizontal scroll", () => {
  assert(/sticky left-0/.test(SHEET), "selection is pinned");
  assert(/sticky left-9/.test(SHEET), "and the company name beside it");
  assert(/sticky top-0/.test(SHEET), "with a pinned header");
});

Deno.test("16. evidence is a link, not a paragraph in every row", () => {
  // Paragraphs of reasoning in every row is what made the original unreadable.
  assert(SHEET.includes("truncate"), "row content is clipped, not wrapped");
  assert(SHEET.includes("onOpen(r)"), "and the drawer holds the full reasoning");
});

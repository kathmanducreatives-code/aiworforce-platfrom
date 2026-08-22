// THE NEXT-STEP BUTTON MUST NOT ADVERTISE A COST IT DOES NOT CHARGE.
//
// ── THE AFFORDANCE MOVED; THE GUARANTEE DID NOT ─────────────────────────────
//
// This protected `LockedCell`, the padlocked table cell whose whole content was
// an upsell. Four of the fourteen columns were those. The card replaced them:
// the same dispatch now hangs off one next-step button per lead, shown only
// when there is genuinely something missing.
//
// `LockedCell` and `LeadTable` are deleted — nothing imported them once the
// card list landed, and 484 lines of unreachable UI would only rot. What must
// not be deleted with them is this: the affordance claims no price, AND the
// path it triggers is provably the free one.
//
// LockedCell used to render a `~Nc` badge and an "Unlock — ~N credits" tooltip.
// Nothing charged it. Every action the unlock cells dispatch is mapped by
// workbenchActionToLeadKind() to a lead_action kind, and LeadResultsView's
// runAction() sends those to runDirectLeadAction() and RETURNS — before
// estimateCredits() and before the confirm dialog run at all. The credit-
// ledgered flow (supabase/functions/unlock-founders) has zero callers in src/.
//
// These tests hold the two halves together: the label claims nothing, AND the
// path it triggers is provably the free one. If someone wires a paid unlock,
// the second test fails first and says so.
//
// Pure and structural — no DOM, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { workbenchActionToLeadKind } from "../../src/lib/leadActionRequest.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

const CARD_SRC = read("../../src/components/chat/workspace/workbench/leadTable/LeadCard.tsx");
const CARD_LIST_SRC = read("../../src/components/chat/workspace/workbench/leadTable/LeadCardList.tsx");
const RESULTS_VIEW_SRC = read("../../src/components/chat/workspace/workbench/LeadResultsView.tsx");

/** Source with comments removed — comments may discuss credits; code may not. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

Deno.test("the lead card renders no credit cost at all", () => {
  const code = stripComments(CARD_SRC);
  assert(!/\bcredits?\b/i.test(code),
    "the card's code must not mention credits — the next step charges none");
  assert(!/~\$\{credits\}/.test(code) && !/\{credits\}c/.test(code),
    "no credit badge may be rendered");
});

Deno.test("no caller passes a credit cost to the card", () => {
  const usages = [...stripComments(CARD_LIST_SRC).matchAll(/<LeadCard\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert(usages.length > 0, "the list must still render LeadCard — the test is otherwise vacuous");
  for (const u of usages) {
    assert(!/\bcredits\s*=/.test(u), `LeadCard usage passes a credit cost:\n${u}`);
  }
});

Deno.test("every unlock button dispatches an action that takes the FREE direct path", () => {
  const actions = [...stripComments(CARD_LIST_SRC).matchAll(/onUnlock\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert(actions.length > 0, "no onUnlock dispatches found — the test would be vacuous");

  // Every distinct action must map to a lead_action kind. That mapping is what
  // makes runAction() return early via runDirectLeadAction(), i.e. free.
  const distinct = [...new Set(actions)].sort();
  for (const a of distinct) {
    assert(
      workbenchActionToLeadKind(a) !== null,
      `unlock action '${a}' does NOT map to a lead kind, so it falls through to the ` +
      `credits-confirm path — the cost-free label on its button would then be wrong`,
    );
  }
  // ── THE SET SHRANK, DELIBERATELY ──────────────────────────────────────
  //
  // It was ["draft_outreach", "find_contacts", "research_company"] — three
  // padlocked cells per row, each an upsell for a different action. The card
  // offers ONE next step, and only when something is genuinely missing.
  //
  // The other two capabilities did not go away: "Research company" and
  // "Generate outreach" are in the action bar, applied to the selection. That
  // is the same work reached by choosing rows first instead of by a padlock in
  // every row of every column.
  //
  // Pinned so a newly-added unlock action has to come back through here.
  assertEquals(distinct, ["find_contacts"]);
});

Deno.test("runAction returns on the direct lead path BEFORE estimating credits", () => {
  const code = stripComments(RESULTS_VIEW_SRC);
  const kindIdx = code.indexOf("workbenchActionToLeadKind(action)");
  const directReturnIdx = code.indexOf("runDirectLeadAction(kind, rows); return;");
  const estimateIdx = code.indexOf("estimateCredits(action, rows)");

  assert(kindIdx >= 0, "runAction must still resolve the lead kind");
  assert(directReturnIdx > kindIdx, "the direct lead path must return immediately after the mapping");
  assert(
    estimateIdx > directReturnIdx,
    "estimateCredits must come AFTER the direct-path return; if it ran first, unlock actions would be charged",
  );
});

Deno.test("the credit-ledgered unlock-founders flow still has no src/ caller", () => {
  // If this ever becomes false, the free-label decision above must be revisited.
  for (const [file, src] of [
    ["LeadCard", CARD_SRC], ["LeadCardList", CARD_LIST_SRC],
    ["LeadResultsView", RESULTS_VIEW_SRC],
  ] as const) {
    assert(!/unlock-founders/.test(src), `${file} now calls unlock-founders — the free label is no longer accurate`);
  }
});

// THE UNLOCK BUTTON MUST NOT ADVERTISE A COST IT DOES NOT CHARGE.
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

const LOCKED_CELL_SRC = read("../../src/components/chat/workspace/workbench/leadTable/LockedCell.tsx");
const LEAD_TABLE_SRC = read("../../src/components/chat/workspace/workbench/leadTable/LeadTable.tsx");
const RESULTS_VIEW_SRC = read("../../src/components/chat/workspace/workbench/LeadResultsView.tsx");

/** Source with comments removed — comments may discuss credits; code may not. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

Deno.test("LockedCell renders no credit cost at all", () => {
  const code = stripComments(LOCKED_CELL_SRC);
  assert(!/\bcredits?\b/i.test(code), "LockedCell's code must not mention credits — it charges none");
  // The specific things that used to lie: the `~Nc` badge and the tooltip.
  assert(!/~\$\{credits\}/.test(code) && !/\{credits\}c/.test(code), "no credit badge may be rendered");
});

Deno.test("no caller passes a credit cost to LockedCell", () => {
  const usages = [...stripComments(LEAD_TABLE_SRC).matchAll(/<LockedCell\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert(usages.length > 0, "LeadTable must still render LockedCell — the test is otherwise vacuous");
  for (const u of usages) {
    assert(!/\bcredits\s*=/.test(u), `LockedCell usage still passes a credit cost:\n${u}`);
  }
});

Deno.test("every unlock button dispatches an action that takes the FREE direct path", () => {
  const actions = [...stripComments(LEAD_TABLE_SRC).matchAll(/onUnlock\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
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
  // Pin the set so a newly-added unlock action has to come back through here.
  assertEquals(distinct, ["draft_outreach", "find_contacts", "research_company"]);
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
  for (const [file, src] of [["LeadTable", LEAD_TABLE_SRC], ["LeadResultsView", RESULTS_VIEW_SRC]] as const) {
    assert(!/unlock-founders/.test(src), `${file} now calls unlock-founders — the free label is no longer accurate`);
  }
});

// ONE WORKBENCH PER CONVERSATION.
//
// THE DEFECT. `ChatWorkspaceContext` kept `selectedOutput` in a single piece of
// provider state and never cleared it on a chat switch. Open a workflow, start a
// new conversation, and the Workbench still rendered the PREVIOUS chat's
// `plan_id` — a brand-new chat that had sourced nothing displayed a finished
// run's leads as its own.
//
// `useLeadResults` was never at fault: it queries `.eq('plan_id', planId)` and
// always has. It was handed the wrong plan id.
//
// These tests are pure and structural — no DOM, no network, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  EMPTY_WORKBENCH_MESSAGE, UNSCOPED_CONVERSATION, acceptRealtimeEvent,
  conversationBucket, ownsSelection, sameWorkbench, workbenchQueryKey,
  workbenchViewState, type WorkbenchOwnership,
} from "../../src/lib/workbench/workbenchSession.ts";

const OLD_CHAT = "conv-old";
const NEW_CHAT = "conv-new";
const own = (o: Partial<WorkbenchOwnership> = {}): WorkbenchOwnership => ({
  workspaceId: "ws-1", conversationId: OLD_CHAT, taskId: "task-1", planId: "plan-1", ...o,
});

// ═══════════════ 15. the query key carries the whole ownership chain ══

Deno.test("15. query keys include workspace, conversation, task and plan", () => {
  const k = workbenchQueryKey(own());
  assert(k.includes("ws-1"), "workspace");
  assert(k.includes(OLD_CHAT), "conversation");
  assert(k.includes("task-1"), "task");
  assert(k.includes("plan-1"), "plan");

  // Every link CHANGES the key. A key that ignored the conversation is exactly
  // the cache that served one chat's rows to another.
  const base = workbenchQueryKey(own()).join("|");
  for (const change of [
    { workspaceId: "ws-2" }, { conversationId: NEW_CHAT },
    { taskId: "task-2" }, { planId: "plan-2" },
  ]) {
    assertFalse(workbenchQueryKey(own(change)).join("|") === base,
      `${Object.keys(change)[0]} must change the key`);
  }

  // A missing link is NAMED, never collapsed to the same key as another absence.
  const k2 = workbenchQueryKey({ workspaceId: null, conversationId: null, taskId: null, planId: null });
  assertEquals(k2.length, 5);
  assertFalse(k2.join("|") === workbenchQueryKey(own()).join("|"));
  assert(sameWorkbench(own(), own()));
  assertFalse(sameWorkbench(own(), own({ planId: "plan-2" })));
});

// ═════════════════ 14. a new conversation clears previous rows ══

Deno.test("14. a selection from another chat is not shown in this one", () => {
  const selection = { conversationId: OLD_CHAT, planId: "plan-1" };

  assert(ownsSelection(selection, OLD_CHAT), "its own chat shows it");
  assertFalse(ownsSelection(selection, NEW_CHAT),
    "the new chat must NOT inherit the previous chat's Workbench");
  assertFalse(ownsSelection(null, OLD_CHAT));

  // The bucket a selection lands in is its OWN conversation, so switching chats
  // reads a different bucket and the previous rows are simply not there.
  assertEquals(conversationBucket(OLD_CHAT, NEW_CHAT), OLD_CHAT);
  assertEquals(conversationBucket(null, NEW_CHAT), NEW_CHAT);
  assertEquals(conversationBucket(null, null), UNSCOPED_CONVERSATION);

  // An unattributable selection is NOT assumed to belong to the active chat.
  // That permissive reading is what the bug was made of.
  assertFalse(ownsSelection({ conversationId: null }, NEW_CHAT));
});

// ═════════════════ 18. switching back restores the right Workbench ══

Deno.test("18. switching chats restores each conversation's own Workbench", () => {
  // The store the context keeps: one selection per conversation.
  const store: Record<string, { planId: string }> = {};
  const open = (conv: string | null, active: string | null, planId: string) => {
    store[conversationBucket(conv, active)] = { planId };
  };
  const visible = (active: string | null) => store[conversationBucket(null, active)] ?? null;

  open(OLD_CHAT, OLD_CHAT, "plan-old");
  assertEquals(visible(OLD_CHAT)?.planId, "plan-old");

  // Switch to a brand-new chat: nothing to show.
  assertEquals(visible(NEW_CHAT), null, "a new chat starts empty");

  open(NEW_CHAT, NEW_CHAT, "plan-new");
  assertEquals(visible(NEW_CHAT)?.planId, "plan-new");

  // Switch BACK: the older chat still has its own, unchanged.
  assertEquals(visible(OLD_CHAT)?.planId, "plan-old");
});

// ═══════════════════ 16. late events from old plans are ignored ══

Deno.test("16. a realtime event for another plan is dropped", () => {
  const owner = own();

  assert(acceptRealtimeEvent({ plan_id: "plan-1" }, owner), "this plan's event applies");
  assert(acceptRealtimeEvent({ plan_id: "plan-1", task_id: "task-9" }, owner),
    "another task of the SAME plan is still this Workbench's business");

  assertFalse(acceptRealtimeEvent({ plan_id: "plan-old" }, owner),
    "a still-finishing previous run must not repopulate the panel");
  assertFalse(acceptRealtimeEvent({ task_id: "task-other" }, owner));
  assertFalse(acceptRealtimeEvent(null, owner));
  assertFalse(acceptRealtimeEvent({ plan_id: "plan-1" }, own({ planId: null })),
    "with no plan of its own, a Workbench accepts nothing");
});

// ═══════════ 17. a current plan with zero rows shows the empty state ══

Deno.test("17. an empty current plan says so, and does not borrow rows", () => {
  assertEquals(workbenchViewState({ hasSelection: true, loading: false, rowCount: 0 }), "empty");
  assertEquals(EMPTY_WORKBENCH_MESSAGE, "No results for this workflow yet.");

  // LOADING IS NOT EMPTY. Showing "no results" while the first query is in
  // flight is a claim about the run, not about the request.
  assertEquals(workbenchViewState({ hasSelection: true, loading: true, rowCount: 0 }), "loading");
  assertEquals(workbenchViewState({ hasSelection: true, loading: true, rowCount: 3 }), "rows");
  assertEquals(workbenchViewState({ hasSelection: false, loading: false, rowCount: 0 }), "no_selection");
});

// ═══════════════════════════════ the wiring is real ══

Deno.test("wiring: the context stores selections per conversation", async () => {
  const src = await Deno.readTextFile(
    new URL("../../src/contexts/ChatWorkspaceContext.tsx", import.meta.url));
  assert(src.includes("selectionByConversation"),
    "a single global selectedOutput is the defect itself");
  assertFalse(/useState<WorkbenchSelection \| null>\(null\)/.test(src),
    "the old single-slot state must be gone, not merely unused");
  assert(src.includes("conversationBucket(sel.conversationId, activeConversationId)"),
    "a selection is filed under ITS OWN conversation");
});

Deno.test("wiring: the Workbench remounts and the hook takes the full chain", async () => {
  const panel = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/workbench/WorkbenchPanel.tsx", import.meta.url));
  assert(panel.includes("key={workbenchKey}"),
    "local row selection, filters and per-row action state must be discarded too");
  assert(panel.includes("workbenchQueryKey({"));

  const hook = await Deno.readTextFile(new URL("../../src/hooks/useLeadResults.ts", import.meta.url));
  assert(hook.includes("ownership: WorkbenchOwnership"),
    "the hook must take the chain, not a bare plan id");
  assert(hook.includes("ownerRef.current !== requestOwner"),
    "a response from the chat the user left must not land");
  assert(hook.includes("setItems([])"), "changing owner clears rows synchronously");

  const view = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/workbench/LeadResultsView.tsx", import.meta.url));
  assert(view.includes("EMPTY_WORKBENCH_MESSAGE"));
  assertFalse(view.includes("useLeadResults(meta.plan_id)"),
    "the bare plan id is what let another chat's rows through");
});

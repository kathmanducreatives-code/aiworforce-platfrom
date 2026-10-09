// Conversation history groups: Today / Yesterday / Earlier, by local day. Pure.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { groupConversationsByDay } from "../../src/lib/chat/conversationGroups.ts";

const NOW = new Date(2026, 9, 7, 9, 30); // 7 Oct 2026, 09:30 local
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

Deno.test("rows fall into Today, Yesterday and Earlier by local calendar day, order kept", () => {
  const rows = [
    { id: "a", updated_at: at(2026, 9, 7, 8) },
    { id: "b", updated_at: at(2026, 9, 7, 0) },
    { id: "c", updated_at: at(2026, 9, 6, 23) },
    { id: "d", updated_at: at(2026, 9, 6, 0) },
    { id: "e", updated_at: at(2026, 9, 5, 23) },
    { id: "f", updated_at: at(2025, 0, 1) },
  ];
  assertEquals(groupConversationsByDay(rows, NOW).map((g) => [g.label, g.items.map((r) => r.id)]), [
    ["Today", ["a", "b"]],
    ["Yesterday", ["c", "d"]],
    ["Earlier", ["e", "f"]],
  ]);
});

Deno.test("empty groups are dropped; a row without a usable date is Earlier", () => {
  assertEquals(groupConversationsByDay([], NOW), []);
  assertEquals(groupConversationsByDay([{ id: "x", updated_at: at(2026, 9, 7) }], NOW).map((g) => g.label), ["Today"]);
  assertEquals(
    groupConversationsByDay([{ id: "n", updated_at: null }, { id: "bad", updated_at: "not a date" }], NOW)
      .map((g) => [g.label, g.items.length]),
    [["Earlier", 2]],
  );
});

Deno.test("yesterday is the previous calendar day across a month boundary", () => {
  const firstOfMonth = new Date(2026, 10, 1, 10);
  assertEquals(
    groupConversationsByDay([{ id: "y", updated_at: at(2026, 9, 31, 22) }], firstOfMonth).map((g) => g.label),
    ["Yesterday"],
  );
});

// THE CHAT WAS NEVER LIVE, AND THE FRONTEND WAS NEVER THE REASON.
//
// ── WHAT WAS ACTUALLY BROKEN ───────────────────────────────────────────────
//
// `useChatConversation` subscribed to `postgres_changes` on `public.messages`,
// filtered by conversation, and deduped by row id. All of that was correct. The
// channel reached SUBSCRIBED, the socket was open, the row was written — and no
// event ever arrived, because `messages` was not in the `supabase_realtime`
// publication. Postgres does not publish what it has not been told to publish.
//
// Measured against production with a control before any code changed:
//
//   messages   not published   SUBSCRIBED   row written   0 events
//   tasks      published       SUBSCRIBED   row written   1 event
//
// So the transport fix is a migration. What these tests pin is everything
// AROUND it — the merge that decides whether a message the client learns about
// twice is displayed once, and the ordering that decides where it lands. Those
// are what turn a working socket into a correct transcript, and they are the
// parts that can silently regress.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeMessages, applyRealtimeEvent, sortByCreatedAt, pendingIsResolved,
} from "../../src/lib/chat/messageMerge.ts";

const m = (id: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ id, created_at: at, role: "assistant", content: id, ...extra });

// ══ 1. ONE MESSAGE, HOWEVER MANY TIMES IT IS OBSERVED ══════════════════════

Deno.test("1. the HTTP result and the realtime event render one message", () => {
  // The reply can arrive in the send response AND as an INSERT. Two bubbles
  // means Pilot appears to answer twice.
  const fromFetch = [m("a", "2026-08-28T08:00:00Z")];
  const afterRealtime = applyRealtimeEvent(fromFetch, "INSERT", m("a", "2026-08-28T08:00:00Z"));
  assertEquals(afterRealtime.length, 1);
  assertEquals(afterRealtime[0].id, "a");
});

Deno.test("2. replaying an event is idempotent", () => {
  // Supabase can redeliver after a reconnect. Applying the same INSERT three
  // times must not grow the transcript.
  let rows = [m("a", "2026-08-28T08:00:00Z")];
  for (let i = 0; i < 3; i++) {
    rows = applyRealtimeEvent(rows, "INSERT", m("b", "2026-08-28T08:00:01Z"));
  }
  assertEquals(rows.map((r) => r.id), ["a", "b"]);
});

Deno.test("3. an UPDATE patches in place and never duplicates", () => {
  const rows = applyRealtimeEvent(
    [m("a", "2026-08-28T08:00:00Z", { content: "draft" })],
    "UPDATE", m("a", "2026-08-28T08:00:00Z", { content: "final" }));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].content, "final");
});

Deno.test("4. a DELETE removes exactly its own row", () => {
  const rows = applyRealtimeEvent(
    [m("a", "2026-08-28T08:00:00Z"), m("b", "2026-08-28T08:00:01Z")],
    "DELETE", m("b", "2026-08-28T08:00:01Z"));
  assertEquals(rows.map((r) => r.id), ["a"]);
});

// ══ 2. ORDER COMES FROM THE SERVER ═════════════════════════════════════════

Deno.test("5. a late arrival lands in server order, not on the end", () => {
  // Two assistant messages written together — a Scout line and a Pilot line —
  // can arrive out of order. Appending would show the reply before the report.
  const rows = applyRealtimeEvent(
    [m("late", "2026-08-28T08:00:05Z")],
    "INSERT", m("early", "2026-08-28T08:00:01Z"));
  assertEquals(rows.map((r) => r.id), ["early", "late"]);
});

Deno.test("6. equal timestamps keep their existing order", () => {
  // Same-millisecond writes must not shuffle on every re-render.
  const rows = sortByCreatedAt([
    m("first", "2026-08-28T08:00:00Z"),
    m("second", "2026-08-28T08:00:00Z"),
    m("third", "2026-08-28T08:00:00Z"),
  ]);
  assertEquals(rows.map((r) => r.id), ["first", "second", "third"]);
});

// ══ 3. RECONCILIATION AFTER A DISCONNECT ═══════════════════════════════════

Deno.test("7. a reconcile read recovers what was missed without losing what arrived", () => {
  // The socket dropped; two messages were written while it was away; realtime
  // then delivered one of them before the recovery query returned.
  const onScreen = [m("a", "2026-08-28T08:00:00Z"), m("c", "2026-08-28T08:00:02Z")];
  const fromServer = [
    m("a", "2026-08-28T08:00:00Z"),
    m("b", "2026-08-28T08:00:01Z"),
    m("c", "2026-08-28T08:00:02Z"),
  ];
  const merged = mergeMessages(onScreen, fromServer);
  assertEquals(merged.map((r) => r.id), ["a", "b", "c"]);
});

Deno.test("8. the reconcile does not revert a fresher realtime patch", () => {
  // A per-field merge, not a per-row replace: the query may have read the row
  // before an UPDATE that realtime already applied.
  const onScreen = [m("a", "2026-08-28T08:00:00Z", { content: "final", extra: 1 })];
  const fromServer = [m("a", "2026-08-28T08:00:00Z", { content: "final" })];
  const merged = mergeMessages(onScreen, fromServer);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].extra, 1, "fields only the client had must survive");
});

Deno.test("9. an empty recovery read never blanks the transcript", () => {
  const onScreen = [m("a", "2026-08-28T08:00:00Z")];
  assertEquals(mergeMessages(onScreen, []).length, 1);
});

// ══ 4. THE OPTIMISTIC BUBBLE ═══════════════════════════════════════════════

Deno.test("10. the pending bubble clears when its real row arrives", () => {
  const text = "What leads do I currently have?";
  assertEquals(pendingIsResolved([], text), false, "still pending before the row exists");
  assertEquals(
    pendingIsResolved([{ id: "u1", role: "user", content: text }], text), true);
});

Deno.test("11. an assistant echo does not clear the pending user bubble", () => {
  // Only the user's own row resolves it. Otherwise a reply quoting the question
  // would make the question disappear.
  const text = "hello";
  assertEquals(
    pendingIsResolved([{ id: "a1", role: "assistant", content: text }], text), false);
});

// ══ 5. THE TRANSPORT ITSELF ════════════════════════════════════════════════

Deno.test("12. messages is published for realtime", async () => {
  // The root cause, pinned. A subscription on an unpublished table reaches
  // SUBSCRIBED and receives nothing forever, which is indistinguishable from a
  // quiet conversation — so this is asserted at the schema, where it is visible.
  const sql = await Deno.readTextFile(
    new URL("../../supabase/migrations/20260828090000_messages_realtime_publication.sql",
      import.meta.url));
  assert(/alter publication supabase_realtime add table public\.messages/i.test(sql),
    "the chat table must be added to the realtime publication");
  assert(/pg_publication_tables/.test(sql),
    "and guarded so re-applying it is inert");
});

Deno.test("13. the subscription reports its status", async () => {
  // `subscribe()` was called with no callback, so a channel that never reached
  // SUBSCRIBED looked exactly like one that was working and had nothing to say.
  // That is how a missing publication survived: the failure mode is silence.
  const hook = await Deno.readTextFile(
    new URL("../../src/hooks/useChatConversation.ts", import.meta.url));
  assert(/channel\.subscribe\(\(status\)/.test(hook),
    "the channel status must be observed");
  assert(/CHANNEL_ERROR|TIMED_OUT/.test(hook),
    "a failed subscription must be handled, not ignored");
  assert(/visibilitychange/.test(hook),
    "a backgrounded tab must reconcile on return");
});

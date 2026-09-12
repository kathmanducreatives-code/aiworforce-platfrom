// THE MOUNTED PATH FROM A SIGNAL TO PILOT, AND WHAT IT CARRIES.
//
// Found by the live canary, not by reading code: the Signals drawer that was
// wired first is not mounted anywhere. The real surface is the Content page —
// "Ask Mira" on a trend — and every command from it was dropped twice before
// Pilot saw it:
//
//   1. ChatComposerPro treated any command with an `action_source` as an in-chat
//      card and refused it without an originating conversation: "Action lost
//      its chat context". A page entry point has no conversation to lose.
//   2. pilot-chat refused the same shape with a 400 for the same reason.
//
// Both dropped the structured metadata with it, so the signal's id never
// reached the server. These tests pin the contract that fixed it: a PAGE entry
// starts its own conversation and keeps its metadata; a CARD without its
// conversation is still refused.
//
// ZERO network, ZERO database, ZERO models.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSignalEventRow, mergeSignalFeed } from "../../src/lib/signalEventProjection.ts";
import { normalizeSignalRow } from "../../src/lib/signalFeedModel.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

// ══════════ 1. the command-bus contract ═════════════════════════════════════

Deno.test("a page command is marked as a page entry; a command with a conversation is a card", async () => {
  const s = code(await read("src/lib/agentCommand.ts"));
  assert(s.includes('entry: opts.conversation_id ? "card" : "page"'));
  const bus = code(await read("src/lib/chatCommandBus.ts"));
  assert(/entry\?:\s*"page"\s*\|\s*"card"/.test(bus), "the bus payload carries where the command started");
});

Deno.test("the composer refuses only a CARD that lost its conversation, and forwards page entries", async () => {
  const s = code(await read("src/components/chat/workspace/ChatComposerPro.tsx"));
  assert(s.includes("pageEntry: cmd.entry === 'page'"), "the bus handler must pass the entry through");
  assert(s.includes("const isCardAction = !!opts?.actionSource && !opts?.pageEntry;"),
    "an action_source alone must not make a page command a card");
  assert(s.includes("if (isCardAction && !conversationId)"), "a real card without its conversation is still refused");
  assert(s.includes("...(opts?.pageEntry ? { entry: 'page' as const } : {})"), "and the server is told");
  // Metadata still travels on every path.
  assert(s.includes("metadata: opts?.metadata,"));
});

Deno.test("pilot-chat refuses a card without its conversation — but not a page entry — and records which", async () => {
  const s = code(await read("supabase/functions/pilot-chat/index.ts"));
  assert(s.includes('const isPageEntry = body?.entry === "page";'));
  assert(s.includes("if (actionSource && !conversationId && !isPageEntry) {"),
    "the card rule stays; only a page entry is exempt");
  assert(s.includes('...(isPageEntry ? { entry: "page" } : {}), ...(actionMetadata ?? {})'),
    "the user turn records the entry and keeps the client metadata — signal_id included");
  const client = code(await read("src/lib/pilotChat.ts"));
  assert(/entry\?:\s*'page'\s*\|\s*'card'/.test(client));
});

// ══════════ 2. asking Pilot about a signal carries its id as data ══════════

Deno.test("Ask Pilot about a selected signal carries that signal's id as metadata", async () => {
  // Mira was the outreach persona borrowed by the Content page; the chat path it
  // carried lives on in the Studio's source preview, with the same contract.
  const page = code(await read("src/pages/Content.tsx"));
  const i = page.indexOf("onAskPilot={async (text) => {");
  assert(i > 0, "the source preview offers Ask Pilot");
  const block = page.slice(i, page.indexOf("}}", i));
  assert(block.includes("metadata: buildSignalContextMetadata(selectedSignal)"), "the id travels as data");
  assert(block.includes("action_source: 'content_copilot'"));
  assert(!page.includes("MiraCopilot"));
});

// ══════════ 3. a legacy-only signal is never a fake FK ═════════════════════

Deno.test("the Content page derives the source from the signal's store, never passes a raw feed id as the FK", async () => {
  const page = code(await read("src/pages/Content.tsx"));
  const i = page.indexOf("const turnSignalInto = useCallback(");
  assert(i > 0);
  const fn = page.slice(i, page.indexOf("}, [workspaceId", i));
  assert(fn.includes("const source = signalContentSource(sg);"));
  assert(fn.includes("source_signal_id: source.source_signal_id"));
  assert(!/source_signal_id:\s*sg\.id/.test(fn), "a legacy signals id in source_signal_id violates the FK");
  assert(!/relatedSignalIds:\s*\[sg\.id\]/.test(fn), "Scribe's related signals are canonical ids only");
});

Deno.test("the feed marks which table each row came from", () => {
  const canonical = normalizeSignalEventRow({ id: "e1", workspace_id: "w", signal_type: "competitor_activity", normalized_value: { title: "T" } });
  assertEquals(canonical.store, "signal_events");
  const legacy = normalizeSignalRow({ id: "l1", workspace_id: "w", signal_type: "hiring_signal", title: "L" } as never);
  assertEquals(legacy.store, "signals");
  const merged = mergeSignalFeed(
    [{ id: "e1", workspace_id: "w", legacy_signal_id: "l-covered", normalized_value: {} }],
    [{ id: "l-covered", workspace_id: "w" } as never, { id: "l-only", workspace_id: "w" } as never],
  );
  assertEquals(merged.signals.map((s) => [s.id, s.store]).sort(), [["e1", "signal_events"], ["l-only", "signals"]]);
});

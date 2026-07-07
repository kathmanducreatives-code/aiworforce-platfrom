import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dispatchAgentCommand,
  subscribeChatCommand,
  hasChatListener,
  setChatOpener,
  __resetChatCommandBus,
  type ChatCommandPayload,
} from "./chatCommandBus.ts";

function setup() {
  __resetChatCommandBus();
}

Deno.test("delivers immediately when a listener is already mounted", async () => {
  setup();
  const received: ChatCommandPayload[] = [];
  const unsub = subscribeChatCommand((p) => received.push(p));
  const ok = await dispatchAgentCommand({ text: "hello" });
  assert(ok);
  assertEquals(received.length, 1);
  assertEquals(received[0].text, "hello");
  unsub();
});

Deno.test("buffers, opens chat, and flushes on subscribe", async () => {
  setup();
  let opened = 0;
  const received: ChatCommandPayload[] = [];
  assert(!hasChatListener());
  // Dispatch with no listener → should call ensureOpen and buffer.
  const p = dispatchAgentCommand(
    { text: "draft comment", action_source: "signal_feed_action" },
    { ensureOpen: () => { opened++; }, timeoutMs: 2000 },
  );
  assertEquals(opened, 1, "ensureOpen called exactly once");
  // Composer mounts a moment later and subscribes → flush.
  const unsub = subscribeChatCommand((cmd) => received.push(cmd));
  const ok = await p;
  assert(ok, "resolves true after flush");
  assertEquals(received.length, 1);
  assertEquals(received[0].action_source, "signal_feed_action");
  unsub();
});

Deno.test("uses the registered opener when ensureOpen is not passed", async () => {
  setup();
  let opened = 0;
  setChatOpener(() => { opened++; });
  const p = dispatchAgentCommand({ text: "x" }, { timeoutMs: 1000 });
  assertEquals(opened, 1);
  const unsub = subscribeChatCommand(() => {});
  await p;
  unsub();
});

Deno.test("resolves false and drops the command when nothing consumes it", async () => {
  setup();
  const ok = await dispatchAgentCommand({ text: "orphan" }, { timeoutMs: 30 });
  assertEquals(ok, false);
  // A late subscriber must NOT receive the timed-out command.
  const received: ChatCommandPayload[] = [];
  const unsub = subscribeChatCommand((p) => received.push(p));
  assertEquals(received.length, 0);
  unsub();
});

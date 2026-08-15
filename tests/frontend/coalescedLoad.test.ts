// WHY THIS FILE EXISTS.
//
// A Workbench tab pinned to a plan that never finalised took the whole app
// down: the 4-second heartbeat kept firing five-query reads without waiting for
// the previous one, so as the database slowed the reads piled up, filled
// PostgREST's connection pool, and every unrelated request — loading the chat
// list, sending a message — came back as an upstream timeout.
//
// The database being slow was a separate problem. The client turning that into
// an outage was this one, and these tests pin the property that prevents it:
// concurrency stays at one no matter how fast the triggers arrive.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coalesceLoads } from "../../src/lib/chat/coalescedLoad.ts";

/** A read whose completion the test controls. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

Deno.test("1. concurrent callers never produce concurrent reads", async () => {
  let concurrent = 0;
  let peak = 0;
  let started = 0;
  const gate = deferred();

  const load = coalesceLoads(async () => {
    started++;
    concurrent++;
    peak = Math.max(peak, concurrent);
    await gate.promise;
    concurrent--;
  });

  // The heartbeat, a realtime event and a refocus, all inside one slow read.
  const a = load(); const b = load(); const c = load();
  assertEquals(started, 1, "only the first caller starts a read");
  assertEquals(peak, 1);

  gate.resolve();
  await Promise.all([a, b, c]);

  // THE COLLAPSE. Three triggers during one read produce exactly one follow-up,
  // not three — the reads are idempotent, so a single fresh one answers all of
  // them. This is the property that bounds the connection count.
  assertEquals(started, 2);
  assertEquals(peak, 1, "two reads ran, never at the same time");
});

Deno.test("2. a trigger during a read is not dropped", async () => {
  let started = 0;
  const gate = deferred();
  // Only the FIRST read blocks; the follow-up must be free to complete, or the
  // test would prove the loader hangs rather than that it re-reads.
  const load = coalesceLoads(async () => {
    started++;
    if (started === 1) await gate.promise;
  });

  const first = load();
  // Something changed while we were reading; the in-flight read may already
  // have fetched its rows, so the UI would be stale without a re-read.
  const during = load();
  gate.resolve();
  await Promise.all([first, during]);

  assertEquals(started, 2, "the follow-up read must actually happen");
});

Deno.test("3. a quiet loader starts a read immediately", async () => {
  let started = 0;
  const load = coalesceLoads(async () => { started++; });

  await load();
  assertEquals(started, 1);
  await load();
  // Sequential calls are not coalesced — nothing was in flight to fold into.
  assertEquals(started, 2);
});

Deno.test("4. a failing read never rejects and never wedges the loader", async () => {
  // The callers are timers and event listeners. A rejection escaping into a
  // `setInterval` is invisible in production, and a loader left stuck busy
  // would silently kill the heartbeat for the life of the component — a worse
  // failure than the slowness it exists to survive.
  let started = 0;
  const errors: unknown[] = [];
  const load = coalesceLoads(
    async () => { started++; throw new Error("PostgREST timeout"); },
    { onError: (e) => errors.push(e) },
  );

  await load();
  assertEquals(started, 1);
  assertEquals(errors.length, 1);
  assertEquals(load.busy(), false, "the loader must be usable again");

  // The next heartbeat retries, which is the recovery path.
  await load();
  assertEquals(started, 2);
});

Deno.test("5. a failure inside a coalesced batch still runs the follow-up", async () => {
  let started = 0;
  const gate = deferred();
  const errors: unknown[] = [];
  const load = coalesceLoads(async () => {
    started++;
    if (started === 1) { await gate.promise; throw new Error("boom"); }
  }, { onError: (e) => errors.push(e) });

  const first = load();
  const queued = load();
  gate.resolve();
  await Promise.all([first, queued]);

  assertEquals(errors.length, 1);
  assertEquals(started, 2, "a failed read must not swallow the queued trigger");
});

Deno.test("6. cancellation stops the follow-up read", async () => {
  // An unmounted component must not issue the read its own heartbeat queued a
  // moment earlier — that is work against a view nobody is looking at, and on a
  // saturated pool it is work that costs someone else their request.
  let started = 0;
  let cancelled = false;
  const gate = deferred();
  const load = coalesceLoads(
    async () => { started++; await gate.promise; },
    { isCancelled: () => cancelled },
  );

  const first = load();
  load(); // queued
  cancelled = true;
  gate.resolve();
  await first;

  assertEquals(started, 1, "the queued read must not run after cancellation");
});

Deno.test("7. busy() reports the read in flight", async () => {
  const gate = deferred();
  const load = coalesceLoads(async () => { await gate.promise; });

  assertEquals(load.busy(), false);
  const running = load();
  assertEquals(load.busy(), true);
  gate.resolve();
  await running;
  assertEquals(load.busy(), false);
});

Deno.test("8. a burst of triggers is bounded by read duration, not burst size", async () => {
  // The shape of the original failure: a trigger every tick against a read
  // slower than the tick. Before, this produced one read per trigger and they
  // all stayed open at once. Now the total is bounded regardless of burst size.
  let started = 0;
  const gate = deferred();
  const load = coalesceLoads(async () => {
    started++;
    if (started === 1) await gate.promise;
  });

  const calls = [load()];
  for (let i = 0; i < 50; i++) calls.push(load());
  assertEquals(started, 1, "51 triggers, one read");

  gate.resolve();
  await Promise.all(calls);

  assertEquals(started, 2, "51 triggers collapse to two reads total");
});

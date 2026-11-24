// A FIRST SLICE KILLED BEFORE ITS FIRST CHECKPOINT IS RUN AGAIN, ON ITS OWN TASK.
//
// The decision is narrow (V2-queue-owned, still running, no checkpoint, no
// verdict) and the new generation is one conditional UPDATE. The end-to-end
// kill/resume is pinned against real Postgres in
// tests/db-contract/killResume.contract.test.ts. ZERO network, ZERO database.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideFirstSliceReentry, type ReentryQuery, takeReentryGeneration,
} from "../../../supabase/functions/_shared/firstSliceReentry.ts";
import { OPEN_RESULT_FILTER } from "../../../supabase/functions/_shared/fencedTaskWrite.ts";
import { SOURCING_STATE_VERSION } from "../../../supabase/functions/_shared/companyFirstSourcingState.ts";

const WS = "ws-1", T = "t-1";
const dead = (over: Record<string, unknown> = {}) => ({
  id: T, workspace_id: WS, status: "running", checkpoint_version: 0,
  result: { lead_runtime: { contract: { ok: true } } }, ...over,
});

Deno.test("re-entry: a queue-owned running task with no checkpoint and no verdict runs again from its generation", () => {
  assertEquals(decideFirstSliceReentry(dead(), WS, T, true), { ok: true, from: 0 });
  assertEquals(decideFirstSliceReentry(dead({ checkpoint_version: 4 }), WS, T, true), { ok: true, from: 4 });
});

Deno.test("re-entry is refused for everything else: the ordinary resume path decides", () => {
  const no = { ok: false };
  assertEquals(decideFirstSliceReentry(dead(), WS, T, false), no, "not owned by the V2 queue");
  assertEquals(decideFirstSliceReentry(null, WS, T, true), no, "no row");
  assertEquals(decideFirstSliceReentry(dead(), "other", T, true), no, "another workspace");
  assertEquals(decideFirstSliceReentry(dead(), WS, "t-2", true), no, "another task");
  assertEquals(decideFirstSliceReentry(dead({ result: { company_first_state: { version: SOURCING_STATE_VERSION } } }), WS, T, true), no,
    "a checkpoint exists: a real resume");
  assertEquals(decideFirstSliceReentry(dead({ result: { terminal_status: "failed" } }), WS, T, true), no, "a verdict exists");
  assertEquals(decideFirstSliceReentry(dead({ status: "failed" }), WS, T, true), no, "the row ended");
  assertEquals(decideFirstSliceReentry(dead({ status: "ready" }), WS, T, true), no, "not a dead first slice");
  assertEquals(decideFirstSliceReentry(dead({ checkpoint_version: null }), WS, T, true), no, "no generation to fence on");
});

function fakeDb(count: number | null, error: unknown = null) {
  const sent: unknown[][] = [];
  let patch: Record<string, unknown> = {};
  const q: ReentryQuery = {
    eq: (c, v) => { sent.push(["eq", c, v]); return q; },
    is: (c, v) => { sent.push(["is", c, v]); return q; },
    or: (f) => { sent.push(["or", f]); return q; },
    then: (resolve, reject) => Promise.resolve({ error, count }).then(resolve, reject),
  };
  return {
    db: { from: (t: string) => { sent.push(["from", t]); return { update: (p: Record<string, unknown>) => { patch = p; return q; } }; } },
    sent, patch: () => patch,
  };
}

Deno.test("the new generation is ONE compare-and-swap on the row exactly as the dead slice left it", async () => {
  const f = fakeDb(1);
  assertEquals(await takeReentryGeneration(f.db, T, WS, 3), 4);
  assertEquals(f.patch().checkpoint_version, 4);
  assertEquals(f.sent, [["from", "tasks"], ["eq", "id", T], ["eq", "workspace_id", WS], ["eq", "checkpoint_version", 3],
    ["eq", "status", "running"], ["is", "result->company_first_state", null], ["or", OPEN_RESULT_FILTER]]);
});

Deno.test("a lost swap or a failed write takes no generation: the caller refuses as before", async () => {
  assertEquals(await takeReentryGeneration(fakeDb(0).db, T, WS, 3), null);
  assertEquals(await takeReentryGeneration(fakeDb(null, { message: "x" }).db, T, WS, 3), null);
});

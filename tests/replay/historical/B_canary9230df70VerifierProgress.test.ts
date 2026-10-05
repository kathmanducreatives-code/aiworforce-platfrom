// HISTORICAL B — CANARY 9230df70 (production 2026-10-03): VERIFIER-ONLY SLICES WERE COUNTED BARREN.
//
// Slices that only verified (Atomus, Pvalyou, Firecrawl, adoptions) changed no
// qualified/investigated/decided count, so `barren_slices` reached 2 and the
// lineage stopped `no_progress` before page 3 with discovery open (fixed by
// PR #15: canonical claim progress counts). Replayed from the logged counters
// through the production `foldSlice` + `decideAutoContinuation`.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import { replayLineage } from "../lib/continuation.ts";

const fx = loadFixture("canary9230df70.verifier-progress");
const expected = fx.expected as { decisions: string[]; barren: number[] };
const asItRan = (fx.anchors as { as_it_ran: { decisions: string[]; barren: number[] } }).as_it_ran;

Deno.test("[historical] B anchors: without claim progress the production fold reproduces the canary's stop — barren 2, no_progress", () => {
  const old = replayLineage(fx.slices!.map((s) => ({ ...s, claimProgress: null })));
  assertEquals(old.map((d) => d.decision), asItRan.decisions);
  assertEquals(old.map((d) => d.barren), asItRan.barren);
});

Deno.test("[historical] B claim progress prevents the barren increment: no slice is barren and slice 5 asks for page 3", () => {
  const now = replayLineage(fx.slices!);
  assertEquals(now.map((d) => d.decision), expected.decisions);
  assertEquals(now.map((d) => d.barren), expected.barren);
  assertEquals(now.at(-1)!.continue, true);
});

Deno.test("[continuation] two slices that change no claim, adopt nothing and add no company still end no_progress", () => {
  const s = fx.slices![4];
  const stuck = replayLineage([fx.slices![0], s, { ...s, label: "6: nothing" }, { ...s, label: "7: nothing" }]);
  assertEquals(stuck.at(-1)!.decision, "no_progress");
  assertEquals(stuck.at(-1)!.barren, 2);
});

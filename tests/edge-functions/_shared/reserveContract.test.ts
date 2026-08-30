// THE RESERVE IS FOR THE WORK THIS SLICE CREATES.
//
// ── THE RATCHET, IN TWO GENERATIONS ────────────────────────────────────────
//
// `downstreamReserveMs` is right to grow with held work — the identity stage
// must stop while it can still afford to enrich and qualify what it resolved.
// The question was always WHICH work that is. It was handed every actionable
// identity, which on a continuation is the whole accumulated backlog:
//
//   gen 12   backlog 7   threshold 126,000 ms   usable 105,597 ms   STOP
//   gen 16   backlog 6   threshold 114,000 ms   usable 105,000 ms   STOP
//
// Both stopped before their first call — `targets: 21, attempted: 0` — while
// fourteen companies had never had a paid lookup, and each spent a credit
// re-qualifying companies it already held. Six credits bought one lead.
//
// The assumption underneath is that the entire backlog must clear inside one
// slice. For a pool larger than a slice that can never hold, so the reserve
// climbs with cumulative progress until it exceeds any window. A
// resolved-but-unenriched company is not stranded: the checkpoint carries it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  downstreamReserveMs, identityStopThreshold, resolveTimeCapacity,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  CHECKPOINT_RESERVE_MS,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const CAPACITY = resolveTimeCapacity({
  remainingMs: 123_597, reserveMs: CHECKPOINT_RESERVE_MS,
  concurrency: 4, enrichmentBatchSize: 10, read: () => undefined,
  qualificationMs: 12_000,
});
const threshold = (n: number) => identityStopThreshold({
  resolvedSoFar: n, capacity: CAPACITY,
  checkpointReserveMs: CHECKPOINT_RESERVE_MS, perCallEstimateMs: 12_000,
});

/** What a slice counts under each contract. */
const backlog = (inherited: number, fresh: number) => inherited + fresh;
const thisSlice = (_inherited: number, fresh: number) => fresh;

// ══ THE TWO GENERATIONS THAT STALLED ══════════════════════════════════════

Deno.test("GEN 12 — the backlog contract stops a slice that has done nothing yet", () => {
  assert(105_597 <= threshold(backlog(7, 0)), "126,000 ms against 105,597 ms");
  assert(105_597 > threshold(thisSlice(7, 0)),
    "with nothing resolved yet, only the checkpoint is owed and the slice runs");
});

Deno.test("GEN 16 — and again at the next water mark", () => {
  assert(105_000 <= threshold(backlog(6, 0)), "114,000 ms against 105,000 ms");
  assert(105_000 > threshold(thisSlice(6, 0)));
});

Deno.test("THE RATCHET IS THE POINT: the further it gets, the less it can do", () => {
  // Under the backlog contract the threshold rises monotonically with progress
  // and eventually exceeds any window, whatever the slice has left.
  const climbing = [3, 5, 7, 9, 12].map((n) => threshold(backlog(n, 0)));
  for (let i = 1; i < climbing.length; i++) assert(climbing[i] > climbing[i - 1]);
  // 12 inherited is 186,000 ms — past the 400s paid ceiling once the rest of a
  // slice is accounted for, and far past the 150s free one.
  assert(climbing.at(-1)! > 180_000,
    `past any plausible edge-function window: ${climbing.at(-1)}`);
  // Under the slice contract a continuation always starts affordable.
  for (const n of [3, 5, 7, 9, 40]) {
    assertEquals(threshold(thisSlice(n, 0)), CHECKPOINT_RESERVE_MS + 12_000,
      "an inherited backlog costs this slice nothing to begin");
  }
});

// ══ THE PROPERTY THAT MUST SURVIVE ════════════════════════════════════════

Deno.test("A FRESH RUN IS UNCHANGED — run ea2d02f2's lesson is intact", () => {
  // On a fresh slice everything resolved IS new, so the two contracts are the
  // same function. Ten fresh identities still stop the stage.
  for (const n of [0, 1, 5, 10, 20]) {
    assertEquals(threshold(backlog(0, n)), threshold(thisSlice(0, n)),
      `fresh slice with ${n} resolved must behave identically`);
  }
  assert(110_000 <= threshold(thisSlice(0, 10)),
    "'room for one more search' is still not the binding question");
});

Deno.test("THE SLICE STILL SELF-LIMITS as it resolves", () => {
  // The contract does not remove the brake; it points it at this slice's own
  // work. Gen 16 with 105s: starts free, and stops once it has created enough.
  assert(105_000 > threshold(thisSlice(6, 0)), "starts");
  assert(105_000 > threshold(thisSlice(6, 3)), "still going at three");
  assert(105_000 <= threshold(thisSlice(6, 6)), "and stops at six");
});

Deno.test("a checkpoint is always affordable", () => {
  // Unchanged and load-bearing: it is what makes a deferral recordable rather
  // than a company stranded, which is the premise the whole contract rests on.
  for (const n of [0, 1, 5, 50]) {
    assert(downstreamReserveMs({
      resolvedSoFar: n, capacity: CAPACITY, checkpointReserveMs: CHECKPOINT_RESERVE_MS,
    }) >= CHECKPOINT_RESERVE_MS, `${n}`);
  }
});

// ══ THE CALL SITE ═════════════════════════════════════════════════════════

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("THE STAGE COUNTS ONLY WHAT IT RESOLVED ITSELF", () => {
  assert(/const inheritedIdentityKeys = new Set\(/.test(code),
    "the inherited set must be captured");
  assert(/!inheritedIdentityKeys\.has\(c\.key\)/.test(code),
    "and excluded from the reserve");
});

Deno.test("the inherited set is captured BEFORE any call is made", () => {
  const captured = code.indexOf("const inheritedIdentityKeys = new Set(");
  const bounded = code.indexOf("const bounded = await runBounded(targets");
  assert(captured > -1 && bounded > -1 && captured < bounded,
    "capturing it later would count this slice's own work as inherited");
});

Deno.test("it is taken once, from the same targets the stage runs on", () => {
  assertEquals(code.split("const inheritedIdentityKeys = new Set(").length - 1, 1);
  const block = code.slice(code.indexOf("const inheritedIdentityKeys = new Set("));
  assert(block.slice(0, 200).includes("targets.filter"),
    "a different population would make the subtraction meaningless");
});

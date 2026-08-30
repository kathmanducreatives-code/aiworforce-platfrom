// THE RESERVE MUST BE FOR WORK STILL OWED, NOT WORK ALREADY DONE.
//
// ── THE RATCHET, FROM PRODUCTION ───────────────────────────────────────────
//
// `downstreamReserveMs` is right to grow with held work — the identity stage
// must stop while it can still afford to enrich and qualify what it resolved.
// It was handed EVERY actionable identity, including companies resolved,
// enriched and qualified in earlier generations whose downstream work is done
// and will never be repeated.
//
// So the reserve grew with cumulative lineage progress until it exceeded any
// single slice, and identity resolution could never attempt anything again.
// The further a lineage got, the less it could do.
//
// Lineage 862e81be, generation 11 — 7 identities restored, all 7 enriched, 3
// qualified, 14 companies still needing identity:
//
//   reserve    1x12,000 + 7x12,000 + 18,000 = 114,000 ms
//   threshold                                 126,000 ms
//   usable                                    105,597 ms
//   result     targets: 21, attempted: 0, unattempted: 21
//
// A credit spent, no leads written, 105 seconds unused, and the run capped at
// 3 of 5 by arithmetic about the past.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  downstreamReserveMs, identityStopThreshold, resolveTimeCapacity,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  CHECKPOINT_RESERVE_MS,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

/** Generation 11's own capacity, from its telemetry. */
const CAPACITY = resolveTimeCapacity({
  remainingMs: 123_597, reserveMs: CHECKPOINT_RESERVE_MS,
  concurrency: 4, enrichmentBatchSize: 10, read: () => undefined,
  qualificationMs: 12_000,
});
const USABLE = 105_597;
const PER_CALL = 12_000;

const threshold = (n: number) => identityStopThreshold({
  resolvedSoFar: n, capacity: CAPACITY,
  checkpointReserveMs: CHECKPOINT_RESERVE_MS, perCallEstimateMs: PER_CALL,
});

// ══ THE RATCHET ═══════════════════════════════════════════════════════════

Deno.test("GENERATION 11, REPLAYED — cumulative counting stops the stage dead", () => {
  // 7 identities ever resolved. This is the number the call site used to pass.
  assert(USABLE <= threshold(7),
    `with 7 held, the stage stops before its first call — that is the defect`);
});

Deno.test("…AND COUNTING ONLY OUTSTANDING WORK LETS IT PROCEED", () => {
  // All 7 were enriched; 3 were already qualified. Four still owe downstream
  // work, and four is what the fixed call site passes.
  assert(USABLE > threshold(4),
    "with 4 genuinely outstanding, the slice can run");
});

Deno.test("THE SELF-LIMITING PROPERTY IS PRESERVED", () => {
  // The reserve must still grow with held work — this is what stops a stage
  // resolving more identities than it can afford to finish. The fix changes
  // WHAT IS COUNTED, never the counting.
  const at = (n: number) => downstreamReserveMs({
    resolvedSoFar: n, capacity: CAPACITY, checkpointReserveMs: CHECKPOINT_RESERVE_MS,
  });
  assertEquals(at(0), CHECKPOINT_RESERVE_MS);
  assert(at(1) > at(0));
  assert(at(10) > at(5));
  // Enough outstanding work still stops the stage, exactly as before.
  assert(USABLE <= threshold(8), "a genuinely loaded slice must still refuse");
});

// ══ THE CALL SITE ═════════════════════════════════════════════════════════

const ENGINE = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
const code = ENGINE.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("THE STAGE RESERVES ONLY FOR COMPANIES THAT STILL OWE SOMETHING", () => {
  const call = code.slice(code.indexOf("resolvedSoFar: targets.filter"));
  const expr = call.slice(0, call.indexOf(").length"));
  assert(expr.includes("identityIsActionable"),
    "a resolved identity is still the precondition");
  assert(/c\.enriched === null \|\| c\.brain === null/.test(expr),
    "and it must be one that still owes enrichment or qualification");
});

Deno.test("it is the ONLY place this count is taken", () => {
  assertEquals(code.split("resolvedSoFar: targets.filter").length - 1, 1);
});

/** The predicate, mirrored — what the call site now counts. */
const outstanding = (cs: Array<{ actionable: boolean; enriched: boolean; qualified: boolean }>) =>
  cs.filter((c) => c.actionable && (!c.enriched || !c.qualified)).length;

Deno.test("862e81be's restored set, counted both ways", () => {
  const restored = [
    ...Array.from({ length: 3 }, () => ({ actionable: true, enriched: true, qualified: true })),
    ...Array.from({ length: 4 }, () => ({ actionable: true, enriched: true, qualified: false })),
    ...Array.from({ length: 14 }, () => ({ actionable: false, enriched: false, qualified: false })),
  ];
  assertEquals(restored.filter((c) => c.actionable).length, 7, "the old count");
  assertEquals(outstanding(restored), 4, "the new one");
  assert(USABLE <= threshold(7) && USABLE > threshold(4),
    "and that difference is the whole run");
});

Deno.test("a company that owes only qualification is still counted", () => {
  // Conservative on purpose: the reserve's job is to be affordable, not exact,
  // and undercharging is the direction that strands a checkpoint.
  assertEquals(outstanding([{ actionable: true, enriched: true, qualified: false }]), 1);
  assertEquals(outstanding([{ actionable: true, enriched: false, qualified: true }]), 1);
  assertEquals(outstanding([{ actionable: true, enriched: true, qualified: true }]), 0);
});

Deno.test("a checkpoint is always affordable", () => {
  // Unchanged and load-bearing: it is what makes a deferral recordable rather
  // than a company stranded.
  for (const n of [0, 1, 5, 50]) {
    assert(downstreamReserveMs({
      resolvedSoFar: n, capacity: CAPACITY, checkpointReserveMs: CHECKPOINT_RESERVE_MS,
    }) >= CHECKPOINT_RESERVE_MS, `${n}`);
  }
});

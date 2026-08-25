// PHASE 5 — WHAT THE FEED MAY SAY ABOUT A SITUATION.
//
// The strip is small, and every line of it is a claim. These pin the two that
// could be wrong in a way a reader would not notice:
//
//   * a cluster of ONE is a row, not a situation — showing it here would make
//     the strip a second copy of the feed below it;
//   * every event written so far carries `occurred_at_basis: unknown`, so the
//     times are OBSERVATIONS. "3 signals this week" would claim something
//     nobody established; "3 signals seen" is what is true.
//
// Read from the component's own source, so the wording cannot drift from the
// rule without this failing.
//
// PURE. No network, no React render, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clusterSignalEvents, type ClusterableEvent,
} from "../../supabase/functions/_shared/signalCluster.ts";

const SRC = await Deno.readTextFile(
  new URL("../../src/components/signals/SituationStrip.tsx", import.meta.url),
);

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const ev = (over: Partial<ClusterableEvent> = {}): ClusterableEvent => ({
  workspace_id: "w", signal_type: "sales_hiring", signal_category: "gtm",
  origin: "scheduled_monitor", subject_type: "competitor",
  subject_key: "linkedin-com-company-vercel", account_id: null,
  occurred_at: null, occurred_at_basis: "unknown",
  observed_at: new Date(NOW - 86_400_000).toISOString(),
  verification_status: "unverified", lifecycle_status: "active", ...over,
});

Deno.test("1. only multi-signal clusters are situations", () => {
  assert(
    SRC.includes(".filter((c) => c.signal_types.length > 1)"),
    "a cluster of one is a row; the feed below already shows rows",
  );
  // And with nothing multi-signal there is no strip at all — not an empty
  // heading claiming zero situations.
  assert(SRC.includes("if (situations.length === 0) return null;"));
});

Deno.test("2. an undated situation says 'seen', never 'this week'", () => {
  assert(SRC.includes("const undated = c.timing.occurred === 0;"));
  assert(SRC.includes("signals seen"), "the honest word for an observation");
  assert(SRC.includes("dated ·"), "and dated events are counted separately when they exist");
  // No time-window language that would imply the events happened in it.
  assertFalse(
    /this week|today|recently|in the last/i.test(SRC),
    "the strip implies an event time the events do not carry",
  );
});

Deno.test("3. it labels canonical types without inventing one it lacks", () => {
  // A type with no label falls back to the type itself, humanised — never to a
  // guess about what the signal means.
  assert(SRC.includes("SIGNAL_LABEL[t] ?? t.replace(/_/g,"));
  for (const t of ["sales_hiring", "recent_funding", "market_expansion", "product_launch"]) {
    assert(SRC.includes(`${t}:`), `${t} needs a reader-facing label`);
  }
});

Deno.test("4. the real three-signal situation is what the strip would show", () => {
  // The cluster sitting in the store: one company, three signals, three
  // categories — and every single-signal cluster filtered out.
  const { clusters } = clusterSignalEvents([
    ev({ signal_type: "sales_hiring", signal_category: "gtm" }),
    ev({ signal_type: "market_expansion", signal_category: "growth" }),
    ev({ signal_type: "product_launch", signal_category: "product" }),
    ev({ subject_key: "eulerhq-com", subject_type: "company", signal_type: "recent_funding" }),
  ], { now: NOW });

  const situations = clusters.filter((c) => c.signal_types.length > 1);
  assertEquals(situations.length, 1);
  assertEquals(situations[0].subject_key, "linkedin-com-company-vercel");
  assertEquals(situations[0].signal_types.length, 3);
  assertEquals(situations[0].timing.occurred, 0, "nothing here carries a source date");
  // And it outranks the lone funding row, which is the whole point.
  assert(situations[0].priority > clusters.find((c) => c.subject_key === "eulerhq-com")!.priority);
});

Deno.test("5. the strip reads the canonical module, not a copy of it", () => {
  assert(
    SRC.includes('from "../../../supabase/functions/_shared/signalCluster.ts"'),
    "a mirrored copy would drift from the edge runtime's version",
  );
  // And no mirror exists in src/ for anyone to import by accident.
  let mirrored = false;
  try {
    Deno.statSync(new URL("../../src/lib/signalCluster.ts", import.meta.url));
    mirrored = true;
  } catch { /* absent, as intended */ }
  assertFalse(mirrored, "src/lib/signalCluster.ts is a second copy of the cluster model");
});


// ── 6–8. PHASE 7: WHAT A JUDGED SITUATION MAY SAY ───────────────────────────

Deno.test("6. the explanation is shown only for a verdict that was BELIEVED", () => {
  // A refused verdict shows nothing rather than a hedge: the validator already
  // decided the claim was not grounded, and printing it anyway would publish
  // exactly what the boundary exists to withhold.
  assert(SRC.includes('const judged = r && r.source === "model";'));
  assert(
    SRC.includes("{judged && (r.why_now || r.why_it_matters) && ("),
    "the explanation must be gated on a believed verdict",
  );
});

Deno.test("7. relevance may reorder within the evidence's ceiling, never above it", () => {
  // The strip sorts by the ADJUSTED priority where one exists. That can only be
  // lower than the deterministic one — the validator caps it and the table's
  // CHECK refuses a row that does not — so this reorders and cannot promote.
  assert(SRC.includes("relevance[b.key]?.adjusted_priority ?? b.priority"));
  assert(
    SRC.includes("b.priority - a.priority || a.key.localeCompare(b.key)"),
    "equal judged priorities must fall back to the evidence's order",
  );
});

Deno.test("8. an unjudged cluster looks exactly as it did before Phase 7", () => {
  // Absent is the ORDINARY case: no judge has read it, or the model was
  // unavailable. Neither is an error and neither may empty the strip.
  assert(SRC.includes("relevance = {}"), "the verdict map must default to empty");
  assert(
    SRC.includes("?? b.priority") && SRC.includes("?? a.priority"),
    "an unjudged cluster must rank by its deterministic priority",
  );
});

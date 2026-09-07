// A WORKSPACE CANNOT SPEND WITHOUT LIMIT ON MODELS.
//
// ── THE HOLE ───────────────────────────────────────────────────────────────
//
// `toolRegistry` gates two things — `source_with_apify` and `scrape_url`. They
// reserve credits, write a ledger row and settle. Model calls did none of it.
// The lead engine bounds itself per run; chat had no ceiling of any kind, so a
// user in a loop was an unbounded bill with no row to attribute it to.
//
// These tests are about the BOUND, not about pricing. They cover the states a
// meter is actually found in: over, under, exactly at, unreadable, unpriced,
// and no workspace at all — because every one of those has a different right
// answer and the wrong one is either a runaway bill or an outage.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorizeModelSpend, resolveSpendEnforcement, resolveCeiling, describeSpend,
  DEFAULT_CEILING_USD, DEFAULT_PERIOD_DAYS,
  MODEL_SPEND_ENFORCEMENT_ENV, MODEL_SPEND_CEILING_ENV, MODEL_SPEND_PERIOD_ENV,
  type SpendDb,
} from "../../../supabase/functions/_shared/modelSpendCeiling.ts";
import {
  MODEL_PRICES, canonicalModelId,
} from "../../../supabase/functions/_shared/modelCostModel.ts";

/** A db whose one query returns these rows, or fails. */
const dbOf = (
  rows: Array<Record<string, unknown>> | { error: unknown },
): SpendDb => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        gte: () =>
          Promise.resolve(
            Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: rows.error },
          ),
      }),
    }),
  }),
});

const priced = (usd: number) => ({
  actual_cost_usd: usd, estimated_cost_usd: null, cost_source: "event_priced",
});

// ══════════ the bound itself ══════════════════════════════════════════════

Deno.test("THE HOLE: a workspace over the ceiling is refused in enforce", async () => {
  const v = await authorizeModelSpend({
    db: dbOf([priced(20), priced(6)]),
    workspace_id: "w", mode: "enforce", ceiling_usd: 25,
  });
  assertEquals(v.spent_usd, 26);
  assert(v.over_ceiling);
  assertEquals(v.allowed, false, "enforce must refuse");
  assertEquals(v.reason, "over_ceiling");
});

Deno.test("under the ceiling proceeds", async () => {
  const v = await authorizeModelSpend({
    db: dbOf([priced(0.34), priced(0.31)]),
    workspace_id: "w", mode: "enforce", ceiling_usd: 25,
  });
  // The two heaviest lineages this product has ever run, together.
  assertEquals(Math.round(v.spent_usd * 100) / 100, 0.65);
  assertEquals(v.over_ceiling, false);
  assert(v.allowed);
  assertEquals(v.reason, "under_ceiling");
});

Deno.test("exactly at the ceiling is over, not under", async () => {
  // A ceiling that lets you spend it and then one more call is a ceiling plus
  // one call. `>=` is the whole difference and it is worth pinning.
  const v = await authorizeModelSpend({
    db: dbOf([priced(25)]), workspace_id: "w", mode: "enforce", ceiling_usd: 25,
  });
  assert(v.over_ceiling);
  assertEquals(v.allowed, false);
});

// ══════════ observe must not be able to break anything ════════════════════

Deno.test("observe reports the same verdict and permits the call", async () => {
  const v = await authorizeModelSpend({
    db: dbOf([priced(100)]), workspace_id: "w", mode: "observe", ceiling_usd: 25,
  });
  assert(v.over_ceiling, "the honest answer does not change with the mode");
  assertEquals(v.allowed, true, "observe permits — that is what it is for");
  assertEquals(v.reason, "over_ceiling");
});

// ══════════ the failure modes a meter really has ══════════════════════════

Deno.test("an unreadable meter permits, in BOTH modes, and says so", async () => {
  // Refusing on a failed read would let one bad query take chat down. The
  // expensive half of the bill is still bounded by the credit reservations on
  // Apify and Firecrawl, so failing open here is the smaller risk — but it must
  // be reported, never silent.
  for (const mode of ["observe", "enforce"] as const) {
    const v = await authorizeModelSpend({
      db: dbOf({ error: { message: "connection reset" } }),
      workspace_id: "w", mode, ceiling_usd: 25,
    });
    assertEquals(v.allowed, true, `${mode} must not fail closed on an unreadable meter`);
    assertEquals(v.reason, "query_failed");
    assert(v.detail?.includes("connection reset"), "and must say why");
  }
});

Deno.test("a throwing db is a failed read, not an exception", async () => {
  const throwing: SpendDb = {
    from: () => ({
      select: () => ({ eq: () => ({ gte: () => { throw new Error("boom"); } }) }),
    }),
  };
  const v = await authorizeModelSpend({
    db: throwing, workspace_id: "w", mode: "enforce", ceiling_usd: 1,
  });
  assertEquals(v.reason, "query_failed");
  assertEquals(v.allowed, true);
});

Deno.test("no workspace is permitted and reported, not metered", async () => {
  const v = await authorizeModelSpend({
    db: dbOf([]), workspace_id: null, mode: "enforce", ceiling_usd: 0.01,
  });
  assertEquals(v.reason, "no_workspace");
  assertEquals(v.allowed, true, "an internal taskless path must not be broken by bookkeeping");
});

// ══════════ an unpriced call is not a free call ═══════════════════════════

Deno.test("THE BLIND SPOT: unpriced calls are counted, never read as $0", async () => {
  const v = await authorizeModelSpend({
    db: dbOf([
      priced(1),
      { actual_cost_usd: null, estimated_cost_usd: null, cost_source: "unknown" },
      { actual_cost_usd: null, estimated_cost_usd: null, cost_source: "unknown" },
    ]),
    workspace_id: "w", mode: "enforce", ceiling_usd: 25,
  });
  assertEquals(v.spent_usd, 1, "an unpriced call contributes no money, because none is known");
  assertEquals(v.unpriced_calls, 2, "but it is COUNTED, so the gap shows in the log");
  assert(describeSpend(v).unpriced_calls === 2, "and reaches the log line");
});

Deno.test("actual cost wins over estimated", async () => {
  const v = await authorizeModelSpend({
    db: dbOf([{ actual_cost_usd: 3, estimated_cost_usd: 99, cost_source: "provider_reported" }]),
    workspace_id: "w", mode: "enforce", ceiling_usd: 25,
  });
  assertEquals(v.spent_usd, 3);
});

// ══════════ every model the router can pick must be priceable ═════════════

Deno.test("THE GAP THIS MAKES LOUD: selectable models that cannot be priced", () => {
  // `spent_usd` can only see what `MODEL_PRICES` can price. A model the router
  // may select but the price table does not know contributes $0 to the ceiling
  // for ever — the meter reads clean while the bill runs. This test does not
  // invent prices; it names the models that need one.
  //
  // Currently unpriced and selectable: `claude-haiku-4-5-20251001` (every
  // Anthropic call — `providerRouting` sends scribe and penn there) and
  // `openai/gpt-5-mini`. Both are recorded in `KNOWN_UNPRICED` rather than
  // hidden, so adding a price removes a name from a list instead of silently
  // changing a number.
  const SELECTABLE = [
    "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol",
    "claude-haiku-4-5-20251001", "openai/gpt-5-mini",
  ];
  const KNOWN_UNPRICED = ["claude-haiku-4-5-20251001", "openai/gpt-5-mini"];

  const unpriced = SELECTABLE.filter((m) => !MODEL_PRICES[canonicalModelId(m)]);
  assertEquals(
    unpriced.sort(), [...KNOWN_UNPRICED].sort(),
    `models the router can select but MODEL_PRICES cannot price: ${unpriced.join(", ")}. ` +
      `Each contributes $0 to the spend ceiling for ever. Add a price, or remove ` +
      `it from the router — do not leave it invisible.`,
  );
  // And the priced ones really are priced, so this cannot pass by matching two
  // empty lists.
  for (const m of ["gpt-5.6-luna", "gpt-5.6-terra"]) {
    assert(MODEL_PRICES[canonicalModelId(m)], `${m} must be priced`);
  }
});

// ══════════ configuration ═════════════════════════════════════════════════

Deno.test("enforcement is OFF unless explicitly turned on", async () => {
  assertEquals(resolveSpendEnforcement(() => undefined), "observe");
  assertEquals(resolveSpendEnforcement(() => "ENFORCE"), "enforce");
  assertEquals(resolveSpendEnforcement(() => "enforce"), "enforce");
  assertEquals(resolveSpendEnforcement(() => "yes"), "observe", "only the exact word arms it");
  assertEquals(
    resolveSpendEnforcement((k) => k === MODEL_SPEND_ENFORCEMENT_ENV ? "enforce" : undefined),
    "enforce",
  );
  // And observe cannot refuse, whatever the numbers say.
  const v = await authorizeModelSpend({
    db: dbOf([priced(1e6)]), workspace_id: "w", mode: resolveSpendEnforcement(() => undefined),
  });
  assertEquals(v.allowed, true);
});

Deno.test("the ceiling is configurable, and a bad value falls back", () => {
  assertEquals(resolveCeiling(() => undefined),
    { ceiling_usd: DEFAULT_CEILING_USD, period_days: DEFAULT_PERIOD_DAYS });
  assertEquals(
    resolveCeiling((k) => k === MODEL_SPEND_CEILING_ENV ? "5" : k === MODEL_SPEND_PERIOD_ENV ? "7" : undefined),
    { ceiling_usd: 5, period_days: 7 },
  );
  // A misconfigured ceiling must not become "unlimited" or "nothing".
  for (const bad of ["0", "-1", "abc", ""]) {
    assertEquals(resolveCeiling(() => bad).ceiling_usd, DEFAULT_CEILING_USD, `"${bad}" must fall back`);
  }
});

// ══════════ the caller wires it ═══════════════════════════════════════════

Deno.test("pilot-chat checks the ceiling before it can spend", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
  );
  assert(src.includes("authorizeModelSpend("), "chat must consult the ceiling");
  // Order is the whole point: after membership, before any model call.
  const member = src.indexOf("not a member of this workspace");
  const guard = src.indexOf("authorizeModelSpend(");
  const firstModel = Math.min(
    ...["generateJson({", "generateText({"]
      .map((n) => src.indexOf(n)).filter((i) => i > 0),
  );
  assert(member > 0 && guard > member, "the ceiling is checked after membership is proven");
  assert(guard < src.lastIndexOf("generateText({"), "and before chat's model work");
  assert(firstModel > 0, "sanity: chat does call a model");
  assert(src.includes("429"), "a refused request must say too-many/over-limit, not 500");
});

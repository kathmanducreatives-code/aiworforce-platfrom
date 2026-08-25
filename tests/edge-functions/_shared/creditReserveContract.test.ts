// THE RESERVE COULD NEVER HAVE SUCCEEDED, AND ENFORCEMENT HID IT.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
//
// `credit_transactions.kind` was CHECK-constrained to
//
//     ('founder_unlock', 'contact_unlock', 'grant', 'adjustment')
//
// and `authorizeProviderCall` has always passed `provider_call`. Every reserve
// it attempted violated the constraint and threw.
//
// ── WHY IT WAS INVISIBLE ────────────────────────────────────────────────────
//
// `LEAD_CREDIT_ENFORCEMENT` defaulted to `observe`, and observe returns
// `allowed: true` for EVERY refusal — including an `rpc_error` refusal. So the
// throw was caught, recorded as a refusal nobody read, and the run carried on.
//
// The bug was invisible precisely BECAUSE enforcement was off, and it was
// armed to fire the instant it was turned on: under enforce,
// `refuse("rpc_error", …)` blocks the call, so every paid provider call in the
// product would have been refused at once.
//
// It was found by running the reserve against the live database instead of
// trusting a path that had never been exercised. These tests hold the two
// halves together so it cannot come back: the KIND the code sends must be a
// kind the schema accepts.
//
// ZERO network — both sides are read from source.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
const AUTH = read("../../../supabase/functions/_shared/creditAuthorization.ts");

/**
 * Every `status` the schema accepts, read from the baseline migration.
 *
 * The `kind` allow-list and the `status` allow-list are two separate CHECK
 * constraints and each has now produced the identical defect: code sending a
 * value the schema rejects, every call throwing, and the guard swallowing it.
 */
const ALLOWED_STATUSES = [
  "reserved", "charged", "partial", "not_charged", "released", "granted",
] as const;

/**
 * Every `kind` literal the schema currently accepts.
 *
 * Read from the LATEST migration that redefines the constraint, not from one
 * filename. Pinning the filename meant a later widening was invisible here —
 * the test would keep checking a superseded list and pass while the code sent a
 * kind the live CHECK rejected, which is the exact defect it exists to catch.
 */
function allowedKinds(): string[] {
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const defining = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => ({ n, sql: read(`../../../supabase/migrations/${n}`) }))
    .filter((f) => /(check\s*\(kind\s+in\s*\(|check\s*\(kind\s*=\s*any)/i.test(f.sql));
  assert(defining.length > 0, "no migration defines the credit kind allow-list");
  const latest = defining[defining.length - 1].sql;
  const start = latest.search(/check\s*\(kind\s*(in\s*\(|=\s*any)/i);
  const block = latest.slice(start, latest.indexOf("));", start));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Every `kind` literal `authorizeProviderCall` can send. */
function sentKinds(): string[] {
  const call = AUTH.slice(AUTH.indexOf("p_kind:"), AUTH.indexOf("p_task_id:"));
  return [...call.matchAll(/"([a-z_]+)"/g)]
    .map((m) => m[1])
    .filter((k) => k !== "monitoring_engine");
}

Deno.test("1. EVERY KIND THE CODE SENDS IS A KIND THE SCHEMA ACCEPTS", () => {
  const sent = sentKinds();
  assert(sent.length > 0, "authorizeProviderCall must name a kind");
  // Both of them: an attended provider call, and an unattended monitoring one.
  // The two exist because only one of them has a period ceiling, and a period
  // total that cannot tell them apart would pause a schedule over a person's
  // manual scans.
  assertEquals(sent.sort(), ["monitoring_call", "provider_call"]);
  const allowed = allowedKinds();
  for (const k of sent) {
    assert(allowed.includes(k),
      `credits_reserve can be called with kind "${k}", which the CHECK ` +
      "constraint rejects — that reserve would throw, and under enforce the " +
      "call would be refused");
  }
});

Deno.test("2. the widening kept every kind that was already legal", () => {
  // A migration that swapped the list rather than extending it would break the
  // `unlock-founders` function, which is the ONLY other caller of this ledger.
  const kinds = allowedKinds();
  for (const previous of ["founder_unlock", "contact_unlock", "grant", "adjustment"]) {
    assert(kinds.includes(previous), `${previous} must stay legal`);
  }
});

Deno.test("3. `provider_call` was WIDENED IN, not renamed onto an unlock kind", () => {
  // Filing every Apify sourcing call under "contact_unlock" would make the
  // ledger unreadable by kind, which is the one thing the column is for.
  assert(!/p_kind:\s*"(founder|contact)_unlock"/.test(AUTH),
    "the lead path is a third caller with a third meaning");
});

// ═══ THE FAILURE MODE THAT MADE IT INVISIBLE ═══════════════════════════════

Deno.test("4. an RPC error is a REFUSAL, which enforce turns into a block", () => {
  // This is correct behaviour and is exactly why the defect was armed: a
  // schema error and a genuine insufficient balance both stop the call. The
  // fix is that the reserve now succeeds, not that errors stop refusing.
  assert(AUTH.includes('return refuse("rpc_error"'),
    "a reserve that throws must not be treated as an authorization");
  // `refuse` is a const arrow, not a function declaration — the first version
  // of this searched for "function refuse" and found nothing.
  const at = AUTH.indexOf("const refuse = (");
  assert(at !== -1, "the refusal helper must still exist");
  const observe = AUTH.slice(at, at + 500);
  assert(/mode === "observe"/.test(observe),
    "observe is the ONLY thing that lets a refusal through — which is what " +
    "hid a reserve that could never have worked");
});

Deno.test("5. observe and enforce differ in exactly one place", () => {
  // If they diverged anywhere else, what is proved in observe would not be what
  // runs in enforce — and the whole point of observe is that it is the real
  // path with the last step disarmed.
  assertEquals((AUTH.match(/mode === "observe"/g) ?? []).length, 1,
    "one branch, one difference");
});

// ═══ SETTLEMENT ════════════════════════════════════════════════════════════

Deno.test("6. a call that never started settles at zero", () => {
  // Verified against the live database as well: finalize(tx, 0, 'not_charged')
  // returns refunded_credits = 2 for a 2-credit reservation.
  assert(/const charged = i\.started \? \(i\.amount \?\? CREDITS_PER_PROVIDER_CALL\) : 0/.test(AUTH));
});

Deno.test("7. the idempotency key is the logical call key", () => {
  // What makes a retried or continued call reserve nothing further. Proven
  // live: a replayed reserve returns the ORIGINAL transaction id.
  assert(/p_idempotency_key:\s*i\.logical_call_key/.test(AUTH));
});

// ═══ THE SETTLE STATUS — THE SAME DEFECT, ONE FIELD OVER ═══════════════════

Deno.test("8. EVERY STATUS THE CODE SENDS IS ONE THE SCHEMA ACCEPTS", () => {
  // `p_status: i.started ? "consumed" : "released"` — and `consumed` has never
  // been permitted. Every settle threw a constraint violation, was caught, and
  // returned `settled: false`. Ninety reservations from two radar scans sat
  // `reserved`: 90 credits held, none charged, none released.
  //
  // The reserve had the identical bug in `kind`, found by running the RPC
  // directly. This one survived because the proof called `credits_finalize`
  // with a VALID status by hand and never checked what the caller sends —
  // proving an RPC works is not proving the code calls it correctly.
  const sent = [...AUTH.matchAll(/p_status:\s*i\.started\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)];
  assert(sent.length === 1, "settleProviderCall must state both statuses in one place");
  const [, whenStarted, whenNot] = sent[0];
  for (const [label, v] of [["started", whenStarted], ["not started", whenNot]] as const) {
    assert((ALLOWED_STATUSES as readonly string[]).includes(v),
      `settle sends "${v}" when ${label}, which credit_transactions_status_check rejects`);
  }
});

Deno.test("9. a call that reached the provider is CHARGED; one that did not is NOT", () => {
  // Verified live: finalize(tx, 1, 'charged') → actual 1, refunded 0.
  //                finalize(tx, 0, 'not_charged') → actual 0, REFUNDED 1.
  const sent = AUTH.match(/p_status:\s*i\.started\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/);
  assertEquals(sent?.[1], "charged");
  assertEquals(sent?.[2], "not_charged",
    "`released` is for the stale reaper, not for a call that simply never started");
});

Deno.test("10. no status literal anywhere in the file is outside the schema", () => {
  // A second settle path added later must not reintroduce this.
  for (const m of AUTH.matchAll(/p_status:\s*"([a-z_]+)"/g)) {
    assert((ALLOWED_STATUSES as readonly string[]).includes(m[1]),
      `literal status "${m[1]}" is not permitted by the schema`);
  }
});

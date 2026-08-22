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

/** Every `kind` literal the schema currently accepts. */
function allowedKinds(): string[] {
  const mig = read(
    "../../../supabase/migrations/20260822130000_credit_kind_provider_call.sql");
  const block = mig.slice(mig.indexOf("check (kind in ("), mig.indexOf("));"));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

Deno.test("1. THE KIND THE CODE SENDS IS A KIND THE SCHEMA ACCEPTS", () => {
  const sent = AUTH.match(/p_kind:\s*"([a-z_]+)"/)?.[1];
  assert(sent, "authorizeProviderCall must name a kind");
  assertEquals(sent, "provider_call");
  assert(allowedKinds().includes(sent),
    `credits_reserve is called with kind "${sent}", which the CHECK constraint ` +
    "rejects — every reserve would throw, and under enforce every paid call in " +
    "the product would be refused");
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

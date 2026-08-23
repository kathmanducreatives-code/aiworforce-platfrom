// NEVER BUY WHAT WE ALREADY HAVE, AND SAY HONESTLY WHAT WE FOUND.
//
// ── TWO RULES, ONE FAILURE MODE ─────────────────────────────────────────────
//
// A user presses an unlock twice. The second press is almost never a request to
// buy the same thing again — it is a mis-click, a reload, or a check on whether
// anything changed. Two separate mechanisms have to agree for that to be free:
//
//   THE REUSE CONTRACT   decides "held, do not spend" from what is persisted.
//   THE CELL STATE       decides what the button says, and a state that reads
//                        as an untouched offer INVITES the second press.
//
// They are tested together because the bug they prevent is one bug: a row that
// has already been paid for looking, and behaving, like a row that has not.
//
// PURE. No network, database, provider or model access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideReuse, heldFor, outreachDepthFor, depthUpgradeFor,
  OUTREACH_DEPTH_ORDER, type HeldEvidence, type UnlockAction,
} from "../../../supabase/functions/_shared/unlockReuseContract.ts";
import {
  unlockStateFor,
} from "../../../src/lib/workbench/unlockState.ts";
import {
  UNLOCK_PRICES,
} from "../../../supabase/functions/_shared/creditPricing.ts";

const PAID: UnlockAction[] = [
  "find_decision_makers", "find_contact_details", "research_company",
];

// ═══════════════ 1-4. HELD MEANS ANSWERED, NOT SUCCESSFUL ══════════════════

Deno.test("1. every PAID action is withheld once its evidence is held", () => {
  const held: HeldEvidence = {
    decision_maker: { full_name: "Ada Kestrel", linkedin_url: "https://x/in/ada" },
    contact: { status: "email_found" },
    research: { summary: "A logistics platform.", evidence_urls: ["https://x/about"] },
  };
  for (const action of PAID) {
    const d = decideReuse(action, held);
    assertEquals(d.verdict, "reuse", action);
    assert(d.spend_avoided, action);
    assert(d.reason.length > 0, `${action} must say WHY it reused`);
  }
});

Deno.test("2. a paid MISS counts as held — re-running buys the same nothing", () => {
  // THE SUBTLE CASE, AND THE EXPENSIVE ONE TO GET WRONG. An email lookup that
  // ran and found no address ANSWERED the question about this person. Treating
  // it as unheld charges the user repeatedly for the same miss.
  const d = decideReuse("find_contact_details", { contact: { status: "not_found" } });
  assertEquals(d.verdict, "reuse");
  assert(d.spend_avoided);
  assert(/same nothing at the same price/.test(d.reason), d.reason);
});

Deno.test("3. a provider ERROR is NOT held — a retry is exactly right", () => {
  // The mirror of test 2, and wrong in the opposite direction: treating a
  // transient failure as permanent means the user can never buy the thing.
  for (const status of ["provider_error", "refused", ""]) {
    const d = decideReuse("find_contact_details", { contact: { status } });
    assertEquals(d.verdict, "purchase", status);
    assertFalse(d.spend_avoided, status);
  }
  assertEquals(decideReuse("find_contact_details", {}).verdict, "purchase");
});

Deno.test("4. partial research is not research", () => {
  // A summary with no evidence URLs cannot ground a claim, so it is not the
  // thing that was bought and must not suppress buying it.
  assertFalse(heldFor("research_company", { research: { summary: "x", evidence_urls: [] } }));
  assertFalse(heldFor("research_company", { research: { summary: "", evidence_urls: ["u"] } }));
  assert(heldFor("research_company", { research: { summary: "x", evidence_urls: ["u"] } }));
});

Deno.test("5. DRAFTING is never withheld — it reaches no paid provider", () => {
  // Outreach costs 0 credits, and a user asking again usually wants a different
  // message. Withholding it would be withholding the free action.
  assertEquals(UNLOCK_PRICES.generate_outreach, 0);
  assertFalse(heldFor("generate_outreach", { outreach: { draft: "already written" } }));
  assertEquals(decideReuse("generate_outreach", { outreach: { draft: "x" } }).verdict,
    "purchase");
});

Deno.test("6. an explicit refresh spends again, and says so", () => {
  const d = decideReuse("research_company",
    { research: { summary: "x", evidence_urls: ["u"] } }, { forceRefresh: true });
  assertEquals(d.verdict, "refresh");
  assertFalse(d.spend_avoided);
  assert(/will charge again/.test(d.reason));
  // Never a default: absent means reuse.
  assertEquals(decideReuse("research_company",
    { research: { summary: "x", evidence_urls: ["u"] } }).verdict, "reuse");
});

// ═══════════════ 7-9. OUTREACH USES WHAT EXISTS ════════════════════════════

Deno.test("7. deep research DEEPENS a draft; it does not gate one", () => {
  const base = {
    has_verified_person: true, has_company_evidence: true,
    has_dated_signal: false, has_deep_research: false,
  };
  // Firmographics alone are writable.
  assertEquals(outreachDepthFor(base), "company_level");
  // A dated trigger is a real why-now.
  assertEquals(outreachDepthFor({ ...base, has_dated_signal: true }), "signal_specific");
  // A crawl is the richest, and only ADDS.
  assertEquals(outreachDepthFor({ ...base, has_dated_signal: true, has_deep_research: true }),
    "research_deep");
  // Every one of those is above the floor — none is `insufficient`.
  for (const signal of [true, false]) {
    for (const research of [true, false]) {
      const d = outreachDepthFor({ ...base, has_dated_signal: signal, has_deep_research: research });
      assert(d !== "insufficient",
        `a verified person with company evidence must always be writable ` +
        `(signal=${signal} research=${research})`);
    }
  }
});

Deno.test("8. THE FLOOR: no person, or no evidence at all, is not writable", () => {
  // Personalization is addressed to somebody. A draft with no verified
  // recipient is a template, and one with nothing grounded would be invented.
  assertEquals(outreachDepthFor({
    has_verified_person: false, has_company_evidence: true,
    has_dated_signal: true, has_deep_research: true,
  }), "insufficient");
  assertEquals(outreachDepthFor({
    has_verified_person: true, has_company_evidence: false,
    has_dated_signal: false, has_deep_research: false,
  }), "insufficient");
});

Deno.test("9. the upgrade suggestion is a RECOMMENDATION, in the right order", () => {
  // A person first — without one there is nothing to write to, and research
  // would be bought for a lead that still cannot be drafted.
  assertEquals(depthUpgradeFor({
    has_verified_person: false, has_company_evidence: true,
    has_dated_signal: true, has_deep_research: false,
  }), "find_decision_makers");
  assertEquals(depthUpgradeFor({
    has_verified_person: true, has_company_evidence: true,
    has_dated_signal: true, has_deep_research: false,
  }), "research_company");
  // Nothing left to suggest.
  assertEquals(depthUpgradeFor({
    has_verified_person: true, has_company_evidence: true,
    has_dated_signal: true, has_deep_research: true,
  }), null);
  assertEquals(OUTREACH_DEPTH_ORDER[0], "research_deep");
  assertEquals(OUTREACH_DEPTH_ORDER[OUTREACH_DEPTH_ORDER.length - 1], "insufficient");
});

// ═══════════════ 10-12. THE CELL MUST NOT INVITE A SECOND PURCHASE ═════════

const stage = (over: Record<string, unknown> = {}) => ({
  attempt: null, last_success: null, ...over,
// deno-lint-ignore no-explicit-any
}) as any;

Deno.test("10. RAN, SUCCEEDED, FOUND NOTHING is `not_found` — not an offer", () => {
  // ── THE STATE THAT WAS MISSING ───────────────────────────────────────────
  //
  // A succeeded attempt with no `last_success` fell through every branch and
  // rendered as `not_researched` — identical to a row nobody had touched. So a
  // user who had already paid to search a company with no matching person was
  // shown the same priced button and could buy the same nothing again.
  assertEquals(unlockStateFor({
    stage: stage({ attempt: { status: "succeeded" }, last_success: null }),
  }), "not_found");

  // A row nobody has touched is still an offer.
  assertEquals(unlockStateFor({ stage: stage() }), "not_researched");
  assertEquals(unlockStateFor({ stage: undefined }), "not_researched");
});

Deno.test("11. HELD DATA OUTRANKS A LATER FAILURE — in every combination", () => {
  // The rule the whole spreadsheet rests on: what we already hold does not stop
  // being held because a retry failed, and showing "Try again" over a value the
  // user can see would be a lie about what is on screen.
  for (const attempt of [
    { status: "failed" }, { status: "succeeded" },
    { status: "failed", reason_code: "credit_authorization_refused" },
  ]) {
    assertEquals(
      unlockStateFor({ stage: stage({ attempt, last_success: { any: "value" } }) }),
      "unlocked",
      JSON.stringify(attempt));
  }
});

Deno.test("12. the six non-held states stay distinct", () => {
  // Each says something different about what happened and what to do, and
  // collapsing any pair is how a user is told the wrong thing.
  assertEquals(unlockStateFor({ stage: stage({ attempt: { status: "running" } }) }),
    "processing");
  assertEquals(unlockStateFor({
    stage: stage({ attempt: { status: "failed", reason_code: "credit_authorization_refused" } }),
  }), "insufficient_credits", "nothing ran and nothing was charged");
  assertEquals(unlockStateFor({ stage: stage(), providerReady: false }),
    "unavailable", "a provider the user must go and configure");
  assertEquals(unlockStateFor({ stage: stage({ attempt: { status: "failed" } }) }),
    "failed", "a provider ran and lost — a retry is right");
  assertEquals(unlockStateFor({ stage: stage({ attempt: { status: "succeeded" } }) }),
    "not_found", "a provider ran and answered nothing — a retry is not");
  assertEquals(unlockStateFor({ stage: stage() }), "not_researched");

  // `unavailable` is checked BEFORE a stale success would matter, but a real
  // held value still wins — the user can see it.
  assertEquals(unlockStateFor({
    stage: stage({ last_success: { v: 1 } }), providerReady: false,
  }), "unlocked");
});

// THE CONTACT DETAILS COLUMN, WIRED END TO END.
//
// ── WHAT "WIRED" HAS TO MEAN ────────────────────────────────────────────────
//
// A column is not a cell. Pressing the button travels through six layers, and
// a break in any of them is invisible in the markup:
//
//   UnlockCell onUnlock('find_contact_details')
//     → LeadResultPanelAction          the panel's vocabulary
//     → workbenchActionToLeadKind      panel action → backend action
//     → LEAD_ACTION_KINDS              the request contract's allow-list
//     → executeLeadAction              the branch that runs a provider
//     → STAGE_FOR_ACTION               which stage the result may update
//     → unlockStateFor                 what the cell says next time
//
// The failure this guards is the quiet one: a button that dispatches an action
// the backend rejects as `unsupported_lead_action`, or that runs and writes to
// a stage the cell never reads — so the user pays and the column never changes.
//
// PURE. No network, no DOM, no provider.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  workbenchActionToLeadKind, AGENT_FOR, INSTRUCTION_FOR, LEAD_ACTION_LOADING,
  type LeadActionKind,
} from "../../src/lib/leadActionRequest.ts";
import {
  STAGE_FOR_ACTION, type ContactEnrichmentView,
} from "../../src/lib/workbenchAccountView.ts";
import { unlockStateFor } from "../../src/lib/workbench/unlockState.ts";
import { priceFor, UNLOCK_PRICES } from "../../src/lib/credits/pricing.ts";
import { estimateCredits, ACTION_LABEL } from
  "../../src/components/chat/workspace/workbench/leadTable/credits.ts";
import {
  LEAD_ACTION_KINDS, isLeadActionKind,
} from "../../supabase/functions/_shared/leadActionRequestContract.ts";

const SPREADSHEET = new URL(
  "../../src/components/chat/workspace/workbench/leadTable/LeadSpreadsheet.tsx",
  import.meta.url);
const src = Deno.readTextFileSync(SPREADSHEET);

// ═══════════════ 1-3. THE CHAIN IS UNBROKEN ════════════════════════════════

Deno.test("1. the button's action survives every hop to the backend", () => {
  // The panel action the cell dispatches…
  assert(src.includes("onUnlock('find_contact_details', r.id)"),
    "the cell must dispatch the contact action");

  // …maps to a backend kind…
  const kind = workbenchActionToLeadKind("find_contact_details");
  assertEquals(kind, "find_contact_details");

  // …which the request contract actually accepts. Without this the button
  // dispatches and run-agent answers `unsupported_lead_action` — a dead cell
  // that looks alive.
  assert(isLeadActionKind(kind), "the backend contract must accept it");
  assert(LEAD_ACTION_KINDS.includes(kind as never));

  // …and the run has an agent, an instruction and a loading label. A missing
  // entry in any of these is a runtime undefined in a Record lookup.
  assertEquals(AGENT_FOR[kind as LeadActionKind], "hawk");
  assert(INSTRUCTION_FOR[kind as LeadActionKind].length > 0);
  assertEquals(LEAD_ACTION_LOADING[kind as LeadActionKind], "Looking up contact details…");
});

Deno.test("2. the result lands in the stage the cell reads", () => {
  // THE OTHER SILENT BREAK. An action that runs, charges, and writes to a stage
  // the column does not read leaves the cell showing an offer forever.
  assertEquals(STAGE_FOR_ACTION.find_contact_details, "contact_enrichment");
  assert(src.includes("view?.contact_enrichment"),
    "the cell must read the stage the action writes");

  // And every kind maps somewhere — a missing entry is `undefined` used as an
  // object key, which silently merges a result into nothing.
  for (const k of LEAD_ACTION_KINDS) {
    assert(STAGE_FOR_ACTION[k as LeadActionKind],
      `${k} has no stage — its result would be written nowhere`);
  }
});

Deno.test("3. the quoted price is the one the reserve takes", () => {
  // The cell renders `priceFor('find_contact_details')`, and the executor tags
  // its runTool call with the same capability, so `authorizeProviderCall`
  // reserves exactly the number the button showed.
  assert(src.includes("priceFor('find_contact_details')"),
    "the cell must quote from the pricing table, never a literal");
  assertEquals(priceFor("find_contact_details"), 1);
  assertEquals(UNLOCK_PRICES.find_contact_details, 1);
  assertEquals(ACTION_LABEL.find_contact_details, "Find contact details");
});

// ═══════════════ 4-6. WHAT THE CELL SAYS, IN EVERY OUTCOME ═════════════════

const stage = (over: Record<string, unknown> = {}) =>
  // deno-lint-ignore no-explicit-any
  ({ attempt: null, last_success: null, ...over }) as any;

const held = (status: ContactEnrichmentView["email_status"], email: string | null) => ({
  email_status: status, business_email: email, email_source: null,
  person_full_name: "Ada Kestrel", person_linkedin_url: "https://x/in/ada",
  linkedin_available: true, reason: "r",
});

Deno.test("4. a found address is UNLOCKED and rendered", () => {
  assertEquals(unlockStateFor({
    stage: stage({ attempt: { status: "succeeded" }, last_success: held("email_found", "a@b.com") }),
  }), "unlocked");
  assert(src.includes("contact.business_email"),
    "the cell must render the address it holds, not merely a status");
  // Selectable: the first thing anyone does with an address is copy it, and
  // `truncate` on a single unbreakable token still yields a copyable string.
  assert(src.includes("select-all"));
});

Deno.test("5. a PAID MISS is held — never a button to buy it again", () => {
  // ── THE DEFECT THIS COLUMN COULD EASILY HAVE SHIPPED WITH ────────────────
  //
  // `unlockStateFor` says `unlocked` whenever a payload exists, and a paid
  // `not_found` IS a payload: the lookup ran, billed, and settled the question.
  // A cell that only rendered on `business_email` would fall through to the
  // priced button and invite the user to buy the same nothing again.
  const s = unlockStateFor({
    stage: stage({ attempt: { status: "succeeded" }, last_success: held("not_found", null) }),
  });
  assertEquals(s, "unlocked", "a paid answer is held, even when the answer is none");

  assert(src.includes("No email found"),
    "the cell must have a branch for a held miss");
  // The branch is reached by state, then by payload — so `unlocked` with no
  // address renders the miss rather than falling through to the offer.
  const unlockedIdx = src.indexOf("contactState === 'unlocked' ? (");
  const offerIdx = src.indexOf("onUnlock('find_contact_details'");
  assert(unlockedIdx > 0 && unlockedIdx < offerIdx,
    "the held-miss branch must precede the priced button");
});

Deno.test("6. a provider ERROR offers a retry; a missing provider does not", () => {
  // An error means nothing was established — "Try again" is right.
  assertEquals(unlockStateFor({
    stage: stage({ attempt: { status: "failed" } }),
  }), "failed");

  // A reserve refusal is NOT a failure: nothing ran and nothing was charged.
  assertEquals(unlockStateFor({
    stage: stage({ attempt: { status: "failed", reason_code: "credit_authorization_refused" } }),
  }), "insufficient_credits");

  // THE COLUMN SHARES THE PEOPLE PROVIDER. The enrichment Actor is an Apify
  // people provider, the same configuration the decision-maker column needs; a
  // separate flag would let this column claim to be runnable when the account
  // it belongs to is not.
  assert(src.includes("providerReady: providers.people }"),
    "contact readiness must follow the people provider");
  assertEquals(unlockStateFor({ stage: stage(), providerReady: false }), "unavailable");
});

// ═══════════════ 7. THE TABLE STILL LINES UP ═══════════════════════════════

Deno.test("7. the header, the width and the hairline all know about column nine", () => {
  assert(src.includes("contact: 'w-[230px]"), "the column needs a width");
  assert(src.includes("<TH w={COL.contact}>Contact details</TH>"), "and a header");
  // The hairline is drawn ONCE under the whole header, so its span is the
  // column count. A stale number leaves the last column underlined by nothing.
  assert(src.includes("colSpan={9}"),
    "the header rule must span all nine columns");
  assertFalse(src.includes("colSpan={8}"));

  // Header order must match cell order, or every column below shifts by one.
  const headers = ["Decision maker", "Contact details", "Company research", "Outreach"];
  let at = 0;
  for (const h of headers) {
    const i = src.indexOf(`>${h}<`, at);
    assert(i > at, `header "${h}" is missing or out of order`);
    at = i;
  }
  const cells = ["COL.decisionMaker}", "COL.contact}", "COL.research}", "COL.outreach}"];
  let ct = src.indexOf("<tbody");
  for (const c of cells) {
    const i = src.indexOf(c, ct);
    assert(i > ct, `cell "${c}" is missing or out of order relative to the headers`);
    ct = i;
  }
});

Deno.test("8. only rows with a resolved person are quoted for", () => {
  // Contact enrichment takes a person, so a row where nobody is resolved cannot
  // be charged: the action declines before reaching a provider. Counting it
  // would quote a price for work that cannot happen.
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [
    { contact_status: "profile_only" },
    { contact_status: "profile_only" },
    { contact_status: "needs_contact" },
    { contact_status: "public_email_found" },
  ];
  assertEquals(estimateCredits("find_contact_details", rows), 2);
  assertEquals(estimateCredits("find_contact_details", []), 0);
});

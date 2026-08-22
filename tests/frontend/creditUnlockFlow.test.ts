// THE PRICE ON THE BUTTON MUST BE THE PRICE THE LEDGER TAKES.
//
//   click → price → authorize → enough? ─no→ stop, charge nothing
//                                  └yes→ reserve → provider → ok? ─yes→ finalize
//                                                              └no → settle 0
//                                                                     → cell
//
// ── WHAT WAS ALREADY THERE, AND WHAT WAS NOT ────────────────────────────────
//
// `creditAuthorization` has reserved-then-settled correctly since the hardening
// phase: idempotency before money, a conditional UPDATE for concurrency,
// finalize row-locked and replay-safe, and settle-0 for a call that never
// started. It was wired at the physical call in `runTool`.
//
// Two gaps. The gate read `tool.name === "source_with_apify"` alone, so
// `find_decision_makers` reserved credits and `research_company` — Firecrawl
// via `scrape_url` — did not, for no reason anyone decided. And the price was a
// flat 1 with NO number anywhere in the UI, because an earlier unlock cell had
// advertised a `~Nc` badge for a charge that never happened.
//
// The moment a number appears on a button it has to be THE number the reserve
// uses. That is what these tests hold.
//
// ZERO network, ZERO React.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { UNLOCK_PRICES, priceFor, bulkPrice } from "../../src/lib/credits/pricing.ts";
import { isCreditRefusal, CREDIT_REFUSED_ERROR } from "../../src/lib/leadActionOutcome.ts";
import { unlockStateFor } from "../../src/lib/workbench/unlockState.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// deno-lint-ignore no-explicit-any
const stage = (o: Record<string, unknown>): any => ({ attempt: null, last_success: null, ...o });

// ═══ 1. ONE TABLE, BOTH SIDES ══════════════════════════════════════════════

Deno.test("1. THE MIRROR CANNOT DRIFT FROM THE AUTHORITY", () => {
  // The edge module is what `authorizeProviderCall` is given, so it is what
  // charges. The src copy exists only to render a number before the request.
  // If they diverge a user is misquoted, and this fails before that happens.
  const edge = read("../../supabase/functions/_shared/creditPricing.ts");
  const mirror = read("../../src/lib/credits/pricing.ts");
  const table = (s: string) =>
    s.slice(s.indexOf("export const UNLOCK_PRICES"), s.indexOf("export function priceFor"));
  assertEquals(code(table(mirror)), code(table(edge)),
    "the price tables must be byte-identical once comments are stripped");
});

Deno.test("2. an unpriced capability is FREE, explicitly", () => {
  // Never a default of 1. A silent default is how an unpriced action starts
  // costing money nobody decided on.
  assertEquals(priceFor("something_nobody_priced"), 0);
  assertEquals(priceFor(""), 0);
});

Deno.test("3. the prices are the shape of the work", () => {
  assertEquals(UNLOCK_PRICES.find_decision_makers, 2, "one Apify actor run");
  assertEquals(UNLOCK_PRICES.research_company, 1, "one Firecrawl crawl");
  assertEquals(UNLOCK_PRICES.generate_outreach, 0,
    "no paid provider — model spend is billed in DOLLARS in the execution " +
    "ledger, and charging credits too would bill one cost twice in two units");
});

Deno.test("4. bulk price counts only rows that need the work", () => {
  assertEquals(bulkPrice("find_decision_makers", 3), 6);
  assertEquals(bulkPrice("find_decision_makers", 0), 0, "nothing to buy is free");
  assertEquals(bulkPrice("find_decision_makers", -5), 0, "and never negative");
  assertEquals(bulkPrice("generate_outreach", 100), 0, "free stays free in bulk");
});

// ═══ 2. THE QUOTE REACHES THE RESERVE ══════════════════════════════════════

Deno.test("5. the reserve is given the quoted price, not a flat default", () => {
  const reg = code(read("../../supabase/functions/_shared/toolRegistry.ts"));
  assert(reg.includes("priceFor(auditInput.unlock_capability)"),
    "the amount reserved comes from the same table the button read");
  assert(/amount: quoted/.test(reg), "…and is passed to authorizeProviderCall");
});

Deno.test("6. both paid unlock paths name their capability", () => {
  // Without the tag the reserve falls back to the flat default and the quote
  // silently stops matching the charge.
  const exec = code(read("../../supabase/functions/_shared/leadActionExecutor.ts"));
  assert(/unlock_capability:\s*"research_company"/.test(exec));
  const people = code(read("../../supabase/functions/_shared/decisionMaker/providerAdapter.ts"));
  assert(/unlock_capability:\s*"find_decision_makers"/.test(people));
});

Deno.test("7. FIRECRAWL IS NOW BEHIND THE MONEY BOUNDARY", () => {
  // The gate covered `source_with_apify` only, so research reached a paid
  // provider with no reserve at all.
  const reg = code(read("../../supabase/functions/_shared/toolRegistry.ts"));
  const gate = reg.slice(reg.indexOf("PAID_TOOLS"), reg.indexOf("const auditInput"));
  assert(gate.includes('"source_with_apify"'));
  assert(gate.includes('"scrape_url"'),
    "Firecrawl is a paid provider call against a workspace like any other");
});

Deno.test("8. and the cell quotes from the same table", () => {
  const sheet = code(read(
    "../../src/components/chat/workspace/workbench/leadTable/LeadSpreadsheet.tsx"));
  const quotes = [...sheet.matchAll(/cost=\{priceFor\('([a-z_]+)'\)\}/g)].map((m) => m[1]);
  assertEquals(quotes.sort(), ["find_decision_makers", "generate_outreach", "research_company"]);
  assert(!/cost=\{\d/.test(sheet), "no literal amount may be typed into a cell");
});

// ═══ 3. A REFUSAL SPENDS NOTHING, AND SAYS SO ══════════════════════════════

Deno.test("9. a refused reserve leaves the cell LOCKED, not failed", () => {
  // `failed` means a provider was paid for and did not deliver. A refusal never
  // reached one, and "Try again" would be wrong about what happened and useless
  // about what to do — the balance has to change first.
  const s = unlockStateFor({
    stage: stage({ attempt: { status: "blocked", reason_code: CREDIT_REFUSED_ERROR } }),
  });
  assertEquals(s, "insufficient_credits");
  assert(s !== "failed");
});

Deno.test("10. but held data still wins over a later refusal", () => {
  const s = unlockStateFor({
    stage: stage({
      last_success: { full_name: "Dana" },
      attempt: { status: "blocked", reason_code: CREDIT_REFUSED_ERROR },
    }),
  });
  assertEquals(s, "unlocked", "a refused re-unlock does not hide what we hold");
});

Deno.test("11. the refusal tells the user it cost them nothing", () => {
  assert(isCreditRefusal(CREDIT_REFUSED_ERROR));
  assert(!isCreditRefusal("lead_action_failed"));

  const copy = read("../../src/lib/leadActionOutcome.ts");
  const line = copy.slice(copy.indexOf("credit_authorization_refused:"));
  assert(/nothing was run and nothing was charged/i.test(line.slice(0, 200)),
    "a user seeing a failed action needs to know whether it cost them anything");
});

Deno.test("12. the UI code and the edge code use the SAME refusal string", () => {
  const edge = read("../../supabase/functions/_shared/creditAuthorization.ts");
  assert(edge.includes('CREDIT_REFUSED_ERROR = "credit_authorization_refused"'));
  assertEquals(CREDIT_REFUSED_ERROR, "credit_authorization_refused",
    "a mismatch here renders the refusal as a generic failure");
});

// ═══ 4. THE SETTLE PATH ════════════════════════════════════════════════════

Deno.test("13. a call that never started is settled at ZERO", () => {
  // Reserve-then-settle only protects a balance if the settle honours what
  // actually happened. A run refused or dead before dispatch must not quietly
  // consume the reservation it never used.
  const auth = code(read("../../supabase/functions/_shared/creditAuthorization.ts"));
  assert(/const charged = i\.started \? \(i\.amount \?\? CREDITS_PER_PROVIDER_CALL\) : 0/.test(auth),
    "settle charges the amount only when the provider was actually reached");
});

Deno.test("14. authorization happens BEFORE the provider runs", () => {
  const reg = code(read("../../supabase/functions/_shared/toolRegistry.ts"));
  const authAt = reg.indexOf("authorizeProviderCall({");
  // THE INVOCATION, not the definition. `executeOnce` is declared as a const
  // above the gate, so `indexOf("executeOnce(")` finds where it is WRITTEN and
  // reports the ordering backwards. What matters is where it is CALLED.
  const execAt = reg.indexOf("withExecutionAudit(writer, auditSpec, executeOnce)");
  assert(authAt !== -1 && execAt !== -1);
  assert(authAt < execAt,
    "no provider work may happen before the reserve — the money boundary and " +
    "the call boundary are the same line, deliberately");
});

Deno.test("15. a refusal returns without executing", () => {
  const reg = code(read("../../supabase/functions/_shared/toolRegistry.ts"));
  const at = reg.indexOf("if (!auth.allowed)");
  const block = reg.slice(at, reg.indexOf("withExecutionAudit(writer", at));
  assert(block.includes("CREDIT_REFUSED_ERROR"),
    "the refusal is reported with its own code, not as a provider fault");
  assert(/\breturn\b/.test(block),
    "and it RETURNS — the execution below must be unreachable on a refusal");
  assert(block.includes("credit_refusal"),
    "carrying the balance, so the UI can say what is actually short");
});

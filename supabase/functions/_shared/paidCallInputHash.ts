// THE INPUT HASH A PAID CALL'S `logical_call_key` IS BUILT FROM.
//
// `logical_call_key` (`executionLedger.logicalCallKey`) is the idempotency key
// for BOTH the execution ledger row and the credit reservation
// (`credits_reserve`): a second call under the same key is a REPLAY — no new
// credit, `attempt_number` bumped. That is right for a retry of the same call,
// or for a call inside a unit the user was already charged for, and wrong for a
// different one.
//
// Canary 4 (task 382de52c, 2026-10-03). Firecrawl `/map` calls were sent without
// `compiled_input_hash`, so every map in the lineage keyed to
// `<lineage>:web_evidence_verification:no-hash`. crewai.com was charged; the
// maps of simera.me, talentify.us.com and every later domain were REPLAYED —
// 44 paid calls, 34 credits charged — and their ledger rows climbed
// attempt_number 1…8 although each was a first call. Every other `scrape_url`
// caller that sent no hash shared one key per task (or, with no task, per
// WORKSPACE) the same way: the V1 page scrape, Company Brain setup, and the
// Workbench research unlock.
//
// The rule:
//   1. the caller's `compiled_input_hash` — always wins. A caller whose billing
//      unit is not one call names its unit here (`researchUnlockHash`);
// and for `scrape_url` (Firecrawl) only:
//   2. the spec's `idempotency_key` — a spec-governed call is already uniquely
//      keyed by its spec, and page fetches pass exactly this as their hash;
//   3. a hash of the fields Firecrawl actually receives — one credit per
//      distinct call, and a retry of the same call still replays.
// Every other tool keeps `null` (→ "no-hash") exactly as before: Apify keys are
// not touched here.

import { hashInput } from "./hiringActorInputs.ts";

/** The fields `execScrapeUrl` reads — a call's identity at the provider. */
const SCRAPE_IDENTITY_FIELDS = ["url", "mode", "max_pages", "extraction_goal"] as const;

export function paidCallInputHash(toolName: string, input: Record<string, unknown>): string | null {
  const compiled = input.compiled_input_hash;
  if (typeof compiled === "string" && compiled) return compiled;
  if (toolName !== "scrape_url") return null;
  const spec = input.provider_call_spec as { idempotency_key?: unknown } | null | undefined;
  if (spec && typeof spec.idempotency_key === "string" && spec.idempotency_key) return spec.idempotency_key;
  if (typeof input.url === "string" && input.url) {
    const identity: Record<string, unknown> = {};
    for (const k of SCRAPE_IDENTITY_FIELDS) if (input[k] !== undefined) identity[k] = input[k];
    return hashInput(identity, "scrape_url");
  }
  return null;
}

/**
 * THE RESEARCH UNLOCK'S BILLING UNIT: one company (lead row) per action.
 *
 * `research_company` is priced at one credit for "one Firecrawl crawl plus
 * extraction" (`creditPricing.ts`), but the crawl reads up to six pages. Keyed
 * per page, one click would be charged up to six times the price the button
 * showed; keyed per task (the old `no-hash`), one click on N companies was
 * charged once. Every page of one company's research shares this key, so the
 * first reserves the quoted credit and the rest replay it. The task id scopes
 * the key, so researching the same company again in a later action is charged
 * again, as the button says.
 */
export function researchUnlockHash(leadId: string): string {
  return hashInput({ unit: "research_company", lead: leadId }, "research_company");
}

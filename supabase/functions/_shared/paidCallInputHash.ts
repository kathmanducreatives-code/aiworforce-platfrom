// THE INPUT HASH A PAID CALL'S `logical_call_key` IS BUILT FROM.
//
// `logical_call_key` (`executionLedger.logicalCallKey`) is the idempotency key
// for BOTH the execution ledger row and the credit reservation
// (`credits_reserve`): a second call under the same key is a REPLAY — no new
// credit, `attempt_number` bumped. That is right for a retry of the same call,
// and wrong for a different one.
//
// Canary 4 (task 382de52c, 2026-10-03). Firecrawl `/map` calls were sent without
// `compiled_input_hash`, so every map in the lineage keyed to
// `<lineage>:web_evidence_verification:no-hash`. crewai.com was charged; the
// maps of simera.me, talentify.us.com and every later domain were REPLAYED —
// 44 paid calls, 34 credits charged — and their ledger rows climbed
// attempt_number 1…8 although each was a first call.
//
// The rule:
//   1. the caller's `compiled_input_hash` — unchanged for every call that has one;
//   2. for a SPEC-GOVERNED Firecrawl call (`scrape_url` carrying a
//      `provider_call_spec`), the spec's `idempotency_key` — the spec already
//      identifies the call uniquely, and page fetches pass exactly this as
//      their hash, so a caller that forgets it keys identically.
// Everything else keeps `null` (→ "no-hash"), exactly as before. Unspecced
// `scrape_url` callers (Company Brain setup, Workbench research unlocks, the V1
// scrape) and every Apify call are untouched here: keying those per URL would
// change what workspaces are charged, which is a pricing decision, not this fix.

export function paidCallInputHash(toolName: string, input: Record<string, unknown>): string | null {
  const compiled = input.compiled_input_hash;
  if (typeof compiled === "string" && compiled) return compiled;
  if (toolName !== "scrape_url") return null;
  const spec = input.provider_call_spec as { idempotency_key?: unknown } | null | undefined;
  if (spec && typeof spec.idempotency_key === "string" && spec.idempotency_key) return spec.idempotency_key;
  return null;
}

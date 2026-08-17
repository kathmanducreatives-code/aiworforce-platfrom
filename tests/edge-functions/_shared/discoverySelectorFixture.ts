// A DISCOVERY SELECTOR FOR TESTS THAT DO NOT TEST DISCOVERY SELECTION.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Actor selection used to have a deterministic floor: with no `planDiscovery`
// wired, the engine ran `deterministicDiscoveryStrategy`, which pinned
// `startup_company_discovery` to the YC scraper and handed it a literal input.
// That floor is deleted — it answered every mission with the same question, and
// on 2026-08-17 it answered "AI startups" with "YC companies tagged B2B".
//
// Twenty-seven test files were relying on that floor without saying so. They
// test the stages AFTER discovery — grounded brain, workbench, frontier,
// identity resolution, enrichment — and needed a pool to exist, so they let the
// production default make one. When selection became mandatory they all blocked,
// correctly, and 190 assertions failed for the right reason.
//
// The fix is NOT to give production a default again. It is to make each test
// say which pool it wants. This fixture is that statement, in one line.
//
// ── WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────────────
//
// It is not a re-implementation of the old fallback living in the test tree.
// It returns a PROPOSAL, exactly as a model would, and every proposal still
// goes through `validateDiscoveryStrategy` against the real catalog. A test
// using this cannot select an unregistered actor, send an unsupported filter,
// or exceed a published limit — the same rules a live run obeys. What it
// removes is only the model call, not the validation.
import type { ProposedSelection } from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";

/** The default pool: the verified startup-company source, asked plainly. */
export const DEFAULT_STUB_SELECTION: ProposedSelection[] = [{
  actor_key: "apify_yc_companies_memo23",
  role: "primary",
  input: { mode: "companies", isHiring: true },
  rationale: "test fixture: a pool for a stage that is not discovery",
}];

/**
 * A `planDiscovery` stub.
 *
 * Pass explicit selections when the test cares which actors run; omit them when
 * it only needs a pool to exist.
 *
 * ```ts
 * runCapabilityPlan({ ...deps, planDiscovery: stubDiscoverySelector() }, opts)
 * ```
 */
export function stubDiscoverySelector(
  selections: ProposedSelection[] = DEFAULT_STUB_SELECTION,
) {
  return () => Promise.resolve(selections);
}

/**
 * A selector that produces nothing usable — for tests asserting the BLOCK.
 *
 * Distinct from a throwing selector: this is the "model answered, and the answer
 * was empty" case, which used to be indistinguishable from a deliberate YC
 * choice.
 */
export function emptyDiscoverySelector() {
  return () => Promise.resolve([] as ProposedSelection[]);
}

/** A selector that fails outright — the model-outage case. */
export function failingDiscoverySelector(message = "model unavailable") {
  return () => Promise.reject(new Error(message));
}

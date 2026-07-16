// Broad-research (Perplexity `research_web`) fallback policy — pure + testable.
//
// Broad research is OPTIONAL and must never become a lead source. It exists only
// as a last-resort context fetch when NO provider-backed sourcing happened. The
// v83 Q1 regression: after the canonical people actor returned 5 real founders
// and company enrichment ran, all candidates were staged (0 persisted) so the
// legacy `apifyContext` was null, and `research_web` (Perplexity) was still
// attempted. That is wrong: once a provider-sourcing step ran / provider
// candidates were sourced / we are in source_and_qualify_only mode, no broad
// research fallback should be attempted.

export interface BroadResearchDecisionInput {
  executionMode?: string | null;
  /** The planner-selected tool for this step (e.g. "source_with_apify"). */
  plannedToolName?: string | null;
  competitorDiscovery?: boolean;
  discoveryMode?: unknown;
  /** This step is a provider-sourcing step (Apify people/jobs/etc.). */
  isProviderSourcingStep?: boolean;
  /** Provider-backed candidates were sourced this step (accepted OR staged). */
  providerCandidatesSourced?: boolean;
  /** Legacy signals: provider/scraped context already produced. */
  hasProviderContext?: boolean;
  hasScrapedContext?: boolean;
}

/**
 * True when the optional broad-research (`research_web`/Perplexity) fallback must
 * be SKIPPED. Applies uniformly and safely to people AND jobs provider-sourcing
 * workflows: a provider-sourcing step never falls back to generic broad research.
 */
export function shouldSkipBroadResearch(i: BroadResearchDecisionInput): boolean {
  return i.executionMode === "fast"
    || i.executionMode === "source_and_qualify_only"
    || i.plannedToolName === "source_with_apify"
    || i.competitorDiscovery === true
    || !!i.discoveryMode
    || i.isProviderSourcingStep === true
    || i.providerCandidatesSourced === true
    || i.hasProviderContext === true
    || i.hasScrapedContext === true;
}

// ADAPTIVE-SOURCING CAPABILITY CARDS.
//
// A thin DERIVED projection over the existing `hiringSourceCatalog`. It adds the
// four planning traits the adaptive strategist needs and the catalog does not yet
// project — startup relevance, how recency is actually enforced, company-metadata
// quality and cost class — without restating any provider fact.
//
// Every field is computed from catalog entries that were verified against real
// Actor input schemas (PR #123). Nothing here is a second source of truth: change
// the catalog and these cards change with it. `providerAdapterKey` and
// `verifiedBuild` are never read, so no raw Actor ID can reach a planner even by
// accident.
//
// ATS is deliberately excluded — see `ADAPTIVE_DISCOVERY_CAPABILITIES`.

import {
  HIRING_SOURCE_CATALOG, plannerHiringSourceMenu,
  type HiringSourceCapabilityId, type PlannerVisibleHiringSource,
} from "../../hiringSourceCatalog.ts";

export const CAPABILITY_CARD_VERSION = "lead-capability-cards-1.0.0";

/**
 * The discovery capabilities this strategist may plan with.
 *
 * `ats_job_verification` is absent by design. It is a verification capability that
 * `requiresKnownCompany`, and its compiler branch is currently unreachable —
 * `OrderedSourceStep.semanticIntent` carries no company identity, so the branch
 * always returns `deferred:ats_verification_requires_resolved_company_slug`.
 * Offering it to a planner would produce steps that cannot execute.
 */
export const ADAPTIVE_DISCOVERY_CAPABILITIES: readonly HiringSourceCapabilityId[] = [
  "yc_job_discovery", "linkedin_job_discovery", "indeed_job_discovery", "glassdoor_job_discovery",
];

/** How a maximum posting age is actually applied for this source. */
export type RecencyEnforcement =
  /** The Actor accepts a posting-window input; the bound is applied provider-side. */
  | "provider_filter"
  /** The Actor exposes no posting-window input; the bound is applied after normalization. */
  | "post_normalization";

export type Grade = "low" | "medium" | "high";

export interface AdaptiveCapabilityCard extends PlannerVisibleHiringSource {
  /** How strongly this source concentrates on early-stage companies. */
  startup_relevance: Grade;
  recency_enforcement: RecencyEnforcement;
  /** Whether retrieved rows carry company identity strong enough to qualify on. */
  company_metadata_quality: Grade;
  cost_class: Grade;
  /** Whether the source can constrain company size/stage provider-side at all. */
  company_filter_support: {
    company_stage: boolean;
    company_size: boolean;
    /** True when ICP fit can only be decided after retrieval + enrichment. */
    requires_post_retrieval_qualification: boolean;
  };
}

function startupRelevance(id: HiringSourceCapabilityId): Grade {
  const c = HIRING_SOURCE_CATALOG[id];
  const stages = (c.bestFor.companyStages ?? []).map((s) => s.toLowerCase());
  // An explicit early-stage focus is the only thing that earns "high".
  if (stages.some((s) => s.includes("seed") || s.includes("series a") || s.includes("pre-"))) return "high";
  const sizes = (c.bestFor.companySizes ?? []).map((s) => s.toLowerCase());
  if (sizes.some((s) => s.includes("smb") || s.includes("startup"))) return "medium";
  return "low";
}

function companyMetadataQuality(id: HiringSourceCapabilityId): Grade {
  const e = HIRING_SOURCE_CATALOG[id].expectedEvidence;
  const score = [e.companyName, e.companyDomain, e.linkedinCompanyUrl].filter(Boolean).length;
  return score >= 3 ? "high" : score === 2 ? "medium" : "low";
}

/** Build the planner-visible cards. Only runtime-enabled providers appear. */
export function adaptiveCapabilityCards(): AdaptiveCapabilityCard[] {
  return plannerHiringSourceMenu()
    .filter((m) => (ADAPTIVE_DISCOVERY_CAPABILITIES as readonly string[]).includes(m.capability))
    .map((m) => {
      const c = HIRING_SOURCE_CATALOG[m.capability];
      return {
        ...m,
        startup_relevance: startupRelevance(m.capability),
        recency_enforcement: c.supportedSemanticFilters.postingWindow ? "provider_filter" : "post_normalization",
        company_metadata_quality: companyMetadataQuality(m.capability),
        cost_class: c.operatingPolicy.costClass,
        company_filter_support: {
          company_stage: c.supportedSemanticFilters.companyStage,
          company_size: c.supportedSemanticFilters.companySize,
          // If neither stage nor size can be expressed provider-side, ICP fit is
          // necessarily a post-retrieval judgment — the planner must be told, so it
          // can weigh rejection rate rather than expect the source to pre-filter.
          requires_post_retrieval_qualification:
            !c.supportedSemanticFilters.companyStage && !c.supportedSemanticFilters.companySize,
        },
      };
    });
}

/** Capability keys the strategy validator will accept. */
export function approvedCapabilityKeys(): string[] {
  return adaptiveCapabilityCards().map((c) => c.capability);
}

/**
 * Assert no card leaks a provider identifier.
 *
 * Called by tests rather than trusted by convention: the card type is structural,
 * so a future catalog field added to `PlannerVisibleHiringSource` would otherwise
 * flow through silently.
 */
export function cardsCarryNoProviderIdentifiers(cards: readonly AdaptiveCapabilityCard[]): boolean {
  const banned = ["provideradapterkey", "verifiedbuild", "actor_id", "actorid", "apify"];
  const blob = JSON.stringify(cards).toLowerCase();
  return !banned.some((b) => blob.includes(b));
}

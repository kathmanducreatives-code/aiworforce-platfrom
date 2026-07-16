// Actor Capability Registry (Phase 1B) — pure / deterministic.
//
// ONE place describing what each provider capability can PROVE, how fresh it is,
// and what it costs — so the enrichment planner can pick the cheapest reliable
// source instead of capabilities being scattered across run-agent.
//
// Bindings are taken from the repository's existing canonical actor keys and
// implementation IDs (_shared/actorRegistry.ts, leadEntityIntent.ACTOR_IMPL).
// NOTHING here is invented: a capability with no verified implementation in the
// repo is registered with verifiedBinding=false and MUST NOT be called.

import type { EvidenceCategory } from "./evidenceContract.ts";

export type FreshnessClass = "identity" | "firmographic" | "recent_signal" | "web_current";
export type CostClass = "low" | "medium" | "high";

export interface ActorCapability {
  actorKey: string;
  /** Canonical implementation id from the repo registry. Absent ⇒ unverified. */
  implementationId?: string;

  inputEntities: Array<"person" | "company" | "job" | "domain">;
  outputArtifactTypes: string[];

  evidenceProduced: EvidenceCategory[];
  signalsProduced: EvidenceCategory[];

  supportsStructuredFilters: boolean;
  freshnessClass: FreshnessClass;
  costClass: CostClass;

  defaultMaxItems: number;
  defaultMaxAttempts: number;

  /** TRUE only when the repo has a real, resolvable implementation for this key.
   * The planner may never route to a capability with verifiedBinding=false. */
  verifiedBinding: boolean;
  /** When unverified, exactly what binding is missing (for the report). */
  missingBindingNote?: string;
}

/** Registered capabilities. Keys/IDs mirror _shared/actorRegistry.ts. */
export const ACTOR_CAPABILITIES: Record<string, ActorCapability> = {
  // ---- verified: primary identity sources -------------------------------------
  apify_people_search: {
    actorKey: "apify_people_search",
    implementationId: "harvestapi/linkedin-profile-search",
    inputEntities: ["person"],
    outputArtifactTypes: ["person_candidate"],
    evidenceProduced: ["person_identity", "person_company_association", "company_geography"],
    signalsProduced: [],
    supportsStructuredFilters: true,
    freshnessClass: "identity",
    costClass: "medium",
    defaultMaxItems: 25,
    defaultMaxAttempts: 3,
    verifiedBinding: true,
  },
  apify_jobs: {
    actorKey: "apify_jobs",
    implementationId: "curious_coder/linkedin-jobs-scraper",
    inputEntities: ["job", "company"],
    outputArtifactTypes: ["job_signal", "company_candidate"],
    evidenceProduced: ["company_identity", "company_geography"],
    signalsProduced: ["job_signal"],
    supportsStructuredFilters: true,
    freshnessClass: "recent_signal",
    costClass: "medium",
    defaultMaxItems: 25,
    defaultMaxAttempts: 3,
    verifiedBinding: true,
  },
  apify_linkedin_company_employees: {
    actorKey: "apify_linkedin_company_employees",
    implementationId: "harvestapi/linkedin-company-employees",
    inputEntities: ["company"],
    outputArtifactTypes: ["person_candidate"],
    evidenceProduced: ["person_identity", "person_company_association"],
    signalsProduced: [],
    supportsStructuredFilters: true,
    freshnessClass: "identity",
    costClass: "medium",
    defaultMaxItems: 25,
    defaultMaxAttempts: 2,
    verifiedBinding: true,
  },

  // ---- verified: signal sources (env-gated at call time) ----------------------
  apify_linkedin_company_posts: {
    actorKey: "apify_linkedin_company_posts",
    implementationId: "harvestapi/linkedin-company-posts",
    inputEntities: ["company"],
    outputArtifactTypes: ["company_candidate"],
    evidenceProduced: [],
    signalsProduced: ["launch_signal", "expansion_signal", "gtm_signal", "founder_activity_signal"],
    supportsStructuredFilters: true,
    freshnessClass: "recent_signal",
    costClass: "medium",
    defaultMaxItems: 10,
    defaultMaxAttempts: 1,
    verifiedBinding: true,
  },
  apify_linkedin_profile_posts: {
    actorKey: "apify_linkedin_profile_posts",
    implementationId: "harvestapi/linkedin-profile-posts",
    inputEntities: ["person"],
    outputArtifactTypes: ["person_candidate"],
    evidenceProduced: [],
    signalsProduced: ["founder_activity_signal", "gtm_signal"],
    supportsStructuredFilters: true,
    freshnessClass: "recent_signal",
    costClass: "medium",
    defaultMaxItems: 10,
    defaultMaxAttempts: 1,
    verifiedBinding: true,
  },

  // ---- verified: web evidence -------------------------------------------------
  firecrawl_scrape_url: {
    actorKey: "firecrawl_scrape_url",
    // Firecrawl is a first-party tool, not an Apify actor ⇒ no implementationId.
    inputEntities: ["domain", "company"],
    outputArtifactTypes: ["company_candidate"],
    evidenceProduced: ["company_website", "company_business_model", "company_industry"],
    signalsProduced: ["launch_signal", "job_signal"],
    supportsStructuredFilters: false,
    freshnessClass: "web_current",
    costClass: "high",
    defaultMaxItems: 3,       // pages per company
    defaultMaxAttempts: 1,
    verifiedBinding: true,
  },

  // ---- VERIFIED (Phase 2): structured company firmographics --------------------
  // Bound to the real Apify actor `harvestapi/linkedin-company` (LinkedIn Company
  // Details Scraper), registered canonically in _shared/actorRegistry.ts as
  // apify_linkedin_company_details. Enriches an ALREADY-KNOWN company; it is not a
  // discovery/search actor. Verified input: { companies: string[] (LinkedIn company
  // URLs), searches: string[] (company names) }.
  apify_linkedin_company_details: {
    actorKey: "apify_linkedin_company_details",
    implementationId: "harvestapi/linkedin-company",
    inputEntities: ["company", "domain"],
    outputArtifactTypes: ["company_candidate"],
    evidenceProduced: ["company_identity", "company_website", "company_industry", "company_size", "company_geography", "company_business_model"],
    signalsProduced: [],
    supportsStructuredFilters: true,
    freshnessClass: "firmographic",
    costClass: "low",
    defaultMaxItems: 8,
    defaultMaxAttempts: 1,
    verifiedBinding: true,
  },
};

/**
 * The capability that fulfils the STRUCTURED COMPANY ENRICHMENT role. One identity,
 * referenced everywhere (planner, adapter, run-agent) so the actor can never drift.
 */
export const STRUCTURED_COMPANY_ENRICHMENT_ACTOR_KEY = "apify_linkedin_company_details";

/** Resolve the capability fulfilling the structured-company-enrichment role. */
export function getStructuredCompanyEnrichmentCapability(): ActorCapability | null {
  return ACTOR_CAPABILITIES[STRUCTURED_COMPANY_ENRICHMENT_ACTOR_KEY] ?? null;
}

export function getActorCapability(actorKey: string | null | undefined): ActorCapability | null {
  if (!actorKey) return null;
  return ACTOR_CAPABILITIES[actorKey] ?? null;
}

/** A capability may only be invoked when the repo has a verified binding. */
export function isCallable(cap: ActorCapability | null | undefined): boolean {
  return !!cap && cap.verifiedBinding === true;
}

/**
 * Cheapest VERIFIED capability that produces every required evidence category.
 * Returns null when no verified capability covers them (⇒ planner must stage).
 */
export function findCapabilityFor(
  required: EvidenceCategory[],
  opts?: { inputEntity?: "person" | "company" | "job" | "domain"; maxCost?: CostClass },
): ActorCapability | null {
  const order: CostClass[] = ["low", "medium", "high"];
  const maxIdx = order.indexOf(opts?.maxCost ?? "high");
  const candidates = Object.values(ACTOR_CAPABILITIES)
    .filter((c) => c.verifiedBinding)
    .filter((c) => (opts?.inputEntity ? c.inputEntities.includes(opts.inputEntity) : true))
    .filter((c) => order.indexOf(c.costClass) <= maxIdx)
    .filter((c) => {
      const produced = new Set([...c.evidenceProduced, ...c.signalsProduced]);
      return required.every((r) => produced.has(r));
    })
    .sort((a, b) => order.indexOf(a.costClass) - order.indexOf(b.costClass));
  return candidates[0] ?? null;
}

/** Capabilities registered but not callable — surfaced in the planning report. */
export function unverifiedCapabilities(): ActorCapability[] {
  return Object.values(ACTOR_CAPABILITIES).filter((c) => !c.verifiedBinding);
}

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

  // ---- UNVERIFIED: structured company firmographics ---------------------------
  // The repo has NO company details/search actor: the only company-input actors are
  // linkedin-company-employees (people) and linkedin-company-posts (signals).
  // Neither yields website/industry/employee-count/HQ. Registered so the planner can
  // reason about the gap and stage honestly — never called.
  structured_company_enrichment: {
    actorKey: "structured_company_enrichment",
    inputEntities: ["company", "domain"],
    outputArtifactTypes: ["company_candidate"],
    evidenceProduced: ["company_identity", "company_website", "company_industry", "company_size", "company_geography", "company_business_model"],
    signalsProduced: [],
    supportsStructuredFilters: true,
    freshnessClass: "firmographic",
    costClass: "low",
    defaultMaxItems: 8,
    defaultMaxAttempts: 1,
    verifiedBinding: false,
    missingBindingNote:
      "No structured company-details actor exists in _shared/actorRegistry.ts. " +
      "Required: an Apify (or equivalent) company-profile actor returning website, " +
      "industry, description, employee count/range, headquarters and company LinkedIn " +
      "URL from a company name / LinkedIn URL / domain. Bind a real actor_id + " +
      "registry entry (e.g. APIFY_ACTOR_COMPANY_DETAILS) before enabling this route.",
  },
};

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

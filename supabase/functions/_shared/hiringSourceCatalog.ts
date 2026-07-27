// THE APPROVED HIRING-SOURCE CATALOG — semantics in, provider ids never out.
//
// WHY A NEW MODULE. Nothing existing owns the mapping from a SEMANTIC research
// channel ("discover companies hiring this role on Indeed") to an internal
// provider variant. `actorRegistry` owns Actor ids, `actorInputSchemas` owns
// provider field shapes, `capabilityRegistry` owns department-scoped Agentory
// capabilities. This is the thin layer between them, and it exists so a planner
// can choose a channel without ever seeing an implementation.
//
// It creates no second authority: every entry POINTS at an existing registry key
// and every id is resolved through `getActorByKey`. Remove this file and nothing
// else changes its behavior.
//
// THE INDEED COEXISTENCE. `apify_indeed_jobs` (curious_coder) already serves the
// legacy deterministic path. `indeed_job_discovery` selects the newly approved
// `apify_indeed_jobs_automation_lab` variant instead. Two PROVIDER variants, one
// SEMANTIC capability — a planner cannot see or choose between them, and the old
// path keeps the Actor it was built and normalized against.
//
// `SOURCE_TYPE_TO_ACTOR` is deliberately NOT modified: it allows one actor per
// source type and is consumed by existing production code. This capability map
// is the additive alternative.
//
// PURE. No network, provider, model or database access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import { getActorByKey, isActorRuntimeEnabled } from "./actorRegistry.ts";

export const HIRING_SOURCE_CATALOG_VERSION = "hiring-source-catalog-1.0.0";

export type HiringSourceCapabilityId =
  | "indeed_job_discovery"
  | "linkedin_job_discovery"
  | "glassdoor_job_discovery"
  | "yc_job_discovery"
  | "ats_job_verification";

export type SourcePurpose = "job_discovery" | "hiring_signal_discovery" | "job_verification";

export interface HiringSourceCapability {
  capabilityId: HiringSourceCapabilityId;
  version: string;
  /** Human-readable description. This is what a planner sees. */
  description: string;
  purposes: SourcePurpose[];

  bestFor: {
    industries?: string[];
    companyStages?: string[];
    companySizes?: string[];
    geographies?: string[];
  };
  avoidFor: string[];

  /** Semantic filters this source can actually express. */
  supportedSemanticFilters: {
    roleFamily: boolean;
    titleAliases: boolean;
    geography: boolean;
    postingWindow: boolean;
    remotePolicy: boolean;
    employmentType: boolean;
    companyIdentity: boolean;
    companyStage: boolean;
    companySize: boolean;
  };

  expectedEvidence: {
    companyName: boolean;
    companyDomain: boolean;
    linkedinCompanyUrl: boolean;
    jobTitle: boolean;
    jobLocation: boolean;
    postingDate: boolean;
    jobUrl: boolean;
  };

  sourceQuality: {
    precision: "low" | "medium" | "high";
    recall: "low" | "medium" | "high";
    authority: "discovery" | "supporting" | "verification";
  };

  operatingPolicy: {
    costClass: "low" | "medium" | "high";
    maximumResultsPerCall: number;
    maximumCallsPerRound: number;
    /** True when the source cannot run without a resolved company. */
    requiresKnownCompany: boolean;
  };

  /** INTERNAL ONLY. Never projected to a planner. */
  providerAdapterKey: string;
  /** Verified upstream build at the time this entry was written. Internal. */
  verifiedBuild: string;
}

/**
 * The five approved capabilities.
 *
 * `supportedSemanticFilters` is not aspirational — it records what each Actor's
 * VERIFIED input schema can express. YC reports companyStage/companySize false
 * because `parsebird/yc-jobs-scraper` (2.4.2) exposes no such input; stage and
 * size remain Company Brain concerns downstream, never fabricated filters.
 */
export const HIRING_SOURCE_CATALOG: Readonly<Record<HiringSourceCapabilityId, HiringSourceCapability>> = {
  indeed_job_discovery: {
    capabilityId: "indeed_job_discovery",
    version: "1.0.0",
    description: "Broad role-first hiring discovery across general job listings. Strong for SMB and mid-market companies outside startup ecosystems.",
    purposes: ["job_discovery", "hiring_signal_discovery"],
    bestFor: { companySizes: ["smb", "mid_market"], geographies: ["United States", "United Kingdom", "Canada", "Australia"] },
    avoidFor: ["people profiles", "company firmographics"],
    supportedSemanticFilters: {
      roleFamily: true, titleAliases: true, geography: true, postingWindow: true,
      remotePolicy: false, employmentType: true, companyIdentity: false,
      companyStage: false, companySize: false,
    },
    expectedEvidence: {
      companyName: true, companyDomain: false, linkedinCompanyUrl: false,
      jobTitle: true, jobLocation: true, postingDate: true, jobUrl: true,
    },
    sourceQuality: { precision: "medium", recall: "high", authority: "discovery" },
    operatingPolicy: { costClass: "low", maximumResultsPerCall: 200, maximumCallsPerRound: 3, requiresKnownCompany: false },
    providerAdapterKey: "apify_indeed_jobs_automation_lab",
    verifiedBuild: "0.1.34",
  },

  linkedin_job_discovery: {
    capabilityId: "linkedin_job_discovery",
    version: "1.0.0",
    description: "Professional-company hiring discovery with strong company identity, plus remote and hybrid work-style filters.",
    purposes: ["job_discovery", "hiring_signal_discovery"],
    bestFor: { industries: ["b2b saas", "technology"], geographies: ["United States", "Europe"] },
    avoidFor: ["people profiles", "private contact data"],
    supportedSemanticFilters: {
      roleFamily: true, titleAliases: true, geography: true, postingWindow: true,
      remotePolicy: true, employmentType: true, companyIdentity: true,
      companyStage: false, companySize: false,
    },
    expectedEvidence: {
      companyName: true, companyDomain: false, linkedinCompanyUrl: true,
      jobTitle: true, jobLocation: true, postingDate: true, jobUrl: true,
    },
    sourceQuality: { precision: "high", recall: "medium", authority: "discovery" },
    operatingPolicy: { costClass: "medium", maximumResultsPerCall: 200, maximumCallsPerRound: 3, requiresKnownCompany: false },
    providerAdapterKey: "apify_linkedin_jobs_crawlworks",
    verifiedBuild: "0.1.27",
  },

  glassdoor_job_discovery: {
    capabilityId: "glassdoor_job_discovery",
    version: "1.0.0",
    description: "Inexpensive recall expansion. Use as a fallback to surface companies the primary sources missed.",
    purposes: ["job_discovery"],
    bestFor: { geographies: ["United States"] },
    avoidFor: ["primary discovery when precision matters", "people profiles"],
    supportedSemanticFilters: {
      roleFamily: true, titleAliases: true, geography: true, postingWindow: true,
      remotePolicy: true, employmentType: false, companyIdentity: false,
      companyStage: false, companySize: true,
    },
    expectedEvidence: {
      companyName: true, companyDomain: false, linkedinCompanyUrl: false,
      jobTitle: true, jobLocation: true, postingDate: true, jobUrl: true,
    },
    sourceQuality: { precision: "low", recall: "high", authority: "supporting" },
    operatingPolicy: { costClass: "low", maximumResultsPerCall: 200, maximumCallsPerRound: 2, requiresKnownCompany: false },
    providerAdapterKey: "apify_glassdoor_jobs",
    verifiedBuild: "0.0.8",
  },

  yc_job_discovery: {
    capabilityId: "yc_job_discovery",
    version: "1.0.0",
    description: "High-precision startup hiring discovery across Y Combinator companies. Strong for early-stage, founder-led technology teams.",
    purposes: ["job_discovery", "hiring_signal_discovery"],
    bestFor: { industries: ["b2b saas", "developer tools", "technology"], companyStages: ["pre-seed", "seed", "series a"] },
    avoidFor: ["local businesses", "manufacturing", "enterprise discovery", "non-startup verticals"],
    supportedSemanticFilters: {
      roleFamily: true, titleAliases: false, geography: true, postingWindow: false,
      remotePolicy: false, employmentType: false, companyIdentity: false,
      // The Actor exposes NO stage/size input. Both remain downstream Company
      // Brain concerns; compiling them here would be fabricating a filter.
      companyStage: false, companySize: false,
    },
    expectedEvidence: {
      companyName: true, companyDomain: false, linkedinCompanyUrl: false,
      jobTitle: true, jobLocation: true, postingDate: false, jobUrl: true,
    },
    sourceQuality: { precision: "high", recall: "low", authority: "discovery" },
    operatingPolicy: { costClass: "low", maximumResultsPerCall: 200, maximumCallsPerRound: 2, requiresKnownCompany: false },
    providerAdapterKey: "apify_yc_jobs",
    verifiedBuild: "2.4.2",
  },

  ats_job_verification: {
    capabilityId: "ats_job_verification",
    version: "1.0.0",
    description: "Confirm a discovered opening is still live on the company's own applicant tracking system, and retrieve canonical requisition evidence. Requires an already-identified company.",
    purposes: ["job_verification"],
    bestFor: {},
    avoidFor: ["broad role-first discovery", "companies with no resolved identity"],
    supportedSemanticFilters: {
      roleFamily: true, titleAliases: false, geography: true, postingWindow: true,
      remotePolicy: true, employmentType: false, companyIdentity: true,
      companyStage: false, companySize: false,
    },
    expectedEvidence: {
      companyName: true, companyDomain: true, linkedinCompanyUrl: false,
      jobTitle: true, jobLocation: true, postingDate: true, jobUrl: true,
    },
    sourceQuality: { precision: "high", recall: "low", authority: "verification" },
    operatingPolicy: { costClass: "medium", maximumResultsPerCall: 200, maximumCallsPerRound: 2, requiresKnownCompany: true },
    providerAdapterKey: "apify_ats_verification",
    verifiedBuild: "0.1.24",
  },
} as const;

export const HIRING_SOURCE_CAPABILITY_IDS = Object.keys(HIRING_SOURCE_CATALOG) as HiringSourceCapabilityId[];

/** Is this a registered capability id? */
export function isHiringSourceCapability(id: string | null | undefined): id is HiringSourceCapabilityId {
  return !!id && Object.prototype.hasOwnProperty.call(HIRING_SOURCE_CATALOG, id);
}

/**
 * Resolve a semantic capability to its internal registry ENTRY.
 *
 * The ONLY crossing of the semantics/provider boundary, and it re-checks runtime
 * enablement rather than trusting the catalog — an Actor whose env flag is off is
 * not selectable no matter what a plan says.
 */
export function resolveHiringSourceActor(
  id: string | null | undefined,
): { ok: true; capability: HiringSourceCapability; actorKey: string } | { ok: false; reason: string } {
  if (!isHiringSourceCapability(id)) return { ok: false, reason: `unknown_capability:${id ?? "null"}` };
  const capability = HIRING_SOURCE_CATALOG[id];
  const entry = getActorByKey(capability.providerAdapterKey);
  if (!entry) return { ok: false, reason: `provider_missing:${capability.providerAdapterKey}` };
  if (!isActorRuntimeEnabled(entry)) return { ok: false, reason: `provider_disabled:${capability.providerAdapterKey}` };
  return { ok: true, capability, actorKey: capability.providerAdapterKey };
}

// ------------------------------------------------- the safe planner view ----

/** Exactly what a planner may see. Provider keys and builds are absent BY CONSTRUCTION. */
export interface PlannerVisibleHiringSource {
  capability: HiringSourceCapabilityId;
  description: string;
  purposes: SourcePurpose[];
  bestFor: HiringSourceCapability["bestFor"];
  avoidFor: string[];
  supportedSemanticFilters: HiringSourceCapability["supportedSemanticFilters"];
  expectedEvidence: HiringSourceCapability["expectedEvidence"];
  sourceQuality: HiringSourceCapability["sourceQuality"];
  maximumResultsPerCall: number;
  maximumCallsPerRound: number;
  requiresKnownCompany: boolean;
}

/**
 * Project the catalog for a planner.
 *
 * `providerAdapterKey` and `verifiedBuild` are never copied, so a planner cannot
 * name an Actor even by accident. Disabled providers are omitted entirely — an
 * unavailable channel should not be proposed and then rejected.
 */
export function plannerHiringSourceMenu(): PlannerVisibleHiringSource[] {
  return HIRING_SOURCE_CAPABILITY_IDS
    .filter((id) => resolveHiringSourceActor(id).ok)
    .map((id) => {
      const c = HIRING_SOURCE_CATALOG[id];
      return {
        capability: c.capabilityId,
        description: c.description,
        purposes: [...c.purposes],
        bestFor: c.bestFor,
        avoidFor: [...c.avoidFor],
        supportedSemanticFilters: c.supportedSemanticFilters,
        expectedEvidence: c.expectedEvidence,
        sourceQuality: c.sourceQuality,
        maximumResultsPerCall: c.operatingPolicy.maximumResultsPerCall,
        maximumCallsPerRound: c.operatingPolicy.maximumCallsPerRound,
        requiresKnownCompany: c.operatingPolicy.requiresKnownCompany,
      };
    });
}

/**
 * Deterministic catalog hash.
 *
 * Covers the SEMANTIC contract and the provider binding, so repointing a
 * capability at a different Actor moves the hash even though a planner would
 * never see the difference.
 */
export async function hiringSourceCatalogHash(): Promise<string> {
  return await sha256Hex(canonicalJson({
    version: HIRING_SOURCE_CATALOG_VERSION,
    capabilities: HIRING_SOURCE_CAPABILITY_IDS.map((id) => {
      const c = HIRING_SOURCE_CATALOG[id];
      return {
        id, version: c.version, adapter: c.providerAdapterKey, build: c.verifiedBuild,
        filters: c.supportedSemanticFilters, policy: c.operatingPolicy,
      };
    }),
  }));
}

// Conditional Enrichment Planner (Phase 1E) + budget (1G) + company dedupe (1H)
// + evidence cache contract (1I). Pure / deterministic. NEVER calls a provider.
//
// Product principle: use the CHEAPEST reliable source able to satisfy the contract.
// Enrichment is the exception, not the default:
//
//   primary source sufficient        → skip
//   missing firmographics            → structured company enrichment (low cost)
//   business model still unclear     → targeted Firecrawl (high cost, capped)
//   missing timing                   → specialized signal source, else Firecrawl
//   no verified binding / no budget  → stage honestly (never guess, never call)

import type { EvidenceCategory } from "./evidenceContract.ts";
import type { CandidateEnvelope, EvidenceItem } from "./candidateEnvelope.ts";
import { isEvidenceFresh } from "./candidateEnvelope.ts";
import type { EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";
import { getActorCapability, findCapabilityFor, isCallable, type ActorCapability } from "./actorCapabilityRegistry.ts";

export type EnrichmentAction =
  | "skip"
  | "structured_company_enrichment"
  | "targeted_firecrawl"
  | "specialized_signal_source"
  | "stage";

export type EnrichmentReasonCode =
  | "primary_source_sufficient"
  | "missing_firmographics"
  | "missing_official_proof"
  | "missing_timing_signal"
  | "no_verified_actor_binding"
  | "budget_exhausted"
  | "fresh_cache_available"
  | "already_rejected"
  | "requested_count_satisfied"
  | "not_competitive";

export interface EnrichmentPlan {
  candidateId: string;
  companyKey?: string | null;
  action: EnrichmentAction;
  actorKey?: string;
  actorId?: string;
  requiredEvidence: EvidenceCategory[];
  reasonCode: EnrichmentReasonCode;
  estimatedCostClass: "none" | "low" | "medium" | "high";
}

// ------------------------------------------------------------------ budget ----

export interface WorkflowEvidenceBudget {
  peopleActorAttempts: number;
  rawCandidates: number;
  companyStructuredEnrichments: number;
  firecrawlCompanies: number;
  firecrawlPagesPerCompany: number;
  finalAcceptedTarget: number;
}

export const DEFAULT_EVIDENCE_BUDGET: WorkflowEvidenceBudget = {
  peopleActorAttempts: 3,
  rawCandidates: 25,
  companyStructuredEnrichments: 8,
  firecrawlCompanies: 5,
  firecrawlPagesPerCompany: 3,
  finalAcceptedTarget: 5,
};

export interface BudgetLedger {
  structuredUsed: number;
  firecrawlCompaniesUsed: number;
  acceptedSoFar: number;
}
export const emptyLedger = (): BudgetLedger => ({ structuredUsed: 0, firecrawlCompaniesUsed: 0, acceptedSoFar: 0 });

// ------------------------------------------------------------- cache (1I) -----

export interface EvidenceBundle {
  companyKey: string;
  items: EvidenceItem[];
}
export interface EvidenceCache {
  getCompanyEvidence(companyKey: string): EvidenceBundle | null;
  isFresh(item: EvidenceItem, now: string): boolean;
}

/** Default freshness policy (hours), deterministic + configurable. */
export const DEFAULT_FRESHNESS_HOURS: Record<string, number> = {
  person_identity: 720,               // 30d
  person_company_association: 720,
  company_identity: 720,
  company_website: 720,               // 30d
  company_industry: 336,              // 14d
  company_business_model: 720,
  company_size: 336,                  // 14d
  company_geography: 720,
  job_signal: 72,                     // 72h
  funding_signal: 168,                // 7d
  launch_signal: 168,
  expansion_signal: 168,
  founder_activity_signal: 168,
  gtm_signal: 168,
};

/** In-memory cache honoring the default policy. No DB, no migration. */
export function createInMemoryEvidenceCache(seed?: Map<string, EvidenceItem[]>): EvidenceCache {
  const store = seed ?? new Map<string, EvidenceItem[]>();
  return {
    getCompanyEvidence(companyKey: string) {
      const items = store.get(companyKey);
      return items && items.length ? { companyKey, items } : null;
    },
    isFresh(item: EvidenceItem, now: string) {
      return isEvidenceFresh(item, now, DEFAULT_FRESHNESS_HOURS[item.category] ?? 720);
    },
  };
}

// ------------------------------------------------------------- planner --------

const FIRMOGRAPHIC: ReadonlySet<EvidenceCategory> = new Set([
  "company_identity", "company_website", "company_industry", "company_size", "company_geography",
]);

function costOf(cap: ActorCapability | null, fallback: "none" | "low" | "medium" | "high"): "none" | "low" | "medium" | "high" {
  return (cap?.costClass as "low" | "medium" | "high" | undefined) ?? fallback;
}

/**
 * Plan enrichment for ONE candidate. Callers pass the sufficiency result plus the
 * live ledger/cache so budget + cache reuse are deterministic.
 */
export function planCandidateEnrichment(args: {
  envelope: CandidateEnvelope;
  sufficiency: EvidenceSufficiencyResult;
  budget: WorkflowEvidenceBudget;
  ledger: BudgetLedger;
  cache?: EvidenceCache | null;
  now: string;
  /** True when cheap pre-ranking says this candidate is worth spending on. */
  competitive?: boolean;
}): EnrichmentPlan {
  const { envelope, sufficiency, budget, ledger } = args;
  const companyKey = envelope.companyKey ?? null;
  const base = { candidateId: envelope.candidateId, companyKey };

  // 1) Already decided / nothing to do.
  if (sufficiency.nextDecision === "reject_source") {
    return { ...base, action: "skip", requiredEvidence: [], reasonCode: "already_rejected", estimatedCostClass: "none" };
  }
  if (sufficiency.nextDecision === "qualify_now") {
    return { ...base, action: "skip", requiredEvidence: [], reasonCode: "primary_source_sufficient", estimatedCostClass: "none" };
  }
  // 2) Requested accepted count already satisfied ⇒ stop spending.
  if (ledger.acceptedSoFar >= budget.finalAcceptedTarget) {
    return { ...base, action: "stage", requiredEvidence: sufficiency.missingCriticalRequirements, reasonCode: "requested_count_satisfied", estimatedCostClass: "none" };
  }
  // 3) Search-wide / enrich-narrow: only spend on competitive candidates.
  if (args.competitive === false) {
    return { ...base, action: "stage", requiredEvidence: sufficiency.missingCriticalRequirements, reasonCode: "not_competitive", estimatedCostClass: "none" };
  }

  const missing = sufficiency.missingCriticalRequirements;

  // 4) Fresh cached company evidence covering every gap ⇒ no provider call.
  if (companyKey && args.cache) {
    const bundle = args.cache.getCompanyEvidence(companyKey);
    if (bundle) {
      const freshCats = new Set(bundle.items.filter((i) => args.cache!.isFresh(i, args.now)).map((i) => i.category));
      if (missing.length > 0 && missing.every((c) => freshCats.has(c))) {
        return { ...base, action: "skip", requiredEvidence: missing, reasonCode: "fresh_cache_available", estimatedCostClass: "none" };
      }
    }
  }

  // 5) Route the gap to the cheapest VERIFIED capability.
  if (sufficiency.nextDecision === "structured_company_enrichment") {
    const cap = getActorCapability("structured_company_enrichment");
    if (!isCallable(cap)) {
      // No verified binding — stage honestly rather than guessing an actor.
      return { ...base, action: "stage", requiredEvidence: missing, reasonCode: "no_verified_actor_binding", estimatedCostClass: "none" };
    }
    if (ledger.structuredUsed >= budget.companyStructuredEnrichments) {
      return { ...base, action: "stage", requiredEvidence: missing, reasonCode: "budget_exhausted", estimatedCostClass: "none" };
    }
    return {
      ...base, action: "structured_company_enrichment", actorKey: cap!.actorKey, actorId: cap!.implementationId,
      requiredEvidence: missing.filter((c) => FIRMOGRAPHIC.has(c)), reasonCode: "missing_firmographics",
      estimatedCostClass: costOf(cap, "low"),
    };
  }

  if (sufficiency.nextDecision === "targeted_web_verification") {
    const cap = getActorCapability("firecrawl_scrape_url");
    if (!isCallable(cap)) {
      return { ...base, action: "stage", requiredEvidence: missing, reasonCode: "no_verified_actor_binding", estimatedCostClass: "none" };
    }
    if (ledger.firecrawlCompaniesUsed >= budget.firecrawlCompanies) {
      return { ...base, action: "stage", requiredEvidence: missing, reasonCode: "budget_exhausted", estimatedCostClass: "none" };
    }
    return {
      ...base, action: "targeted_firecrawl", actorKey: cap!.actorKey, actorId: cap!.implementationId,
      requiredEvidence: missing, reasonCode: "missing_official_proof", estimatedCostClass: costOf(cap, "high"),
    };
  }

  if (sufficiency.nextDecision === "signal_enrichment") {
    // Prefer a verified STRUCTURED signal source; fall back to targeted Firecrawl.
    const inputEntity = envelope.targetEntity === "person" ? "person" : "company";
    const structured = findCapabilityFor(missing.slice(0, 1), { inputEntity, maxCost: "medium" })
      ?? findCapabilityFor(missing.slice(0, 1), { inputEntity: "company", maxCost: "medium" });
    if (structured) {
      return {
        ...base, action: "specialized_signal_source", actorKey: structured.actorKey, actorId: structured.implementationId,
        requiredEvidence: missing, reasonCode: "missing_timing_signal", estimatedCostClass: costOf(structured, "medium"),
      };
    }
    const fc = getActorCapability("firecrawl_scrape_url");
    if (isCallable(fc) && ledger.firecrawlCompaniesUsed < budget.firecrawlCompanies) {
      return {
        ...base, action: "targeted_firecrawl", actorKey: fc!.actorKey, actorId: fc!.implementationId,
        requiredEvidence: missing, reasonCode: "missing_timing_signal", estimatedCostClass: costOf(fc, "high"),
      };
    }
    return { ...base, action: "stage", requiredEvidence: missing, reasonCode: isCallable(fc) ? "budget_exhausted" : "no_verified_actor_binding", estimatedCostClass: "none" };
  }

  return { ...base, action: "stage", requiredEvidence: missing, reasonCode: "no_verified_actor_binding", estimatedCostClass: "none" };
}

/**
 * Company-level dedupe (Phase 1H): collapse per-candidate plans so ONE company
 * enrichment action is emitted per companyKey; the resulting evidence is fanned
 * back into every related candidate. Three founders at one company ⇒ one call.
 */
export function dedupeCompanyEnrichment(plans: EnrichmentPlan[]): {
  actions: EnrichmentPlan[];
  fanOut: Map<string, string[]>;   // companyKey → candidateIds sharing the action
} {
  const actions: EnrichmentPlan[] = [];
  const fanOut = new Map<string, string[]>();
  const seenCompany = new Map<string, EnrichmentPlan>();

  for (const p of plans) {
    const companyScoped = p.action === "structured_company_enrichment" || p.action === "targeted_firecrawl";
    if (!companyScoped || !p.companyKey) { actions.push(p); continue; }
    const prev = seenCompany.get(p.companyKey);
    if (!prev) {
      seenCompany.set(p.companyKey, p);
      actions.push(p);
      fanOut.set(p.companyKey, [p.candidateId]);
    } else {
      // Reuse the single action; merge the required evidence for the fan-out.
      prev.requiredEvidence = [...new Set([...prev.requiredEvidence, ...p.requiredEvidence])];
      fanOut.get(p.companyKey)!.push(p.candidateId);
    }
  }
  return { actions, fanOut };
}

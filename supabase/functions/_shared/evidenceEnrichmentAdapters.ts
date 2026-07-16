// Enrichment adapter CONTRACTS (Phases 2–4) — provider-free, pure planning only.
//
// These modules describe WHAT would be requested and WHAT normalized evidence would
// come back. They never call Apify, Firecrawl or an LLM. Execution is a separate,
// separately-reviewed live-integration branch.
//
// Binding rule: an adapter whose capability has verifiedBinding=false MUST refuse to
// produce a call plan. No actor implementation id is ever invented.

import type { EvidenceCategory, EvidenceConfidence } from "./evidenceContract.ts";
import type { EvidenceItem } from "./candidateEnvelope.ts";
import { getActorCapability, isCallable, findCapabilityFor, type ActorCapability } from "./actorCapabilityRegistry.ts";
import type { WorkflowEvidenceBudget } from "./conditionalEnrichmentPlanner.ts";

export type AdapterPlanStatus = "ready" | "blocked_no_binding" | "blocked_budget" | "not_needed";

export interface AdapterCallPlan {
  status: AdapterPlanStatus;
  actorKey?: string;
  actorId?: string;
  /** Sanitized, provider-shaped request the executor WOULD send. */
  request?: Record<string, unknown>;
  requiredEvidence: EvidenceCategory[];
  /** Why this plan is blocked / not needed. */
  reason?: string;
  estimatedCostClass: "none" | "low" | "medium" | "high";
}

// ============================================================================
// PHASE 2 — Structured company enrichment (firmographics)
// ============================================================================

export interface StructuredCompanyEnrichmentInput {
  companyKey: string;
  companyName?: string | null;
  companyLinkedInUrl?: string | null;
  officialDomain?: string | null;
  requiredEvidence: EvidenceCategory[];
  actorCapability?: ActorCapability | null;
  budget: WorkflowEvidenceBudget;
}

/** Normalized firmographic output the adapter WOULD return (per-field confidence). */
export interface StructuredCompanyEvidence {
  companyKey: string;
  website?: { value: string; confidence: EvidenceConfidence } | null;
  industry?: { value: string; confidence: EvidenceConfidence } | null;
  description?: { value: string; confidence: EvidenceConfidence } | null;
  employeeCount?: { value: number | string; confidence: EvidenceConfidence } | null;
  headquarters?: { value: string; confidence: EvidenceConfidence } | null;
  companyLinkedInUrl?: { value: string; confidence: EvidenceConfidence } | null;
  observedAt: string;
  sourceProvenance: { provider: string; actorKey: string; actorId: string; verified: boolean };
}

/**
 * Plan a structured company enrichment call. PROVIDER-FREE.
 * Returns `blocked_no_binding` while the repo has no company-firmographics actor —
 * the executor must never guess an actor id.
 */
export function planStructuredCompanyEnrichment(input: StructuredCompanyEnrichmentInput): AdapterCallPlan {
  const cap = input.actorCapability ?? getActorCapability("structured_company_enrichment");
  if (!input.requiredEvidence.length) {
    return { status: "not_needed", requiredEvidence: [], estimatedCostClass: "none", reason: "no_firmographic_gap" };
  }
  if (!isCallable(cap)) {
    return {
      status: "blocked_no_binding",
      requiredEvidence: input.requiredEvidence,
      estimatedCostClass: "none",
      reason: cap?.missingBindingNote ?? "structured_company_enrichment has no verified actor binding",
    };
  }
  // Prefer the strongest identifier the caller has.
  const request: Record<string, unknown> = {
    companyKey: input.companyKey,
    ...(input.companyLinkedInUrl ? { companyLinkedInUrl: input.companyLinkedInUrl } : {}),
    ...(input.officialDomain ? { domain: input.officialDomain } : {}),
    ...(input.companyName ? { companyName: input.companyName } : {}),
    maxItems: 1,
    fields: input.requiredEvidence,
  };
  return {
    status: "ready", actorKey: cap!.actorKey, actorId: cap!.implementationId,
    request, requiredEvidence: input.requiredEvidence, estimatedCostClass: cap!.costClass,
  };
}

/** Map adapter output → append-only evidence items. Pure. */
export function structuredCompanyEvidenceToItems(out: StructuredCompanyEvidence): EvidenceItem[] {
  const mk = (category: EvidenceCategory, f?: { value: unknown; confidence: EvidenceConfidence } | null): EvidenceItem | null =>
    f && f.value != null ? {
      category, value: f.value, sourceType: "apify_actor", confidence: f.confidence,
      actorKey: out.sourceProvenance.actorKey, actorId: out.sourceProvenance.actorId,
      observedAt: out.observedAt, verified: out.sourceProvenance.verified === true,
    } : null;
  return [
    mk("company_website", out.website),
    mk("company_industry", out.industry),
    mk("company_size", out.employeeCount),
    mk("company_geography", out.headquarters),
    mk("company_identity", out.companyLinkedInUrl),
  ].filter((x): x is EvidenceItem => !!x);
}

// ============================================================================
// PHASE 3 — Targeted Firecrawl (official web proof)
// ============================================================================

export type FirecrawlPagePurpose = "homepage" | "product_about" | "careers" | "press_news";

export interface TargetedFirecrawlInput {
  companyKey: string;
  officialDomain?: string | null;
  requiredEvidence: EvidenceCategory[];
  budget: WorkflowEvidenceBudget;
  firecrawlCompaniesUsed: number;
}

export interface FirecrawlPlan extends AdapterCallPlan {
  pages?: Array<{ purpose: FirecrawlPagePurpose; path: string }>;
}

/** Choose the minimum page set that can prove the missing evidence. */
export function selectFirecrawlPages(required: EvidenceCategory[], max: number): Array<{ purpose: FirecrawlPagePurpose; path: string }> {
  const pages: Array<{ purpose: FirecrawlPagePurpose; path: string }> = [{ purpose: "homepage", path: "/" }];
  if (required.some((c) => c === "company_business_model" || c === "company_industry")) {
    pages.push({ purpose: "product_about", path: "/about" });
  }
  if (required.includes("job_signal")) pages.push({ purpose: "careers", path: "/careers" });
  else if (required.some((c) => c === "launch_signal" || c === "funding_signal" || c === "expansion_signal")) {
    pages.push({ purpose: "press_news", path: "/news" });
  }
  return pages.slice(0, max);
}

/**
 * Plan a TARGETED Firecrawl. PROVIDER-FREE. Never a full-site crawl; capped at
 * budget.firecrawlPagesPerCompany (default 3) and budget.firecrawlCompanies (5).
 * Refuses when structured evidence would suffice (caller decides) or no domain.
 */
export function planTargetedFirecrawl(input: TargetedFirecrawlInput): FirecrawlPlan {
  const cap = getActorCapability("firecrawl_scrape_url");
  if (!input.requiredEvidence.length) {
    return { status: "not_needed", requiredEvidence: [], estimatedCostClass: "none", reason: "no_web_gap" };
  }
  if (!isCallable(cap)) {
    return { status: "blocked_no_binding", requiredEvidence: input.requiredEvidence, estimatedCostClass: "none", reason: "firecrawl capability not verified" };
  }
  if (input.firecrawlCompaniesUsed >= input.budget.firecrawlCompanies) {
    return { status: "blocked_budget", requiredEvidence: input.requiredEvidence, estimatedCostClass: "none", reason: "firecrawl_companies_budget_exhausted" };
  }
  if (!input.officialDomain) {
    return { status: "blocked_no_binding", requiredEvidence: input.requiredEvidence, estimatedCostClass: "none", reason: "no_official_domain_to_verify" };
  }
  const pages = selectFirecrawlPages(input.requiredEvidence, input.budget.firecrawlPagesPerCompany);
  return {
    status: "ready", actorKey: cap!.actorKey, requiredEvidence: input.requiredEvidence,
    request: { domain: input.officialDomain, pages: pages.map((p) => p.path), maxPages: pages.length, fullSiteCrawl: false },
    pages, estimatedCostClass: cap!.costClass,
  };
}

// ============================================================================
// PHASE 4 — Timing signal enrichment
// ============================================================================

export type SignalCategoryName = "hiring" | "funding" | "product_launch" | "expansion" | "founder_activity" | "gtm_change";

export interface SignalPlan {
  selectedSource: string | null;
  selectedActorId?: string;
  signalCategory: SignalCategoryName | null;
  evidenceCategory: EvidenceCategory | null;
  reason: string;
  fallbackSource: string | null;
  stopCondition: string;
  status: AdapterPlanStatus;
  estimatedCostClass: "none" | "low" | "medium" | "high";
}

const EVIDENCE_TO_SIGNAL: Record<string, SignalCategoryName> = {
  job_signal: "hiring",
  funding_signal: "funding",
  launch_signal: "product_launch",
  expansion_signal: "expansion",
  founder_activity_signal: "founder_activity",
  gtm_signal: "gtm_change",
};

/**
 * Plan timing-signal enrichment. PROVIDER-FREE. Prefers a verified STRUCTURED
 * source; falls back to targeted Firecrawl only when structured cannot provide the
 * evidence or official confirmation is required.
 */
export function planSignalEnrichment(input: {
  missingTiming: EvidenceCategory[];
  targetEntity: "person" | "company" | "job";
  budget: WorkflowEvidenceBudget;
  firecrawlCompaniesUsed?: number;
}): SignalPlan {
  const want = input.missingTiming[0] ?? null;
  if (!want) {
    return { selectedSource: null, signalCategory: null, evidenceCategory: null, reason: "no_timing_gap", fallbackSource: null, stopCondition: "n/a", status: "not_needed", estimatedCostClass: "none" };
  }
  const inputEntity = input.targetEntity === "person" ? "person" : "company";
  const structured = findCapabilityFor([want], { inputEntity, maxCost: "medium" })
    ?? findCapabilityFor([want], { inputEntity: "company", maxCost: "medium" });

  const stopCondition = "stop when the requested accepted count is reached or the signal budget is exhausted";
  if (structured) {
    return {
      selectedSource: structured.actorKey, selectedActorId: structured.implementationId,
      signalCategory: EVIDENCE_TO_SIGNAL[want] ?? null, evidenceCategory: want,
      reason: "verified_structured_signal_source_preferred",
      fallbackSource: isCallable(getActorCapability("firecrawl_scrape_url")) ? "firecrawl_scrape_url" : null,
      stopCondition, status: "ready", estimatedCostClass: structured.costClass,
    };
  }
  const fc = getActorCapability("firecrawl_scrape_url");
  if (isCallable(fc) && (input.firecrawlCompaniesUsed ?? 0) < input.budget.firecrawlCompanies) {
    return {
      selectedSource: fc!.actorKey, signalCategory: EVIDENCE_TO_SIGNAL[want] ?? null, evidenceCategory: want,
      reason: "no_structured_source_official_confirmation_required",
      fallbackSource: null, stopCondition, status: "ready", estimatedCostClass: fc!.costClass,
    };
  }
  return {
    selectedSource: null, signalCategory: EVIDENCE_TO_SIGNAL[want] ?? null, evidenceCategory: want,
    reason: isCallable(fc) ? "budget_exhausted" : "no_verified_actor_binding",
    fallbackSource: null, stopCondition, status: isCallable(fc) ? "blocked_budget" : "blocked_no_binding",
    estimatedCostClass: "none",
  };
}

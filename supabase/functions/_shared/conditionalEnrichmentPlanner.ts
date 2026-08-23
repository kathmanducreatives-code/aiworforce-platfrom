// Conditional Enrichment Planner (Phase 1E) + budget (1G) + company dedupe (1H)
// + evidence cache contract (1I). Pure / deterministic. NEVER calls a provider.
//
// Product principle: use the CHEAPEST reliable source able to satisfy the contract.
// Enrichment is the exception, not the default:
//
//   primary source sufficient        → skip
//   missing firmographics            → structured company enrichment (low cost)
//   business model still unclear     → stage. NOT a web crawl. See below.
//   missing timing                   → specialized signal source, else stage
//   no verified binding / no budget  → stage honestly (never guess, never call)
//
// ── WEB RESEARCH IS UNLOCK-GATED, AND THIS PLANNER MAY NOT ORDER IT ────────
//
// This planner used to route two of those gaps into `targeted_firecrawl`, with
// a DEFAULT budget of five companies × three pages that nobody had to opt into.
// It had no production caller — `runFindLeadsCompanyEnrichment` is unreferenced
// and the live orchestrator only ever admits candidates whose next decision is
// `structured_company_enrichment` — so the route was dead. Dead is not the same
// as safe: it sat one call site away from making a crawl the automatic
// consequence of a company having a thin description, which is the single most
// expensive thing this system could start doing by accident. Measured, that is
// ~6.2 crawl credits per useful lead, ~84% of them bought for companies
// qualification was about to reject.
//
// Firecrawl has exactly one home in this architecture: the `research_company`
// Workbench unlock, which a USER triggers on a lead they have already seen, at
// a price they are shown, through `planEnrichmentCrawl` in `companyEnrichment.ts`.
// That path is untouched and is where the capability belongs.
//
// So a gap this planner cannot close with a structured source is STAGED —
// reported as an open question with a named reason — rather than converted into
// a crawl. `web_research_is_unlock_gated` is that reason, and it is deliberately
// distinct from `no_verified_actor_binding`: the actor exists and is callable,
// and this planner still may not call it. A future reader who sees "no binding"
// goes looking for a binding to add. This one tells them not to.
//
// `enforcesUnlockGatedWebResearch` below is the assertion tests hold this to.

import type { EvidenceCategory } from "./evidenceContract.ts";
import type { CandidateEnvelope, EvidenceItem } from "./candidateEnvelope.ts";
import { isEvidenceFresh } from "./candidateEnvelope.ts";
import type { EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";
// `getActorCapability` IS DELIBERATELY NOT IMPORTED.
//
// It resolves ANY actor by key, and `getActorCapability("firecrawl_scrape_url")`
// was how both deleted branches reached the crawler. What remains are the two
// narrow lookups this planner legitimately needs: the structured company
// enricher by name, and a capability search bounded by `maxCost: "medium"` —
// which cannot return a high-cost crawl even if one were registered for the
// category. Re-adding the general lookup is the first step back to an automatic
// crawl, so its absence is the guard.
import { findCapabilityFor, isCallable, getStructuredCompanyEnrichmentCapability, type ActorCapability } from "./actorCapabilityRegistry.ts";

export type EnrichmentAction =
  | "skip"
  | "structured_company_enrichment"
  | "specialized_signal_source"
  | "stage";

/**
 * Actions this planner is FORBIDDEN to emit, named so a test can hold the line.
 *
 * `targeted_firecrawl` lived in the union above. Deleting it from a type stops
 * today's compile and nothing else — a future edit adds the string back and the
 * type widens to accept it again. This constant is what
 * `enforcesUnlockGatedWebResearch` checks, so the rule survives the type.
 */
export const FORBIDDEN_AUTOMATIC_ACTIONS: readonly string[] =
  Object.freeze(["targeted_firecrawl", "firecrawl", "web_crawl"]);

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
  | "not_competitive"
  /**
   * A structured source cannot close this gap, and the web CAN — but only when
   * a user pays for it. Distinct from `no_verified_actor_binding`, which means
   * nothing could answer this at all.
   */
  | "web_research_is_unlock_gated";

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
  finalAcceptedTarget: number;
  // ── NO `firecrawlCompanies`, NO `firecrawlPagesPerCompany` ───────────────
  //
  // These were 5 and 3, in the DEFAULT budget, which meant every caller that
  // took the defaults was already authorised to crawl fifteen pages without
  // ever naming Firecrawl. A budget line is permission; removing the line is
  // what makes the permission impossible to spend by accident, and it is why
  // this is a deletion rather than a zero.
}

export const DEFAULT_EVIDENCE_BUDGET: WorkflowEvidenceBudget = {
  peopleActorAttempts: 3,
  rawCandidates: 25,
  companyStructuredEnrichments: 8,
  finalAcceptedTarget: 5,
};

export interface BudgetLedger {
  structuredUsed: number;
  acceptedSoFar: number;
}
export const emptyLedger = (): BudgetLedger => ({ structuredUsed: 0, acceptedSoFar: 0 });

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
    const cap = getStructuredCompanyEnrichmentCapability();
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

  // 5a) A gap only the company's own site can close is an UNLOCK, not a plan.
  //
  // The three lines this replaces looked up `firecrawl_scrape_url`, checked an
  // automatic crawl budget, and returned a plan naming the actor and its id —
  // everything an executor needs to start spending. What decided a candidate
  // came down this branch was `nextDecision === "targeted_web_verification"`,
  // which `evaluateEvidenceSufficiency` returns for a company whose business
  // model is not yet established. That is the COMMON case for a thin LinkedIn
  // description, so the automatic route was widest exactly where it was most
  // expensive.
  //
  // Staging it says the true thing: the question is open, the web could answer
  // it, and answering costs a credit that only the user may spend.
  if (sufficiency.nextDecision === "targeted_web_verification") {
    return {
      ...base, action: "stage", requiredEvidence: missing,
      reasonCode: "web_research_is_unlock_gated", estimatedCostClass: "none",
    };
  }

  // 5b) A missing TIMING signal takes a verified structured source, or nothing.
  //
  // The deleted fallback read "no structured source? crawl the site" — which is
  // how a dated signal nobody sells would have become a crawl per candidate.
  // A signal source that does not exist is a capability gap, and this system
  // reports capability gaps rather than substituting a general-purpose scraper
  // for a specialised one and hoping the model finds a date on a homepage.
  if (sufficiency.nextDecision === "signal_enrichment") {
    const inputEntity = envelope.targetEntity === "person" ? "person" : "company";
    const structured = findCapabilityFor(missing.slice(0, 1), { inputEntity, maxCost: "medium" })
      ?? findCapabilityFor(missing.slice(0, 1), { inputEntity: "company", maxCost: "medium" });
    if (structured) {
      return {
        ...base, action: "specialized_signal_source", actorKey: structured.actorKey, actorId: structured.implementationId,
        requiredEvidence: missing, reasonCode: "missing_timing_signal", estimatedCostClass: costOf(structured, "medium"),
      };
    }
    return {
      ...base, action: "stage", requiredEvidence: missing,
      reasonCode: "no_verified_actor_binding", estimatedCostClass: "none",
    };
  }

  return { ...base, action: "stage", requiredEvidence: missing, reasonCode: "no_verified_actor_binding", estimatedCostClass: "none" };
}

/**
 * Does a set of produced plans respect the unlock gate?
 *
 * ── WHY A RUNTIME CHECK AND NOT ONLY A TYPE ────────────────────────────────
 *
 * `EnrichmentAction` no longer contains `targeted_firecrawl`, and that is worth
 * exactly as much as the next person's willingness to leave it out. A union is
 * widened by typing a string; a budget is restored by adding a field. Neither
 * edit fails a test on its own, and the failure mode is not a broken build —
 * it is a silent, per-candidate crawl that shows up as a bill.
 *
 * So the rule is asserted against real output: no plan may name a crawl action,
 * and no plan may carry a high cost class, because nothing this planner is
 * still allowed to order is expensive. Returns the violations rather than
 * throwing — the caller is a test, and a list of what went wrong beats a stack
 * trace.
 */
export function enforcesUnlockGatedWebResearch(
  plans: readonly EnrichmentPlan[],
): string[] {
  const violations: string[] = [];
  for (const p of plans) {
    const action = String(p.action);
    if (FORBIDDEN_AUTOMATIC_ACTIONS.includes(action)) {
      violations.push(
        `${p.candidateId}: action "${action}" orders web research automatically. ` +
        `Firecrawl is reachable only through the research_company unlock.`);
    }
    if (/firecrawl|crawl/i.test(String(p.actorKey ?? ""))) {
      violations.push(
        `${p.candidateId}: names actor "${p.actorKey}" in an automatic plan.`);
    }
    if (p.estimatedCostClass === "high") {
      violations.push(
        `${p.candidateId}: cost class "high" — every action this planner may ` +
        `still emit is low or medium, so a high class means an expensive route ` +
        `was reintroduced.`);
    }
  }
  return violations;
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
    // `|| p.action === "targeted_firecrawl"` was the second member here.
    const companyScoped = p.action === "structured_company_enrichment";
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

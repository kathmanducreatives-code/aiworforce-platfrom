// Company enrichment orchestration (Phase 2, Section 9) — pure control flow with
// DEPENDENCY-INJECTED execution. This module itself never calls a provider: the
// caller supplies an executor (run-agent passes the existing Apify path via
// toolRegistry's source_with_apify; tests pass fixtures).
//
// It is the single entry point run-agent calls, so there is exactly ONE person
// pipeline — not a parallel one:
//
//   source-accepted people
//     → CandidateEnvelopes            (person provenance preserved)
//     → EvidenceContract              (compiled once per workflow)
//     → EvidenceSufficiency (before)
//     → competitive pre-rank          (deterministic, no LLM)
//     → conditional enrichment plans  → company dedupe
//     → company actor requests        → INJECTED execution
//     → normalize + fan-out evidence  (append-only, separate company provenance)
//     → EvidenceSufficiency (after)
//     → company_enrichment_observability
//
// Qualification/persistence are NOT performed here — the caller reruns its own
// canonical engine on the enriched envelopes, so thresholds and persistence
// safety stay exactly where they are.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { compileEvidenceContract, type BrainConstraints, type EvidenceCategory, type EvidenceContract } from "./evidenceContract.ts";
import { appendEvidence, companyKeyFor, type CandidateEnvelope, type EvidenceItem } from "./candidateEnvelope.ts";
import { evaluateEvidenceSufficiency, type EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";
import {
  planCandidateEnrichment, dedupeCompanyEnrichment, emptyLedger,
  type WorkflowEvidenceBudget, type EvidenceCache, type EnrichmentPlan, type BudgetLedger,
} from "./conditionalEnrichmentPlanner.ts";
import {
  buildCompanyEnrichmentInput, interpretCompanyActorResponse,
  COMPANY_DETAILS_ACTOR_KEY, COMPANY_DETAILS_ACTOR_ID,
  type CompanyEnrichmentResult, type StructuredCompanyEvidenceBundle,
} from "./structuredCompanyEnrichment.ts";
import {
  buildCompanyEnrichmentObservability, type CompanyDiagnosticInput, type CompanyEnrichmentObservability,
} from "./companyEnrichmentObservability.ts";
import { getStructuredCompanyEnrichmentCapability, isCallable } from "./actorCapabilityRegistry.ts";
import type { LinkedInCompanyActorInput } from "./linkedinCompanyActorFixture.ts";

// ------------------------------------------------------- injected execution ---

export interface CompanyActorExecuteArgs {
  actorKey: string;
  actorId: string;
  input: LinkedInCompanyActorInput;
  workflowRunId?: string;
  taskId?: string;
  workspaceId?: string;
  maxItems: number;
  timeoutMs?: number;
}
export interface CompanyActorExecuteResult {
  items?: unknown[];
  error?: unknown;
  providerRunId?: string;
  timedOut?: boolean;
}
/** run-agent injects the existing Apify path; tests inject fixtures. */
export type CompanyActorExecutor = (args: CompanyActorExecuteArgs) => Promise<CompanyActorExecuteResult>;

// --------------------------------------------------- person → envelope --------

/** A source-accepted person candidate as run-agent already has it. */
export interface SourceAcceptedPerson {
  candidateId: string;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  profileUrl?: string | null;
  companyLinkedInUrl?: string | null;
  companyWebsite?: string | null;
  locationText?: string | null;
  countryCode?: string | null;
  providerVerified: boolean;
  /** Cheap deterministic rank from the existing scoring stack (higher = better). */
  preRankScore?: number | null;
  /** Set when the candidate already failed a gate — never enriched. */
  disqualified?: boolean;
  duplicate?: boolean;
  icpContradiction?: boolean;
}

const PERSON_PROVENANCE = { provider: "apify", actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search" };

/**
 * Build a CandidateEnvelope from a source-accepted person. Only PROVIDER-BACKED
 * facts become evidence; Brain values are constraints and never appear here.
 */
export function buildPersonEnvelope(p: SourceAcceptedPerson, observedAt: string): CandidateEnvelope {
  const ev: EvidenceItem[] = [];
  const mk = (category: EvidenceCategory, value: unknown, confidence: "low" | "medium" | "high"): EvidenceItem => ({
    category, value, sourceType: "apify_actor", confidence,
    actorKey: PERSON_PROVENANCE.actorKey, actorId: PERSON_PROVENANCE.actorId,
    ...(p.profileUrl ? { sourceUrl: String(p.profileUrl) } : {}),
    observedAt, verified: p.providerVerified === true,
  });
  if (p.profileUrl) ev.push(mk("person_identity", p.profileUrl, "high"));
  if (p.company) ev.push(mk("person_company_association", p.company, "medium"));
  if (p.companyLinkedInUrl) ev.push(mk("company_identity", p.companyLinkedInUrl, "medium"));
  if (p.countryCode || p.locationText) ev.push(mk("company_geography", p.countryCode ?? p.locationText, "medium"));

  return {
    candidateId: p.candidateId,
    targetEntity: "person",
    primaryArtifactType: "person_candidate",
    person: {
      fullName: p.name ?? null, title: p.title ?? null, companyName: p.company ?? null,
      profileUrl: p.profileUrl ?? null, locationText: p.locationText ?? null, countryCode: p.countryCode ?? null,
    },
    evidence: ev,
    companyKey: companyKeyFor({
      companyLinkedinUrl: p.companyLinkedInUrl, website: p.companyWebsite,
      companyName: p.company, countryCode: p.countryCode,
    }),
    sourceProvenance: { ...PERSON_PROVENANCE, verified: p.providerVerified === true },
  };
}

// ---------------------------------------------------------- orchestration -----

export interface CompanyEnrichmentRunResult {
  contract: EvidenceContract;
  envelopes: CandidateEnvelope[];
  sufficiencyBefore: Map<string, EvidenceSufficiencyResult>;
  sufficiencyAfter: Map<string, EvidenceSufficiencyResult>;
  /** candidateIds whose evidence actually changed ⇒ qualification must rerun. */
  requalifyCandidateIds: Set<string>;
  companyResults: CompanyEnrichmentResult[];
  observability: CompanyEnrichmentObservability;
  ledger: BudgetLedger;
}

/** Deterministic competitive pre-rank: identity/fit completeness first, then the
 * caller's existing score. No LLM, no provider. */
export function preRankForEnrichment(
  people: SourceAcceptedPerson[],
  sufficiency: Map<string, EvidenceSufficiencyResult>,
): SourceAcceptedPerson[] {
  return [...people].sort((a, b) => {
    const sa = sufficiency.get(a.candidateId); const sb = sufficiency.get(b.candidateId);
    const gapA = sa?.missingCriticalRequirements.length ?? 99;
    const gapB = sb?.missingCriticalRequirements.length ?? 99;
    if (gapA !== gapB) return gapA - gapB;                       // fewer gaps first
    const ra = a.preRankScore ?? 0; const rb = b.preRankScore ?? 0;
    if (ra !== rb) return rb - ra;                               // then better score
    return a.candidateId.localeCompare(b.candidateId);           // stable
  });
}

/**
 * Run the conditional company-enrichment stage. PROVIDER-FREE by construction:
 * every provider touch goes through `execute`.
 */
export async function runCompanyEnrichment(args: {
  people: SourceAcceptedPerson[];
  intent: LeadEntityIntent;
  brain?: BrainConstraints | null;
  budget: WorkflowEvidenceBudget;
  now: string;
  execute?: CompanyActorExecutor | null;
  cache?: EvidenceCache | null;
  acceptedSoFar?: number;
  workflowRunId?: string;
  taskId?: string;
  workspaceId?: string;
}): Promise<CompanyEnrichmentRunResult> {
  const contract = compileEvidenceContract(args.intent, args.brain);   // compiled ONCE
  const ledger: BudgetLedger = { ...emptyLedger(), acceptedSoFar: args.acceptedSoFar ?? 0 };

  // 1) envelopes (source-accepted only)
  const envelopes = args.people.map((p) => buildPersonEnvelope(p, args.now));
  const byId = new Map(envelopes.map((e) => [e.candidateId, e]));
  const personById = new Map(args.people.map((p) => [p.candidateId, p]));

  // 2) sufficiency BEFORE
  const sufficiencyBefore = new Map<string, EvidenceSufficiencyResult>();
  for (const e of envelopes) {
    const p = personById.get(e.candidateId)!;
    sufficiencyBefore.set(e.candidateId, evaluateEvidenceSufficiency({
      contract, envelope: e, now: args.now, icpContradiction: p.icpContradiction === true,
    }));
  }

  // 3) eligibility + competitive pre-rank (enrich-narrow)
  const eligible = args.people.filter((p) => {
    if (p.disqualified || p.duplicate || p.icpContradiction) return false;
    if (!p.providerVerified) return false;
    const s = sufficiencyBefore.get(p.candidateId);
    return s?.nextDecision === "structured_company_enrichment";
  });
  const ranked = preRankForEnrichment(eligible, sufficiencyBefore);

  // 4) plan per candidate, marking those outside the budget window non-competitive
  const maxCompanies = args.budget.companyStructuredEnrichments;
  const competitiveKeys = new Set<string>();
  const plans: EnrichmentPlan[] = [];
  for (const p of ranked) {
    const e = byId.get(p.candidateId)!;
    const key = e.companyKey ?? null;
    const withinWindow = !key || competitiveKeys.has(key) || competitiveKeys.size < maxCompanies;
    if (withinWindow && key) competitiveKeys.add(key);
    plans.push(planCandidateEnrichment({
      envelope: e, sufficiency: sufficiencyBefore.get(p.candidateId)!,
      budget: args.budget, ledger, cache: args.cache, now: args.now, competitive: withinWindow,
    }));
  }

  // 5) company dedupe — ONE action per companyKey, fanned back to all candidates
  const { actions, fanOut } = dedupeCompanyEnrichment(plans);
  const toCall = actions.filter((a) => a.action === "structured_company_enrichment" && a.companyKey);

  // 6) build ONE actor request covering the deduped companies
  const cap = getStructuredCompanyEnrichmentCapability();
  const callable = isCallable(cap) && !!args.execute;
  const inputPlan = buildCompanyEnrichmentInput(
    toCall.map((a) => {
      const anyCandidate = byId.get((fanOut.get(a.companyKey!) ?? [])[0] ?? a.candidateId);
      const p = personById.get(anyCandidate?.candidateId ?? a.candidateId);
      return {
        companyKey: a.companyKey!,
        companyLinkedInUrl: p?.companyLinkedInUrl ?? null,
        companyName: p?.company ?? null,
      };
    }),
    args.budget,
  );

  // 7) execute per company (isolated failures)
  const companyResults: CompanyEnrichmentResult[] = [];
  const bundles = new Map<string, StructuredCompanyEvidenceBundle>();
  const diagnostics: CompanyDiagnosticInput[] = [];

  for (const t of inputPlan.targets) {
    const related = fanOut.get(t.companyKey) ?? [];
    const firstEnv = byId.get(related[0] ?? "");
    const p = personById.get(related[0] ?? "");
    const missingBefore = sufficiencyBefore.get(related[0] ?? "")?.missingCriticalRequirements ?? [];
    const baseDiag = {
      companyKey: t.companyKey, companyName: p?.company, companyLinkedInUrl: p?.companyLinkedInUrl,
      associatedCandidateIds: related, missingBefore,
      action: "structured_company_enrichment",
      actorKey: COMPANY_DETAILS_ACTOR_KEY, actorId: COMPANY_DETAILS_ACTOR_ID,
      verifiedBinding: isCallable(cap), sufficiencyBefore: false,
    };
    if (!callable) {
      const r: CompanyEnrichmentResult = { companyKey: t.companyKey, outcome: "budget_skipped", bundle: null, failureReason: "no_verified_actor_binding_or_executor" };
      companyResults.push(r);
      diagnostics.push({ ...baseDiag, action: "stage", outcome: "budget_skipped", sufficiencyAfter: false, qualificationRerun: false, failureReason: r.failureReason, missingAfter: missingBefore });
      continue;
    }
    let res: CompanyActorExecuteResult;
    try {
      res = await args.execute!({
        actorKey: COMPANY_DETAILS_ACTOR_KEY, actorId: COMPANY_DETAILS_ACTOR_ID,
        input: t.via === "companies" ? { companies: [t.identifier] } : { searches: [t.identifier] },
        workflowRunId: args.workflowRunId, taskId: args.taskId, workspaceId: args.workspaceId,
        maxItems: 1,
      });
    } catch (e) {
      res = { error: e };
    }
    ledger.structuredUsed += 1;
    const interpreted = res.timedOut
      ? { companyKey: t.companyKey, outcome: "timeout" as const, bundle: null, failureReason: "actor_timeout" }
      : interpretCompanyActorResponse({ companyKey: t.companyKey, items: res.items, error: res.error, observedAt: args.now, providerRunId: res.providerRunId });
    companyResults.push(interpreted);
    if (interpreted.bundle) bundles.set(t.companyKey, interpreted.bundle);
    diagnostics.push({
      ...baseDiag,
      officialWebsite: interpreted.bundle?.company.officialWebsite,
      providerRunId: res.providerRunId ?? null,
      fieldsReturned: interpreted.bundle ? Object.keys(interpreted.bundle.company) : [],
      evidenceAdded: interpreted.bundle?.evidence.map((e) => e.category) ?? [],
      outcome: interpreted.outcome, failureReason: interpreted.failureReason ?? null,
      sufficiencyAfter: false, qualificationRerun: !!interpreted.bundle, missingAfter: [],
    });
  }

  // 8) fan evidence out (append-only; person provenance untouched)
  const requalifyCandidateIds = new Set<string>();
  const enriched = envelopes.map((e) => {
    const b = e.companyKey ? bundles.get(e.companyKey) : undefined;
    if (!b) return e;
    requalifyCandidateIds.add(e.candidateId);
    return appendEvidence(e, b.evidence);
  });
  const enrichedById = new Map(enriched.map((e) => [e.candidateId, e]));

  // 9) sufficiency AFTER (only meaningful where evidence changed)
  const sufficiencyAfter = new Map<string, EvidenceSufficiencyResult>();
  for (const e of enriched) {
    const p = personById.get(e.candidateId)!;
    sufficiencyAfter.set(e.candidateId, requalifyCandidateIds.has(e.candidateId)
      ? evaluateEvidenceSufficiency({ contract, envelope: e, now: args.now, icpContradiction: p.icpContradiction === true })
      : sufficiencyBefore.get(e.candidateId)!);
  }

  // 10) finalize diagnostics with after-state
  for (const d of diagnostics) {
    const related = fanOut.get(d.companyKey) ?? [];
    const first = related[0];
    const after = first ? sufficiencyAfter.get(first) : undefined;
    d.sufficiencyBefore = sufficiencyBefore.get(first ?? "")?.sufficient ?? false;
    d.sufficiencyAfter = after?.sufficient ?? false;
    d.missingAfter = after?.missingCriticalRequirements ?? d.missingBefore;
    d.finalCandidateDecisions = related.map((id) => sufficiencyAfter.get(id)?.nextDecision ?? "stage_missing_evidence");
  }

  const stopReason = ledger.acceptedSoFar >= args.budget.finalAcceptedTarget ? "requested_count_satisfied"
    : ledger.structuredUsed >= args.budget.companyStructuredEnrichments ? "budget_exhausted"
      : "completed";

  const observability = buildCompanyEnrichmentObservability({
    candidatesConsidered: args.people.length,
    companiesDeduplicated: new Set(envelopes.map((e) => e.companyKey).filter(Boolean)).size,
    budgetLimit: args.budget.companyStructuredEnrichments,
    budgetConsumed: ledger.structuredUsed,
    stopReason,
    companies: diagnostics,
  });

  return { contract, envelopes: enriched, sufficiencyBefore, sufficiencyAfter, requalifyCandidateIds, companyResults, observability, ledger };
}

// run-agent ↔ company enrichment BRIDGE (Phase 2, Section 10 integration).
//
// This is the ONLY glue between the person Find Leads flow in
// supabase/functions/run-agent/index.ts and the completed, dependency-injected
// company enrichment orchestrator. It never introduces a second sourcing,
// qualification or persistence pipeline; it maps the ALREADY source-accepted
// people into the orchestrator's input, invokes it ONCE per workflow, and
// reports what changed so run-agent can rerun its OWN canonical qualification +
// persistence decision on the enriched candidates.
//
// PROVIDER-FREE by construction: the only provider touch is the injected
// executor. run-agent supplies the real executor (the existing
// runTool("source_with_apify", …) path); tests inject fixtures.
//
// Safety invariants enforced here:
//   • primary person provenance is preserved (apify_people_search) — company
//     evidence is appended SEPARATELY under the company actor provenance.
//   • the canonical company actor identity is immutable and never sourced from
//     user input, tool_input, planner prose, or model output.
//   • only PROVIDER-BACKED facts become evidence; Company Brain requirements are
//     constraints, never candidate evidence.
//   • enrichment can only make a candidate MORE conservative (force-stage when
//     fit/timing is still insufficient); it can NEVER force an accept.
//   • no phone/email/token/raw-payload ever leaves this module.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import type { BrainConstraints, EvidenceCategory } from "./evidenceContract.ts";
import type { EvidenceItem } from "./candidateEnvelope.ts";
import {
  DEFAULT_EVIDENCE_BUDGET, type WorkflowEvidenceBudget, type EvidenceCache,
} from "./conditionalEnrichmentPlanner.ts";
import {
  runCompanyEnrichment,
  type SourceAcceptedPerson, type CompanyActorExecutor,
  type CompanyActorExecuteArgs, type CompanyActorExecuteResult, type CompanyEnrichmentRunResult,
  type EnrichmentClock, type LateProviderCompletion,
} from "./companyEnrichmentOrchestrator.ts";
import {
  COMPANY_DETAILS_ACTOR_KEY, COMPANY_DETAILS_ACTOR_ID, type CompanyEnrichmentOutcome,
} from "./structuredCompanyEnrichment.ts";
import type { SufficiencyDecision } from "./evidenceSufficiency.ts";
import type { CompanyEnrichmentOutcomeForCandidate } from "./finalCandidateState.ts";
import {
  buildCompanyEnrichmentObservability, type CompanyEnrichmentObservability,
} from "./companyEnrichmentObservability.ts";

// The primary PERSON actor identity that must stay attached to every enriched
// candidate (Section 4/21). Mirrors the orchestrator's PERSON_PROVENANCE.
export const PEOPLE_ACTOR_KEY = "apify_people_search";
export const PEOPLE_ACTOR_ID = "harvestapi/linkedin-profile-search";

// ---------------------------------------------------- candidate mapping -------

/** A source-gate-accepted item as run-agent already holds it (mapItem output). */
export interface RunAgentAcceptedItem {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  source_url?: string | null;
  location?: string | null;
  location_country_code?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface MapPeopleOptions {
  /** Stable candidate id; defaults to normalized_candidate_id → profile url → index. */
  candidateId?: (item: RunAgentAcceptedItem, index: number) => string;
  /** Deterministic pre-rank score from the existing scoring stack. */
  preRankScore?: (item: RunAgentAcceptedItem, index: number) => number | null | undefined;
  /** True when the candidate was hard-rejected at the proof gate (never enriched). */
  isHardRejected?: (item: RunAgentAcceptedItem, index: number) => boolean;
  /** True when the candidate is a duplicate (never enriched). */
  isDuplicate?: (item: RunAgentAcceptedItem, index: number) => boolean;
  /** True when the candidate already contradicts the ICP (never enriched). */
  icpContradiction?: (item: RunAgentAcceptedItem, index: number) => boolean;
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : (v == null ? "" : String(v).trim());
  return s ? s : null;
};

/** A person profile URL is the provider proof of identity. */
function personProfileUrl(item: RunAgentAcceptedItem): string | null {
  const raw = item.raw ?? {};
  const candidates = [item.source_url, raw.profile_url, raw.profileUrl, raw.person_linkedin_url, raw.linkedinUrl, raw.url];
  for (const c of candidates) {
    const s = str(c);
    if (s && /linkedin\.com\/in\//i.test(s)) return s;
  }
  // Fall back to any provider source url (still provider-backed, just not /in/).
  return str(item.source_url) ?? str(raw.profile_url) ?? null;
}

function companyLinkedInUrl(item: RunAgentAcceptedItem): string | null {
  const raw = item.raw ?? {};
  return str(raw.company_linkedin_url) ?? str(raw.companyLinkedinUrl) ?? str(raw.companyLinkedInUrl) ?? null;
}

function companyWebsite(item: RunAgentAcceptedItem): string | null {
  const raw = item.raw ?? {};
  return str(raw.company_website) ?? str(raw.website) ?? str(raw.companyUrl) ?? str(raw.domain) ?? null;
}

/**
 * Map source-accepted people into the orchestrator's SourceAcceptedPerson shape.
 * Preserves candidate identity, provenance-verified status, pre-rank score, and
 * every disqualifying flag so ineligible candidates are never enriched. Company
 * Brain requirements are NOT copied in — only what the provider actually returned.
 */
export function mapAcceptedPeople(
  items: RunAgentAcceptedItem[],
  opts: MapPeopleOptions = {},
): SourceAcceptedPerson[] {
  return (items ?? []).map((item, index) => {
    const profileUrl = personProfileUrl(item);
    const isLinkedInPerson = !!profileUrl && /linkedin\.com\/in\//i.test(profileUrl);
    const candidateId = opts.candidateId?.(item, index)
      ?? str((item.raw ?? {}).normalized_candidate_id)
      ?? profileUrl
      ?? `cand-${index}`;
    return {
      candidateId,
      name: str(item.name),
      title: str(item.title),
      company: str(item.company),
      profileUrl,
      companyLinkedInUrl: companyLinkedInUrl(item),
      companyWebsite: companyWebsite(item),
      locationText: str(item.location),
      countryCode: str(item.location_country_code),
      // Provider verification = a genuine provider-backed profile URL exists.
      providerVerified: isLinkedInPerson || !!str(item.source_url),
      preRankScore: opts.preRankScore?.(item, index) ?? null,
      disqualified: opts.isHardRejected?.(item, index) === true,
      duplicate: opts.isDuplicate?.(item, index) === true,
      icpContradiction: opts.icpContradiction?.(item, index) === true,
    } satisfies SourceAcceptedPerson;
  });
}

// ------------------------------------------------ real executor adapter -------

/** Minimal shape of run-agent's runTool result for source_with_apify. `data` is
 * `any` (run-agent's ToolResult types it as `unknown`); the adapter reads only
 * `data.items` and `data.run_id`. */
export interface RunToolResultLike {
  ok?: boolean;
  // deno-lint-ignore no-explicit-any
  data?: any;
  error?: unknown;
  unavailable?: boolean;
}
// `ctx` is `any` so run-agent's concrete runTool(…, ctx: ToolContext) is assignable
// (the bridge never inspects ctx — it just threads it through unchanged).
// deno-lint-ignore no-explicit-any
export type RunToolFn = (tool: string, input: unknown, ctx: any) => Promise<RunToolResultLike>;

/**
 * LEGACY recovery only. Before the dedicated company_items path existed, the
 * generic `source_with_apify` helper job-normalized company output and buried the
 * raw item under `raw.provider_payload` (falling back to `raw`). Recover it so the
 * structured normalizer sees the real company shape. Never fabricates — an
 * unrecoverable item passes through and the normalizer honestly returns
 * `invalid_result`. Prefer {@link extractCompanyItemsFromResult}.
 */
export function extractRawCompanyItems(items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    if (it && typeof it === "object") {
      const raw = (it as Record<string, unknown>).raw;
      if (raw && typeof raw === "object") {
        const pp = (raw as Record<string, unknown>).provider_payload;
        if (pp && typeof pp === "object") return pp;
        return raw;
      }
    }
    return it;
  });
}

/** True when a legacy provider_payload is the {@link truncObj} truncation marker
 * `{ _truncated: true, preview }`. Such a payload is INCOMPLETE and must never be
 * trusted as a company record. */
function isTruncatedPayload(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as Record<string, unknown>)._truncated === true;
}

/**
 * Recover company items from a LEGACY (job-normalized) source_with_apify result,
 * REJECTING any truncated provider_payload rather than partially trusting it.
 * Returns `truncated: true` when at least one recovered payload was truncated —
 * the caller must fail closed (never continue with partial JSON).
 */
export function recoverLegacyCompanyItems(items: unknown): { items: unknown[]; truncated: boolean } {
  if (!Array.isArray(items)) return { items: [], truncated: false };
  const out: unknown[] = [];
  let truncated = false;
  for (const it of items) {
    if (it && typeof it === "object") {
      const raw = (it as Record<string, unknown>).raw;
      if (raw && typeof raw === "object") {
        const pp = (raw as Record<string, unknown>).provider_payload;
        if (pp !== undefined) {
          if (isTruncatedPayload(pp)) { truncated = true; continue; }   // reject, do not trust
          if (pp && typeof pp === "object") { out.push(pp); continue; }
        }
        if (isTruncatedPayload(raw)) { truncated = true; continue; }
        out.push(raw);
        continue;
      }
    }
    out.push(it);
  }
  return { items: out, truncated };
}

/**
 * Extract complete company items from a source_with_apify result, in priority:
 *   1. the typed `company_items` field (complete, untruncated — preferred);
 *   2. a legacy job-normalized `items` array, recovering the raw payload but
 *      REJECTING truncation.
 * Returns `truncated: true` only when the legacy fallback hit a truncated payload
 * and no complete item was available — the caller stages the candidate honestly.
 */
export function extractCompanyItemsFromResult(data: unknown): { items: unknown[]; truncated: boolean } {
  const d = (data ?? {}) as Record<string, unknown>;
  if (Array.isArray(d.company_items)) return { items: d.company_items, truncated: false };
  return recoverLegacyCompanyItems(d.items);
}

/**
 * Adapt run-agent's existing Apify path into the orchestrator's injected
 * executor. The actor identity is HARD-CODED to the canonical company actor and
 * resolved from the ACTOR_REGISTRY inside source_with_apify — it is NEVER taken
 * from the orchestrator args, user input, tool_input, planner prose, or model
 * output. Actor input carries ONLY the deterministic { companies | searches }.
 */
export function makeCompanyEnrichmentExecutor(
  runTool: RunToolFn,
  ctx: unknown,
  opts: { allowDisabled?: boolean } = {},
): CompanyActorExecutor {
  return async (a: CompanyActorExecuteArgs): Promise<CompanyActorExecuteResult> => {
    let rr: RunToolResultLike;
    try {
      rr = await runTool("source_with_apify", {
        tool_name: "source_with_apify",
        // Canonical registry key → source_with_apify resolves actor_id from the
        // ACTOR_REGISTRY. We deliberately DO NOT pass actor_id here so no caller
        // value can override the verified binding.
        selected_actor_key: COMPANY_DETAILS_ACTOR_KEY,
        source_type: "company_details",
        // Deterministic builder output only: { companies?: string[], searches?: string[] }.
        input: a.input,
        max_results: Math.max(1, a.maxItems ?? 1),
        // We persist ONCE downstream through the canonical person path; the
        // company actor never writes leads itself.
        defer_persistence: true,
        ...(opts.allowDisabled ? { allow_disabled: true } : {}),
      }, ctx);
    } catch (e) {
      return { error: e };
    }
    if (rr && rr.ok && rr.data) {
      const { items, truncated } = extractCompanyItemsFromResult(rr.data);
      // A truncated legacy payload is INCOMPLETE — reject it rather than trust
      // partial JSON. The company is isolated as a provider failure and its
      // candidate stages honestly (no fabricated evidence, no persistence).
      if (truncated && items.length === 0) {
        return { error: "company_result_truncated" };
      }
      return {
        items,
        providerRunId: str(rr.data.run_id) ?? undefined,
      };
    }
    return { error: (rr && rr.error) ?? "apify_failed" };
  };
}

// ------------------------------------------------ enriched-evidence patch -----

/** Sanitized company firmographics run-agent may merge onto a candidate's raw so
 * qualification + Workbench can read website/industry/size/geography. Derived
 * ONLY from mapped evidence — never from the raw actor payload, so phone/email
 * cannot pass through. Carries the SEPARATE company actor provenance. */
export interface CompanyRawPatch {
  company_website?: string;
  company_industries?: string[];
  company_employee_count?: number;
  company_employee_range?: { start?: number; end?: number };
  company_country?: string;
  company_country_code?: string;
  company_linkedin_url?: string;
  company_evidence_provenance: { provider: "apify"; actor_key: string; actor_id: string; verified: true };
}

/** The company actor evidence appended to one candidate (fan-out output). */
export function companyEvidenceFor(evidence: EvidenceItem[]): EvidenceItem[] {
  return (evidence ?? []).filter((e) => e.actorId === COMPANY_DETAILS_ACTOR_ID);
}

const CATEGORY = {
  website: "company_website" as EvidenceCategory,
  industry: "company_industry" as EvidenceCategory,
  size: "company_size" as EvidenceCategory,
  geography: "company_geography" as EvidenceCategory,
  identity: "company_identity" as EvidenceCategory,
};

/** Build the sanitized raw patch from the company evidence of one candidate. */
export function companyPatchFromEvidence(evidence: EvidenceItem[]): CompanyRawPatch | null {
  const company = companyEvidenceFor(evidence);
  if (!company.length) return null;
  const byCat = new Map<EvidenceCategory, unknown>();
  for (const e of company) if (!byCat.has(e.category)) byCat.set(e.category, e.value);

  const patch: CompanyRawPatch = {
    company_evidence_provenance: { provider: "apify", actor_key: COMPANY_DETAILS_ACTOR_KEY, actor_id: COMPANY_DETAILS_ACTOR_ID, verified: true },
  };
  const website = byCat.get(CATEGORY.website);
  if (typeof website === "string") patch.company_website = website;
  const identity = byCat.get(CATEGORY.identity);
  if (typeof identity === "string" && /linkedin\.com\/company\//i.test(identity)) patch.company_linkedin_url = identity;
  const industries = byCat.get(CATEGORY.industry);
  if (Array.isArray(industries)) patch.company_industries = industries.filter((x): x is string => typeof x === "string");
  const size = byCat.get(CATEGORY.size);
  if (typeof size === "number") patch.company_employee_count = size;
  else if (size && typeof size === "object") {
    const rng = size as { start?: unknown; end?: unknown };
    const start = typeof rng.start === "number" ? rng.start : undefined;
    const end = typeof rng.end === "number" ? rng.end : undefined;
    if (start != null || end != null) patch.company_employee_range = { ...(start != null ? { start } : {}), ...(end != null ? { end } : {}) };
  }
  const geo = byCat.get(CATEGORY.geography);
  if (geo && typeof geo === "object") {
    const g = geo as { country?: unknown; countryCode?: unknown };
    if (typeof g.country === "string") patch.company_country = g.country;
    if (typeof g.countryCode === "string") patch.company_country_code = g.countryCode;
  }
  return patch;
}

// ------------------------------------------------------- orchestration --------

export interface FindLeadsEnrichmentArgs {
  /** Source-accepted people OR pre-mapped SourceAcceptedPerson[]. */
  items?: RunAgentAcceptedItem[];
  people?: SourceAcceptedPerson[];
  intent: LeadEntityIntent;
  brain?: BrainConstraints | null;
  now: string;
  budget?: WorkflowEvidenceBudget;
  acceptedSoFar?: number;
  /** Injected provider path. Null ⇒ nothing is called; candidates stage honestly. */
  execute?: CompanyActorExecutor | null;
  cache?: EvidenceCache | null;
  workflowRunId?: string;
  taskId?: string;
  workspaceId?: string;
  mapOptions?: MapPeopleOptions;
  // --- latency policy (forwarded to the orchestrator) ---
  clock?: EnrichmentClock;
  concurrency?: number;
  companyTimeoutMs?: number;
  /** Absolute epoch-ms deadline; enrichment stops launching new calls past it. */
  deadlineMs?: number | null;
}

export interface FindLeadsEnrichmentResult {
  enrichment: CompanyEnrichmentRunResult;
  observability: CompanyEnrichmentObservability;
  people: SourceAcceptedPerson[];
  /** Only these candidates gained verified company evidence ⇒ rerun qualification. */
  requalifyCandidateIds: Set<string>;
  /** Company actor evidence appended per requalified candidate (person-provenance untouched). */
  companyEvidenceById: Map<string, EvidenceItem[]>;
  /** Sanitized firmographic patch per requalified candidate (for the raw merge). */
  companyPatchById: Map<string, CompanyRawPatch>;
  /** Requalified candidates whose fit/timing is STILL insufficient ⇒ force-stage. */
  stagedByEnrichment: Set<string>;
  /**
   * Post-enrichment truth per candidate. `decisionAfter` and `missingAfter` are the
   * SAME values the company observability reports, so run-agent's qualification
   * diagnostics and the company diagnostics cannot disagree (the v84 defect where
   * one said `signal_enrichment` and the other said `reject`).
   *
   * Covers EVERY candidate the enrichment stage considered — not just requalified
   * ones — so candidates whose company timed out / returned nothing still carry an
   * honest post-state instead of falling back to stale pre-enrichment fields.
   */
  perCandidate: Map<string, CandidateEnrichmentOutcome>;
  /** Abandoned late provider answers (audit only; never evidence). */
  lateProviderCompletions: LateProviderCompletion[];
}

/** Collapse the orchestrator's company outcome to the candidate-facing vocabulary
 * the final-state reducer consumes. `invalid_result`/`provider_error` are provider
 * failures; `budget_skipped`/`not_needed` mean no call was made for this candidate. */
export function normalizeCompanyOutcome(o: CompanyEnrichmentOutcome): CompanyEnrichmentOutcomeForCandidate {
  switch (o) {
    case "enriched": case "cached": return "enriched";
    case "no_result": return "no_result";
    case "timeout": return "timeout";
    case "invalid_result": case "provider_error": return "failed";
    case "skipped_due_deadline": return "skipped_due_deadline";
    default: return "not_attempted";
  }
}

export interface CandidateEnrichmentOutcome {
  decisionBefore: string;
  decisionAfter: SufficiencyDecision | "unknown";
  sufficientAfter: boolean;
  /** Authoritative post-enrichment critical gaps (canonical EvidenceCategory names). */
  missingAfter: EvidenceCategory[];
  /** How this candidate's company enrichment actually ended. */
  companyOutcome: CompanyEnrichmentOutcomeForCandidate;
}

/**
 * Run the conditional company-enrichment stage ONCE for the whole Scout
 * workflow. Returns exactly what run-agent needs to (a) merge company evidence,
 * (b) rerun its OWN qualification + persistence decision for the changed
 * candidates only, and (c) attach the sanitized observability.
 */
export async function runFindLeadsCompanyEnrichment(
  args: FindLeadsEnrichmentArgs,
): Promise<FindLeadsEnrichmentResult> {
  const people = args.people ?? mapAcceptedPeople(args.items ?? [], args.mapOptions);
  const enrichment = await runCompanyEnrichment({
    people,
    intent: args.intent,
    brain: args.brain ?? null,
    budget: args.budget ?? DEFAULT_EVIDENCE_BUDGET,
    now: args.now,
    execute: args.execute ?? null,
    cache: args.cache ?? null,
    acceptedSoFar: args.acceptedSoFar ?? 0,
    workflowRunId: args.workflowRunId,
    taskId: args.taskId,
    workspaceId: args.workspaceId,
    clock: args.clock,
    concurrency: args.concurrency,
    companyTimeoutMs: args.companyTimeoutMs,
    deadlineMs: args.deadlineMs ?? null,
  });

  const companyEvidenceById = new Map<string, EvidenceItem[]>();
  const companyPatchById = new Map<string, CompanyRawPatch>();
  const stagedByEnrichment = new Set<string>();
  const perCandidate = new Map<string, CandidateEnrichmentOutcome>();

  // How each deduplicated company ended, fanned back to its candidates via the
  // envelope's companyKey (the sanitized observability deliberately exposes only a
  // candidate COUNT, never ids, so the raw results are the correct source here).
  const outcomeByCompanyKey = new Map<string, CompanyEnrichmentOutcomeForCandidate>();
  for (const r of enrichment.companyResults) {
    outcomeByCompanyKey.set(r.companyKey, normalizeCompanyOutcome(r.outcome));
  }
  const outcomeByCandidate = new Map<string, CompanyEnrichmentOutcomeForCandidate>();
  for (const e of enrichment.envelopes) {
    const o = e.companyKey ? outcomeByCompanyKey.get(e.companyKey) : undefined;
    if (o) outcomeByCandidate.set(e.candidateId, o);
  }

  for (const id of enrichment.requalifyCandidateIds) {
    const env = enrichment.envelopes.find((e) => e.candidateId === id);
    if (!env) continue;
    const evidence = companyEvidenceFor(env.evidence);
    if (evidence.length) companyEvidenceById.set(id, evidence);
    const patch = companyPatchFromEvidence(env.evidence);
    if (patch) companyPatchById.set(id, patch);
  }

  // Record an honest post-state for EVERY considered candidate. `sufficiencyAfter`
  // is recomputed from the updated envelope by the orchestrator, so a candidate that
  // gained a verified website/industry no longer reports those as missing.
  for (const p of people) {
    const id = p.candidateId;
    const before = enrichment.sufficiencyBefore.get(id);
    const after = enrichment.sufficiencyAfter.get(id);
    const sufficientAfter = after?.sufficient === true && after?.nextDecision === "qualify_now";
    // Enrichment can only tighten: a candidate whose fit/timing is still incomplete
    // (e.g. a Hot founder proven on firmographics but with no timing signal) is
    // force-staged — never accepted on firmographics alone.
    if (enrichment.requalifyCandidateIds.has(id) && !sufficientAfter) stagedByEnrichment.add(id);
    perCandidate.set(id, {
      decisionBefore: before?.nextDecision ?? "unknown",
      decisionAfter: after?.nextDecision ?? "unknown",
      sufficientAfter,
      missingAfter: (after?.missingCriticalRequirements ?? before?.missingCriticalRequirements ?? []) as EvidenceCategory[],
      companyOutcome: outcomeByCandidate.get(id) ?? "not_attempted",
    });
  }

  return {
    enrichment,
    observability: enrichment.observability,
    people,
    requalifyCandidateIds: enrichment.requalifyCandidateIds,
    companyEvidenceById,
    companyPatchById,
    stagedByEnrichment,
    perCandidate,
    lateProviderCompletions: enrichment.lateProviderCompletions,
  };
}

// ---------------------------------------------------- terminal helpers --------

/** An empty, reconciling company-enrichment observability for terminals that are
 * reached BEFORE any enrichment ran (no accepted people / hard sourcing failure
 * / zero-accepted). Guarantees the object is present in EVERY terminal. */
export function emptyCompanyEnrichmentObservability(
  candidatesConsidered = 0,
  budgetLimit = DEFAULT_EVIDENCE_BUDGET.companyStructuredEnrichments,
): CompanyEnrichmentObservability {
  return buildCompanyEnrichmentObservability({
    candidatesConsidered,
    companiesDeduplicated: 0,
    budgetLimit,
    budgetConsumed: 0,
    stopReason: "no_enrichment",
    companies: [],
  });
}

/**
 * Compute the FINAL accepted person ids and prove the Aria hand-off count.
 * A candidate persists only when the canonical persistence decision accepts it
 * AND enrichment did not force-stage it. Aria receives exactly this set.
 */
export function computeFinalAcceptedPersonIds(
  candidateIds: string[],
  opts: { canonicalPersist: (id: string) => boolean; stagedByEnrichment: Set<string> },
): Set<string> {
  const accepted = new Set<string>();
  for (const id of candidateIds) {
    if (opts.stagedByEnrichment.has(id)) continue;
    if (opts.canonicalPersist(id) === true) accepted.add(id);
  }
  return accepted;
}

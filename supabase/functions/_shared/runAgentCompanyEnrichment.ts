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
} from "./companyEnrichmentOrchestrator.ts";
import { COMPANY_DETAILS_ACTOR_KEY, COMPANY_DETAILS_ACTOR_ID } from "./structuredCompanyEnrichment.ts";
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
 * The canonical `source_with_apify` helper normalizes actor output; the raw
 * provider item is preserved under `raw.provider_payload` (falling back to
 * `raw`). Recover it so the structured normalizer sees the real company shape.
 * Never fabricates — an unrecoverable item passes through and the normalizer
 * will honestly return `invalid_result`.
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
      return {
        items: extractRawCompanyItems(rr.data.items),
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
  /** Before/after honest outcomes per requalified candidate (audit only). */
  perCandidate: Map<string, { decisionBefore: string; decisionAfter: string; sufficientAfter: boolean }>;
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
  });

  const companyEvidenceById = new Map<string, EvidenceItem[]>();
  const companyPatchById = new Map<string, CompanyRawPatch>();
  const stagedByEnrichment = new Set<string>();
  const perCandidate = new Map<string, { decisionBefore: string; decisionAfter: string; sufficientAfter: boolean }>();

  for (const id of enrichment.requalifyCandidateIds) {
    const env = enrichment.envelopes.find((e) => e.candidateId === id);
    if (!env) continue;
    const evidence = companyEvidenceFor(env.evidence);
    if (evidence.length) companyEvidenceById.set(id, evidence);
    const patch = companyPatchFromEvidence(env.evidence);
    if (patch) companyPatchById.set(id, patch);

    const before = enrichment.sufficiencyBefore.get(id);
    const after = enrichment.sufficiencyAfter.get(id);
    const sufficientAfter = after?.sufficient === true && after?.nextDecision === "qualify_now";
    // Enrichment can only tighten: a candidate whose fit/timing is still
    // incomplete (e.g. a Hot founder proven on firmographics but with no timing
    // signal) is force-staged — never accepted on firmographics alone.
    if (!sufficientAfter) stagedByEnrichment.add(id);
    perCandidate.set(id, {
      decisionBefore: before?.nextDecision ?? "unknown",
      decisionAfter: after?.nextDecision ?? "unknown",
      sufficientAfter,
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

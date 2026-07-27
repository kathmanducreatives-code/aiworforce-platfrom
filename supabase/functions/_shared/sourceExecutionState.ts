// SEQUENTIAL SOURCE-EXECUTION STATE — the smallest record needed to run an
// ordered plan one step at a time, and to resume it without paying twice.
//
// NOT A SECOND CHECKPOINT SYSTEM. This is a SLICE that lives inside the existing
// `CompanyFirstSourcingState`, which already lives in the existing
// `tasks.result.company_first_state` jsonb column. No migration, no new task
// type, no second continuation system — the same task id, the same lease, the
// same store.
//
// WHY A SLICE RATHER THAN NEW COLUMNS. The company-first checkpoint already
// carries the quota contract, the completed paid calls and the cross-round dedupe
// identities, and continuation already restores it. Source-step progress belongs
// to the same task and must be restored at the same instant by the same code — a
// parallel store could be restored out of step with it, and then a resumed run
// would disagree with itself about what had already been paid for.
//
// PURE. No network, no provider, no model, no database access.

import { resolveCompanyIdentity, type CompanyIdentity } from "./companyIdentity.ts";

export const SOURCE_EXECUTION_VERSION = "sequential-source-execution-1.0.0";
/** Key inside the existing company-first checkpoint. */
export const SOURCE_EXECUTION_KEY = "source_execution";

export type SourceStepStatus =
  /** Declared by the plan, never activated. */
  | "pending"
  /** Currently the one active discovery step. */
  | "active"
  /** Ran and finished its useful work. */
  | "completed"
  /** Ran, produced nothing more, and has no safe broadening left. */
  | "exhausted"
  /** The provider failed for this step. */
  | "failed"
  /** Never ran because the quota was already satisfied. */
  | "inactive_quota_met"
  /** Could not run — e.g. ATS without a resolved company identity. */
  | "deferred";

export interface SourceStepRecord {
  step_id: string;
  capability: string;
  actor_key: string | null;
  order: number;
  status: SourceStepStatus;
  attempts: number;
  /** Broadening rungs already spent on THIS step. Never reoffered. */
  broadening_used: string[];
  /** Compiled input hashes already sent. Guards against an identical repeat. */
  input_hashes: string[];
  idempotency_keys: string[];
  contact_ready_delta: number;
  cost: number;
  failure_category: string | null;
  inactive_reason: string | null;
}

export interface SourceExecutionState {
  version: string;
  plan_hash: string;
  /** The ONE step currently permitted to call a provider. */
  current_step_id: string | null;
  current_attempt: number;
  steps: SourceStepRecord[];

  completed_step_ids: string[];
  exhausted_step_ids: string[];

  /** Task-local dedupe. Jobs and companies already seen in THIS task. */
  seen_job_keys: string[];
  seen_company_keys: string[];
  /** Companies whose decision-maker sequence already ran. Exactly once each. */
  people_searched_company_keys: string[];

  provider_calls: number;
  cumulative_cost: number;
  total_contact_ready: number;
  remaining_quota: number;

  pending_next_action: string | null;
  early_stop_reason: string | null;
  exhaustion_reason: string | null;
  checkpoint_at: string;
}

export interface PlanStepSeed {
  stepId: string;
  capability: string;
  order: number;
  actorKey?: string | null;
}

export function newSourceExecutionState(args: {
  planHash: string;
  steps: PlanStepSeed[];
  requestedCount: number;
  now: string;
}): SourceExecutionState {
  return {
    version: SOURCE_EXECUTION_VERSION,
    plan_hash: args.planHash,
    current_step_id: null,
    current_attempt: 0,
    steps: args.steps.map((s) => ({
      step_id: s.stepId, capability: s.capability, actor_key: s.actorKey ?? null,
      order: s.order, status: "pending", attempts: 0,
      broadening_used: [], input_hashes: [], idempotency_keys: [],
      contact_ready_delta: 0, cost: 0, failure_category: null, inactive_reason: null,
    })),
    completed_step_ids: [], exhausted_step_ids: [],
    seen_job_keys: [], seen_company_keys: [], people_searched_company_keys: [],
    provider_calls: 0, cumulative_cost: 0,
    total_contact_ready: 0, remaining_quota: args.requestedCount,
    pending_next_action: null, early_stop_reason: null, exhaustion_reason: null,
    checkpoint_at: args.now,
  };
}

/**
 * Reject a checkpoint written against a DIFFERENT plan.
 *
 * The plan hash covers ordering, so a re-planned run is a different sequence and
 * its step ids mean different things. Resuming across that boundary would attribute
 * one plan's completed calls to another plan's steps.
 */
export function stateMatchesPlan(s: SourceExecutionState | null | undefined, planHash: string): boolean {
  return !!s && s.version === SOURCE_EXECUTION_VERSION && s.plan_hash === planHash;
}

export function stepOf(s: SourceExecutionState, stepId: string | null | undefined): SourceStepRecord | null {
  if (!stepId) return null;
  return s.steps.find((x) => x.step_id === stepId) ?? null;
}

export function hasSentInput(s: SourceExecutionState, stepId: string, inputHash: string): boolean {
  return !!stepOf(s, stepId)?.input_hashes.includes(inputHash);
}

/** A step is finished when it completed, exhausted, failed or was skipped. */
export function isStepFinished(step: SourceStepRecord): boolean {
  return step.status === "completed" || step.status === "exhausted"
    || step.status === "failed" || step.status === "inactive_quota_met";
}

// ------------------------------------------------------- task-local dedupe ---

/**
 * Job identity, strongest first: provider id, then canonical URL, then the
 * normalized company + title + location triple.
 *
 * The triple is the WEAKEST rung and deliberately last: two genuinely different
 * openings at one company can share a title and a city, so it only decides when
 * nothing better exists.
 */
export function jobDedupeKey(job: {
  providerJobId?: string | null;
  jobUrl?: string | null;
  companyName?: string | null;
  title?: string | null;
  location?: string | null;
}): string | null {
  const id = String(job.providerJobId ?? "").trim();
  if (id) return `job_id:${id.toLowerCase()}`;

  const url = String(job.jobUrl ?? "").trim();
  if (url) {
    // Strip query and fragment: the same posting is routinely linked with
    // per-source tracking parameters, and treating those as distinct jobs is how
    // one opening gets paid for several times.
    const canonical = url.split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
    if (canonical) return `job_url:${canonical}`;
  }

  const company = String(job.companyName ?? "").trim().toLowerCase();
  const title = String(job.title ?? "").trim().toLowerCase();
  if (!company || !title) return null;
  const loc = String(job.location ?? "").trim().toLowerCase();
  return `job_cti:${company}|${title}|${loc}`;
}

/**
 * Company identity via the EXISTING precedence. Never re-derived here.
 *
 * `resolveCompanyIdentity` takes snake_case `domain` / `website_url` /
 * `linkedin_url`. Passing camelCase silently drops those fields — the call still
 * succeeds and still returns a key, but it degrades to the WEAKEST `name+location`
 * rung for every company. That failure is invisible at the call site and would
 * quietly stop the same company collapsing across two sources, so both spellings
 * are accepted here and mapped onto the authority's own field names.
 */
export function companyDedupeKeyFor(input: {
  name?: string | null;
  domain?: string | null;
  website?: string | null;
  website_url?: string | null;
  linkedinUrl?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
}): { key: string | null; identity: CompanyIdentity } {
  const identity = resolveCompanyIdentity({
    name: input.name ?? null,
    domain: input.domain ?? null,
    website_url: input.website_url ?? input.website ?? null,
    linkedin_url: input.linkedin_url ?? input.linkedinUrl ?? null,
    location: input.location ?? null,
  });
  return { key: identity.dedupeKey, identity };
}

export interface DedupeOutcome<T> {
  fresh: T[];
  duplicates: T[];
  /** Items carrying no usable identity at all. Kept separate from duplicates. */
  unidentified: T[];
}

/**
 * Filter to items this task has not seen, recording the new keys.
 *
 * Items with no derivable key are reported as `unidentified` rather than silently
 * kept or silently dropped: they cannot be deduplicated, and a caller needs to
 * decide that consciously.
 */
export function dedupeAgainstState<T>(
  seen: string[],
  items: T[],
  keyOf: (item: T) => string | null,
): DedupeOutcome<T> {
  const known = new Set(seen);
  const out: DedupeOutcome<T> = { fresh: [], duplicates: [], unidentified: [] };
  for (const item of items) {
    const key = keyOf(item);
    if (!key) { out.unidentified.push(item); continue; }
    if (known.has(key)) { out.duplicates.push(item); continue; }
    known.add(key);
    seen.push(key);
    out.fresh.push(item);
  }
  return out;
}

/** Has this company's decision-maker sequence already run in this task? */
export function peopleSearchAlreadyRan(s: SourceExecutionState, companyKey: string | null): boolean {
  return !!companyKey && s.people_searched_company_keys.includes(companyKey);
}

/** Record that a company's ONE decision-maker sequence has run. */
export function markPeopleSearched(s: SourceExecutionState, companyKey: string | null): void {
  if (companyKey && !s.people_searched_company_keys.includes(companyKey)) {
    s.people_searched_company_keys.push(companyKey);
  }
}

// MULTI-SOURCE HIRING-EVIDENCE FUSION.
//
// PR #108 executes ordered sources one at a time. This module folds each source's
// output into ONE canonical view of what is actually happening at a company —
// after every source attempt, never only at the end.
//
// WHAT THIS MODULE DOES NOT OWN. Everything load-bearing already has an authority,
// and this module calls it rather than reimplementing it:
//
//   canonical event model      signalEvent.ts            (SignalEvent)
//   provider row -> event      jobsSignalAdapter.ts      (jobRecordToSignalEvent)
//   event identity             the adapter's dedupe_key  (company+family+window)
//   freshness                  timingFreshnessPolicy.ts / signalFreshness.ts
//   timing verdict             timingAssessment.ts       (TimingDecision)
//   company identity           companyIdentity.ts        (resolveCompanyIdentity)
//   hashing                    planHash.ts
//
// There is deliberately no second event model, freshness calculator, verdict enum
// or dedupe-key generator here. The one time this repository had two hiring
// policies they diverged — `hiringFreshnessPolicy.test.ts` records a 72h contract
// window against a 60-day signal policy, which made verified 10-day-old hiring
// look stale. Adding a parallel authority would rebuild that bug.
//
// WHAT IS GENUINELY NEW, and therefore lives here:
//   * translating each approved source's rows into the adapter's input shape
//   * reconciling equivalent events across sources WITHOUT losing provenance
//   * recording how each source contributed (discovery / corroboration / verification)
//   * grouping reconciled events under one canonical company
//   * a deterministic evidence hash and the transitions that justify reprocessing
//   * suppressing duplicate decision-maker searches
//
// PURE. No network, provider, model or database access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import { jobRecordToSignalEvent, type NormalizedJobLike } from "./jobsSignalAdapter.ts";
import type { SignalEvent, SignalEvidenceRef } from "./signalEvent.ts";
import { listingStatusIsDead, type ListingStatus } from "./timingFreshnessPolicy.ts";
import type { TimingDecision } from "./timingAssessment.ts";
import { companyDedupeKeyFor } from "./sourceExecutionState.ts";

export const FUSION_STATE_VERSION = "hiring-evidence-fusion-1.0.0";
/** Key inside the existing company-first checkpoint. */
export const FUSION_STATE_KEY = "hiring_evidence_fusion";

/** The approved hiring sources, named as the ordered plan names them. */
export type FusionSourceId =
  | "yc_job_discovery" | "indeed_job_discovery" | "linkedin_job_discovery"
  | "glassdoor_job_discovery" | "ats_job_verification";

/**
 * How a source contributed to a given event IN THIS TASK.
 *
 * Task context, not a property of the source: Indeed is discovery when it finds an
 * event first and corroboration when it confirms one YC already surfaced. This
 * never replaces `SignalEvent.evidence_refs[].sourceType` or `provenance`, which
 * record WHAT the source is.
 */
export type EvidenceSourceRole = "discovery" | "corroboration" | "verification";

/**
 * ATS is the only source that inspects the company's own system of record, so it
 * is the only one whose word on whether a listing is still open is decisive. Every
 * other source reports what its index happened to show.
 */
export function roleForSource(source: FusionSourceId, isFirstForEvent: boolean): EvidenceSourceRole {
  if (source === "ats_job_verification") return "verification";
  return isFirstForEvent ? "discovery" : "corroboration";
}

export interface SourceContribution {
  source: FusionSourceId;
  role: EvidenceSourceRole;
  observedAt: string;
  actorKey?: string;
  sourceUrl?: string;
  listingStatus?: ListingStatus | null;
}

/**
 * One canonical event plus every source that spoke to it.
 *
 * `signal` is the EXISTING `SignalEvent`. Reconciliation adds to its
 * `evidence_refs` and may update `listing_status`; it never replaces the event.
 */
export interface FusedSignal {
  dedupeKey: string;
  signal: SignalEvent;
  contributions: SourceContribution[];
  conflicts: string[];
}

/** Task-level evidence attached to an existing canonical company. Not a company record. */
export interface CompanyEvidenceFusion {
  companyKey: string;
  signalDedupeKeys: string[];
  evidenceSourceTypes: FusionSourceId[];
  evidenceHash: string;
  latestTimingDecision?: TimingDecision;
  lastProcessedEvidenceHash?: string;
  peopleSearchCompleted: boolean;
  strongIdentity: boolean;
  conflicts: string[];
}

export interface HiringEvidenceFusionState {
  version: string;
  /** Reconciled events, keyed by the adapter's own dedupe_key. */
  signals: Record<string, FusedSignal>;
  companies: Record<string, CompanyEvidenceFusion>;
  /** Rows that produced no admissible signal, by reason. Counts only. */
  rejected: Record<string, number>;
}

export function newFusionState(): HiringEvidenceFusionState {
  return { version: FUSION_STATE_VERSION, signals: {}, companies: {}, rejected: {} };
}

// ------------------------------------------------ provider row translation ---

/**
 * Translate one approved source's row into the adapter's input shape.
 *
 * Only field naming differs between these sources; the meaning does not. Anything
 * the shape cannot express is deliberately dropped rather than guessed — the
 * adapter refuses a signal with no source-backed posting date, and inventing one
 * here to get past that check would defeat the freshness doctrine it protects.
 */
export function toNormalizedJob(source: FusionSourceId, row: Record<string, unknown>): NormalizedJobLike {
  const s = (v: unknown): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t : null;
  };
  const first = (...vals: unknown[]): string | null => {
    for (const v of vals) { const t = s(v); if (t) return t; }
    return null;
  };

  const base: NormalizedJobLike = {
    company: first(row.company, row.companyName, row.company_name, row.employer, row.organization),
    jobTitle: first(row.title, row.jobTitle, row.job_title, row.position, row.role),
    jobUrl: first(row.url, row.jobUrl, row.job_url, row.link, row.applyUrl),
    linkedinUrl: first(row.companyLinkedinUrl, row.company_linkedin_url, row.linkedinUrl, row.linkedin_url),
    website: first(row.companyWebsite, row.company_website, row.website, row.website_url),
    domain: first(row.companyDomain, row.company_domain, row.domain),
    // `postedDate` — crawlworks/linkedin-jobs-scraper (official:2026-07-30). This
    // builder deliberately accepts raw-ish provider shapes, and it had the same
    // `datePosted`/`postedDate` transposition the normalizer did. The live path
    // feeds it already-normalized rows, so the normalizer fix is what unblocks
    // production; this keeps a directly-supplied crawlworks row from failing
    // `missing_occurred_at` the same way. `postedTime` (localized text) and
    // `validThrough` (deadline) remain excluded.
    postedAt: first(row.postedAt, row.posted_at, row.datePosted, row.date_posted, row.postedDate, row.publishedAt, row.created_at),
    seniorityLevel: first(row.seniority, row.seniorityLevel, row.seniority_level),
    jobFunction: first(row.jobFunction, row.job_function, row.category),
  };

  // ATS rows describe a posting on the company's OWN system, so their status field
  // is authoritative rather than indexed hearsay. It is carried through `raw` in
  // the shape `normalizeListingStatus` already reads.
  if (source === "ats_job_verification") {
    const status = first(row.status, row.jobStatus, row.job_status, row.state);
    const closed = row.closed === true || row.isClosed === true || row.is_closed === true;
    base.raw = {
      ...(status ? { status } : {}),
      ...(closed ? { closed: true } : {}),
      ...(s(row.closedAt) ? { closedAt: s(row.closedAt) } : {}),
    };
  }
  return base;
}

// ------------------------------------------------------------ reconciliation --

export interface FuseSourceArgs {
  state: HiringEvidenceFusionState;
  source: FusionSourceId;
  actorKey?: string;
  rows: Array<Record<string, unknown>>;
  workspaceId: string;
  observedAt: string;
  /** Injected so tests need no clock. */
  now?: string;
}

export interface FuseSourceOutcome {
  /** Events this source contributed to for the first time in the task. */
  newSignalKeys: string[];
  /** Events that already existed and were corroborated or verified. */
  reconciledSignalKeys: string[];
  /** Companies whose evidence hash CHANGED, and are therefore worth re-evaluating. */
  changedCompanyKeys: string[];
  /** Companies present in this batch whose evidence did not materially change. */
  unchangedCompanyKeys: string[];
  rejected: Record<string, number>;
  conflicts: Array<{ dedupeKey: string; reason: string }>;
  /** Counts for the PR #108 observation. Duplicates are NOT yield. */
  counts: {
    rowsReceived: number;
    signalsProduced: number;
    duplicatesCollapsed: number;
    evidenceRefsAdded: number;
    canonicalCompanies: number;
  };
}

/**
 * Fold one source's rows into the fused state.
 *
 * The merge policy is explicitly NOT "last source wins". An existing event keeps
 * its identity and its accumulated evidence; a later source appends a reference
 * and a contribution. The only field a later source may change is
 * `listing_status`, and only when it is a verification source — see below.
 */
export async function fuseSourceResults(args: FuseSourceArgs): Promise<FuseSourceOutcome> {
  const { state, source, rows, workspaceId, observedAt } = args;
  const out: FuseSourceOutcome = {
    newSignalKeys: [], reconciledSignalKeys: [], changedCompanyKeys: [], unchangedCompanyKeys: [],
    rejected: {}, conflicts: [],
    counts: { rowsReceived: rows.length, signalsProduced: 0, duplicatesCollapsed: 0, evidenceRefsAdded: 0, canonicalCompanies: 0 },
  };

  const touchedCompanies = new Set<string>();

  for (const row of rows) {
    const job = toNormalizedJob(source, row);

    // Canonical company identity through the EXISTING precedence.
    const { key: companyKey, identity } = companyDedupeKeyFor({
      name: job.company, domain: job.domain, website_url: job.website, linkedin_url: job.linkedinUrl,
    });
    if (!companyKey) { bump(out.rejected, "no_company_identity"); continue; }

    const res = jobRecordToSignalEvent({
      job,
      workspace_id: workspaceId,
      company_ref: companyKey,
      observedAt,
      provider: "apify",
      actorKey: args.actorKey,
    });
    if (res.rejected || !res.signal) { bump(out.rejected, res.reason ?? "rejected"); continue; }

    const signal = res.signal;
    const key = signal.dedupe_key;
    const existing = state.signals[key];

    if (!existing) {
      out.counts.signalsProduced += 1;
      out.newSignalKeys.push(key);
      state.signals[key] = {
        dedupeKey: key,
        signal,
        contributions: [{
          source,
          role: roleForSource(source, true),
          observedAt,
          ...(args.actorKey ? { actorKey: args.actorKey } : {}),
          ...(signal.source_url ? { sourceUrl: signal.source_url } : {}),
          listingStatus: signal.listing_status ?? null,
        }],
        conflicts: [],
      };
    } else {
      // RECONCILE. The same underlying hiring event, seen again.
      out.counts.duplicatesCollapsed += 1;
      out.reconciledSignalKeys.push(key);

      const alreadyFromSource = existing.contributions.some((c) => c.source === source);
      if (!alreadyFromSource) {
        // Every independent reference is preserved — collapsing duplicates must
        // never lose the fact that a second source agreed.
        for (const ref of signal.evidence_refs) {
          if (!hasEquivalentRef(existing.signal.evidence_refs, ref)) {
            existing.signal.evidence_refs.push(ref);
            out.counts.evidenceRefsAdded += 1;
          }
        }
        existing.contributions.push({
          source,
          role: roleForSource(source, false),
          observedAt,
          ...(args.actorKey ? { actorKey: args.actorKey } : {}),
          ...(signal.source_url ? { sourceUrl: signal.source_url } : {}),
          listingStatus: signal.listing_status ?? null,
        });
      }

      // FRESHNESS. Keep the freshest source-backed occurrence; never let a later
      // observation make an older posting look newer.
      if (Date.parse(signal.occurred_at) > Date.parse(existing.signal.occurred_at)) {
        existing.signal.occurred_at = signal.occurred_at;
      }
      existing.signal.observed_at = observedAt;

      // LISTING STATUS. Only a verification source may change it, and a dead
      // listing is never overridden by an older discovery claim that it was open.
      const incoming = signal.listing_status ?? null;
      const current = existing.signal.listing_status ?? null;
      if (source === "ats_job_verification" && incoming && incoming !== current) {
        if (listingStatusIsDead(incoming) && !listingStatusIsDead(current)) {
          existing.signal.listing_status = incoming;
          existing.conflicts.push(`ats_closed_overrides_discovery_active:${current ?? "unknown"}`);
          out.conflicts.push({ dedupeKey: key, reason: "ats_closed_overrides_discovery_active" });
        } else if (!listingStatusIsDead(incoming) && listingStatusIsDead(current)) {
          // A newer direct verification that the role is open resolves an older
          // closure, and the resolution is recorded rather than silently applied.
          existing.signal.listing_status = incoming;
          existing.conflicts.push("ats_active_resolved_prior_closed");
          out.conflicts.push({ dedupeKey: key, reason: "ats_active_resolved_prior_closed" });
        } else {
          existing.signal.listing_status = incoming;
        }
      } else if (incoming && current && incoming !== current && listingStatusIsDead(incoming) !== listingStatusIsDead(current)) {
        // Two NON-verification sources materially disagree. Neither outranks the
        // other, so the disagreement stays visible instead of being resolved by
        // whichever source happened to run last.
        const reason = `discovery_sources_disagree_on_status:${current}|${incoming}`;
        if (!existing.conflicts.includes(reason)) existing.conflicts.push(reason);
        out.conflicts.push({ dedupeKey: key, reason: "discovery_sources_disagree_on_status" });
      }
    }

    // ---- company-level fusion ------------------------------------------------
    const company = state.companies[companyKey] ?? (state.companies[companyKey] = {
      companyKey, signalDedupeKeys: [], evidenceSourceTypes: [], evidenceHash: "",
      peopleSearchCompleted: false, strongIdentity: false, conflicts: [],
    });
    if (!company.signalDedupeKeys.includes(key)) company.signalDedupeKeys.push(key);
    if (!company.evidenceSourceTypes.includes(source)) company.evidenceSourceTypes.push(source);
    company.strongIdentity = company.strongIdentity
      || identity.dedupeKeyKind === "domain" || identity.dedupeKeyKind === "linkedin_id";
    for (const c of state.signals[key].conflicts) {
      if (!company.conflicts.includes(c)) company.conflicts.push(c);
    }
    touchedCompanies.add(companyKey);
  }

  // Recompute hashes once per touched company, so a batch of duplicates for one
  // company costs one hash rather than one per row.
  for (const companyKey of touchedCompanies) {
    const company = state.companies[companyKey];
    const before = company.evidenceHash;
    company.evidenceHash = await companyEvidenceHash(state, company);
    if (company.evidenceHash !== before) out.changedCompanyKeys.push(companyKey);
    else out.unchangedCompanyKeys.push(companyKey);
  }
  out.counts.canonicalCompanies = Object.keys(state.companies).length;

  return out;
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** Two references are equivalent when they point at the same evidence. */
function hasEquivalentRef(refs: SignalEvidenceRef[], ref: SignalEvidenceRef): boolean {
  return refs.some((r) =>
    r.category === ref.category
    && r.sourceType === ref.sourceType
    && (r.sourceUrl ?? "") === (ref.sourceUrl ?? "")
    && (r.actorKey ?? "") === (ref.actorKey ?? ""));
}

// -------------------------------------------------------------- hashing ------

/**
 * Deterministic hash of a company's MEANINGFUL evidence.
 *
 * Sorted throughout, so the order sources ran in cannot change it — two tasks that
 * gathered the same evidence by different routes must agree, or reprocessing
 * suppression would depend on scheduling.
 *
 * Deliberately EXCLUDED: `observed_at`, source URLs, actor ids, raw payloads and
 * any wall-clock value. Re-observing the same posting is not new evidence, and
 * including observation time would make every re-scrape look like a change and
 * defeat the suppression this hash exists to provide.
 */
export async function companyEvidenceHash(
  state: HiringEvidenceFusionState,
  company: CompanyEvidenceFusion,
): Promise<string> {
  const signals = company.signalDedupeKeys
    .map((k) => state.signals[k])
    .filter(Boolean)
    .map((f) => ({
      k: f.dedupeKey,
      t: f.signal.signal_type,
      o: f.signal.occurred_at,
      l: f.signal.listing_status ?? "unknown",
      v: f.signal.verification,
      // Which sources spoke, and in what capacity — a new corroborating source IS
      // meaningful evidence even when nothing else changed.
      c: [...f.contributions].map((c) => `${c.source}:${c.role}`).sort(),
      x: [...f.conflicts].sort(),
    }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  return await sha256Hex(canonicalJson({
    company: company.companyKey,
    strongIdentity: company.strongIdentity,
    signals,
  }));
}

// ---------------------------------------------------------- transitions ------

export type EvidenceTransition =
  | "first_evidence"
  | "new_independent_source"
  | "verification_added"
  | "listing_closed"
  | "listing_reopened"
  | "timing_became_sufficient"
  | "timing_became_insufficient"
  | "identity_strengthened"
  | "conflict_raised"
  | "conflict_resolved"
  | "none";

export interface TransitionInput {
  previousHash?: string | null;
  currentHash: string;
  previousDecision?: TimingDecision | null;
  currentDecision?: TimingDecision | null;
  previousStrongIdentity?: boolean;
  currentStrongIdentity: boolean;
  previousSourceCount?: number;
  currentSourceCount: number;
  hadVerification?: boolean;
  hasVerification: boolean;
  wasDead?: boolean;
  isDead: boolean;
  previousConflictCount?: number;
  currentConflictCount: number;
}

/**
 * Classify what materially changed.
 *
 * An unchanged hash is `none` before anything else is considered: if the evidence
 * did not change, no downstream work is justified regardless of how the fields
 * happen to compare.
 */
export function classifyTransition(i: TransitionInput): EvidenceTransition {
  if (!i.previousHash) return "first_evidence";
  if (i.previousHash === i.currentHash) return "none";

  if (i.isDead && !i.wasDead) return "listing_closed";
  if (!i.isDead && i.wasDead) return "listing_reopened";
  if (i.hasVerification && !i.hadVerification) return "verification_added";
  if (i.currentStrongIdentity && !i.previousStrongIdentity) return "identity_strengthened";

  if (i.currentDecision === "timing_sufficient" && i.previousDecision !== "timing_sufficient") {
    return "timing_became_sufficient";
  }
  if (i.previousDecision === "timing_sufficient" && i.currentDecision && i.currentDecision !== "timing_sufficient") {
    return "timing_became_insufficient";
  }

  if ((i.currentConflictCount ?? 0) > (i.previousConflictCount ?? 0)) return "conflict_raised";
  if ((i.previousConflictCount ?? 0) > (i.currentConflictCount ?? 0)) return "conflict_resolved";
  if (i.currentSourceCount > (i.previousSourceCount ?? 0)) return "new_independent_source";
  return "none";
}

/**
 * Transitions that justify running the decision-maker workflow again.
 *
 * A new corroborating source is deliberately ABSENT. Learning that a second job
 * board also lists the same opening tells us nothing new about who to contact, and
 * re-running the search would spend a paid people call to rediscover the same
 * founder.
 */
const PEOPLE_SEARCH_WORTHY: ReadonlySet<EvidenceTransition> = new Set([
  "first_evidence",
  "identity_strengthened",
  "timing_became_sufficient",
  "verification_added",
]);

export interface PeopleSearchDecision {
  run: boolean;
  reason: string;
  transition: EvidenceTransition;
}

/**
 * Should the existing PR #105 decision-maker workflow run for this company?
 *
 * Reuses the fused state's own record of completion rather than a second ledger.
 */
export function decidePeopleSearch(
  company: CompanyEvidenceFusion,
  transition: EvidenceTransition,
): PeopleSearchDecision {
  if (transition === "none") {
    return { run: false, reason: "evidence_unchanged", transition };
  }
  if (!company.peopleSearchCompleted) {
    return PEOPLE_SEARCH_WORTHY.has(transition) || transition === "new_independent_source"
      ? { run: true, reason: "no_completed_search", transition }
      : { run: true, reason: "no_completed_search", transition };
  }
  // Already searched. Only a transition that changes WHO is reachable, or whether
  // the company is eligible at all, justifies paying again.
  if (PEOPLE_SEARCH_WORTHY.has(transition) && transition !== "first_evidence") {
    return { run: true, reason: `eligibility_changed:${transition}`, transition };
  }
  return { run: false, reason: "already_searched_no_material_change", transition };
}

/** Record that the existing workflow completed for this company. */
export function markPeopleSearchCompleted(company: CompanyEvidenceFusion, processedHash: string): void {
  company.peopleSearchCompleted = true;
  company.lastProcessedEvidenceHash = processedHash;
}

// --------------------------------------------------- company-first adapter ---

/**
 * A company-first-friendly label, MAPPED from the existing decision authority.
 *
 * This performs no timing arithmetic of its own: `decision` must come from
 * `evaluateTimingSufficiency`. The extra labels exist because company-first needs
 * to distinguish "we know it closed" and "our sources disagree" from the generic
 * insufficiency the timing enum expresses — and both of those are read from the
 * fused fields, not recomputed.
 */
export type CompanyEvidenceLabel =
  | "sufficient" | "insufficient" | "stale" | "conflicting" | "closed" | "not_required";

export function labelForCompany(
  decision: TimingDecision | null | undefined,
  opts: { anyDead: boolean; unresolvedConflicts: number },
): CompanyEvidenceLabel {
  // A listing the company itself reports closed is closed, whatever a stale index
  // still shows.
  if (opts.anyDead) return "closed";
  if (opts.unresolvedConflicts > 0) return "conflicting";
  switch (decision) {
    case "timing_sufficient": return "sufficient";
    case "timing_not_required": return "not_required";
    case "timing_contradicted": return "conflicting";
    case "missing_timing_evidence": return "insufficient";
    default: return "insufficient";
  }
}

/** Signals for one company, for handing to `evaluateTimingSufficiency`. */
export function signalsForCompany(
  state: HiringEvidenceFusionState,
  companyKey: string,
): SignalEvent[] {
  const company = state.companies[companyKey];
  if (!company) return [];
  return company.signalDedupeKeys.map((k) => state.signals[k]?.signal).filter(Boolean) as SignalEvent[];
}

export function companyHasDeadListing(state: HiringEvidenceFusionState, companyKey: string): boolean {
  return signalsForCompany(state, companyKey).some((s) => listingStatusIsDead(s.listing_status ?? null));
}

export function companyHasVerification(state: HiringEvidenceFusionState, companyKey: string): boolean {
  const company = state.companies[companyKey];
  if (!company) return false;
  return company.signalDedupeKeys.some((k) =>
    (state.signals[k]?.contributions ?? []).some((c) => c.role === "verification"));
}

// ---------------------------------------------------------- diagnostics -----

/** Safe diagnostics. No raw payloads, credentials or contact data. */
export function fusionDiagnostics(
  state: HiringEvidenceFusionState,
  last?: FuseSourceOutcome | null,
): Record<string, unknown> {
  const signals = Object.values(state.signals);
  const companies = Object.values(state.companies);
  const roleCount = (role: EvidenceSourceRole) =>
    signals.reduce((n, f) => n + f.contributions.filter((c) => c.role === role).length, 0);

  return {
    fusion_version: state.version,
    canonical_signals: signals.length,
    canonical_companies: companies.length,
    evidence_refs_total: signals.reduce((n, f) => n + f.signal.evidence_refs.length, 0),
    discovery_sources: roleCount("discovery"),
    corroborating_sources: roleCount("corroboration"),
    verification_sources: roleCount("verification"),
    dead_listings: signals.filter((f) => listingStatusIsDead(f.signal.listing_status ?? null)).length,
    unresolved_conflicts: signals.reduce((n, f) => n + f.conflicts.length, 0),
    companies_with_strong_identity: companies.filter((c) => c.strongIdentity).length,
    people_searches_completed: companies.filter((c) => c.peopleSearchCompleted).length,
    timing_decisions: companies.reduce((acc: Record<string, number>, c) => {
      const d = c.latestTimingDecision ?? "unevaluated";
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {}),
    source_types_seen: [...new Set(companies.flatMap((c) => c.evidenceSourceTypes))].sort(),
    rejected_rows: { ...state.rejected },
    ...(last ? {
      last_fusion: {
        rows_received: last.counts.rowsReceived,
        signals_produced: last.counts.signalsProduced,
        duplicates_collapsed: last.counts.duplicatesCollapsed,
        evidence_refs_added: last.counts.evidenceRefsAdded,
        companies_changed: last.changedCompanyKeys.length,
        companies_unchanged: last.unchangedCompanyKeys.length,
        rejected: { ...last.rejected },
      },
    } : {}),
  };
}

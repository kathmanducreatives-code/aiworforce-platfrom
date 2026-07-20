// Account-research hydration — pure, deterministic, zero-credit.
//
// THE PRODUCT RULE THIS ENFORCES
//   Agentory must never charge a user to rediscover information it already
//   collected. A sourced account already carries a verified website, a company
//   LinkedIn page, a live job posting, source proof, and (usually) an enrichment
//   summary. The Workbench, however, only ever populated its research stage from
//   a paid `research_company` ACTION, so a freshly sourced account showed
//   "No sources yet" / "Company research incomplete" and offered the paid
//   "Research company ~4c" — asking the user to buy data Agentory already has.
//
// This module hydrates a canonical, provider-independent research snapshot from
// the already-stored fields, projects it into the existing WorkbenchAccountView
// (so `hasCompletedResearch` / `nextAction` see it), and drives a credit policy
// where viewing costs nothing and only a genuine provider refresh is paid.
//
// PROVENANCE (proven by a read-only production audit — field presence/counts only)
//   A sourced lead_candidate.raw carries: company_enrichment.{company_summary,
//   evidence_urls,status,confidence,missing_evidence}, source_proof[], plus
//   flattened website / company_linkedin_url / job_url / job_title / why_now /
//   industries / employee_count. The old view counted ONLY evidence_urls, so a
//   verified website + LinkedIn + live job posting counted as zero sources.

import type { LeadTableRow } from '@/hooks/useLeadResults';
import { hydrateOutreachStage } from './outreachStageView';
import {
  buildCompanyResearchView,
  sanitizeSummary,
  type CompanyResearchView,
  type ResearchDisplayStatus,
} from '@/lib/companyResearchDisplay';
import {
  buildIcpSnapshot,
  type AccountFacts,
  type IcpSnapshot,
  type SavedIcp,
} from '@/lib/icpSnapshot';
import {
  emptyAccountView,
  type AccountStage,
  type WorkbenchAccountView,
} from '@/lib/workbenchAccountView';

// ------------------------------------------------------------------ contract --

export type ResearchSnapshotStatus =
  | 'available'   // usable summary AND ≥1 verified source
  | 'partial'     // some evidence, but not enough to ground an outreach claim
  | 'stale'       // was usable, but older than its freshness window
  | 'missing'     // nothing usable stored
  | 'failed';     // a prior research attempt failed and left nothing

export type ResearchOrigin = 'sourcing' | 'workbench_research' | 'combined';

export type EvidenceKind =
  | 'website'
  | 'company_linkedin'
  | 'job_posting'
  | 'source_proof'
  | 'enrichment'
  | 'signal';

export interface ResearchEvidence {
  /** Sanitized public URL only — never a scraped page body or provider payload. */
  url: string;
  kind: EvidenceKind;
  /** Safe human label (no PII, no raw content). */
  label: string;
}

export interface AccountResearchSnapshot {
  lead_candidate_id: string;
  status: ResearchSnapshotStatus;
  origin: ResearchOrigin;
  company_identity: {
    name: string | null;
    domain: string | null;
    website: string | null;
    company_linkedin_url: string | null;
  };
  overview: {
    summary: string | null;
    industry: string | null;
    category: string | null;
    employee_range: string | null;
    location: string | null;
  };
  hiring_signal: {
    title: string | null;
    job_url: string | null;
    posted_at: string | null;
    why_now: string | null;
  } | null;
  qualification_context: {
    sourcing_fit_score: number | null;
    sourcing_verdict: string | null;
    why_selected: string | null;
    why_now: string | null;
    gate: string | null;
    confidence: string | null;
    disqualifiers: string[];
  };
  evidence: ResearchEvidence[];
  source_count: number;
  confidence: 'high' | 'medium' | 'low';
  missing_evidence: string[];
  refreshed_at: string | null;
  stale_after: string | null;
}

/** Default freshness window for stored research, in days. Sourcing evidence older
 * than this is surfaced as `stale` so an OPTIONAL paid refresh can be offered —
 * viewing the existing snapshot always stays free. */
export const RESEARCH_STALE_DAYS = 30;

// -------------------------------------------------------------- safe readers --

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** The jsonb payload lives one level deeper: row.raw is the DB row, row.raw.raw is
 * the jsonb (company_enrichment / agentory_workbench / source_proof live there). */
export function readLeadJsonb(row: Pick<LeadTableRow, 'raw'>): Json {
  const dbRow = isObj(row.raw) ? row.raw : {};
  const inner = isObj(dbRow.raw) ? dbRow.raw : {};
  return inner;
}

function companyEnrichment(jsonb: Json): Json | null {
  return isObj(jsonb.company_enrichment) ? jsonb.company_enrichment : null;
}

/** Normalize a URL to a stable dedupe key (host+path, lowercased, no scheme/query/
 * trailing slash, `www.` stripped). Returns '' for anything not http(s). */
export function normalizeEvidenceUrl(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return '';
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    const host = url.host.replace(/^www\./i, '');
    return `${host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
}

/** Keep the original public URL but drop query/fragment and credentials. */
function cleanPublicUrl(u: unknown): string | null {
  const s = typeof u === 'string' ? u.trim() : '';
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ evidence build --

/**
 * Collect deduplicated verified sources from every trusted field. A verified
 * website, a company LinkedIn page and a live job posting each COUNT as a source
 * (the old view ignored all three). source_proof entries and enrichment
 * evidence_urls are folded in and deduped by normalized URL.
 */
export function collectEvidence(row: LeadTableRow, jsonb: Json): ResearchEvidence[] {
  const out: ResearchEvidence[] = [];
  const seen = new Set<string>();
  const add = (rawUrl: unknown, kind: EvidenceKind, label: string) => {
    const clean = cleanPublicUrl(rawUrl);
    if (!clean) return;
    const key = normalizeEvidenceUrl(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ url: clean, kind, label });
  };

  add(row.website, 'website', 'Company website');
  add(row.company_linkedin_url, 'company_linkedin', 'Company LinkedIn');
  add(row.job_url, 'job_posting', 'Hiring signal (job posting)');
  add(row.signal_source_url, 'signal', 'Signal source');

  // source_proof: array of { url } | string — provenance from sourcing.
  const proof = Array.isArray(jsonb.source_proof) ? jsonb.source_proof : [];
  for (const p of proof) {
    if (typeof p === 'string') add(p, 'source_proof', 'Source proof');
    else if (isObj(p)) add(p.url ?? p.source_url ?? p.evidence_url, 'source_proof', 'Source proof');
  }

  // enrichment evidence_urls: array of string.
  const ce = companyEnrichment(jsonb);
  const evUrls = ce && Array.isArray(ce.evidence_urls) ? ce.evidence_urls : [];
  for (const u of evUrls) add(u, 'enrichment', 'Research source');

  return out;
}

// ----------------------------------------------------------- overview build --

function employeeRange(row: LeadTableRow, jsonb: Json): string | null {
  const ce = companyEnrichment(jsonb);
  const explicit = str((ce ?? {}).employee_range) ?? str(jsonb.employee_range);
  if (explicit) return explicit;
  const count = num(row.employee_count) ?? num(jsonb.employee_count);
  if (count == null) return null;
  if (count < 11) return '1–10';
  if (count < 51) return '11–50';
  if (count < 201) return '51–200';
  if (count < 1001) return '201–1000';
  return '1000+';
}

function bestSummary(row: LeadTableRow, jsonb: Json): string | null {
  const ce = companyEnrichment(jsonb);
  // Precedence: verified workbench research summary → enrichment summary →
  // legacy flattened summaries. sanitizeSummary drops newsletter/markdown/nav.
  const candidates = [
    (ce ?? {}).company_summary,
    row.enrichment_summary,
    row.company_description,
    row.evidence_summary,
  ];
  for (const c of candidates) {
    const s = sanitizeSummary(c);
    if (s) return s;
  }
  return null;
}

function firstIndustry(row: LeadTableRow, jsonb: Json): string | null {
  if (Array.isArray(row.industries) && row.industries.length) {
    const first = row.industries.find((x) => typeof x === 'string' && x.trim());
    if (first) return first.trim();
  }
  const ind = Array.isArray(jsonb.industries) ? jsonb.industries.find((x) => typeof x === 'string' && (x as string).trim()) : null;
  return typeof ind === 'string' ? ind.trim() : null;
}

// ------------------------------------------------------------- snapshot build --

function parseDate(v: unknown): number | null {
  const s = typeof v === 'string' ? v : '';
  const t = Date.parse(s);
  return isFinite(t) ? t : null;
}

export interface HydrateOptions {
  /** Injected clock for deterministic tests. */
  now?: () => number;
  staleDays?: number;
}

/**
 * Build the canonical account-research snapshot from all stored trusted fields.
 * NO provider call. Never fabricates a fact that isn't present.
 */
export function hydrateAccountResearchSnapshot(
  row: LeadTableRow,
  opts: HydrateOptions = {},
): AccountResearchSnapshot {
  const jsonb = readLeadJsonb(row);
  const ce = companyEnrichment(jsonb);
  const nowMs = (opts.now ?? Date.now)();
  const staleDays = opts.staleDays ?? RESEARCH_STALE_DAYS;

  const evidence = collectEvidence(row, jsonb);
  const summary = bestSummary(row, jsonb);
  const source_count = evidence.length;

  // Origin: enrichment blob present ⇒ sourcing; a workbench research stage that
  // succeeded ⇒ combined; otherwise sourcing/none.
  const aw = isObj(jsonb.agentory_workbench) ? jsonb.agentory_workbench : null;
  const researchStage = aw && isObj(aw.company_research) ? aw.company_research : null;
  const workbenchResearched = !!researchStage && str(researchStage.status) === 'succeeded';
  const origin: ResearchOrigin = workbenchResearched && ce ? 'combined'
    : workbenchResearched ? 'workbench_research'
    : 'sourcing';

  // refreshed_at: when the evidence was last established. Prefer an explicit
  // research/enrichment timestamp; fall back to the job posting date.
  const refreshedMs =
    parseDate(researchStage?.succeeded_at) ??
    parseDate((ce ?? {}).refreshed_at) ??
    parseDate(row.posted_at);
  const refreshed_at = refreshedMs != null ? new Date(refreshedMs).toISOString() : null;
  const staleMs = refreshedMs != null ? refreshedMs + staleDays * 86_400_000 : null;
  const stale_after = staleMs != null ? new Date(staleMs).toISOString() : null;

  const missing_evidence = Array.isArray((ce ?? {}).missing_evidence)
    ? ((ce ?? {}).missing_evidence as unknown[]).map((m) => String(m)).filter(Boolean)
    : (Array.isArray(row.missing_evidence) ? row.missing_evidence.filter((m) => typeof m === 'string') : []);

  // Confidence: an explicit stored confidence wins; else derive from source_count.
  const storedConfidence = str((ce ?? {}).confidence) ?? str(row.confidence_level);
  let confidence: AccountResearchSnapshot['confidence'];
  if (storedConfidence === 'high' || storedConfidence === 'medium' || storedConfidence === 'low') {
    confidence = storedConfidence;
  } else {
    confidence = source_count >= 3 ? 'high' : source_count >= 1 ? 'medium' : 'low';
  }

  // Status.
  const usable = !!summary && source_count > 0;
  let status: ResearchSnapshotStatus;
  if (usable) {
    status = staleMs != null && nowMs > staleMs ? 'stale' : 'available';
  } else if (source_count > 0 || summary) {
    status = 'partial';
  } else if (str(researchStage?.status) === 'failed') {
    status = 'failed';
  } else {
    status = 'missing';
  }

  const hasHiring = !!(row.job_title || row.job_url || row.signal_type === 'hiring_signal');

  return {
    lead_candidate_id: row.lead_candidate_id ?? row.id,
    status,
    origin,
    company_identity: {
      name: str(row.company_name),
      domain: str(jsonb.domain) ?? str(row.website),
      website: cleanPublicUrl(row.website),
      company_linkedin_url: cleanPublicUrl(row.company_linkedin_url),
    },
    overview: {
      summary,
      industry: firstIndustry(row, jsonb),
      category: str((ce ?? {}).category) ?? str(jsonb.category),
      employee_range: employeeRange(row, jsonb),
      location: str(row.company_location),
    },
    hiring_signal: hasHiring ? {
      title: str(row.job_title) ?? str(row.signal_title),
      job_url: cleanPublicUrl(row.job_url),
      posted_at: str(row.posted_at),
      why_now: str(row.why_now),
    } : null,
    qualification_context: {
      sourcing_fit_score: num(row.fit_score) ?? num(row.final_overall_fit),
      sourcing_verdict: str(row.analyst_verdict) ?? str(row.fit_tier),
      why_selected: str(row.why_this_lead) ?? str(row.fit_reason),
      why_now: str(row.why_now),
      gate: str(row.gate_decision),
      confidence: storedConfidence,
      disqualifiers: Array.isArray(row.disqualifiers_hit) ? row.disqualifiers_hit.filter((d) => typeof d === 'string') : [],
    },
    evidence,
    source_count,
    confidence,
    missing_evidence,
    refreshed_at,
    stale_after,
  };
}

// ----------------------------------------------- projection into existing view --

const SNAPSHOT_TO_RESEARCH_STATUS: Record<ResearchSnapshotStatus, ResearchDisplayStatus> = {
  available: 'succeeded',
  partial: 'partial',
  stale: 'succeeded',
  missing: 'not_started',
  failed: 'failed',
};

/**
 * Project the snapshot into the existing CompanyResearchView so the reducer,
 * `hasCompletedResearch` and the cell all see hydrated research. Crucially this
 * uses the FULL deduped source count (not just enrichment.evidence_urls), so a
 * sourced account is never labelled "No sources yet".
 */
export function researchViewFromSnapshot(s: AccountResearchSnapshot): CompanyResearchView {
  const base = buildCompanyResearchView(
    { company_summary: s.overview.summary, evidence_urls: s.evidence.map((e) => e.url), missing_evidence: s.missing_evidence, confidence: s.confidence },
    SNAPSHOT_TO_RESEARCH_STATUS[s.status],
  );
  // buildCompanyResearchView already computes usable = summary && evidence>0.
  return base;
}

export function accountFactsFromSnapshot(s: AccountResearchSnapshot, dm: {
  has_verified_decision_maker: boolean;
  verified_buyer_role_family?: string | null;
  manual_review_count?: number;
}): AccountFacts {
  return {
    industry: s.overview.industry,
    employee_count: null,
    company_size_label: s.overview.employee_range,
    geography: s.overview.location,
    verified_buyer_role_family: dm.verified_buyer_role_family ?? null,
    has_verified_decision_maker: dm.has_verified_decision_maker,
    manual_review_count: dm.manual_review_count ?? 0,
    research_usable: s.status === 'available' || s.status === 'stale',
    research_confidence: s.confidence,
    evidence_ids: s.evidence.map((e) => e.url),
  };
}

/**
 * Hydrate a full WorkbenchAccountView from stored evidence + the saved ICP.
 * company_research is seeded from the snapshot; icp_snapshot is computed locally
 * against the workspace's saved ICP (never generic defaults). Zero credits.
 */
export function hydrateAccountView(
  row: LeadTableRow,
  icp: SavedIcp | null | undefined,
  opts: HydrateOptions = {},
): { view: WorkbenchAccountView; snapshot: AccountResearchSnapshot; icp_snapshot: IcpSnapshot } {
  const snapshot = hydrateAccountResearchSnapshot(row, opts);
  const research = researchViewFromSnapshot(snapshot);
  const facts = accountFactsFromSnapshot(snapshot, { has_verified_decision_maker: false });
  const icp_snapshot = buildIcpSnapshot(facts, icp ?? null);

  const now = new Date((opts.now ?? Date.now)()).toISOString();

  // A generated opener lives in the namespaced outreach stage. Without this the
  // message vanished on refresh: it was persisted correctly but nothing read it
  // back, so the Personalized Message column reverted to a blocker/empty state.
  //
  // `last_success` is the durable valid opener; the stage's own status reflects
  // the LATEST attempt, so a failed retry shows its status without erasing the
  // opener that already succeeded.
  const outreachStage = hydrateOutreachStage(readLeadJsonb(row));

  const view: WorkbenchAccountView = {
    ...emptyAccountView(snapshot.lead_candidate_id),
    company_research: {
      attempt: research.usable
        ? { status: 'succeeded', attempted_at: now, succeeded_at: snapshot.refreshed_at ?? now }
        : null,
      last_success: research.usable ? research : null,
    },
    outreach: {
      attempt: outreachStage.latest_status
        ? {
          status: outreachStage.latest_status,
          reason_code: outreachStage.latest_reason_code ?? undefined,
          attempted_at: now,
          succeeded_at: outreachStage.last_success?.generated_at,
        }
        : null,
      last_success: outreachStage.last_success,
    },
    icp_snapshot,
    updated_at: snapshot.refreshed_at,
  };
  return { view, snapshot, icp_snapshot };
}

/**
 * Hydration is the FLOOR, never an override. For each stage, an action-produced
 * success (already in `existing`) wins; hydrated research fills only a stage the
 * user has not yet advanced. This is what keeps completed intelligence visible
 * after Generate outreach / Find decision-makers while still un-blocking sourced
 * accounts on first load.
 */
export function applyHydrationFloor(
  hydrated: WorkbenchAccountView,
  existing: WorkbenchAccountView | undefined,
): WorkbenchAccountView {
  if (!existing) return hydrated;
  const keepStage = <T>(ex: AccountStage<T>, hy: AccountStage<T>): AccountStage<T> =>
    ex.last_success != null ? ex : (hy.last_success != null ? { attempt: ex.attempt ?? hy.attempt, last_success: hy.last_success } : ex);

  return {
    ...existing,
    company_research: keepStage(existing.company_research, hydrated.company_research),
    // Same floor rule for outreach: an opener produced by an action in THIS
    // session wins; otherwise the persisted one fills in on load.
    outreach: keepStage(existing.outreach, hydrated.outreach),
    // ICP: keep a freshly recomputed one from an action if present, else hydrated.
    icp_snapshot: existing.icp_snapshot ?? hydrated.icp_snapshot,
    updated_at: existing.updated_at ?? hydrated.updated_at,
  };
}

// ------------------------------------------------------------- credit policy --

export type ResearchCtaKind = 'view' | 'refresh' | 'research';

export interface ResearchCta {
  kind: ResearchCtaKind;
  /** True only when a provider-backed call will actually run. */
  paid: boolean;
  label: string;
  /** Estimated credits — 0 for view. */
  credits: number;
}

/**
 * Decide the research call-to-action from a hydrated snapshot.
 *   available/partial-with-summary → View research (FREE)
 *   stale / important evidence missing → Refresh research (PAID, optional)
 *   missing/failed → Research company (PAID)
 *
 * `refreshCredits` is the caller's real estimate for a provider refresh.
 */
export function researchCta(s: AccountResearchSnapshot, refreshCredits = 4): ResearchCta {
  if (s.status === 'available') {
    return { kind: 'view', paid: false, label: 'View research', credits: 0 };
  }
  if (s.status === 'stale') {
    return { kind: 'refresh', paid: true, label: 'Refresh research', credits: refreshCredits };
  }
  if (s.status === 'partial' && (s.overview.summary || s.source_count > 0)) {
    // Something usable to view for free, with an optional paid deepen.
    return { kind: 'view', paid: false, label: 'View research', credits: 0 };
  }
  return { kind: 'research', paid: true, label: 'Research company', credits: refreshCredits };
}

/** True when the account has enough hydrated research to skip a paid research step. */
export function hasUsableHydratedResearch(s: AccountResearchSnapshot): boolean {
  return s.status === 'available' || s.status === 'stale'
    || (s.status === 'partial' && !!s.overview.summary && s.source_count > 0);
}

// -------------------------------------------------------- saved ICP adapter --

/**
 * Extract a SavedIcp from the workspace's active `company_brain.profile.icp`.
 * Tolerates both the legacy shape (company_size / geography as scalars) and the
 * v2 shape (arrays). Returns null when no saved ICP is present, so the assessment
 * reports insufficient_evidence rather than applying generic defaults.
 */
export function savedIcpFromBrain(brainProfile: unknown): SavedIcp | null {
  if (!isObj(brainProfile)) return null;
  const icp = isObj(brainProfile.icp) ? brainProfile.icp : null;
  if (!icp) return null;
  const arr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim());
    const s = str(v);
    return s ? [s] : [];
  };
  const out: SavedIcp = {
    industries: arr(icp.industries),
    company_size: arr((icp as Json).company_size ?? (icp as Json).company_sizes),
    geographies: arr((icp as Json).geographies ?? (icp as Json).geography),
    buyer_roles: arr(icp.buyer_roles),
    buying_moments: arr((icp as Json).buying_moments),
    exclusions: arr((icp as Json).exclusions),
    disqualifiers: arr((icp as Json).disqualifiers),
    messaging_fit: arr((icp as Json).messaging_fit),
  };
  const anyDefined = Object.values(out).some((v) => Array.isArray(v) && v.length > 0);
  return anyDefined ? out : null;
}

// ------------------------------------------------------------ outreach gate --

export type OutreachReadiness =
  | { ready: true }
  | { ready: false; blocker: 'missing_person' | 'missing_company_brain' | 'missing_research' | 'excluded'; message: string };

/**
 * Decide whether Generate outreach is the primary next step, or which SPECIFIC
 * prerequisite blocks it. Never the bare "Complete the required previous step".
 */
export function outreachReadiness(input: {
  snapshot: AccountResearchSnapshot;
  hasVerifiedDecisionMaker: boolean;
  companyBrainPresent: boolean;
  icpStatus: IcpSnapshot['status'];
}): OutreachReadiness {
  if (input.icpStatus === 'excluded') {
    return { ready: false, blocker: 'excluded', message: 'Excluded by a saved disqualifier — skip this account' };
  }
  if (!input.companyBrainPresent) {
    return { ready: false, blocker: 'missing_company_brain', message: 'Complete Company Brain first' };
  }
  if (!hasUsableHydratedResearch(input.snapshot)) {
    return { ready: false, blocker: 'missing_research', message: 'Research this company first' };
  }
  if (!input.hasVerifiedDecisionMaker) {
    return { ready: false, blocker: 'missing_person', message: 'Find a verified decision-maker first' };
  }
  return { ready: true };
}

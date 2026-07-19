// Saved-ICP assessment for a Workbench account. Pure and deterministic.
//
// HONESTY CONSTRAINTS (derived from a read-only production audit)
//
// The saved ICP in production carries industries, company_size, geography,
// buyer_roles and disqualifiers — but NOT buying_moments, exclusions,
// messaging_fit or target_markets.
//
// Company research produces summary, growth_signals, evidence_urls, confidence
// and missing_evidence — but NOT product, target_customers, industry,
// company_size, hiring_signals, funding_signals or sales_motion.
//
// So this engine assesses what is genuinely knowable and reports everything else
// as a missing criterion. It never invents a buying moment, a company size, a
// funding event or a score it cannot support. An "unknown" that is labelled
// unknown is useful; an "unknown" dressed as an assessment is not.

export type IcpFitStatus =
  | 'strong_fit'
  | 'moderate_fit'
  | 'weak_fit'
  | 'insufficient_evidence'
  | 'excluded';

export type BuyerFitStatus = 'verified' | 'probable' | 'missing' | 'mismatch';
export type MomentFitStatus = 'supported' | 'weak' | 'missing';

/** The saved workspace ICP, as stored under company_brain.profile.icp. */
export interface SavedIcp {
  industries?: string[];
  company_size?: string[];
  geographies?: string[];
  buyer_roles?: string[];
  buying_moments?: string[];
  exclusions?: string[];
  disqualifiers?: string[];
  messaging_fit?: string[];
}

export interface IcpCompleteness {
  /** Criteria the saved ICP actually defines. */
  defined: string[];
  /** Criteria absent from the saved ICP — assessment cannot cover these. */
  undefined_criteria: string[];
  complete: boolean;
}

export interface MatchedCriterion {
  criterion: string;
  reason: string;
  evidence_ids: string[];
}

export interface IcpSnapshot {
  status: IcpFitStatus;
  /** Omitted entirely when evidence is insufficient — never a filler number. */
  score?: number;
  company_fit: { status: 'supported' | 'partial' | 'unsupported'; reasons: string[]; evidence_ids: string[] };
  buyer_fit: { status: BuyerFitStatus; reasons: string[] };
  buying_moment_fit: { status: MomentFitStatus; reason?: string; evidence_ids: string[] };
  matched_criteria: MatchedCriterion[];
  missing_criteria: string[];
  disqualifiers: Array<{ disqualifier: string; reason: string }>;
  confidence: 'high' | 'medium' | 'low';
  /** True when this used the workspace's saved ICP (never generic defaults). */
  uses_saved_icp: boolean;
  icp_completeness: IcpCompleteness;
}

export interface AccountFacts {
  /** Company facts the LEAD carries — research does not currently extract these. */
  industry?: string | null;
  employee_count?: number | null;
  company_size_label?: string | null;
  geography?: string | null;
  /** Role family of the VERIFIED decision-maker, when one exists. */
  verified_buyer_role_family?: string | null;
  has_verified_decision_maker: boolean;
  manual_review_count?: number;
  /** Company research state. */
  research_usable: boolean;
  research_confidence?: string | null;
  evidence_ids: string[];
}

const ALL_CRITERIA = ['industries', 'company_size', 'geographies', 'buyer_roles', 'buying_moments'] as const;

function nonEmpty(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

/** Report the saved ICP's coverage truthfully — never fill gaps with defaults. */
export function assessIcpCompleteness(icp: SavedIcp | null | undefined): IcpCompleteness {
  const defined: string[] = [];
  const missing: string[] = [];
  for (const key of ALL_CRITERIA) {
    (nonEmpty((icp ?? {})[key]).length > 0 ? defined : missing).push(key);
  }
  return { defined, undefined_criteria: missing, complete: missing.length === 0 };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function anyMatch(candidates: string[], target: string | null | undefined): string | null {
  if (!target) return null;
  const t = norm(target);
  if (!t) return null;
  for (const c of candidates) {
    const n = norm(c);
    if (!n) continue;
    if (t === n || t.includes(n) || n.includes(t)) return c;
  }
  return null;
}

/**
 * Assess an account against the SAVED ICP.
 *
 * `icp` must come from the workspace's own saved brain. Passing null means no
 * saved ICP exists — the result then reports insufficient_evidence rather than
 * silently applying generic B2B assumptions.
 */
export function buildIcpSnapshot(facts: AccountFacts, icp: SavedIcp | null | undefined): IcpSnapshot {
  const completeness = assessIcpCompleteness(icp);
  const usesSaved = !!icp && completeness.defined.length > 0;

  const matched: MatchedCriterion[] = [];
  const missing: string[] = [];
  const companyReasons: string[] = [];
  const evidence = facts.evidence_ids ?? [];

  // ---- Hard disqualifiers first: they override any positive signal ---------
  const disqualifiers: Array<{ disqualifier: string; reason: string }> = [];
  for (const d of nonEmpty(icp?.disqualifiers)) {
    const hit = anyMatch([d], facts.industry) ?? anyMatch([d], facts.geography);
    if (hit) disqualifiers.push({ disqualifier: d, reason: `Account matches the saved disqualifier "${d}"` });
  }
  for (const e of nonEmpty(icp?.exclusions)) {
    const hit = anyMatch([e], facts.industry) ?? anyMatch([e], facts.geography);
    if (hit) disqualifiers.push({ disqualifier: e, reason: `Account matches the saved exclusion "${e}"` });
  }

  // ---- Company fit ---------------------------------------------------------
  const industries = nonEmpty(icp?.industries);
  if (industries.length === 0) missing.push('industries not defined in saved ICP');
  else if (!facts.industry) missing.push('company industry not verified');
  else {
    const hit = anyMatch(industries, facts.industry);
    if (hit) {
      matched.push({ criterion: 'Industry', reason: `Matches saved target industry "${hit}"`, evidence_ids: evidence });
      companyReasons.push('Target industry');
    } else {
      missing.push('industry outside the saved ICP');
    }
  }

  const sizes = nonEmpty(icp?.company_size);
  if (sizes.length === 0) missing.push('company size not defined in saved ICP');
  else if (facts.employee_count == null && !facts.company_size_label) {
    // Research does not extract company size today — say so rather than guess.
    missing.push('company size not verified');
  } else {
    const hit = anyMatch(sizes, facts.company_size_label ?? String(facts.employee_count));
    if (hit) {
      matched.push({ criterion: 'Company size', reason: `Matches saved size band "${hit}"`, evidence_ids: evidence });
      companyReasons.push('Company size band');
    } else {
      missing.push('company size outside the saved ICP');
    }
  }

  const geos = nonEmpty(icp?.geographies);
  if (geos.length > 0 && facts.geography) {
    const hit = anyMatch(geos, facts.geography);
    if (hit) {
      matched.push({ criterion: 'Geography', reason: `Matches saved geography "${hit}"`, evidence_ids: evidence });
      companyReasons.push('Geography');
    }
  } else if (geos.length === 0) {
    missing.push('geography not defined in saved ICP');
  }

  // ---- Buyer fit — the one dimension that is reliably computable today -----
  const buyerRoles = nonEmpty(icp?.buyer_roles);
  let buyer_fit: IcpSnapshot['buyer_fit'];
  if (!facts.has_verified_decision_maker) {
    buyer_fit = {
      status: (facts.manual_review_count ?? 0) > 0 ? 'probable' : 'missing',
      reasons: (facts.manual_review_count ?? 0) > 0
        ? ['Profiles found but current employment is unverified']
        : ['No verified decision-maker yet'],
    };
  } else if (buyerRoles.length === 0) {
    buyer_fit = { status: 'verified', reasons: ['Verified decision-maker found; saved ICP defines no buyer roles to match'] };
  } else {
    const hit = anyMatch(buyerRoles, facts.verified_buyer_role_family ?? null);
    buyer_fit = hit
      ? { status: 'verified', reasons: [`Verified decision-maker matches saved buyer role "${hit}"`] }
      : { status: 'mismatch', reasons: ['Verified decision-maker is outside the saved buyer roles'] };
    if (hit) matched.push({ criterion: 'Buyer role', reason: `Verified buyer matches "${hit}"`, evidence_ids: [] });
  }

  // ---- Buying moment — no saved moments means MISSING, never invented ------
  const moments = nonEmpty(icp?.buying_moments);
  const buying_moment_fit: IcpSnapshot['buying_moment_fit'] = moments.length === 0
    ? { status: 'missing', reason: 'No buying moments defined in the saved ICP', evidence_ids: [] }
    : { status: 'missing', reason: 'No verified current trigger', evidence_ids: [] };
  if (moments.length === 0) missing.push('buying moments not defined in saved ICP');

  // ---- Roll-up -------------------------------------------------------------
  if (disqualifiers.length > 0) {
    return {
      status: 'excluded',
      company_fit: { status: 'unsupported', reasons: companyReasons, evidence_ids: evidence },
      buyer_fit,
      buying_moment_fit,
      matched_criteria: matched,
      missing_criteria: missing,
      disqualifiers,
      confidence: 'high',
      uses_saved_icp: usesSaved,
      icp_completeness: completeness,
    };
  }

  const assessable = completeness.defined.length;
  const insufficient = !usesSaved || !facts.research_usable || matched.length === 0;

  let status: IcpFitStatus;
  if (insufficient) status = 'insufficient_evidence';
  else if (matched.length >= 3 && buyer_fit.status === 'verified') status = 'strong_fit';
  else if (matched.length >= 2) status = 'moderate_fit';
  else status = 'weak_fit';

  // A score is only meaningful with enough matched criteria to divide by.
  const score = insufficient || assessable === 0
    ? undefined
    : Math.round((matched.length / assessable) * 100);

  const confidence: IcpSnapshot['confidence'] = insufficient
    ? 'low'
    : (matched.length >= 3 && facts.research_confidence === 'high' ? 'high' : 'medium');

  return {
    status,
    ...(score !== undefined ? { score } : {}),
    company_fit: {
      status: companyReasons.length >= 2 ? 'supported' : companyReasons.length === 1 ? 'partial' : 'unsupported',
      reasons: companyReasons,
      evidence_ids: evidence,
    },
    buyer_fit,
    buying_moment_fit,
    matched_criteria: matched,
    missing_criteria: missing,
    disqualifiers,
    confidence,
    uses_saved_icp: usesSaved,
    icp_completeness: completeness,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const ICP_STATUS_COPY: Record<IcpFitStatus, string> = {
  strong_fit: 'Strong fit',
  moderate_fit: 'Moderate fit',
  weak_fit: 'Weak fit',
  insufficient_evidence: 'Insufficient evidence',
  excluded: 'Excluded',
};

/** "ICP fit: 82 / 100 · Strong fit" or "ICP fit: Insufficient evidence". */
export function icpFitLine(s: IcpSnapshot): string {
  const label = ICP_STATUS_COPY[s.status];
  return s.score === undefined ? `ICP fit: ${label}` : `ICP fit: ${s.score} / 100 · ${label}`;
}

/** At most three reasons for the compact cell. */
export function topFitReasons(s: IcpSnapshot, limit = 3): string[] {
  return s.matched_criteria.slice(0, limit).map((m) => m.criterion);
}

/** One missing item for the compact cell. */
export function topMissing(s: IcpSnapshot): string | null {
  return s.missing_criteria[0] ?? null;
}

export interface WhyRelevant {
  why_this_company?: string;
  why_this_person?: string;
  why_now?: string;
  support_level: 'specific' | 'company_level' | 'generic_value_only' | 'none';
}

/**
 * Compact relevance explanation. Never fabricates a timing reason — with no
 * saved buying moments and no fresh trigger, why_now is stated as absent.
 */
export function buildWhyRelevant(s: IcpSnapshot): WhyRelevant {
  const why_this_company = s.matched_criteria.length > 0
    ? `Matches saved ${topFitReasons(s, 2).map((r) => r.toLowerCase()).join(' and ')}`
    : undefined;

  const why_this_person = s.buyer_fit.status === 'verified' ? s.buyer_fit.reasons[0] : undefined;

  const why_now = s.buying_moment_fit.status === 'supported'
    ? s.buying_moment_fit.reason
    : undefined;

  let support_level: WhyRelevant['support_level'] = 'none';
  if (why_now) support_level = 'specific';
  else if (why_this_company && why_this_person) support_level = 'company_level';
  else if (why_this_company) support_level = 'company_level';
  else support_level = 'generic_value_only';

  return { why_this_company, why_this_person, why_now, support_level };
}

export const NO_TRIGGER_COPY = 'No verified current trigger';

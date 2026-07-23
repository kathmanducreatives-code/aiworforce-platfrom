// Lead-quality benchmark — shared type model.
//
// This benchmark evaluates the full Agentory lead-acquisition path against ONE
// fixed query, using the real TEST backend pipeline for the (single) live run
// and cached artifacts for deterministic replay. The types here are shared by
// the guards (env/budget/run-lock), the deterministic audit rubric, and the
// artifact writers.
//
// SAFETY: nothing in this module holds a secret value. Credential *presence* is
// represented as booleans only (see PreflightInput). Raw provider payloads are
// captured verbatim for replay but never include phone numbers or personal
// emails (see RawCandidate — those fields are intentionally absent).

// -------------------------------------------------------------- constants ----

/** The only Supabase project this benchmark is allowed to touch. */
export const TEST_PROJECT_REF = "zbwsbnqqpkvdhqwavjke";
/** Production — the benchmark must terminate before any request if it sees this. */
export const PROD_PROJECT_REF = "wqnigjhcwjxtmordrwno";

/** The fixed benchmark query. Never paraphrased; never changed between runs. */
export const FIXED_QUERY =
  "Founders of SaaS startups hiring Sales Operations in the United States";

/** Hard Apify budget in USD. The run must never intentionally exceed HARD. */
export const APIFY_SOFT_STOP_USD = 4.5;
export const APIFY_HARD_CAP_USD = 5.0;

export type BenchmarkMode = "dry-run" | "live" | "replay";
export type Environment = "production" | "test" | "unknown";

// -------------------------------------------------------- provider limits ----

/**
 * Bounded provider scope. Every field caps the maximum possible provider work,
 * so the upper cost boundary is computable BEFORE any live call.
 */
export interface ApifyLimits {
  /** Max raw company/job results pulled from the jobs actor. */
  rawMaxResults: number;
  /** Max accounts entering full verification/enrichment. */
  verifyMaxAccounts: number;
  /** Max accounts entering founder lookup (people actor). */
  founderLookupMaxAccounts: number;
  /** Max founder candidates fetched per account. */
  founderCandidatesPerAccount: number;
  /** Max final ranked leads reported. */
  finalRankedMax: number;
}

/** Default limits (section 12 suggestion). Adjusted DOWN if pricing requires. */
export const DEFAULT_LIMITS: ApifyLimits = {
  rawMaxResults: 25,
  verifyMaxAccounts: 10,
  founderLookupMaxAccounts: 8,
  founderCandidatesPerAccount: 2,
  finalRankedMax: 10,
};

// ------------------------------------------------------------- raw capture ----

/**
 * A raw provider result captured BEFORE normalization (section 4). Contact
 * details that this benchmark must not collect (phone/personal email) are
 * intentionally not part of the shape.
 */
export interface RawCandidate {
  provider: string;
  actorKey: string;
  actorId: string | null;
  actorRunId: string | null;
  rawItemIndex: number;
  sourceUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
  jobTitle: string | null;
  jobDescriptionExcerpt: string | null;
  jobLocation: string | null;
  jobPostingUrl: string | null;
  jobObservedDate: string | null;
  personName: string | null;
  personTitle: string | null;
  personLinkedinUrl: string | null;
  statedCurrentCompany: string | null;
  rawLocation: string | null;
  /** Opaque provider metadata, minus any sensitive contact fields. */
  rawMeta?: Record<string, unknown>;
}

// ------------------------------------------------------- normalized model ----

export interface NormalizedCandidate {
  candidateId: string;
  normalizedCompanyName: string | null;
  canonicalDomain: string | null;
  normalizedPersonName: string | null;
  normalizedJobTitle: string | null;
  /** Coarse job family, e.g. "sales_ops", "rev_ops", "sales_generic". */
  normalizedJobFamily: string | null;
  normalizedLocation: string | null;
  normalizedCountry: string | null;
  companyLinkedinUrl: string | null;
  personLinkedinUrl: string | null;
  sourceDate: string | null;
  evidenceUrl: string | null;
  /** Days since the source date, or null when no date is observable. */
  evidenceFreshnessDays: number | null;
  /** True when the person's stated current employer matches the target company. */
  currentEmployerMatch: boolean;
  /** Stable duplicate keys (account-level + person-level). */
  duplicateKeys: DuplicateKeys;
  /** The raw values are preserved untouched for audit. */
  raw: RawCandidate;
}

export interface DuplicateKeys {
  accountByDomain: string | null;
  accountByLinkedin: string | null;
  accountByNameFallback: string | null;
  personByLinkedin: string | null;
  personByCompanyNameFallback: string | null;
}

// ------------------------------------------------------------- hard gates ----

export type HardGateId =
  | "company_type"
  | "hiring_signal"
  | "us_relevance"
  | "founder_role"
  | "employer_match"
  | "evidence";

export type GateOutcome = "pass" | "fail" | "needs_review";

export type ReasonCode =
  | "not_saas"
  | "hiring_role_mismatch"
  | "stale_hiring_signal"
  | "us_relevance_missing"
  | "founder_role_invalid"
  | "current_employer_mismatch"
  | "evidence_missing"
  | "duplicate_account"
  | "duplicate_person"
  | "insufficient_company_evidence"
  | "insufficient_founder_evidence"
  | "score_inflation"
  | "why_now_unsupported";

export interface HardGateResult {
  id: HardGateId;
  outcome: GateOutcome;
  /** Human-readable justification (e.g. exact matched title + why). */
  detail: string;
  /** Set when the gate did not cleanly pass. */
  reasonCode?: ReasonCode;
}

export interface GateReport {
  candidateId: string;
  gates: HardGateResult[];
  allHardPass: boolean;
  anyNeedsReview: boolean;
  failedCodes: ReasonCode[];
}

// -------------------------------------------------------- secondary signals ----

/** Secondary quality signals, each normalized to 0..1. Never override a gate. */
export interface SecondarySignals {
  b2bRelevance: number;
  companySizeFit: number;
  earlyOrGrowthStage: number;
  recentFunding: number;
  smallRevenueTeam: number;
  activeGtmHiring: number;
  founderLedSalesLikely: number;
  pipelineNeed: number;
  signalRecency: number;
  evidenceQuality: number;
  domainConfidence: number;
}

// -------------------------------------------------------------- audit score ----

export interface BenchmarkScore {
  total: number; // 0..100
  components: Record<string, number>;
}

export type BenchmarkVerdict = "CONTACT" | "WATCH" | "REJECT" | "NEEDS_REVIEW";

export interface WhyNowAudit {
  statement: string | null;
  namesSignal: boolean;
  inventsFacts: boolean;
  distinguishesInference: boolean;
  companySpecific: boolean;
  unsupportedClauses: string[];
  supported: boolean;
}

export interface OutreachAngleAudit {
  angle: string | null;
  referencesSignal: boolean;
  connectsToValue: boolean;
  violations: string[];
  ok: boolean;
}

/** The original Agentory outputs — preserved and reported separately. */
export interface AgentoryOutput {
  leadCandidateId: string | null;
  score: number | null;
  decision: string | null;
  rank: number | null;
  whyNow: string | null;
  outreachAngle: string | null;
}

export type DuplicateStatus = "unique" | "duplicate_account" | "duplicate_person";

/** Full independent evaluation of one candidate. */
export interface BenchmarkEvaluation {
  normalized: NormalizedCandidate;
  gates: GateReport;
  secondary: SecondarySignals;
  benchmarkScore: BenchmarkScore;
  verdict: BenchmarkVerdict;
  whyNow: WhyNowAudit;
  outreachAngle: OutreachAngleAudit;
  duplicateStatus: DuplicateStatus;
  agentory: AgentoryOutput | null;
  /** benchmarkScore.total - agentory.score (null when Agentory score absent). */
  scoreDiff: number | null;
  /** Set when Agentory ranked a hard-gate failure highly. */
  inflationWarning: boolean;
  /** Set when Agentory under-ranked a fully-passing strong lead. */
  underRankWarning: boolean;
}

export interface RankedEvaluation extends BenchmarkEvaluation {
  finalRank: number;
}

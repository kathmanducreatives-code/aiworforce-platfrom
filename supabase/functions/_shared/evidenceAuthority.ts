// HOW STRONG IS THIS FACT, FOR THIS CLAIM?
//
// A normalized provider field is not "proven" or "plausible" in itself. The
// same LinkedIn company record carries an exact `employeeCount` — the provider's
// own count, the best headcount source the catalogue has — and a free-text
// description that says nothing a hard business-model rule may rest on. Status
// was decided inside the adapter (`observationFromCompany`) as one blanket
// verdict per dimension, so every LinkedIn fact was `plausible` and no hard
// profile criterion could ever pass: canary 6e4a93b9 left 3CX pending on
// "headcount 184 is advisory, not proven".
//
// This module owns that judgement, and nothing else does:
//
//   provider observation → normalized field (adapters: facts only)
//     → authorityForEvidence(claim, source, field, observed_at, quality)
//     → EvidenceItem status               (this module)
//     → PASS / FAIL / PENDING             (candidateEligibility: grounding)
//
// ── THE RULES ──────────────────────────────────────────────────────────────
//
// Authority is never "provider === LinkedIn → proven". It is a row in
// AUTHORITY_RULES naming the SOURCE, the FIELD and the CLAIM together, plus the
// quality the fact must have. Anything not named is at most `plausible`, and a
// field that does not speak to the claim at all is `insufficient`.
//
// DISCOVERY STAYS DISCOVERY. The company-search, job-search and YC directory
// rows are candidate generation: they appear in no proving rule, so a search
// result alone can never make a company eligible. Facts are proven by the
// record read AFTER identity resolution (company details by canonical URL), by
// the canonical funding pair, by job evidence, or by a grounded website read.
//
// FRESHNESS is the canonical validity table (`EVIDENCE_VALIDITY_DAYS`), not a
// second copy: a proving fact older than its dimension's validity is
// `plausible`, and the evidence graph retires it as stale once `valid_until`
// passes.
//
// Pure. No network, no clock beyond the caller's `now`.

import { EVIDENCE_VALIDITY_DAYS, type EvidenceDimension, type EvidenceItem } from "./candidateObservation.ts";

export const EVIDENCE_AUTHORITY_VERSION = "evidence-authority-v1" as const;

export type EvidenceAuthority = "proven" | "plausible" | "insufficient";

/** The claims a fact can be weighed for. */
export type AuthorityClaim =
  | "country" | "headquarters" | "headcount" | "company_size" | "industry" | "business_model"
  | "funding_stage" | "recently_funded" | "open_role";

/** What a normalized fact IS — not where it came from. */
export type AuthorityField =
  /** Structured company locations (offices). Presence, never headquarters. */
  | "location_entries"
  /** The provider's own headquarters flag, on exactly one location. */
  | "headquarters_flag"
  /** An exact employee count. */
  | "employee_count"
  /** A provider headcount band ("51-200"). */
  | "employee_count_range"
  /** A provider industry taxonomy label / id. */
  | "industry_taxonomy"
  /** Self-description text on a profile: description, tagline, specialties. */
  | "profile_text"
  /** A business-model statement checked against the company's own website text. */
  | "grounded_statement"
  /** A dated funding record (rounds, completeness). */
  | "funding_record"
  /** An open job posting. */
  | "job_posting";

/** The evidence dimension each claim is read from — whose validity applies. */
const CLAIM_DIMENSION: Readonly<Record<AuthorityClaim, EvidenceDimension>> = Object.freeze({
  country: "geography", headquarters: "geography", headcount: "headcount", company_size: "headcount",
  industry: "industry", business_model: "business_model",
  funding_stage: "funding", recently_funded: "funding", open_role: "hiring",
});

/** Which claims a field can speak to AT ALL. Anything else is `insufficient`. */
const FIELD_SPEAKS_TO: Readonly<Record<AuthorityField, readonly AuthorityClaim[]>> = Object.freeze({
  location_entries: ["country"],
  headquarters_flag: ["headquarters", "country"],
  employee_count: ["headcount", "company_size"],
  employee_count_range: ["headcount", "company_size"],
  industry_taxonomy: ["industry"],
  profile_text: ["business_model", "industry"],
  grounded_statement: ["business_model", "industry"],
  funding_record: ["funding_stage", "recently_funded"],
  job_posting: ["open_role"],
});

export interface AuthorityQuality {
  /** A single, exact value (an employee COUNT, not a band). */
  exact?: boolean;
  /** Every entry carries a structured country, so the country is read, not guessed. */
  structured_country?: boolean;
  /** Exactly one entry is flagged headquarters by the provider. */
  single_headquarters_flag?: boolean;
  /** The grounder's own decision on a website statement. */
  grounding?: "accepted" | "review";
}

/** One proving rule: this source's field proves this claim, given this quality. */
interface AuthorityRule {
  id: string;
  sources: readonly string[];
  field: AuthorityField;
  claims: readonly AuthorityClaim[];
  requires?: (q: AuthorityQuality) => boolean;
  why: string;
}

/**
 * The company record read by canonical LinkedIn URL AFTER identity resolution.
 * Not the company-search or job-search row: those are discovery.
 */
const COMPANY_RECORD = ["apify_linkedin_company_details"] as const;
const FUNDING_PAIR = ["apify_funding_atomus", "apify_funding_pvalyou", "funding_corroboration"] as const;

export const AUTHORITY_RULES: readonly AuthorityRule[] = Object.freeze([
  { id: "li_record_exact_headcount", sources: COMPANY_RECORD, field: "employee_count", claims: ["headcount", "company_size"],
    requires: (q) => q.exact === true,
    why: "the provider's own exact employee count on the company record" },
  { id: "li_record_structured_country", sources: COMPANY_RECORD, field: "location_entries", claims: ["country"],
    requires: (q) => q.structured_country === true,
    why: "structured company locations, each with its country — presence in a market, not headquarters" },
  { id: "li_record_flagged_headquarters", sources: COMPANY_RECORD, field: "headquarters_flag", claims: ["headquarters", "country"],
    requires: (q) => q.single_headquarters_flag === true,
    why: "exactly one location flagged headquarters by the provider" },
  { id: "grounded_website_statement", sources: ["grounded_evidence_evaluation", "firecrawl"], field: "grounded_statement",
    claims: ["business_model", "industry"], requires: (q) => q.grounding === "accepted",
    why: "the company's own website text, quoted and verified by the grounder" },
  { id: "canonical_funding_pair", sources: FUNDING_PAIR, field: "funding_record", claims: ["funding_stage", "recently_funded"],
    why: "the canonical funding route (atomus completeness, pvalyou citation)" },
  { id: "job_evidence", sources: ["apify_linkedin_job_search", "apify_yc_companies_memo23", "job_board"], field: "job_posting",
    claims: ["open_role"], why: "a dated open job posting" },
]);

/**
 * Sources that cannot speak to a claim WHATEVER field they carry.
 *
 * A company profile is not a funding history and not a job board: whatever a
 * LinkedIn record says about rounds or openings is a snapshot of a profile, not
 * evidence of an event. The canonical routes (the funding pair, job evidence)
 * answer those claims; the record is `insufficient` for them.
 */
export const SOURCE_CANNOT_SPEAK: readonly { sources: readonly string[]; claims: readonly AuthorityClaim[]; why: string }[] =
  Object.freeze([
    { sources: [...COMPANY_RECORD, "apify_linkedin_company_search"], claims: ["funding_stage", "recently_funded"],
      why: "a company profile is not a funding history; the canonical funding route answers this" },
    { sources: [...COMPANY_RECORD, "apify_linkedin_company_search"], claims: ["open_role"],
      why: "a company profile is not a job posting; canonical job evidence answers this" },
  ]);

export interface AuthorityInput {
  claim: AuthorityClaim;
  /** The actor/source key that produced the fact (`EvidenceItem.source.actor`). */
  source: string;
  field: AuthorityField;
  observed_at: string | null;
  quality?: AuthorityQuality;
  now?: Date;
}

export interface AuthorityDecision {
  version: typeof EVIDENCE_AUTHORITY_VERSION;
  claim: AuthorityClaim;
  authority: EvidenceAuthority;
  /** The rule that proved it, or why none did. */
  rule: string;
  reason: string;
  /** When a proving fact stops proving, by the canonical validity table. Null = durable. */
  valid_until: string | null;
}

const DAY = 86_400_000;

/**
 * How strong this normalized fact is for this claim.
 *
 * `insufficient` — the field does not speak to the claim (company enrichment
 * for a funding stage). `plausible` — it speaks, but no rule lets it prove
 * (a LinkedIn industry label, a headcount band, a discovery row, a stale fact).
 * `proven` — a named rule's source, field, claim and quality all hold, and the
 * fact is within its validity.
 */
export function authorityForEvidence(i: AuthorityInput): AuthorityDecision {
  const q = i.quality ?? {};
  const dim = CLAIM_DIMENSION[i.claim];
  const days = EVIDENCE_VALIDITY_DAYS[dim];
  const observed = i.observed_at ? Date.parse(i.observed_at) : NaN;
  const valid_until = days == null || !Number.isFinite(observed) ? null : new Date(observed + days * DAY).toISOString();
  const base = { version: EVIDENCE_AUTHORITY_VERSION, claim: i.claim, valid_until };

  const mute = SOURCE_CANNOT_SPEAK.find((m) => m.sources.includes(i.source) && m.claims.includes(i.claim));
  if (mute) {
    return { ...base, authority: "insufficient", rule: "source_cannot_speak_to_claim", reason: mute.why };
  }
  if (!FIELD_SPEAKS_TO[i.field]?.includes(i.claim)) {
    return { ...base, authority: "insufficient", rule: "field_does_not_speak_to_claim",
      reason: `${i.field} says nothing about ${i.claim}` };
  }
  const rule = AUTHORITY_RULES.find((r) =>
    r.field === i.field && r.claims.includes(i.claim) && r.sources.includes(i.source));
  if (!rule) {
    return { ...base, authority: "plausible", rule: "no_proving_rule",
      reason: `${i.source} ${i.field} can suggest ${i.claim} but no rule lets it prove it` };
  }
  if (rule.requires && !rule.requires(q)) {
    return { ...base, authority: "plausible", rule: `${rule.id}:quality_not_met`,
      reason: `${rule.why} — but this fact lacks the required quality (${JSON.stringify(q)})` };
  }
  const now = (i.now ?? new Date()).getTime();
  if (valid_until && Date.parse(valid_until) < now) {
    return { ...base, authority: "plausible", rule: `${rule.id}:stale`,
      reason: `${rule.why} — observed ${i.observed_at}, past its ${days}-day validity` };
  }
  return { ...base, authority: "proven", rule: rule.id, reason: rule.why };
}

/** The EvidenceItem status an authority grants. `insufficient` speaks for nothing. */
export function statusForAuthority(a: EvidenceAuthority): EvidenceItem["status"] {
  return a === "proven" ? "proven" : a === "plausible" ? "plausible" : "unknown";
}

/** The record an item carries of how its status was decided. */
export function authorityRecord(d: AuthorityDecision): NonNullable<EvidenceItem["authority"]> {
  return { version: d.version, claim: d.claim, level: d.authority, rule: d.rule, reason: d.reason };
}

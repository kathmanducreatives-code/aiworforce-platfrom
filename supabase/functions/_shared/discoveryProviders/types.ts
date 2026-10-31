// Multi-provider lead discovery — the shared vocabulary.
//
// Three external data providers sit behind one contract: Apollo (prospect
// discovery), LeadOcean (people + company search, contact data) and Apify (web
// research and signal verification, through the existing actor registry). The
// mission compiler stays the only reader of the user's words; this layer only
// ever sees what it compiled (`requirements.ts`).
//
// Pure types. No network, no database, no Deno APIs.

export type ProviderId = "apollo" | "leadocean" | "apify";
export const PROVIDER_IDS: readonly ProviderId[] = ["apollo", "leadocean", "apify"];

export type ProviderCapability =
  | "company_search"
  | "people_search"
  | "contact_enrichment"
  | "web_research"
  | "signal_verification";

/**
 * A requirement the mission can impose on a lead. Every hard criterion the
 * compiler emits maps to exactly one of these (or to `unmappable`, which no
 * provider can satisfy and which therefore fails closed).
 */
export type FilterKey =
  | "industry"
  | "geography_hq"
  | "geography_person"
  | "employee_range"
  | "company_stage"
  | "business_model"
  | "known_companies"
  | "excluded_company_types"
  | "excluded_geography"
  | "roles"
  | "signal"
  | "unmappable";

export interface Range { min: number | null; max: number | null }

/**
 * A funding EVENT as a provider states it. `roundDate` is set only when the
 * provider gives a full date; a year alone stays a year, so it can never
 * satisfy a dated window ("raised in the last six months").
 */
export interface FundingClaim {
  lastRoundType: string | null;
  lastRoundYear: number | null;
  roundDate: string | null;
  totalUsd: number | null;
  lastRoundUsd: number | null;
}

export interface HardRequirement {
  /** The compiler's criterion id, so every verdict points back at the user's words. */
  criterionId: string;
  key: FilterKey;
  /** Strings for list filters; a Range for employee_range. */
  values: string[] | Range;
  label: string;
  /** Free text for `signal` (e.g. "hiring") and `unmappable` (why). */
  detail?: string;
  /** The criterion was not representable (compiler status other than ok). */
  representable: boolean;
}

export interface DiscoveryRequirements {
  originalQuery: string;
  targetEntity: "company" | "person";
  requestedCount: number;
  hard: HardRequirement[];
  /** Preferences: used to rank, never to admit or reject. */
  preferences: { criterionId: string; label: string; key: FilterKey; values: string[] }[];
  /** Decision-maker titles. Required only when the mission is for people. */
  roles: string[];
  /**
   * Dimensions the user forbade relaxing, in the compiler's canonical vocabulary
   * (geography, industry, business_model, stage, size, role, recency), whichever
   * compiler version produced `disallowed_broadening`.
   */
  forbidBroadening: string[];
  /** Entries that name no dimension: kept for audit, never read as a ban or a permission. */
  forbidBroadeningUnread: string[];
  /**
   * The compiler's own criteria, untouched. The shared qualification engine
   * (`sharedQualification.ts` → `evaluateEligibility`) decides on these, not
   * on the provider-facing `hard` list above.
   */
  criteria: import("../missionCriteria.ts").MissionCriterion[];
}

// ── Provider-side records ───────────────────────────────────────────────────

/** Where one value came from. Kept for every field of every merged record. */
export interface Claim<T = unknown> {
  value: T;
  provider: ProviderId;
  /** The provider's own record id (opaque). */
  recordId: string;
  /** The provider's field name, for audit. */
  sourceField: string;
  /** When Agentory received it. */
  retrievedAt: string;
  /** The provider's own freshness stamp, when it gives one. */
  providerUpdatedAt?: string | null;
}

/** A company as one provider returned it, before merging. */
export interface ProviderCompany {
  provider: ProviderId;
  recordId: string;
  retrievedAt: string;
  providerUpdatedAt?: string | null;
  name?: string | null;
  domain?: string | null;
  linkedinUrl?: string | null;
  /** Human-readable industry labels only. NAICS codes live in naicsSector / naicsPrimary. */
  industry?: string[] | null;
  /** Two-digit NAICS sector code ("54"), as the provider states it. Never an industry label. */
  naicsSector?: string | null;
  /** The one NAICS code the company is filed under ("541511"). */
  naicsPrimary?: string | null;
  keywords?: string[] | null;
  hqCountry?: string | null;
  hqRegion?: string | null;
  hqCity?: string | null;
  employeeCount?: number | null;
  employeeRange?: Range | null;
  foundedYear?: number | null;
  funding?: FundingClaim | null;
  /** Filters this provider reported it did NOT apply to the query that produced this row. */
  ignoredFilters?: FilterKey[];
  /** Filters the provider applied natively to the query that produced this row. */
  assertedFilters?: FilterKey[];
}

export type ContactPointVerification =
  /** The provider says it verified this; Agentory has no independent evidence. */
  | "provider_reported_verified"
  /** The provider returned it with a weaker or no status. */
  | "provider_supplied_unverified"
  /** Agentory holds independent evidence (attached by a separate check). */
  | "independently_verified"
  /** The provider marked it invalid / risky / disposable / do-not-call. */
  | "provider_flagged";

export interface ContactPoint {
  kind: "email" | "phone";
  value: string;
  type?: string | null;
  provider: ProviderId;
  recordId: string;
  providerStatus?: string | null;
  /** The provider's own verification-run date (LeadOcean `verified_batch_date`). */
  providerVerifiedAt?: string | null;
  verification: ContactPointVerification;
  /** Independent evidence; required for `independently_verified`. */
  evidence?: { kind: string; ref: string; at: string }[];
  retrievedAt: string;
}

/** A person as one provider returned it, before merging. */
export interface ProviderPerson {
  provider: ProviderId;
  recordId: string;
  retrievedAt: string;
  providerUpdatedAt?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  /** The CURRENT role's job title. */
  title?: string | null;
  /** The profile headline — the person's own tagline, never read as a title. */
  headline?: string | null;
  seniority?: string | null;
  linkedinUrl?: string | null;
  country?: string | null;
  company?: ProviderCompany | null;
  /**
   * Whether the provider states `company` is the person's CURRENT employer
   * (LeadOcean contact_current_experiences, Apollo's organization). Null when
   * it does not say. A provider's word only: never verified employment.
   */
  employerIsCurrent?: boolean | null;
  /** Flags only (Apollo search returns has_email / has_direct_phone, never values). */
  hasEmail?: boolean | null;
  hasPhone?: boolean | null;
  contactPoints?: ContactPoint[];
  ignoredFilters?: FilterKey[];
  assertedFilters?: FilterKey[];
}

// ── Failures ────────────────────────────────────────────────────────────────

export type ProviderErrorKind =
  | "auth_failed"
  | "forbidden_scope"
  /**
   * The key is valid but the account's PLAN does not include this endpoint
   * (Apollo 403 API_INACCESSIBLE / AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED,
   * observed 2026-10-30 on a Professional (Trial) plan). Never a reason to
   * mark the key invalid.
   */
  | "plan_restricted"
  | "allowance_exhausted"
  | "rate_limited"
  | "outage"
  | "invalid_request"
  | "cursor_expired"
  /** A paid request whose outcome is unknown (timeout after send). Never retried. */
  | "charge_uncertain"
  | "not_connected"
  | "disabled";

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

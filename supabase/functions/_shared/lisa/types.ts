// LISA V2 — the normalized signal record and the shapes the pipeline passes.
//
// Collection → Extraction → Validation → Evidence → Deduplication → Relevance
// → Persistence. Every stage is pure except Collection (a SearchSource) and
// Persistence (a SignalStore); both are injected, so the whole pipeline replays
// offline from recorded fixtures.
//
// STORAGE COMPATIBILITY. A LisaSignal persists as an ordinary `signal_events`
// row (canonical signal_type/category, subject, dedupe_key, occurred_at,
// verification_status, lifecycle_status, source_url) with the extra V2 fields
// under `normalized_value.lisa`. Every existing consumer (Signals feed, ORION,
// clustering) keeps reading the columns it already reads.
//
// PURE. No network, database or Deno APIs.

/** The four categories V2 collects. Extension categories are declared in collectors.ts. */
export const LISA_CATEGORIES = ["hiring", "funding", "expansion", "product_launch"] as const;
export type LisaCategory = typeof LISA_CATEGORIES[number];

/** One search hit as a provider returns it (Firecrawl /v2/search shape). */
export interface SearchHit {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  markdown?: string | null;
  /** Publication date when the provider reports one (ISO). */
  published_at?: string | null;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Null on success; a short machine reason otherwise (timeout, http_502, invalid_response…). */
  error: string | null;
  /** Provider credits the call consumed (0 when refused before sending). */
  credits: number;
}

/** The one provider seam. Firecrawl in production; recorded fixtures in tests. */
export interface SearchSource {
  readonly provider: string;
  search(query: string, opts: { limit: number; signal?: AbortSignal }): Promise<SearchResult>;
}

/** What LISA watches: a named company (competitor / tracked) or the market (ICP). */
export interface WatchSubject {
  kind: "competitor" | "tracked_company" | "market";
  /** Canonical domain for named subjects; null for market watches. */
  domain: string | null;
  /** Display name; for market watches, a short label of the query. */
  name: string;
  /** Where this watch came from: a monitoring_subjects row, an approved Brain competitor, or the ICP. */
  origin: "watchlist" | "brain_competitor" | "icp";
  categories: LisaCategory[];
  /** Minutes between scans (default weekly). */
  cadence_minutes: number;
}

/** A claim extracted from one source. Never invented: every field comes from the hit text. */
export interface Observation {
  category: LisaCategory;
  company_name: string;
  company_domain: string | null;
  title: string;
  description: string;
  /** Category-specific identity of the real-world event (round, location, product, role family…). */
  attributes: Record<string, string | number | null>;
  /** When the source says it happened (ISO), or null when the text gives no date. */
  event_date: string | null;
  source_url: string;
  source_domain: string;
  /** "company_site" when the source is the subject's own domain; "news" otherwise. */
  source_type: "company_site" | "news" | "job_board" | "other";
  excerpt: string;
  /** Denial / retraction / contradiction language found in the source. */
  negation: string | null;
}

export type VerificationLevel =
  | "corroborated"     // ≥ 2 independent sources (domains), none contradicting
  | "self_reported"    // the company's own announcement only
  | "single_source"    // one independent source
  | "contradicted"     // sources disagree, or a source denies it
  | "model_inference"; // reserved: an AI reading with no quotable source (never produced by V2's deterministic path)

export interface Verification {
  level: VerificationLevel;
  independent_sources: number;
  sources: string[];
  contradictions: string[];
  /** True when a source retracts / cancels the claim (lifecycle 'retracted', never current). */
  retracted: boolean;
  /**
   * The value for the signal_events.verification_status column. That column's
   * vocabulary is pinned across the codebase (provider_verified | self_reported |
   * unverified), so `corroborated` is PROJECTED to `provider_verified` for
   * compatibility with every existing reader. The authoritative level is always
   * `normalized_value.lisa.verification.level`, which is counted, never asserted.
   */
  column_status: "provider_verified" | "self_reported" | "unverified";
  confidence: "high" | "medium" | "low";
}

export interface Relevance {
  score: number;
  band: "high" | "medium" | "low" | "excluded";
  reasons: string[];
  why_now: string;
  why_it_matters: string;
  suggested_action: string;
  excluded_by: string | null;
  /** The Company Brain version this was judged against (loader fingerprint). */
  brain_fingerprint: string | null;
  computed_at: string;
}

/** The normalized V2 signal. */
export interface LisaSignal {
  workspace_id: string;
  category: LisaCategory;
  signal_type: string;
  signal_category: string;
  subject_type: "competitor" | "company";
  subject_key: string;
  company_name: string;
  company_domain: string | null;
  title: string;
  description: string;
  event_date: string | null;
  discovered_at: string;
  source_url: string;
  source_type: Observation["source_type"];
  evidence: Array<{
    url: string; domain: string; excerpt: string; observed_at: string; negation: string | null;
    source_type: Observation["source_type"]; attributes: Observation["attributes"];
  }>;
  verification: Verification;
  relevance: Relevance | null;
  dedupe_key: string;
  event_instance: string;
  lifecycle_status: "active" | "stale" | "contradicted" | "retracted";
  collection_method: "lisa_v2_scheduled" | "lisa_v2_on_demand";
  provider: string;
  processing_status: "new" | "updated" | "duplicate";
  watch_origin: WatchSubject["origin"];
}

/** Why an observation or signal was not kept — every drop is counted, none is silent. */
export type DropReason =
  | "missing_source" | "no_company" | "not_an_event" | "generic_page" | "stale"
  | "excluded" | "below_significance" | "invalid_hit";

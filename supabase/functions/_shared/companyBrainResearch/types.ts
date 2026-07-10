// Company Brain Onboarding v3 — research adapter contracts.
//
// One shared shape per research source so the draft generator, the edge
// function, and the review UI all speak the same language. Every adapter is
// evidence-first: it records `source_url`/`source_pages` and an honest
// `confidence`, and it NEVER invents a field it did not read.
//
// Pure types + pure normalizers live beside these. Network calls are injected
// (see `ResearchDeps`) so tests run on fixtures and no provider is ever called.

export type ResearchConfidence = "low" | "medium" | "high";

export type ResearchSourceType =
  | "founder_linkedin"
  | "company_website"
  | "company_linkedin"
  | "ai_draft";

export type ResearchProvider = "apify" | "firecrawl" | "claude" | "manual";

export type ResearchStatus = "pending" | "completed" | "failed";

/** Injected IO so adapters stay pure/testable — no provider runs in tests. */
export interface ResearchDeps {
  /** Run an Apify actor and return its dataset items. */
  runApifyActor?: (actorId: string, input: unknown) => Promise<unknown[]>;
  /** Firecrawl: scrape one URL → markdown/html/metadata. */
  firecrawlScrape?: (url: string) => Promise<FirecrawlPage | null>;
  /** Firecrawl: map a site → candidate URLs. */
  firecrawlMap?: (url: string) => Promise<string[]>;
  /** LLM JSON completion. */
  generateJson?: (args: { system: string; user: string }) => Promise<{ ok: boolean; json?: unknown; error?: string }>;
  /** Resolve a configurable Apify actor id from env (never hardcoded permanently). */
  actorId?: (envName: string, fallback: string) => string;
}

export interface FirecrawlPage {
  url: string;
  title?: string | null;
  markdown?: string | null;
  description?: string | null;
}

// ------------------------------------------------------------ founder ------

export interface FounderExperience {
  title: string;
  company: string;
  duration?: string;
}

export interface FounderEducation {
  school: string;
  degree?: string;
}

export interface FounderResearch {
  name: string;
  headline: string;
  location: string;
  current_role: string;
  current_company: string;
  experience: FounderExperience[];
  education: FounderEducation[];
  skills: string[];
  summary: string;
  /** Facts that make the founder credible (prior exits, notable employers). */
  credibility_signals: string[];
  /** Why this founder's background matters for GTM / the Company Brain. */
  gtm_relevance: string[];
  source_url: string;
  confidence: ResearchConfidence;
  /** What we could not read — never silently treated as absent. */
  missing_evidence: string[];
}

// ------------------------------------------------------------ company ------

export interface CompanyWebsiteResearch {
  company_name: string;
  website: string;
  description: string;
  product_category: string;
  business_model: string;
  target_users_guess: string[];
  features: string[];
  use_cases: string[];
  pricing_signal: string;
  customers_or_segments: string[];
  integrations: string[];
  positioning_claims: string[];
  proof_points: string[];
  careers_signal: string[];
  source_pages: string[];
  confidence: ResearchConfidence;
  missing_evidence: string[];
}

export interface CompanyLinkedInResearch {
  linkedin_url: string;
  industry: string;
  employee_count: string;
  locations: string[];
  company_description: string;
  website: string;
  specialties: string[];
  followers: string;
  confidence: ResearchConfidence;
  missing_evidence: string[];
}

// ------------------------------------------------------- user-typed input ---

export interface FounderInput {
  name: string;
  role: string;
  linkedin_url: string;
  timezone: string;
  first_help_goal: string;
  /** Explicit, per-run consent to enrich from the supplied LinkedIn URL. */
  enrichment_consent: boolean;
}

export interface CompanyInput {
  name: string;
  website_url: string;
  linkedin_url: string;
  description: string;
  stage: string;
  team_size: string;
}

// -------------------------------------------------------------- AI draft ----

/** An inferred claim carries its own evidence + confidence — never bare proof. */
export interface DraftEvidence {
  source_pages: string[];
  linkedin_sources: string[];
  confidence_notes: string[];
}

export interface BrainDraft {
  schema_version: 2;
  setup_status: "in_progress";
  is_draft: true;
  brain_confidence: "weak" | "partial" | "strong";
  company: Record<string, unknown>;
  founder: Record<string, unknown>;
  target_customer: Record<string, unknown>;
  buyer_personas: string[];
  triggers: string[];
  jobs_to_watch: string[];
  competitors: string[];
  tools: string[];
  pain_points: string[];
  positive_examples: string[];
  negative_examples: string[];
  content_angles: string[];
  qualification_rules: Record<string, unknown>;
  brand_voice: Record<string, unknown>;
  positioning: Record<string, unknown>;
  evidence: DraftEvidence;
  missing_fields: string[];
  /** Fields the model inferred with weak support — UI must ask the user. */
  needs_confirmation: string[];
}

// ---------------------------------------------------------------- helpers ---

export function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  const s = asString(v);
  return s ? [s] : [];
}

export function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (x && !seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

/**
 * Confidence from how many independent signals we actually read, penalised by
 * how much evidence is missing. Lots of gaps can never read as "medium".
 */
export function confidenceFrom(signals: number, missing: number): ResearchConfidence {
  if (signals >= 5 && missing === 0) return "high";
  if (signals >= 3 && missing <= 2) return "medium";
  return "low";
}

export function isHttpUrl(u: unknown): boolean {
  const s = asString(u);
  return /^https?:\/\/\S+$/i.test(s);
}

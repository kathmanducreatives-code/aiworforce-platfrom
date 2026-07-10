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

/**
 * Where a claim came from and what it is allowed to mean (Research System v3).
 * Examples and signal demos are first-class tags so they can never be
 * mistaken for customer proof or the product category.
 */
export type ClaimTag =
  | "source_fact"        // read verbatim from a product-defining page
  | "user_input"         // the founder's own words
  | "product_claim"      // what the company says it does
  | "feature"
  | "use_case"
  | "workflow_example"   // an illustrative workflow, not the ICP
  | "signal_example"     // a demo/sample signal, not customer proof
  | "customer_proof"     // numeric result tied to a real customer page
  | "pricing"
  | "integration"
  | "ai_inference"       // we inferred it; must be confirmed
  | "noisy_or_irrelevant"
  | "needs_confirmation";

/** One classified claim with its origin. */
export interface TaggedClaim {
  text: string;
  tag: ClaimTag;
  source_url?: string;
  confidence: ResearchConfidence;
}

/** How a fetched page was classified. Drives what it is allowed to inform. */
export type PageType =
  | "homepage" | "pricing" | "features" | "use_cases" | "customers"
  | "case_study" | "about" | "blog" | "careers" | "docs" | "unrelated";

/**
 * Display-ready evidence for one page. The review UI renders these as cards
 * instead of a soup of chips, and the user can see *why* a page was trusted
 * for one field and ignored for another.
 */
export interface SourceEvidence {
  source_url: string;
  page_type: PageType;
  title: string;
  /** Concrete strings we actually read off this page. */
  extracted_facts: string[];
  /** Brain fields this page was allowed to inform. */
  used_for: string[];
  /** Brain fields this page was deliberately NOT allowed to inform. */
  ignored_for: string[];
  confidence: ResearchConfidence;
  /** Plain-English justification, shown under the card. */
  reason: string;
}

/**
 * A clean "what is this company" pass that runs BEFORE any ICP inference.
 * Getting the product wrong poisons every downstream field, so this stage is
 * conservative and reports ambiguity rather than guessing.
 */
export interface CompanyUnderstanding {
  company_name: string;
  website: string;
  one_line_summary: string;
  product_category: string;
  business_model: string;
  primary_users: string[];
  primary_use_cases: string[];
  key_features: string[];
  main_promise: string;
  pricing_signal: string;
  proof_points: string[];
  integrations: string[];
  evidence: SourceEvidence[];
  confidence: ResearchConfidence;
  missing_evidence: string[];
  /** True when the site's signals conflict or are too thin to commit. */
  ambiguous: boolean;
  /** Fields the user must confirm before we treat them as fact. */
  needs_confirmation: string[];
  // ---- Research System v3 (additive) ----
  /** Illustrative workflows the site walks through — never the ICP by themselves. */
  workflows: string[];
  /** Demo/sample signals and "for example" content, quarantined from proof. */
  examples_detected: string[];
  /** Phrases that hint at who the product targets (never asserted as the ICP). */
  target_customer_hints: string[];
  /** Tools/competitors the site names — hypotheses, not facts. */
  competitors_or_tools_mentioned: string[];
  /** Plain-English reasons the read is ambiguous (empty when it is not). */
  ambiguity_reasons: string[];
  /** Every extracted claim with its origin tag. */
  claims: TaggedClaim[];
}

/** A buyer persona hypothesis. Never asserted as fact without confirmation. */
export interface BuyerPersona {
  title: string;
  role_keywords: string[];
  department: string;
  seniority: string;
  pains: string[];
  cares_about: string[];
  likely_objection: string;
  outreach_angle: string;
  confidence: ResearchConfidence;
  needs_confirmation: boolean;
}

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
  /** Display-ready, per-page evidence cards (Research Quality v2). */
  evidence: SourceEvidence[];
  /** The clean "what is this company" pass that ran before ICP inference. */
  understanding: CompanyUnderstanding;
  /** True when the site's signals conflict or are too thin to commit. */
  ambiguous: boolean;
  needs_confirmation: string[];
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
  // ---- Research System v3 (additive) ----
  company_name: string;
  headquarters: string;
  company_size: string;
  founded: string;
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
  /** Persona titles — the shape CompanyBrainV2 stores. */
  buyer_personas: string[];
  /** Rich persona hypotheses (Research Quality v2). Additive. */
  buyer_persona_profiles: BuyerPersona[];
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
  /** Per-page evidence cards, so the UI can separate facts from guesses. */
  source_evidence: SourceEvidence[];
  /** Claims the repair pass removed because no source supported them. */
  dropped_claims: string[];
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

// -------------------------------------------------------- strict confidence --

export interface ConfidenceInputs {
  /** Distinct PRODUCT-DEFINING pages read (homepage/features/pricing/use_cases/about). */
  strongPages: number;
  /** The user typed a company description we can corroborate against. */
  hasUserInput: boolean;
  /** Extracted facts disagree (e.g. two different product categories). */
  conflicts: boolean;
  /** Count of evidence gaps. */
  missingEvidence: number;
  /** Only the homepage was read — never enough for "high". */
  onlyHomepage: boolean;
  /** No source page at all — the field is pure inference. */
  noSourceProof?: boolean;
}

/**
 * The single place confidence is graded. Deliberately hard to reach "high":
 * it requires MULTIPLE strong pages agreeing, no conflicts, nothing missing,
 * and more than just a homepage. Everything else is medium or low.
 */
export function gradeConfidence(i: ConfidenceInputs): ResearchConfidence {
  if (i.noSourceProof || i.strongPages === 0) return "low";
  if (i.conflicts) return "low";

  const canBeHigh =
    i.strongPages >= 2 &&
    !i.onlyHomepage &&
    i.missingEvidence === 0 &&
    !i.conflicts;
  if (canBeHigh) return "high";

  // One strong page corroborated by the user's own description, or two strong
  // pages with some gaps → medium.
  if ((i.strongPages >= 1 && i.hasUserInput) || i.strongPages >= 2) return "medium";
  return "low";
}

/** Never let a caller claim more confidence than the evidence supports. */
export function capConfidence(claimed: ResearchConfidence, ceiling: ResearchConfidence): ResearchConfidence {
  const rank: Record<ResearchConfidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[claimed] <= rank[ceiling] ? claimed : ceiling;
}

// ------------------------------------------------------------- sanitizing ---

// Model output routinely contains glued chips ("FoundersSales leaders"),
// bullet residue, quotes and stray punctuation. Clean before anything is shown.
//
// Splitting camelCase is dangerous: "RevOps" and "HubSpot" are real words, not
// two glued ones. So we protect known compounds and only split a boundary whose
// left-hand segment is long enough to be a word in its own right.
const PROTECTED_COMPOUNDS = new Set([
  "revops", "salesops", "marketingops", "devops", "devrel", "bizops",
  "github", "gitlab", "hubspot", "linkedin", "youtube", "paypal", "shopify",
  "saas", "iaas", "paas", "openai", "postgresql", "mysql", "javascript", "typescript",
]);

const MIN_SPLIT_LEFT = 5; // "Founders" splits; "Rev" (in RevOps) never does.

function splitGlued(s: string): string {
  if (PROTECTED_COMPOUNDS.has(s.toLowerCase())) return s;
  return s.replace(/([a-z])([A-Z])/g, (m, a: string, b: string, offset: number) => {
    const leftLen = offset + 1; // chars before the boundary within this token
    return leftLen >= MIN_SPLIT_LEFT ? `${a} ${b}` : m;
  });
}

/** Clean one chip: trim bullets/quotes, split glued words, collapse spaces. */
export function cleanChip(v: unknown): string {
  const s = asString(v)
    .replace(/^[\s"'`•\-–—*·]+|[\s"'`•\-–—*·]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  // Split token-by-token so offsets are local to each word.
  return s.split(" ").map(splitGlued).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Clean + drop empties + dedupe (case-insensitive), preserving order.
 * Only arrays and strings are chip sources — a bare number or object is not.
 */
export function cleanChips(v: unknown): string[] {
  const raw: unknown[] = Array.isArray(v) ? v : (typeof v === "string" && v.trim() ? [v] : []);
  return uniq(raw.map(cleanChip).filter((s) => s.length > 1));
}

export function isHttpUrl(u: unknown): boolean {
  const s = asString(u);
  return /^https?:\/\/\S+$/i.test(s);
}

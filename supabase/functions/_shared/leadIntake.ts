// Lead-intake — turns a vague "find me leads" request into either a direct,
// deterministic Scout run (when the brief is complete) or an interactive
// "Lead Search Brief" form payload (when details are missing).
//
// Pure / import-free so it runs under both Deno and `node --experimental-strip-types`.
// Company Brain PREFILLS defaults; explicit user input always wins.

import { matchCompetitors } from "./competitorRegistry.ts";

export type LeadMode = "people" | "companies" | "signals" | "competitor_engagement" | "hiring";

// Canonical lead-engine taxonomy. Every lead workflow maps to one of these.
export type LeadSourceType =
  | "icp_search"
  | "hiring_signal"
  | "linkedin_posts"
  | "linkedin_comments"
  | "competitor_engagement"
  | "people_profiles"
  | "company_search"
  | "memory_refine";

export interface LeadDetails {
  mode: LeadMode | null;
  target_role: string | null;
  industry: string | null;
  location: string | null;
  company_category: string | null;
  buying_signal: string | null;
  count: number | null;
  needs_outreach: boolean;
}

export interface LeadRequest {
  source_type?: LeadSourceType;
  mode: LeadMode;
  target_role?: string;
  industry?: string;
  location?: string;
  company_category?: string;
  company_size?: string;
  stage?: string;
  buying_signal?: string;
  topic?: string;
  competitors?: string[];
  post_url?: string;
  count: number;
  needs_outreach: boolean;
  source_preference?: string;
  original_user_request: string;
  company_brain_context_used: boolean;
  confidence?: number;
  missing_fields?: string[];
}

/** Which sourcing actors/tools are configured in this environment. */
export interface ToolAvailability {
  people: boolean;   // apify_people_search
  comments: boolean; // apify_linkedin_post_comments
  firecrawl: boolean;
}

// Triggers that should open the Lead Search Brief when under-specified.
const LEAD_INTAKE_RE =
  /\b(find\s+me\s+leads|scrape\s+(?:me\s+)?leads(?:\s+for\s+me)?|get\s+me\s+(?:some\s+)?(?:leads|prospects)|find\s+(?:me\s+)?(?:people|prospects|buyers|customers)\b|find\s+people\s+to\s+reach\s+out\s+to|find\s+(?:me\s+)?companies(?:\s+for\s+me)?|find\s+buyers|find\s+leads)\b/i;
// People-by-role asks ("find founders", "find 5 B2B SaaS founders …") also open
// the lead path. Allows a few words between the verb and the role (count,
// industry, adjectives), but the LEAD_EXCLUDE guard below still defers LinkedIn/
// competitor/hiring asks to their Phase 3/4 flows.
const PEOPLE_ROLE_RE =
  /\b(find|get|source)\b[^.!?\n]{0,40}?\b(founders?|co-?founders?|ceos?|ctos?|cfos?|coos?|cmos?|vps?|heads?\s+of\b|operators?|executives?|decision[-\s]?makers?|buyers?)\b/i;
// …unless the ask is clearly a Phase 3/4 LinkedIn/competitor/hiring/engagement
// flow, which the classifier already handles well — don't hijack those.
const LEAD_EXCLUDE_RE = /\b(linkedin|posts?|commenting|comment on|engag\w*|talking about|conversations?|hiring|competitors?|alternatives?)\b/i;

// A NEW sourcing command (find/search/scrape/source + a target). Used to stop
// memory save/refine/enrich handlers from swallowing fresh sourcing briefs that
// happen to contain words like "save"/"signal feed".
const SOURCING_VERB_RE = /\b(find|search|scrape|source|discover)\b/i;
const SOURCING_TARGET_RE = /\b(\d+\s+)?(founders?|co-?founders?|ceos?|ctos?|cfos?|coos?|cmos?|vps?|heads?\s+of\b|operators?|executives?|decision[-\s]?makers?|people|profiles?|prospects?|buyers?|customers?|leads?|companies|accounts?|startups?|orgs?|hiring|job openings?|linkedin\s+posts?|competitors?)\b/i;

export function hasNewSourcingIntent(message: string): boolean {
  const m = message ?? "";
  if (/\bget\s+me\s+(?:some\s+)?(?:leads|prospects)\b/i.test(m)) return true;
  return SOURCING_VERB_RE.test(m) && (SOURCING_TARGET_RE.test(m) || /\bfind\s+\d+\b/i.test(m));
}

// "Save these / save them / keep these results / add to signal feed / mark
// saved / save for later" over the CURRENT result set. The sourcing run already
// persists leads — this is a 0-credit acknowledgement, NOT a new search.
// Callers MUST still guard with !hasNewSourcingIntent(message) so a fresh brief
// like "find 5 founders and save them" routes to sourcing, not here.
const SAVE_EXISTING_RE =
  /\b(?:save|keep|store|add|mark)\b[^.!?]*\b(?:these|those|them|this list|the (?:leads?|results?|list|companies|accounts?|signals?)|to (?:the )?signal feed|for (?:now|later)|saved|signal feed)\b|\b(?:save|keep) (?:these|those|them|it)\b/i;

export function isSaveExistingResultsRequest(message: string): boolean {
  const m = (message ?? "").trim();
  if (!m) return false;
  if (hasNewSourcingIntent(m)) return false; // a fresh sourcing brief wins
  return SAVE_EXISTING_RE.test(m);
}

export function isLeadIntakeRequest(message: string): boolean {
  const m = message ?? "";
  // LinkedIn / competitor / hiring / engagement asks are Phase 3/4 flows the
  // classifier already routes well — never hijack them into the lead form.
  if (LEAD_EXCLUDE_RE.test(m)) return false;
  // A named competitor (e.g. "Clay", "Apollo") means a competitor-tracking flow.
  if (matchCompetitors(m).length > 0) return false;
  return LEAD_INTAKE_RE.test(m) || PEOPLE_ROLE_RE.test(m);
}

const COUNT_RE = /\b(\d{1,3})\b/;
const PEOPLE_HINT = /\b(founders?|ceos?|cto|cfo|coo|cmo|vps?|head of|heads? of|operators?|buyers?|executives?|leaders?|people|profiles?|prospects?|reps?|managers?|directors?|analysts?)\b/i;
const COMPANY_HINT = /\b(companies|accounts?|startups?|orgs?|organi[sz]ations?|businesses)\b/i;
const HIRING_HINT = /\b(hiring|job openings?|recruit(?:ing|ers?)?|roles open|open roles)\b/i;
const COMPETITOR_HINT = /\b(competitors?|competing|alternatives?|switching from|vs\.?\s)\b/i;
const LINKEDIN_HINT = /\b(linkedin (?:posts?|conversations?)|posts? about|conversations? about|engaging|commenting)\b/i;
const OUTREACH_HINT = /\b(draft|write|send)\s+(outreach|emails?|messages?|dms?)\b|also draft outreach|reach out/i;

const ROLE_TERMS: Array<[RegExp, string]> = [
  [/\bfounders?\b/i, "Founder"],
  [/\bco-?founders?\b/i, "Co-founder"],
  [/\bceos?\b/i, "CEO"],
  [/\bctos?\b/i, "CTO"],
  [/\bhead of growth\b/i, "Head of Growth"],
  [/\bvps? of sales|vp sales\b/i, "VP Sales"],
  [/\brevops\b/i, "RevOps"],
  [/\bmarketing (?:lead|manager|head)\b/i, "Marketing Lead"],
  [/\bdata analysts?\b/i, "Data Analyst"],
  [/\boperators?\b/i, "Operator"],
];

const INDUSTRY_TERMS: Array<[RegExp, string]> = [
  [/\bhealthcare|health\s?tech|digital health\b/i, "Healthcare"],
  [/\bb2b saas|saas\b/i, "B2B SaaS"],
  [/\bfintech|financial\b/i, "Fintech"],
  [/\bdeveloper tools|devtools?\b/i, "Developer tools"],
  [/\be-?commerce\b/i, "E-commerce"],
];

// Category is the "what they build/do" phrase (e.g. "AI software", "AI products").
const CATEGORY_RE = /\b(?:building|build|that build|making|sell(?:ing)?|offer(?:ing)?)\s+([a-z0-9][\w\s/+\-]{2,40}?)(?=\s+(?:in|based|for|across|located|companies)\b|[.!?,]|$)/i;
const AI_CATEGORY_RE = /\b(ai (?:software|products?|tools?|agents?|employees?|sdrs?))\b/i;

const LOCATION_TERMS: Array<[RegExp, string]> = [
  [/\b(usa|u\.s\.a?\.?|united states|america)\b/i, "USA"],
  [/\b(uk|united kingdom|britain)\b/i, "UK"],
  [/\bsan francisco|sf bay|bay area\b/i, "San Francisco"],
  [/\bremote\b/i, "Remote"],
  [/\b(global|worldwide|anywhere)\b/i, "Global"],
];

function firstMatch(terms: Array<[RegExp, string]>, text: string): string | null {
  for (const [re, label] of terms) if (re.test(text)) return label;
  return null;
}

/** Parse whatever lead criteria are present in the raw message. */
export function extractLeadDetails(message: string): LeadDetails {
  const m = (message ?? "").trim();

  // Mode: most-specific first.
  let mode: LeadMode | null = null;
  if (COMPETITOR_HINT.test(m)) mode = "competitor_engagement";
  else if (HIRING_HINT.test(m) || (COMPANY_HINT.test(m) && /\bhiring\b/i.test(m))) mode = "hiring";
  else if (LINKEDIN_HINT.test(m)) mode = "signals";
  else if (COMPANY_HINT.test(m) && !PEOPLE_HINT.test(m)) mode = "companies";
  else if (PEOPLE_HINT.test(m)) mode = "people";

  const target_role = firstMatch(ROLE_TERMS, m);
  const industry = firstMatch(INDUSTRY_TERMS, m);
  const location = firstMatch(LOCATION_TERMS, m);

  let company_category: string | null = null;
  const ai = m.match(AI_CATEGORY_RE);
  if (ai) company_category = titleish(ai[1]);
  else {
    const cat = m.match(CATEGORY_RE);
    if (cat && cat[1]) company_category = titleish(cat[1].trim());
  }

  const countMatch = m.match(COUNT_RE);
  const count = countMatch ? clampCount(parseInt(countMatch[1], 10)) : null;

  return {
    mode,
    target_role,
    industry,
    location,
    company_category,
    buying_signal: null,
    count,
    needs_outreach: OUTREACH_HINT.test(m),
  };
}

function titleish(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(25, Math.max(1, Math.floor(n)));
}

/**
 * Enough to run Scout directly (skip the Source Selector). A determined mode +
 * a concrete target. When too vague (e.g. bare "find me leads", "find founders"
 * with no industry/category), we show the Lead Source Selector instead.
 * "Find founders building AI tools for healthcare" → run (people → fallback).
 * "Find me leads" → selector.
 */
export function hasEnoughToRun(d: LeadDetails): boolean {
  if (!d.mode) return false;
  const hasTarget = !!(d.target_role || d.company_category);
  const hasTopic = !!(d.industry || d.company_category || d.target_role);
  if (d.mode === "hiring" || d.mode === "companies") {
    return hasTopic && (!!d.location || !!d.count || !!d.industry);
  }
  if (d.mode === "signals" || d.mode === "competitor_engagement") {
    return hasTopic;
  }
  // people: a concrete role/title PLUS an industry or company category is enough
  // to attempt the search (count defaults to 5, location optional). A bare role
  // ("find founders") with no industry/category is too vague → selector.
  return !!d.target_role && (!!d.industry || !!d.company_category);
}

// ----- Company Brain prefill (defaults only — user input wins) -----

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export interface BrainPrefill {
  mode: LeadMode | null;
  target_role: string | null;
  industry: string | null;
  location: string | null;
  used: boolean;
}

/** Derive form defaults from the Company Brain (flat or structured profile). */
export function brainPrefill(profile: Record<string, unknown> | null | undefined): BrainPrefill {
  const p = obj(profile);
  const icp = obj(p.icp);
  const goals = obj(p.goals);

  const roles = arr(icp.buyer_roles);
  const target_role = roles[0] ?? null;

  const industries = arr(icp.industries);
  const industry = industries[0] ?? str(p.category) ?? str(p.industry) ?? null;

  const location = str(icp.geography) ?? str(p.geography) ?? null;

  // Goal hints → default mode.
  let mode: LeadMode | null = null;
  const goalBlob = [str(goals.gtm), str(goals.hiring), str(goals.competitor_tracking), str(goals.content)].filter(Boolean).join(" ").toLowerCase();
  if (/competitor/.test(goalBlob)) mode = "competitor_engagement";
  else if (/hir(e|ing)/.test(goalBlob)) mode = "hiring";
  else if (roles.length > 0) mode = "people";

  const used = !!(target_role || industry || location || mode);
  return { mode, target_role, industry, location, used };
}

// ----- Form payload (rendered as an interactive card in chat) -----

export interface FormField {
  key: string;
  label: string;
  type: "select" | "text" | "toggle";
  required?: boolean;
  options?: string[];
  value: string | boolean | null;
  placeholder?: string;
}

export interface LeadIntakeForm {
  kind: "lead_intake";
  title: string;
  subtitle: string;
  safety_note: string;
  brain_used: boolean;
  brain_missing: boolean;
  fields: FormField[];
  original_user_request: string;
}

const MODE_OPTIONS = ["People / profiles", "Companies / accounts", "LinkedIn conversations", "Competitor engagement", "Hiring signals"];
const SIGNAL_OPTIONS = ["LinkedIn posts about a problem", "Competitor engagement", "Hiring activity", "Funding / growth signal", "Website/category fit", "Recommend for me"];
const COUNT_OPTIONS = ["5", "10", "25"];
const MODE_LABEL: Record<LeadMode, string> = {
  people: "People / profiles",
  companies: "Companies / accounts",
  signals: "LinkedIn conversations",
  competitor_engagement: "Competitor engagement",
  hiring: "Hiring signals",
};

export function buildLeadIntakeForm(
  details: LeadDetails,
  profile: Record<string, unknown> | null | undefined,
  hasBrain: boolean,
): LeadIntakeForm {
  const pre = brainPrefill(profile);
  const used = pre.used && hasBrain;

  // User input wins over brain prefill.
  const mode = details.mode ?? (used ? pre.mode : null);
  const role = details.target_role ?? (used ? pre.target_role : null);
  const industry = details.industry ?? (used ? pre.industry : null);
  const location = details.location ?? (used ? pre.location : null) ?? "Any / Global";

  return {
    kind: "lead_intake",
    title: "Lead Search Brief",
    subtitle: "Scout will use this to find the right people or companies. We'll save results to Signal Feed. Nothing will be sent.",
    safety_note: "No outreach will be sent.",
    brain_used: used,
    brain_missing: !hasBrain,
    original_user_request: details ? "" : "",
    fields: [
      { key: "mode", label: "Lead type", type: "select", required: true, options: MODE_OPTIONS, value: mode ? MODE_LABEL[mode] : null },
      { key: "target_role", label: "Target role / title", type: "text", value: role, placeholder: "Founder, CEO, Head of Growth, RevOps…" },
      { key: "industry", label: "Industry / niche", type: "text", value: industry, placeholder: "Healthcare, B2B SaaS, Fintech, AI software…" },
      { key: "location", label: "Location", type: "text", value: location, placeholder: "USA, UK, San Francisco, Remote, Global" },
      { key: "company_category", label: "Company type / category", type: "text", value: details.company_category, placeholder: "AI software companies, early-stage SaaS, companies hiring GTM…" },
      { key: "buying_signal", label: "Buying signal", type: "select", options: SIGNAL_OPTIONS, value: "Recommend for me" },
      { key: "count", label: "Count", type: "select", options: COUNT_OPTIONS, value: String(details.count ?? 5) },
      { key: "outreach", label: "Outreach", type: "toggle", value: details.needs_outreach },
    ],
  };
}

// ===========================================================================
// Lead Source Selector — the 7-engine picker shown for vague prompts. Each
// source carries its own dynamic Lead Search Brief field schema (prefilled from
// the Company Brain) plus an availability flag + honest fallback note.
// ===========================================================================

export interface LeadSourceOption {
  source_type: LeadSourceType;
  mode: LeadMode;
  title: string;
  description: string;
  examples: string[];
  available: boolean;
  fallback_note: string | null;
  fields: FormField[];
}

export interface LeadSourceSelector {
  kind: "lead_source_selector";
  title: string;
  subtitle: string;
  safety_note: string;
  brain_used: boolean;
  brain_missing: boolean;
  suggested_source?: LeadSourceType;
  sources: LeadSourceOption[];
  original_user_request: string;
}

const countField = (n?: number | null): FormField =>
  ({ key: "count", label: "Count", type: "select", options: COUNT_OPTIONS, value: String(n ?? 5) });

/** Build the per-source brief fields, prefilled from details + brain. */
function fieldsForSource(
  source: LeadSourceType,
  d: LeadDetails,
  pre: BrainPrefill,
  used: boolean,
  brainCompetitors: string[],
): FormField[] {
  const role = d.target_role ?? (used ? pre.target_role : null);
  const industry = d.industry ?? (used ? pre.industry : null);
  const location = d.location ?? (used ? pre.location : null) ?? "Any / Global";
  const t = (k: string, label: string, value: string | null, placeholder: string, required = false): FormField =>
    ({ key: k, label, type: "text", value, placeholder, required });

  switch (source) {
    case "hiring_signal":
      return [
        t("target_role", "Role type", role, "GTM, SDR, Growth, Marketing, Engineering", true),
        t("location", "Location", location, "USA, UK, Remote, Global"),
        t("industry", "Industry", industry, "B2B SaaS, Fintech, Healthcare"),
        t("stage", "Company stage / size", null, "early-stage, Series A, 1-50"),
        countField(d.count),
      ];
    case "linkedin_posts":
      return [
        t("topic", "Topic / pain", d.company_category, "outbound problems, lead gen pain, AI SDR tools", true),
        t("audience", "Audience", role, "founders, GTM leaders, RevOps"),
        t("location", "Location (optional)", location, "USA, UK, Global"),
        countField(d.count),
      ];
    case "linkedin_comments":
      return [
        t("topic", "Topic / competitor", d.company_category, "outbound automation, Clay alternatives", true),
        t("post_url", "Post URL (optional)", null, "https://www.linkedin.com/posts/…"),
        countField(d.count),
      ];
    case "competitor_engagement":
      return [
        t("competitors", "Competitors", brainCompetitors.join(", ") || null, "Clay, Apollo, Artisan, GojiBerry", true),
        t("company_category", "Category", d.company_category ?? industry, "AI SDR, GTM data, outbound"),
        countField(d.count),
      ];
    case "people_profiles":
      return [
        t("target_role", "Target title", role, "Founder, CEO, Head of Growth", true),
        t("company_category", "Company category", d.company_category, "AI software, early-stage SaaS"),
        t("industry", "Industry", industry, "Healthcare, Fintech, B2B SaaS"),
        t("location", "Location", location, "USA, UK, Remote"),
        countField(d.count),
      ];
    case "company_search":
      return [
        t("company_category", "Company category", d.company_category, "AI software, digital health startups", true),
        t("industry", "Industry", industry, "Healthcare, Fintech"),
        t("location", "Location", location, "USA, UK, Global"),
        t("stage", "Stage / size", null, "early-stage, Series A, 1-50"),
        countField(d.count),
      ];
    case "icp_search":
    default:
      return [
        { key: "mode", label: "People or companies", type: "select", required: true, options: ["People / profiles", "Companies / accounts"], value: d.mode === "companies" ? "Companies / accounts" : (d.mode ? "People / profiles" : null) },
        t("target_role", "Role / title", role, "Founder, Head of Growth"),
        t("industry", "Industry", industry, "B2B SaaS, Healthcare"),
        t("location", "Location", location, "USA, UK, Global"),
        t("company_category", "Company category", d.company_category, "AI software, early-stage SaaS"),
        countField(d.count),
      ];
  }
}

/**
 * Build the Lead Source Selector (7 engines). Sources whose actor is not
 * configured stay visible but are flagged unavailable with an honest fallback.
 */
export function buildLeadSourceSelector(
  details: LeadDetails,
  profile: Record<string, unknown> | null | undefined,
  hasBrain: boolean,
  availability: ToolAvailability,
): LeadSourceSelector {
  const pre = brainPrefill(profile);
  const used = pre.used && hasBrain;
  const brainCompetitors = arr(obj(obj(profile).competitors).known)
    .concat(arr(obj(profile).competitors));

  const def = (
    source: LeadSourceType, mode: LeadMode, title: string, description: string, examples: string[],
    available: boolean, fallback_note: string | null,
  ): LeadSourceOption => ({
    source_type: source, mode, title, description, examples, available, fallback_note,
    fields: fieldsForSource(source, details, pre, used, brainCompetitors),
  });

  const sources: LeadSourceOption[] = [
    def("icp_search", "people", "ICP / normal leads", "Find people or companies matching your ICP.", [], true, null),
    def("hiring_signal", "hiring", "Hiring signals", "Find companies actively hiring roles that signal growth or pain.", ["GTM roles", "SDR roles", "Growth roles", "Engineering roles"], true, null),
    def("linkedin_posts", "signals", "LinkedIn intent posts", "Find people posting about relevant pain points or needs.", ["outbound problems", "lead generation pain", "AI SDR tools", "competitor alternatives"], true, null),
    def("linkedin_comments", "signals", "LinkedIn comments / engagement", "Find people engaging with posts in your category.", ["commenters on AI SDR posts", "people reacting to Clay posts"], availability.comments,
      availability.comments ? null : "Comment-level scraping isn't configured yet — I'll search LinkedIn posts instead."),
    def("competitor_engagement", "competitor_engagement", "Competitor engagement", "Find people talking about or engaging with competitors.", ["people talking about Clay", "comparing Apollo and Clay"], true, null),
    def("people_profiles", "people", "Founder / profile search", "Find individual founders/operators by role, industry, and location.", ["healthcare AI founders", "RevOps leaders in SaaS"], availability.people,
      availability.people ? null : "People/profile search isn't configured yet — I'll find likely founders through LinkedIn engagement instead."),
    def("company_search", "companies", "Company / category search", "Find companies in a category, niche, or market.", ["healthcare AI startups", "early-stage digital health"], true,
      availability.firecrawl ? null : "Website analysis is unavailable, but I'll use your Company Brain / description."),
  ];

  return {
    kind: "lead_source_selector",
    title: "Choose a lead source",
    subtitle: "Scout can find leads from different signals. Pick the source you want to start with. Nothing will be sent.",
    safety_note: "Nothing will be sent.",
    brain_used: used,
    brain_missing: !hasBrain,
    suggested_source: used ? (pre.mode === "competitor_engagement" ? "competitor_engagement" : pre.mode === "hiring" ? "hiring_signal" : pre.mode === "people" ? "people_profiles" : undefined) : undefined,
    sources,
    original_user_request: "",
  };
}

// ----- LeadRequest → execution -----

export function modeFromLabel(label: string | null | undefined): LeadMode {
  const l = (label ?? "").toLowerCase();
  if (l.includes("compan") && !l.includes("hiring")) return "companies";
  if (l.includes("hiring")) return "hiring";
  if (l.includes("competitor")) return "competitor_engagement";
  if (l.includes("linkedin") || l.includes("conversation")) return "signals";
  return "people";
}

export interface LeadToolInput {
  intent: string;
  tool_name: "source_with_apify";
  selected_actor_key: string;
  source_type: string;
  signal_type?: string;
  query: string;
  role_keywords: string[];
  location: string | null;
  max_results: number;
  needs_outreach: boolean;
  needs_enrichment: boolean;
  execution_mode: string;
  reason: string;
  competitors?: string[];
}

/** Map a LeadRequest to a deterministic Scout tool_input. people ≠ jobs. */
export function leadRequestToToolInput(req: LeadRequest): LeadToolInput {
  const count = clampCount(req.count);
  const queryParts = [req.target_role, req.company_category, req.industry, req.location]
    .map((x) => (x ?? "").trim()).filter(Boolean);
  const query = queryParts.join(" ") || req.original_user_request;

  const base = {
    query,
    role_keywords: req.target_role ? [req.target_role.toLowerCase()] : [],
    location: req.location && !/^any/i.test(req.location) ? req.location : null,
    max_results: count,
    needs_outreach: req.needs_outreach,
    needs_enrichment: false,
    execution_mode: req.needs_outreach ? "outreach" : "fast",
  };

  // Source-type wins when present (canonical taxonomy). Falls through to the
  // mode-based mapping below for icp_search / unset source_type.
  switch (req.source_type) {
    case "hiring_signal":
    case "company_search":
      return { ...base, query: query || req.topic || req.company_category || req.original_user_request, intent: "source_companies_hiring", tool_name: "source_with_apify", selected_actor_key: "apify_jobs", source_type: "jobs", reason: `lead brief: ${req.source_type} → jobs actor` };
    case "linkedin_posts":
      return { ...base, query: req.topic || query, intent: "signal_sourcing", tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts", source_type: "linkedin_engagement", signal_type: "linkedin_engagement", reason: "lead brief: linkedin intent posts" };
    case "linkedin_comments":
      // Comments need a post; without one (or when the actor is off) the caller
      // falls back to post search. tool_input still names the comments actor.
      return { ...base, query: req.topic || req.post_url || query, intent: "extract_commenters", tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_post_comments", source_type: "linkedin_comments", signal_type: "linkedin_engagement", reason: "lead brief: linkedin comments/engagement" };
    case "competitor_engagement":
      return { ...base, query: (req.competitors ?? []).join(", ") || query, competitors: req.competitors ?? [], intent: "signal_sourcing", tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts", source_type: "linkedin_engagement", signal_type: "competitor_engagement", reason: "lead brief: competitor engagement" };
    case "people_profiles":
      return { ...base, intent: "source_people", tool_name: "source_with_apify", selected_actor_key: "apify_people_search", source_type: "people_profiles", reason: "lead brief: people/profile search" };
    case "icp_search":
    case "memory_refine":
    case undefined:
    default:
      break; // fall through to mode-based mapping
  }

  switch (req.mode) {
    case "hiring":
    case "companies":
      // Only hiring/company-hiring uses the Jobs actor.
      return { ...base, intent: "source_companies_hiring", tool_name: "source_with_apify", selected_actor_key: "apify_jobs", source_type: "jobs", reason: "lead brief: companies/hiring → jobs actor" };
    case "signals":
      return { ...base, intent: "signal_sourcing", tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts", source_type: "linkedin_engagement", signal_type: "linkedin_engagement", reason: "lead brief: LinkedIn conversations" };
    case "competitor_engagement":
      return { ...base, intent: "signal_sourcing", tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts", source_type: "linkedin_engagement", signal_type: "competitor_engagement", reason: "lead brief: competitor engagement" };
    case "people":
    default:
      // Individual profiles → people search, NEVER the jobs actor.
      return { ...base, intent: "source_people", tool_name: "source_with_apify", selected_actor_key: "apify_people_search", source_type: "people_profiles", reason: "lead brief: individual profiles → people search" };
  }
}

/**
 * Safe LinkedIn-engagement fallback when people/profile search is unavailable.
 * Builds a LinkedIn-post search instruction from the brief (contains "LinkedIn"
 * so it routes to apify_linkedin_posts, never the people actor), capped to count.
 * e.g. "founder AI healthcare software USA" → LinkedIn engagement search.
 */
export function leadRequestToLinkedInFallbackInstruction(req: LeadRequest): string {
  const n = clampCount(req.count);
  const topic = [req.target_role, req.company_category, req.industry, req.location]
    .map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || "founders in your space";
  return `Find ${n} LinkedIn posts about ${topic}. Save them to Signal Feed. Do not send any outreach.`;
}

/** Companies/accounts fallback instruction (jobs/hiring source), capped to count. */
export function leadRequestToCompaniesInstruction(req: LeadRequest): string {
  const n = clampCount(req.count);
  const role = req.target_role || "GTM";
  const ind = req.industry ? ` in ${req.industry}` : "";
  const where = req.location && !/^any/i.test(req.location) ? ` in ${req.location}` : "";
  return `Find ${n} companies hiring ${role} roles${ind}${where}. Save them to Signal Feed. Do not send any outreach.`;
}

/** Humanized, complete instruction that the classifier runs directly (no re-clarify). */
export function leadRequestToInstruction(req: LeadRequest): string {
  const n = clampCount(req.count);
  const who = [req.target_role, req.company_category].filter(Boolean).join(" ");
  const where = req.location && !/^any/i.test(req.location) ? ` in ${req.location}` : "";
  const ind = req.industry ? ` in ${req.industry}` : "";
  const comps = (req.competitors ?? []).filter(Boolean).join(", ");

  // Source-type wins (canonical); falls back to mode for icp_search/unset.
  let subject: string;
  switch (req.source_type) {
    case "hiring_signal":
      subject = `companies hiring ${req.target_role ?? "GTM"} roles${ind}${where}`; break;
    case "company_search":
      subject = `${req.company_category ?? "companies"} companies${ind}${where}`; break;
    case "linkedin_posts":
      subject = `LinkedIn posts about ${req.topic ?? req.company_category ?? req.industry ?? (who || "your space")}${where}`; break;
    case "linkedin_comments":
      subject = `people commenting on ${req.post_url ? `this post: ${req.post_url}` : `posts about ${req.topic ?? req.company_category ?? "your category"}`}`; break;
    case "competitor_engagement":
      subject = `people talking about ${comps || "competitors"}${ind}`; break;
    case "people_profiles":
      subject = `${who || "founders"}${ind}${where}`; break;
    default:
      subject =
        req.mode === "hiring" ? `companies hiring ${req.target_role ?? "GTM"} roles${ind}${where}`
        : req.mode === "companies" ? `${req.company_category ?? "companies"}${ind}${where}`
        : req.mode === "signals" ? `LinkedIn posts about ${req.company_category ?? req.industry ?? (who || "your space")}${where}`
        : req.mode === "competitor_engagement" ? `people talking about ${comps || "competitors"}${ind}`
        : `${who || "founders"}${ind}${where}`;
  }
  const tail = req.needs_outreach
    ? " Save them to Signal Feed and draft outreach for approval (do not send)."
    : " Save them to Signal Feed. Do not send any outreach.";
  return `Find ${n} ${subject}.${tail}`;
}

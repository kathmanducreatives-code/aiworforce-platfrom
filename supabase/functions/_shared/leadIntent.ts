// Lead Intelligence Engine v1 — pure core.
//
//   LeadIntentExtractor → SourceRouter → ActorInputPlanner → (filter/tier)
//
// The point is to SEPARATE the things the old system collapsed:
//   - what the user SELLS  (user_product)        — never a target filter
//   - who they want to TARGET (buyer/company)    — persona / company type
//   - what hiring SIGNAL to search (role family) — drives the jobs query
//   - which SOURCE to run (jobs / people / …)    — drives the provider
//
// Deterministic + import-free (except role library) so it is fully unit-testable.

// ── R1 CLASSIFICATION: COMPATIBILITY ────────────────────────────────────────
//
// `extractLeadIntent` HAS NO LIVE CALLERS. pilot-chat was the last one — the
// confirmation card, the card's threaded `lead_intent`, and the Start path all
// read `leadIntentFromMission` (below) now. What remains here is exercised only
// by leadIntent.test.ts, kept as the executable record of the reading this
// projection replaced.
//
// The rest of this module IS live and stays: `planJobsActorInput` (provider-input
// formatting), `filterHiringCandidates` (post-source filtering) and the source
// router. The Mission deliberately expresses no provider, so that half cannot
// move into it.
//
// DO NOT extend the intent-extraction half. New semantics belong in the Mission.

import {
  classifyRoleFamily, roleFamilyAliases, hiringExcludeTitles,
  roleMatchesFamily, isProfileOrEquityTitle, type RoleFamily,
} from "./roleFamilies.ts";

export type WorkflowType =
  | "company_hiring_sourcing" | "company_icp_sourcing" | "people_sourcing"
  | "decision_maker_discovery" | "linkedin_intent_sourcing"
  | "competitor_signal_sourcing" | "unknown";

export type SourceType =
  | "jobs" | "company_search" | "people" | "linkedin_posts"
  | "comments" | "competitor_mentions" | "existing_accounts";

export interface LeadIntent {
  workflow_type: WorkflowType;
  source_type: SourceType;
  user_product?: { name?: string; category?: string; description?: string };
  target_buyer: string[];
  target_company_type: string[];
  target_industry: string[];
  target_geography: string[];
  target_company_size: string[];
  target_stage: string[];
  hiring_signal: {
    requested: boolean;
    role_family: RoleFamily;
    role_keywords: string[];
    exclude_role_keywords: string[];
  };
  pain_points: string[];
  competitors: string[];
  keywords: string[];
  disqualifiers: string[];
  count: number;
  strictness: "strict" | "balanced" | "broad";
  confidence: number;
  clarification_needed: boolean;
  clarification_question?: string;
  // --- Company-Brain ICP constraints (additive; the prompt sets the SIGNAL, the
  // Brain sets the TARGET COMPANY). All optional so existing callers are unchanged.
  positive_industries?: string[];
  negative_industries?: string[];
  positive_keywords?: string[];
  negative_keywords?: string[];
  excluded_company_sizes?: string[];
  preferred_company_sizes?: string[];
  excluded_company_types?: string[];
  preferred_company_types?: string[];
  target_regions?: string[];
  excluded_regions?: string[];
  funding_stage?: string[];
  company_stage?: string[];
  company_model?: string[];
  remote_preference?: string | null;
  tech_stack?: string[];
  growth_signals?: string[];
  hiring_signals?: string[];
  intent_signals?: string[];
  competitor_keywords?: string[];
  negative_competitors?: string[];
  buyer_roles?: string[];
  exclude_roles?: string[];
  allow_enterprise?: boolean;
}

export interface BrainLite {
  icp?: {
    industries?: string[]; geography?: string; disqualifiers?: string[]; buyer_roles?: string[]; company_size?: string;
    // Extended ICP (all optional).
    negative_industries?: string[]; avoid_industries?: string[];
    company_types?: string[]; excluded_company_types?: string[]; avoid_company_types?: string[];
    regions?: string[]; excluded_regions?: string[];
    funding_stage?: string[]; company_stage?: string[]; company_model?: string[];
    remote_preference?: string | null; tech_stack?: string[];
    keywords?: string[]; negative_keywords?: string[];
    allow_enterprise?: boolean;
  };
  competitors?: string[];
  positioning?: { competitors?: string[] };
  company?: { category?: string; industry?: string };
}

// ---------- detectors ----------

const PRODUCT_RE =
  /\b(?:my|our)\s+([a-z0-9][\w/+\-]*(?:\s+[a-z0-9][\w/+\-]*){0,3}?)\s+(?:product|tool|platform|service|app|solution|company)\b|\b(?:i|we)\s+(?:sell|offer|build|make|run)\s+(?:an?\s+)?([a-z0-9][\w/+\-]*(?:\s+[a-z0-9][\w/+\-]*){0,3})/i;
// Clause that describes selling-to/targeting — strip before parsing the subject.
const TARGET_CLAUSE_RE = /\b(?:so (?:i|we) can|to)\s+(?:target|sell to|reach|pitch|market to|approach)\b[^.?!]*/i;
const HIRING_RE = /\bhiring\b|\blooking to hire\b|\bhire(?:s|ing)?\b|\bopen roles?\b|\bjob openings?\b/i;
const BUYER_RE = /\b(founders?|co-?founders?|ceos?|operators?|owners?)\b/i;
const COMPANY_NOUN_RE = /\b(compan(?:y|ies)|startups?|agenc(?:y|ies)|businesses?|firms?|organi[sz]ations?|brands?|vendors?)\b/i;
const PEOPLE_HEAD_RE = /\b(founders?|co-?founders?|ceos?|ctos?|operators?|heads? of [a-z]+|vps?|directors?|executives?|leaders?|decision[- ]?makers?)\b/i;
const POSTS_RE = /\b(posts?|talking about|discussing|writing about|sharing about|content about)\b/i;
const COMMENTS_RE = /\b(comment(?:ing|ers)?|replies|replying)\b/i;
const COMPETITOR_RE = /\b(competitors?|alternatives? to|switching from|vs\.?|complaints? about)\b/i;
const SELLING_TO_RE = /\b(selling to|sell to|that sell to|whose (?:buyers?|customers?|clients?) are|targeting|market to)\s+([a-z][\w\s/+\-]{2,40})/i;

function uniq(a: string[]): string[] { return Array.from(new Set(a.filter(Boolean))); }
function titleCase(s: string): string { return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim(); }

function extractCount(m: string, fallback = 5): number {
  const mm = m.match(/\b(?:find|get|show|top|first|want)\s+(\d{1,3})\b/i) ?? m.match(/\b(\d{1,3})\s+(?:companies|founders|people|leads|profiles|accounts|results)\b/i);
  const n = mm ? parseInt(mm[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(50, n)) : fallback;
}

const GEO_TERMS: Array<[RegExp, string]> = [
  [/\b(usa|u\.?s\.?a?\.?|united states|america)\b/i, "USA"],
  [/\b(uk|united kingdom|britain)\b/i, "UK"],
  [/\blondon\b/i, "London"],
  [/\b(remote|global|worldwide)\b/i, "Remote"],
];
function extractGeo(m: string): string[] {
  return uniq(GEO_TERMS.filter(([re]) => re.test(m)).map(([, l]) => l));
}

const INDUSTRY_TERMS: Array<[RegExp, string]> = [
  [/\bb2b saas|saas\b/i, "B2B SaaS"],
  [/\bhealthcare|health ?tech|digital health\b/i, "Healthcare"],
  [/\bfintech|financial\b/i, "Fintech"],
  [/\bai\b/i, "AI"],
];

/**
 * Extract a structured LeadIntent from a natural-language lead request.
 * Company Brain backfills geography / industry / disqualifiers when the user
 * left them implicit. Never collapses product/buyer/role/source into one field.
 */
export function extractLeadIntent(opts: { message: string; brain?: BrainLite | null }): LeadIntent {
  const brain = opts.brain ?? {};
  const original = (opts.message ?? "").trim();

  // 1) Pull out what the user SELLS, then strip selling/targeting clauses so the
  //    product (e.g. "AI SaaS") never leaks into the target filters.
  let user_product: LeadIntent["user_product"];
  const pm = original.match(PRODUCT_RE);
  if (pm) {
    const cat = titleCase((pm[1] ?? pm[2] ?? "").trim());
    if (cat) user_product = { category: cat };
  }
  const subject = original.replace(TARGET_CLAUSE_RE, " ").replace(PRODUCT_RE, " ");

  // 2) Buyer / company-type / selling-to persona.
  const target_buyer: string[] = [];
  const target_company_type: string[] = [];
  const sellingTo = subject.match(SELLING_TO_RE);
  const buyerHit = subject.match(BUYER_RE);
  if (buyerHit) target_buyer.push(titleCase(buyerHit[1].replace(/s$/i, "")));
  if (sellingTo) target_buyer.push(titleCase(sellingTo[2].trim().replace(/s$/i, "")));
  if (COMPANY_NOUN_RE.test(subject)) target_company_type.push("Companies");

  // 3) Hiring signal: classify the requested role family from the role phrase.
  const hiringRequested = HIRING_RE.test(subject);
  let role_family: RoleFamily = null;
  if (hiringRequested) {
    // role phrase = text after "hiring (for)" up to a stop word.
    const rp = subject.match(/\bhiring(?:\s+for)?\s+([a-z][\w\s/&+\-]{2,50}?)(?=\s+(?:in|at|for|across|roles?|positions?)\b|[.?!,]|$)/i);
    role_family = classifyRoleFamily(rp?.[1] ?? subject);
  }
  const role_keywords = hiringRequested ? roleFamilyAliases(role_family) : [];
  const exclude_role_keywords = hiringRequested ? hiringExcludeTitles(role_family) : [];

  // 4) Source routing.
  const route = routeSourceType({ subject, hiringRequested, sellingTo: !!sellingTo, role_family });

  // 5) Geography / industry / size / stage (+ Brain backfill).
  const target_geography = uniq([...extractGeo(subject), ...(brain.icp?.geography ? [brain.icp.geography] : [])]);
  const target_industry = uniq([
    ...INDUSTRY_TERMS.filter(([re]) => re.test(subject)).map(([, l]) => l),
    ...(brain.icp?.industries ?? []),
  ]);
  const target_stage = /\b(early-stage|seed|pre-seed|startup)\b/i.test(subject) ? ["early-stage"] : [];

  const strictness: LeadIntent["strictness"] =
    /\bonly\b|\bexactly\b|\bmust\b/i.test(subject) ? "strict"
    : /\bany\b|\bbroad|\binclude/i.test(subject) ? "broad" : "balanced";

  // Confidence + clarification.
  let confidence = 0.85;
  if (route.workflow_type === "unknown") confidence = 0.4;
  if (hiringRequested && !role_family) confidence = 0.55;

  return {
    workflow_type: route.workflow_type,
    source_type: route.source_type,
    user_product,
    target_buyer: uniq(target_buyer),
    target_company_type: uniq(target_company_type),
    target_industry,
    target_geography,
    target_company_size: brain.icp?.company_size ? [brain.icp.company_size] : [],
    target_stage,
    hiring_signal: { requested: hiringRequested, role_family, role_keywords, exclude_role_keywords },
    pain_points: [],
    competitors: uniq([...(brain.competitors ?? []), ...(brain.positioning?.competitors ?? [])]),
    keywords: [],
    disqualifiers: uniq(brain.icp?.disqualifiers ?? []),
    count: extractCount(original),
    strictness,
    confidence,
    // Company-Brain ICP constraints (target company definition).
    positive_industries: target_industry,
    negative_industries: uniq([...(brain.icp?.negative_industries ?? []), ...(brain.icp?.avoid_industries ?? [])]),
    positive_keywords: uniq(brain.icp?.keywords ?? []),
    negative_keywords: uniq(brain.icp?.negative_keywords ?? []),
    excluded_company_types: uniq([...(brain.icp?.excluded_company_types ?? []), ...(brain.icp?.avoid_company_types ?? [])]),
    preferred_company_types: uniq(brain.icp?.company_types ?? []),
    target_regions: target_geography,
    excluded_regions: uniq(brain.icp?.excluded_regions ?? []),
    funding_stage: uniq(brain.icp?.funding_stage ?? []),
    company_stage: uniq([...(brain.icp?.company_stage ?? []), ...target_stage]),
    company_model: uniq(brain.icp?.company_model ?? []),
    remote_preference: brain.icp?.remote_preference ?? null,
    tech_stack: uniq(brain.icp?.tech_stack ?? []),
    competitor_keywords: uniq([...(brain.competitors ?? []), ...(brain.positioning?.competitors ?? [])]),
    buyer_roles: uniq(brain.icp?.buyer_roles ?? []),
    allow_enterprise: brain.icp?.allow_enterprise ?? false,
    clarification_needed: route.workflow_type === "unknown",
    clarification_question: route.workflow_type === "unknown"
      ? "What kind of leads — companies hiring a role, companies in an ICP, individual people/founders, or LinkedIn posts/comments?"
      : undefined,
  };
}

// ── THE SAME DTO, PROJECTED FROM THE CANONICAL MISSION ──────────────────────
//
// `extractLeadIntent` above reads the user's sentence. pilot-chat used its answer
// to fill the confirmation card AND to decide whether a lead card was shown at
// all — so a regex both interpreted the request and gated the interpreter that
// was supposed to interpret it.
//
// This projection fills the same DTO from a decided Mission plus the Company
// Brain. It parses nothing: every semantic field reads a Mission field, and every
// ICP field reads the Brain, exactly as before. The only text it touches are
// already-decided taxonomy terms handed to the role library — the same library
// call `extractLeadIntent` made after its own regex had chosen the phrase.

export interface MissionForLeadIntent {
  original_user_query?: string;
  target_entity?: string;
  requested_output?: string;
  requested_count?: number | null;
  confidence?: number;
  company_profile?: {
    verticals?: string[];
    stages?: string[];
    locations?: string[];
    known_companies?: string[];
  };
  required_signals?: Array<{ type?: string; role_families?: string[] } | null>;
  required_signal_terms?: string[];
  decision_makers?: { roles?: string[] };
  no_broadening_requested?: boolean;
}

/** The lead workflow kind, from the Mission's decided entity and signals. */
function workflowTypeFor(m: MissionForLeadIntent): WorkflowType {
  if (!m.target_entity) return "unknown";
  if (m.requested_output === "social_posts") return "linkedin_intent_sourcing";
  if (m.target_entity === "person") return "people_sourcing";
  const hiring = (m.required_signals ?? []).some((s) => String(s?.type ?? "").includes("hiring"));
  if (m.target_entity === "job" || hiring) return "company_hiring_sourcing";
  return "company_icp_sourcing";
}

/** The provider family each workflow kind sources from. Routing, not reading. */
const SOURCE_FOR_WORKFLOW: Record<WorkflowType, SourceType> = {
  company_hiring_sourcing: "jobs",
  company_icp_sourcing: "company_search",
  people_sourcing: "people",
  decision_maker_discovery: "people",
  linkedin_intent_sourcing: "linkedin_posts",
  competitor_signal_sourcing: "comments",
  unknown: "company_search",
};

/**
 * Project a LeadIntent out of a decided Mission and the Company Brain.
 *
 * Semantic fields — workflow kind, source, persona, industry, geography, stage,
 * hiring signal, role family, count, strictness — come from the Mission.
 * ICP fields — negatives, disqualifiers, competitors, sizes, enterprise policy —
 * come from the Brain, which is where `extractLeadIntent` read them too.
 *
 * `clarification_needed` is always false: a Mission exists, so the request was
 * already interpreted, and asking the user to disambiguate a decided request is
 * the regex's doubt outliving the decision that resolved it.
 */
export function leadIntentFromMission(
  mission: MissionForLeadIntent, brainInput?: BrainLite | null,
): LeadIntent {
  const brain = brainInput ?? {};
  const workflow_type = workflowTypeFor(mission);
  const source_type = SOURCE_FOR_WORKFLOW[workflow_type];

  const signals = (mission.required_signals ?? []).filter(Boolean);
  const hiringRequested = signals.some((s) => String(s?.type ?? "").includes("hiring"));

  // The family the Mission named, from its own record of it: the taxonomy keys
  // it attached to a signal, then the literal terms it preserved verbatim.
  // Underscored keys are normalised into the phrases the role library matches —
  // punctuation handling on a decided field, not a reading of free text.
  let role_family: RoleFamily = null;
  for (const term of [
    ...signals.flatMap((s) => s?.role_families ?? []),
    ...(mission.required_signal_terms ?? []),
  ]) {
    const fam = classifyRoleFamily(String(term ?? "").replace(/[_-]+/g, " "));
    if (fam) { role_family = fam; break; }
  }
  const role_keywords = hiringRequested ? roleFamilyAliases(role_family) : [];
  const exclude_role_keywords = hiringRequested ? hiringExcludeTitles(role_family) : [];

  const verticals = uniq(mission.company_profile?.verticals ?? []);
  const target_industry = uniq([...verticals, ...(brain.icp?.industries ?? [])]);
  const missionLocations = uniq(mission.company_profile?.locations ?? []);
  const target_geography = missionLocations.length
    ? missionLocations
    : uniq(brain.icp?.geography ? [brain.icp.geography] : []);
  const target_stage = uniq(mission.company_profile?.stages ?? []);

  return {
    workflow_type,
    source_type,
    // What the workspace SELLS is workspace configuration. `extractLeadIntent`
    // mined it out of "my … product" phrasing; the Brain simply knows it.
    ...(brain.company?.category ? { user_product: { category: brain.company.category } } : {}),
    target_buyer: uniq(mission.decision_makers?.roles ?? []),
    target_company_type: verticals,
    target_industry,
    target_geography,
    target_company_size: brain.icp?.company_size ? [brain.icp.company_size] : [],
    target_stage,
    hiring_signal: { requested: hiringRequested, role_family, role_keywords, exclude_role_keywords },
    pain_points: [],
    competitors: uniq([...(brain.competitors ?? []), ...(brain.positioning?.competitors ?? [])]),
    keywords: [],
    disqualifiers: uniq(brain.icp?.disqualifiers ?? []),
    count: mission.requested_count ?? DEFAULT_LEAD_INTENT_COUNT,
    // "exactly N", "only", "do not broaden" — the Mission carries this as a
    // decided flag rather than as a phrase list to re-match.
    strictness: mission.no_broadening_requested ? "strict" : "balanced",
    confidence: typeof mission.confidence === "number" ? mission.confidence : 0.85,
    positive_industries: target_industry,
    negative_industries: uniq([...(brain.icp?.negative_industries ?? []), ...(brain.icp?.avoid_industries ?? [])]),
    positive_keywords: uniq(brain.icp?.keywords ?? []),
    negative_keywords: uniq(brain.icp?.negative_keywords ?? []),
    excluded_company_types: uniq([...(brain.icp?.excluded_company_types ?? []), ...(brain.icp?.avoid_company_types ?? [])]),
    preferred_company_types: uniq(brain.icp?.company_types ?? []),
    target_regions: target_geography,
    excluded_regions: uniq(brain.icp?.excluded_regions ?? []),
    funding_stage: uniq(brain.icp?.funding_stage ?? []),
    company_stage: uniq([...(brain.icp?.company_stage ?? []), ...target_stage]),
    company_model: uniq(brain.icp?.company_model ?? []),
    remote_preference: brain.icp?.remote_preference ?? null,
    tech_stack: uniq(brain.icp?.tech_stack ?? []),
    competitor_keywords: uniq([...(brain.competitors ?? []), ...(brain.positioning?.competitors ?? [])]),
    buyer_roles: uniq(brain.icp?.buyer_roles ?? []),
    allow_enterprise: brain.icp?.allow_enterprise ?? false,
    clarification_needed: false,
  };
}

/**
 * The count this DTO shows when the Mission recorded none.
 *
 * Deliberately the same number as `leadMission.DEFAULT_REQUESTED_COUNT`, and
 * deliberately not an import: this module is import-free apart from the role
 * library, and the value is asserted equal by the projection's tests.
 */
export const DEFAULT_LEAD_INTENT_COUNT = 5;

// ---------- SourceRouter ----------

export interface SourceRoute {
  workflow_type: WorkflowType;
  source_type: SourceType;
  provider: string;
  fallback_providers: string[];
  reason: string;
  required_capabilities: string[];
}

function routeSourceType(o: { subject: string; hiringRequested: boolean; sellingTo: boolean; role_family: RoleFamily }): SourceRoute {
  const s = o.subject;
  // Hiring signal → jobs (even when "founders" appear as the company qualifier).
  if (o.hiringRequested) {
    return { workflow_type: "company_hiring_sourcing", source_type: "jobs", provider: "apify_jobs", fallback_providers: [], reason: "active hiring signal requested", required_capabilities: ["apify_jobs"] };
  }
  if (
    COMMENTS_RE.test(s) ||
    /\bcompetitor conversations?\b/i.test(s) ||
    (COMPETITOR_RE.test(s) && /\b(comment|mention|conversation|talking|discuss|chatter|complain)\b/i.test(s))
  ) {
    return { workflow_type: "competitor_signal_sourcing", source_type: "comments", provider: "apify_linkedin_post_comments", fallback_providers: ["apify_linkedin_posts"], reason: "comment / competitor-mention intent", required_capabilities: ["apify_comments"] };
  }
  if (POSTS_RE.test(s)) {
    return { workflow_type: "linkedin_intent_sourcing", source_type: "linkedin_posts", provider: "apify_linkedin_posts", fallback_providers: [], reason: "LinkedIn post / intent intent", required_capabilities: ["apify_posts"] };
  }
  // "companies selling to founders" → company ICP search (buyer is the persona).
  if (o.sellingTo || (COMPANY_NOUN_RE.test(s) && !PEOPLE_HEAD_RE.test(stripSellingTo(s)))) {
    return { workflow_type: "company_icp_sourcing", source_type: "company_search", provider: "apify_jobs", fallback_providers: [], reason: "company / ICP subject", required_capabilities: ["apify_jobs"] };
  }
  // "founders of recruiting agencies" → people search.
  if (PEOPLE_HEAD_RE.test(s)) {
    return { workflow_type: "people_sourcing", source_type: "people", provider: "apify_people_search", fallback_providers: ["apify_linkedin_posts"], reason: "individual person subject", required_capabilities: ["apify_people"] };
  }
  return { workflow_type: "unknown", source_type: "company_search", provider: "apify_jobs", fallback_providers: [], reason: "could not determine source", required_capabilities: [] };
}

function stripSellingTo(s: string): string { return s.replace(SELLING_TO_RE, " "); }

/** Public SourceRouter entry: route an already-extracted intent. */
export function routeSource(intent: LeadIntent): SourceRoute {
  return routeSourceType({
    subject: "",
    hiringRequested: intent.hiring_signal.requested,
    sellingTo: intent.target_buyer.length > 0 && intent.target_company_type.length > 0,
    role_family: intent.hiring_signal.role_family,
  });
}

// ---------- ActorInputPlanner ----------

export interface JobsActorInput {
  query: string;
  role_keywords: string[];
  exclude_keywords: string[];
  location?: string;
  max_results: number;
  date_posted?: "week" | "month" | "any";
  source_notes?: string;
}

/** Build the jobs actor JSON from a hiring intent — OR-joined alias query + excludes. */
export function planJobsActorInput(intent: LeadIntent): JobsActorInput {
  const aliases = intent.hiring_signal.role_keywords.length
    ? intent.hiring_signal.role_keywords
    : roleFamilyAliases(intent.hiring_signal.role_family);
  const query = aliases.length ? aliases.slice(0, 12).map((a) => (/\s/.test(a) ? a : a)).join(" OR ") : (intent.target_industry[0] ?? "");
  return {
    query,
    role_keywords: aliases,
    exclude_keywords: intent.hiring_signal.exclude_role_keywords,
    location: intent.target_geography[0],
    max_results: intent.count,
    date_posted: "month",
    source_notes: `role_family=${intent.hiring_signal.role_family ?? "custom"} strictness=${intent.strictness}`,
  };
}

// ---------- DynamicFilter (role-family hiring filter) ----------

export interface RawCandidate {
  company?: string | null;
  job_title?: string | null;
  title?: string | null;
  source_url?: string | null;
  location?: string | null;
}

export interface FilterTrace {
  stage: string; rule: string; before_count: number; after_count: number;
  rejected_count: number; rejected_reasons: Record<string, number>;
}

export interface HiringFilterResult {
  accepted: RawCandidate[];
  rejected: Array<{ candidate: RawCandidate; reason: string }>;
  trace: FilterTrace[];
}

/**
 * Stage-based hiring filter: source proof → role-family match → negative-title
 * reject → dedupe. Produces a transparent trace. Never accepts a row without an
 * exact role-family hiring signal + source proof.
 */
export function filterHiringCandidates(candidates: RawCandidate[], intent: LeadIntent): HiringFilterResult {
  const fam = intent.hiring_signal.role_family;
  const accepted: RawCandidate[] = [];
  const rejected: Array<{ candidate: RawCandidate; reason: string }> = [];
  const trace: FilterTrace[] = [];
  const seen = new Set<string>();

  const stage = (name: string, rule: string, before: number, kept: RawCandidate[], reasons: Record<string, number>) =>
    trace.push({ stage: name, rule, before_count: before, after_count: kept.length, rejected_count: before - kept.length, rejected_reasons: reasons });

  let pool = candidates ?? [];

  // 1) source proof — must be a REAL url (reject empty + the "proof_incomplete"
  // placeholder, which signals a row that never had a verifiable job/source link).
  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => {
    const u = (c.source_url ?? "").trim().toLowerCase();
    const ok = !!u && u !== "proof_incomplete" && u !== "null" && u !== "undefined";
    if (!ok) { r1["no source proof"] = (r1["no source proof"] ?? 0) + 1; rejected.push({ candidate: c, reason: "no source proof" }); }
    return ok;
  });
  stage("source_proof", "must have a real job/source URL (not proof_incomplete)", pool.length, kept, r1); pool = kept;

  // 2) job_title present  3) role-family match  4) negative profile/equity title
  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    const title = (c.job_title ?? c.title ?? "").trim();
    if (!title) { r2["missing job_title"] = (r2["missing job_title"] ?? 0) + 1; rejected.push({ candidate: c, reason: "missing job_title / exact hiring signal" }); return false; }
    if (isProfileOrEquityTitle(title)) { r2["profile/equity title"] = (r2["profile/equity title"] ?? 0) + 1; rejected.push({ candidate: c, reason: "profile/equity title (not a hiring signal)" }); return false; }
    if (fam && !roleMatchesFamily(title, fam)) { r2["wrong role"] = (r2["wrong role"] ?? 0) + 1; rejected.push({ candidate: c, reason: `wrong role (not ${fam})` }); return false; }
    return true;
  });
  stage("role_match", `title must match ${fam ?? "requested role"} and not be a founder/equity title`, pool.length, kept, r2); pool = kept;

  // 4) dedupe (company + title + url)
  let r4: Record<string, number> = {};
  kept = pool.filter((c) => {
    const key = `${(c.company ?? "").toLowerCase()}|${(c.job_title ?? c.title ?? "").toLowerCase()}|${c.source_url ?? ""}`;
    if (seen.has(key)) { r4["duplicate"] = (r4["duplicate"] ?? 0) + 1; rejected.push({ candidate: c, reason: "duplicate" }); return false; }
    seen.add(key); return true;
  });
  stage("dedupe", "same company + title + source URL", pool.length, kept, r4);

  for (const c of kept) accepted.push(c);
  return { accepted, rejected, trace };
}

/** Map a 0-100 fit score to the engine's A/B/C tiering. */
export function tierFromScore(score: number, hasSourceProof: boolean): "A" | "B" | "C" | "rejected" {
  if (!hasSourceProof) return "C";
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "rejected";
}

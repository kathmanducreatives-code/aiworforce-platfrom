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
}

export interface BrainLite {
  icp?: { industries?: string[]; geography?: string; disqualifiers?: string[]; buyer_roles?: string[]; company_size?: string };
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
    competitors: [],
    keywords: [],
    disqualifiers: uniq(brain.icp?.disqualifiers ?? []),
    count: extractCount(original),
    strictness,
    confidence,
    clarification_needed: route.workflow_type === "unknown",
    clarification_question: route.workflow_type === "unknown"
      ? "What kind of leads — companies hiring a role, companies in an ICP, individual people/founders, or LinkedIn posts/comments?"
      : undefined,
  };
}

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
  if (COMMENTS_RE.test(s) || (COMPETITOR_RE.test(s) && /\bcomment|mention/i.test(s))) {
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

  // 1) source proof
  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => { const ok = !!(c.source_url && c.source_url.trim()); if (!ok) { r1["no source proof"] = (r1["no source proof"] ?? 0) + 1; rejected.push({ candidate: c, reason: "no source proof" }); } return ok; });
  stage("source_proof", "must have a job/source URL", pool.length, kept, r1); pool = kept;

  // 2) role-family match  3) negative profile/equity title
  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    const title = c.job_title ?? c.title ?? "";
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

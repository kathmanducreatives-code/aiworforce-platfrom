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

/** Deduplicate and drop blanks. Used by the mission projection below. */
function uniq(a: string[]): string[] { return Array.from(new Set(a.filter(Boolean))); }

// ── THE ENGLISH-PARSING HALF IS GONE ────────────────────────────────────────
//
// `extractLeadIntent(message)` lived here: ~170 lines of regex tables —
// PRODUCT_RE, HIRING_RE, BUYER_RE, GEO_TERMS, INDUSTRY_TERMS — that read a
// user's sentence and decided what kind of lead request it was.
//
// It had already been disconnected from every caller: `compileCanonicalLeadMission`
// stopped gating on it, the delegation path stopped re-parsing with it, and the
// card stopped deriving its fields from it. What remained was a second reader of
// the user's language sitting one import away from the path that decides what
// gets bought, kept alive only by its own tests.
//
// WHAT STAYS is everything below, and none of it reads English:
// `leadIntentFromMission` PROJECTS a compiled mission into this shape,
// `routeSource` and `planJobsActorInput` turn that projection into provider
// input, and `filterHiringCandidates` scores results. They are execution
// contracts that happen to share the word "intent" with a classifier — which is
// exactly why deleting by name would have been wrong.
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

// ── THE SOURCE ROUTER IS GONE TOO ───────────────────────────────────────────
//
// `routeSource` / `routeSourceType` decided which provider surface a request
// belonged to by running six regexes — COMPANY_NOUN_RE, PEOPLE_HEAD_RE,
// POSTS_RE, COMMENTS_RE, COMPETITOR_RE, SELLING_TO_RE — over a subject string.
// Nothing had called it since the capability graph became the router, and a
// dead second router one import from the live one is a standing invitation to
// reconnect it. Provider selection is decided by `buildCapabilityGraph` and the
// actor registry, from a compiled mission, and by nothing that reads English.

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

// THE CANONICAL LEAD MISSION — one typed object, one authority.
//
// WHAT THIS REPLACES.
//
// A lead request used to travel as FIVE strings — `original_instruction`,
// `input`, `instruction`, `tool_input.query`, `tool_input.user_request` — written
// by different layers and read by different layers. Three separate authorities
// then re-derived intent from whichever string they happened to prefer:
// `routeQualifiedLead` in pilot-chat, `parseLeadEntityIntent` in run-agent, and
// `inferRouteFromRequest` in the route contract.
//
// On TEST task 8af17651-5fa2-48e2-af87-4bc923146243 that cost a whole run. The
// user asked for "founders of SaaS startups"; orchestrate rewrote the step
// instruction to "Find 5 jobs matching: Sales Operations OR ..."; the rewrite
// carries no company-stage word; route inference preferred it and resolved
// `general_company_first`. The preview card still showed the user's own sentence,
// because it reads a different carrier. Nothing was logged as wrong.
//
// A mission is INTERPRETED ONCE and then executed. `original_user_query` is
// immutable and is never the thing a planner rewrites.
//
// WHAT THIS DOES NOT REPLACE.
//
// The good contracts stay where they are and are imported, not copied:
//   * `companyBrainEffectivePolicy` still owns constraint compilation and is the
//     only place that decides what the Brain may tighten.
//   * `hiringActorCatalog` still owns Actor ids, enums and input limits.
//   * `companyFirstStages` still owns stage semantics and the fit gate.
//   * `hiringRouteContract` keeps its closed source sets for legacy tasks.
// This module owns the MISSION and nothing else.
//
// PURE. No network, provider, model or database access.

import { canonicalJson, sha256Hex } from "./planHash.ts";
import type { CapabilityId } from "./leadCapabilityGraph.ts";

export const LEAD_MISSION_VERSION = "lead-mission-v1" as const;

// ------------------------------------------------------------ provenance ----

/**
 * WHERE A FIELD CAME FROM. Ordered by authority, strongest first.
 *
 * This exists so "the Brain quietly added Recruiting Agencies" is a question with
 * an answer rather than an argument. Every field the gates enforce carries one.
 */
export const PROVENANCE_ORDER = [
  "explicit_user_request",
  "workflow_edit",
  "company_brain",
  "system_default",
  "gpt_inference",
] as const;

export type FieldProvenance = typeof PROVENANCE_ORDER[number];

/** Lower index = stronger. A weaker source may FILL a field, never overwrite it. */
export function provenanceRank(p: FieldProvenance): number {
  const i = PROVENANCE_ORDER.indexOf(p);
  return i < 0 ? PROVENANCE_ORDER.length : i;
}

export function outranks(a: FieldProvenance, b: FieldProvenance): boolean {
  return provenanceRank(a) < provenanceRank(b);
}

// --------------------------------------------------------------- mission ----

export type TargetEntity = "company" | "person" | "job";

export type MissionType =
  | "qualified_lead_sourcing"
  | "company_research"
  | "job_research"
  | "known_company_enrichment";

export type RequestedOutput =
  | "contact_ready_leads"
  | "qualified_companies"
  | "job_listings"
  | "enriched_companies";

export interface MissionSignal {
  /** e.g. "hiring", "funding", "expansion", "leadership_change", "technology". */
  type: string;
  role_families?: string[];
  timeframe_days?: number;
}

export interface MissionCompanyProfile {
  business_models: string[];
  verticals: string[];
  stages: string[];
  locations: string[];
  employee_range?: { min?: number; max?: number };
  /** Supplied domains/names. Non-empty means discovery is SKIPPED. */
  known_companies?: string[];
}

export interface MissionDecisionMakers {
  roles: string[];
  current_employment_required: boolean;
}

/**
 * The interpreting model's JUDGEMENT about the query, carried forward whole.
 *
 * Optional, because a deterministically-parsed mission has none. Present, it is
 * what every later stage must obey instead of re-deriving its own idea of what
 * the query wanted — the failure this whole compiler exists to remove.
 *
 * Deliberately NOT part of `missionHash`. The hash answers "is this the same
 * question?", and the question is the query, profile, signals and capabilities.
 * Directives are guidance about how to judge the answer; folding them in would
 * invalidate the resume state of every run whose guidance was reworded.
 */
export interface MissionDirectives {
  preferred_signals: string[];
  adjacent_signals: string[];
  excluded_signals: string[];
  required_evidence: string[];
  allowed_broadening: {
    role_families: string[];
    company_types: string[];
    geographies: string[];
    employee_range: { min: number | null; max: number | null };
  };
  disallowed_broadening: string[];
  evaluation_instructions: string;
  source_strategy: string[];
  requested_contact_ready_count: number | null;
  founder_unlock_recommended: boolean;
}

export interface LeadMissionV1 {
  version: typeof LEAD_MISSION_VERSION;
  /** IMMUTABLE. The user's words, never a planner rewrite. */
  original_user_query: string;
  mission_type: MissionType;
  target_entity: TargetEntity;
  requested_output: RequestedOutput;
  requested_count: number;

  company_profile: MissionCompanyProfile;
  required_signals: MissionSignal[];
  decision_makers: MissionDecisionMakers;

  hard_constraints: Record<string, unknown>;
  soft_preferences: Record<string, unknown>;

  required_capabilities: CapabilityId[];
  prohibited_capabilities: CapabilityId[];

  field_provenance: Record<string, FieldProvenance>;
  confidence: number;
  /** Set only on the model-compiled path. See {@link MissionDirectives}. */
  directives?: MissionDirectives;
}

/** Structural guard. Used to decide mission-path vs legacy-carrier path. */
export function isLeadMissionV1(x: unknown): x is LeadMissionV1 {
  if (!x || typeof x !== "object") return false;
  const m = x as Record<string, unknown>;
  return m.version === LEAD_MISSION_VERSION &&
    typeof m.original_user_query === "string" &&
    m.original_user_query.trim().length > 0 &&
    typeof m.company_profile === "object" && m.company_profile !== null &&
    Array.isArray(m.required_capabilities);
}

/** Stable identity of a mission, for idempotency and drift detection. */
export async function missionHash(m: LeadMissionV1): Promise<string> {
  return await sha256Hex(canonicalJson({
    v: m.version,
    q: m.original_user_query,
    t: m.mission_type,
    e: m.target_entity,
    o: m.requested_output,
    n: m.requested_count,
    c: m.company_profile,
    s: m.required_signals,
    d: m.decision_makers,
    rc: [...m.required_capabilities].sort(),
    pc: [...m.prohibited_capabilities].sort(),
  }));
}

// ---------------------------------------------- deterministic parsing -------
//
// The FALLBACK interpreter, and the reference the model is validated against. It
// reads only the user's own sentence — never a rewrite — so it cannot reproduce
// the failure this module exists to remove.

const STAGE_MARKERS = [
  "yc", "y combinator", "ycombinator", "startup", "start-up", "early stage",
  "early-stage", "seed stage", "seed-stage", "venture backed", "venture-backed",
  "pre-seed", "series a", "founding team",
];

const FOUNDER_MARKERS = ["founder", "co-founder", "cofounder", "ceo", "owner"];

const VERTICAL_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bb2b saas\b/, "b2b saas"],
  [/\bai saas\b/, "ai saas"],
  [/\bsaas\b/, "saas"],
  [/\bfintech\b/, "fintech"],
  [/\bcyber ?security\b/, "cybersecurity"],
  [/\bhealth ?tech\b/, "healthtech"],
  [/\be-?commerce\b/, "ecommerce"],
  [/\bmanufactur\w*\b/, "manufacturing"],
  [/\bindustrial\b/, "industrial"],
  [/\brecruiting agenc\w*\b/, "recruiting agencies"],
];

const ROLE_FAMILY_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bsales operations\b|\bsales ops\b/, "sales_ops"],
  [/\brevenue operations\b|\brev ?ops\b/, "rev_ops"],
  [/\bgtm operations\b|\bgtm ops\b/, "gtm_ops"],
  [/\bmarketing operations\b/, "marketing_ops"],
  [/\bcustomer success\b/, "customer_success"],
  [/\bsdr\b|\bbdr\b/, "sdr"],
  [/\bengineer\w*\b/, "engineering"],
];

const GEO_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bunited states\b|\busa\b|\bu\.s\.\b|\bus\b/, "United States"],
  [/\beurope\b|\beu\b/, "Europe"],
  [/\bunited kingdom\b|\buk\b/, "United Kingdom"],
  [/\bcanada\b/, "Canada"],
  [/\bindia\b/, "India"],
];

function firstMatch(t: string, table: ReadonlyArray<[RegExp, string]>): string | null {
  for (const [re, v] of table) if (re.test(t)) return v;
  return null;
}
function allMatches(t: string, table: ReadonlyArray<[RegExp, string]>): string[] {
  const out: string[] = [];
  for (const [re, v] of table) if (re.test(t)) out.push(v);
  return [...new Set(out)];
}

/** Explicit counts only. An absent count is a system default, not a guess. */
export function extractRequestedCount(query: string): number | null {
  const m = query.match(/\b(\d{1,3})\s+(?:qualified\s+)?(?:leads?|companies|contacts?|founders?|people|jobs?|listings?)\b/i)
    ?? query.match(/\breturn\s+(\d{1,3})\b/i)
    ?? query.match(/\bfind\s+(\d{1,3})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : null;
}

/** Supplied domains — the signal that discovery must be SKIPPED. */
export function extractKnownCompanies(query: string): string[] {
  const domains = query.match(/\b[a-z0-9][a-z0-9-]*\.(?:com|io|ai|co|net|org|dev|security)\b/gi) ?? [];
  return [...new Set(domains.map((d) => d.toLowerCase()))];
}

export interface DeterministicParseOpts {
  /** Explicit count from an upstream intake, if it already resolved one. */
  requestedCount?: number | null;
}

/**
 * Interpret the user's sentence with no model involved.
 *
 * Every field it sets is marked `explicit_user_request` when it came from the
 * user's words and `system_default` when it did not. Nothing here is
 * `gpt_inference` — that provenance is reserved for the model path.
 */
export function parseLeadMissionDeterministic(
  originalUserQuery: string, opts: DeterministicParseOpts = {},
): LeadMissionV1 {
  const q = String(originalUserQuery ?? "");
  const t = q.toLowerCase();
  const prov: Record<string, FieldProvenance> = {};

  const verticals = allMatches(t, VERTICAL_MARKERS);
  if (verticals.length) prov["company_profile.verticals"] = "explicit_user_request";

  const isStartup = STAGE_MARKERS.some((m) => t.includes(m));
  const stages = isStartup ? ["startup"] : [];
  if (isStartup) prov["company_profile.stages"] = "explicit_user_request";

  const locations = allMatches(t, GEO_MARKERS);
  if (locations.length) prov["company_profile.locations"] = "explicit_user_request";

  const known = extractKnownCompanies(q);
  if (known.length) prov["company_profile.known_companies"] = "explicit_user_request";

  const roleFamilies = allMatches(t, ROLE_FAMILY_MARKERS);

  // SIGNALS. "hiring X" is a hiring signal; funding and expansion are their own.
  const signals: MissionSignal[] = [];
  if (/\bhiring\b|\brecruit\w*\s+for\b|\bopen roles?\b/.test(t)) {
    signals.push({ type: "hiring", ...(roleFamilies.length ? { role_families: roleFamilies } : {}) });
  }
  if (/\bfund(?:ed|ing)\b|\braised\b|\bseries [a-d]\b|\bpre-?seed\b/.test(t)) {
    signals.push({ type: "funding", timeframe_days: 180 });
  }
  if (/\bexpand\w*\b|\bopening (?:an? )?(?:office|location)\b|\bentering\b/.test(t)) {
    signals.push({ type: "expansion", timeframe_days: 180 });
  }
  if (signals.length) prov["required_signals"] = "explicit_user_request";

  // TARGET ENTITY + OUTPUT. What the user asked to RECEIVE.
  const wantsJobs = /\bjobs?\b|\bjob listings?\b|\bpostings?\b|\bvacanc\w*\b/.test(t) &&
    !FOUNDER_MARKERS.some((m) => t.includes(m));
  const wantsPeople = FOUNDER_MARKERS.some((m) => t.includes(m)) ||
    /\bdecision[- ]makers?\b|\bcontacts?\b|\bleads?\b/.test(t);
  const wantsEnrichOnly = known.length > 0 &&
    /\benrich\b|\bresearch\b|\blook ?up\b/.test(t) && !wantsPeople;

  let target_entity: TargetEntity;
  let requested_output: RequestedOutput;
  let mission_type: MissionType;
  if (wantsJobs) {
    target_entity = "job"; requested_output = "job_listings"; mission_type = "job_research";
  } else if (wantsEnrichOnly) {
    target_entity = "company"; requested_output = "enriched_companies";
    mission_type = "known_company_enrichment";
  } else if (wantsPeople) {
    target_entity = "person"; requested_output = "contact_ready_leads";
    mission_type = "qualified_lead_sourcing";
  } else {
    target_entity = "company"; requested_output = "qualified_companies";
    mission_type = "company_research";
  }
  prov["target_entity"] = "explicit_user_request";
  prov["requested_output"] = "explicit_user_request";

  // DECISION MAKERS. Founder language expands to the founder set, because a
  // "founder" request is satisfied by a co-founder or the CEO of a startup.
  const roles = FOUNDER_MARKERS.some((m) => t.includes(m))
    ? ["Founder", "Co-Founder", "CEO"]
    : (target_entity === "person" ? ["Founder", "Co-Founder", "CEO"] : []);
  if (roles.length) {
    prov["decision_makers.roles"] = FOUNDER_MARKERS.some((m) => t.includes(m))
      ? "explicit_user_request" : "system_default";
  }

  const explicitCount = opts.requestedCount ?? extractRequestedCount(q);
  prov["requested_count"] = explicitCount != null ? "explicit_user_request" : "system_default";

  return {
    version: LEAD_MISSION_VERSION,
    original_user_query: q,
    mission_type,
    target_entity,
    requested_output,
    requested_count: explicitCount ?? 5,
    company_profile: {
      business_models: [],
      verticals,
      stages,
      locations,
      ...(known.length ? { known_companies: known } : {}),
    },
    required_signals: signals,
    decision_makers: { roles, current_employment_required: roles.length > 0 },
    hard_constraints: {},
    soft_preferences: {},
    required_capabilities: [],
    prohibited_capabilities: [],
    field_provenance: prov,
    confidence: 0.6,
  };
}

// ----------------------------------------------------- model validation -----

export interface MissionValidation {
  ok: boolean;
  mission: LeadMissionV1;
  errors: string[];
  repairs: string[];
  /** How the returned mission was produced. Persisted for audit. */
  source: "gpt_validated" | "gpt_repaired" | "deterministic_fallback";
}

const TARGET_ENTITIES: readonly TargetEntity[] = ["company", "person", "job"];
const MISSION_TYPES: readonly MissionType[] = [
  "qualified_lead_sourcing", "company_research", "job_research", "known_company_enrichment",
];
const REQUESTED_OUTPUTS: readonly RequestedOutput[] = [
  "contact_ready_leads", "qualified_companies", "job_listings", "enriched_companies",
];

function strArray(x: unknown): string[] {
  return Array.isArray(x)
    ? [...new Set(x.map((s) => String(s ?? "").trim()).filter(Boolean))]
    : [];
}

/**
 * Validate a model-proposed mission against the schema.
 *
 * THE ONE THING THAT IS NEVER TAKEN FROM THE MODEL is `original_user_query`. It
 * is overwritten from the caller's copy unconditionally, so no amount of model
 * creativity can restate the user's goal — the exact failure mode that produced
 * "Find 5 jobs matching: ..." in place of a startup mission.
 *
 * Unknown Actor ids in `required_capabilities` are DROPPED and named. A planner
 * that reaches for a provider id is expressing something it has no authority to
 * express, and the safe reading is that it said nothing.
 */
export function validateLeadMission(
  candidate: unknown,
  ctx: { originalUserQuery: string; isCapabilityId: (s: string) => boolean; requestedCount?: number | null },
): MissionValidation {
  const errors: string[] = [];
  const repairs: string[] = [];
  const fallback = () => parseLeadMissionDeterministic(ctx.originalUserQuery, { requestedCount: ctx.requestedCount });

  if (!candidate || typeof candidate !== "object") {
    return { ok: false, mission: fallback(), errors: ["mission is not an object"], repairs, source: "deterministic_fallback" };
  }
  const c = candidate as Record<string, any>;
  const base = fallback();

  const mission_type = MISSION_TYPES.includes(c.mission_type) ? c.mission_type : base.mission_type;
  if (mission_type !== c.mission_type) repairs.push(`mission_type_repaired:${String(c.mission_type)}->${mission_type}`);

  const target_entity = TARGET_ENTITIES.includes(c.target_entity) ? c.target_entity : base.target_entity;
  if (target_entity !== c.target_entity) repairs.push(`target_entity_repaired:${String(c.target_entity)}->${target_entity}`);

  const requested_output = REQUESTED_OUTPUTS.includes(c.requested_output) ? c.requested_output : base.requested_output;
  if (requested_output !== c.requested_output) repairs.push(`requested_output_repaired:${String(c.requested_output)}->${requested_output}`);

  const nRaw = Number(c.requested_count);
  const requested_count = Number.isFinite(nRaw) && nRaw > 0 && nRaw <= 500
    ? Math.trunc(nRaw) : base.requested_count;
  if (requested_count !== nRaw) repairs.push(`requested_count_repaired:${String(c.requested_count)}->${requested_count}`);

  // CAPABILITIES: names only, never provider ids.
  const rawCaps = strArray(c.required_capabilities);
  const required_capabilities: CapabilityId[] = [];
  for (const s of rawCaps) {
    if (ctx.isCapabilityId(s)) required_capabilities.push(s as CapabilityId);
    else { repairs.push(`non_capability_dropped:${s}`); }
  }
  const prohibited_capabilities: CapabilityId[] = [];
  for (const s of strArray(c.prohibited_capabilities)) {
    if (ctx.isCapabilityId(s)) prohibited_capabilities.push(s as CapabilityId);
    else repairs.push(`non_capability_dropped:${s}`);
  }

  const cp = (c.company_profile ?? {}) as Record<string, any>;
  const er = (cp.employee_range ?? {}) as Record<string, any>;
  const minE = Number(er.min), maxE = Number(er.max);
  const employee_range = (Number.isFinite(minE) || Number.isFinite(maxE))
    ? {
      ...(Number.isFinite(minE) ? { min: Math.max(0, Math.trunc(minE)) } : {}),
      ...(Number.isFinite(maxE) ? { max: Math.max(0, Math.trunc(maxE)) } : {}),
    }
    : base.company_profile.employee_range;

  const signals: MissionSignal[] = Array.isArray(c.required_signals)
    ? c.required_signals
      .filter((s: any) => s && typeof s === "object" && typeof s.type === "string" && s.type.trim())
      .map((s: any) => ({
        type: String(s.type).trim().toLowerCase(),
        ...(strArray(s.role_families).length ? { role_families: strArray(s.role_families) } : {}),
        ...(Number.isFinite(Number(s.timeframe_days)) ? { timeframe_days: Math.trunc(Number(s.timeframe_days)) } : {}),
      }))
    : base.required_signals;

  const dm = (c.decision_makers ?? {}) as Record<string, any>;
  const dmRoles = strArray(dm.roles);

  const prov: Record<string, FieldProvenance> = { ...base.field_provenance };
  // Anything the model supplied that the deterministic pass did NOT already
  // attribute to the user is model inference, and is marked as such.
  for (const k of [
    "company_profile.verticals", "company_profile.stages", "company_profile.locations",
    "company_profile.business_models", "decision_makers.roles", "required_signals",
  ]) {
    if (!prov[k]) prov[k] = "gpt_inference";
  }

  const mission: LeadMissionV1 = {
    version: LEAD_MISSION_VERSION,
    // NEVER from the model.
    original_user_query: ctx.originalUserQuery,
    mission_type,
    target_entity,
    requested_output,
    requested_count,
    company_profile: {
      business_models: strArray(cp.business_models),
      // The user's own words win over the model's restatement.
      verticals: base.company_profile.verticals.length
        ? base.company_profile.verticals : strArray(cp.verticals),
      stages: base.company_profile.stages.length
        ? base.company_profile.stages : strArray(cp.stages),
      locations: base.company_profile.locations.length
        ? base.company_profile.locations : strArray(cp.locations),
      ...(employee_range ? { employee_range } : {}),
      ...(base.company_profile.known_companies?.length
        ? { known_companies: base.company_profile.known_companies }
        : (strArray(cp.known_companies).length ? { known_companies: strArray(cp.known_companies) } : {})),
    },
    required_signals: signals,
    decision_makers: {
      roles: dmRoles.length ? dmRoles : base.decision_makers.roles,
      current_employment_required: dm.current_employment_required !== false &&
        (dmRoles.length > 0 || base.decision_makers.roles.length > 0),
    },
    hard_constraints: (c.hard_constraints && typeof c.hard_constraints === "object") ? c.hard_constraints : {},
    soft_preferences: (c.soft_preferences && typeof c.soft_preferences === "object") ? c.soft_preferences : {},
    required_capabilities,
    prohibited_capabilities,
    field_provenance: prov,
    confidence: Number.isFinite(Number(c.confidence))
      ? Math.min(1, Math.max(0, Number(c.confidence))) : 0.7,
  };

  // A mission whose OUTPUT contradicts the user's own words is not repaired
  // quietly: the deterministic reading wins and the disagreement is recorded.
  if (base.requested_output !== mission.requested_output) {
    repairs.push(`requested_output_overridden_by_user_words:${mission.requested_output}->${base.requested_output}`);
    mission.requested_output = base.requested_output;
    mission.target_entity = base.target_entity;
    mission.mission_type = base.mission_type;
  }

  return {
    ok: errors.length === 0,
    mission,
    errors,
    repairs,
    source: repairs.length ? "gpt_repaired" : "gpt_validated",
  };
}

// -------------------------------------------------- Company Brain merge -----

export interface BrainMergeInput {
  /** Brain ICP industries/verticals. */
  industries?: string[];
  business_models?: string[];
  stages?: string[];
  locations?: string[];
  employee_min?: number | null;
  employee_max?: number | null;
}

export interface BrainMergeResult {
  mission: LeadMissionV1;
  /** Brain values NOT applied because they would widen an explicit request. */
  rejected_broadening: Array<{ field: string; values: string[]; reason: string }>;
  applied: Array<{ field: string; values: string[] }>;
}

/**
 * Merge the Company Brain into a mission.
 *
 * PRECEDENCE: explicit_user_request > workflow_edit > company_brain > system_default.
 *
 * The Brain FILLS a field the user left open. It never widens one the user
 * closed. When the user says "SaaS startups" and the Brain targets
 * ["B2B SaaS", "AI SaaS", "Recruiting Agencies"], the mission keeps SaaS: the
 * two SaaS entries are compatible refinements and "Recruiting Agencies" is a
 * different business the user did not ask for. Adding it silently is how a
 * founder outreach list acquires staffing firms.
 *
 * Rejected values are RETURNED, not discarded, so the UI can offer the broader
 * scope as an explicit choice rather than taking it.
 */
export function mergeCompanyBrainIntoMission(
  mission: LeadMissionV1, brain: BrainMergeInput,
): BrainMergeResult {
  const rejected: BrainMergeResult["rejected_broadening"] = [];
  const applied: BrainMergeResult["applied"] = [];
  const prov = { ...mission.field_provenance };
  const cp: MissionCompanyProfile = {
    ...mission.company_profile,
    business_models: [...mission.company_profile.business_models],
    verticals: [...mission.company_profile.verticals],
    stages: [...mission.company_profile.stages],
    locations: [...mission.company_profile.locations],
  };

  const norm = (xs: readonly string[] | undefined) =>
    [...new Set((xs ?? []).map((s) => String(s ?? "").trim().toLowerCase()).filter(Boolean))];

  /** Compatible = one is a refinement of the other ("saas" vs "b2b saas"). */
  const compatible = (userVal: string, brainVal: string) =>
    userVal.includes(brainVal) || brainVal.includes(userVal);

  const mergeList = (
    field: string, userList: string[], brainList: string[],
  ): string[] => {
    const b = norm(brainList);
    if (!b.length) return userList;
    const existing = prov[field];
    const userClosed = userList.length > 0 &&
      (existing === "explicit_user_request" || existing === "workflow_edit");

    if (!userClosed) {
      if (userList.length === 0) {
        prov[field] = "company_brain";
        applied.push({ field, values: b });
        return b;
      }
      return userList;
    }
    // The user closed this field. Brain values may only REFINE it.
    const u = norm(userList);
    const refinements = b.filter((x) => u.some((y) => compatible(y, x)));
    const widening = b.filter((x) => !u.some((y) => compatible(y, x)));
    if (widening.length) {
      rejected.push({
        field, values: widening,
        reason: `outside the user's explicit ${field.split(".").pop()}: ${u.join(", ")}`,
      });
    }
    if (refinements.length) {
      applied.push({ field, values: refinements });
      return refinements;
    }
    return userList;
  };

  cp.verticals = mergeList("company_profile.verticals", cp.verticals, brain.industries ?? []);
  cp.business_models = mergeList("company_profile.business_models", cp.business_models, brain.business_models ?? []);
  cp.stages = mergeList("company_profile.stages", cp.stages, brain.stages ?? []);
  cp.locations = mergeList("company_profile.locations", cp.locations, brain.locations ?? []);

  // SIZE. The Brain fills an absent range; it may only TIGHTEN a present one,
  // mirroring companyBrainEffectivePolicy so the two cannot disagree.
  const userRange = mission.company_profile.employee_range;
  const bMin = brain.employee_min ?? null, bMax = brain.employee_max ?? null;
  if (bMin != null || bMax != null) {
    if (!userRange) {
      cp.employee_range = {
        ...(bMin != null ? { min: bMin } : {}), ...(bMax != null ? { max: bMax } : {}),
      };
      prov["company_profile.employee_range"] = "company_brain";
      applied.push({ field: "company_profile.employee_range", values: [`${bMin ?? ""}-${bMax ?? ""}`] });
    } else {
      const next = { ...userRange };
      if (bMin != null && (next.min == null || bMin > next.min)) next.min = bMin;
      if (bMax != null && (next.max == null || bMax < next.max)) next.max = bMax;
      if (bMin != null && next.min !== bMin && userRange.min != null && bMin < userRange.min) {
        rejected.push({ field: "company_profile.employee_range", values: [`min ${bMin}`], reason: "would widen the user's minimum" });
      }
      if (bMax != null && next.max !== bMax && userRange.max != null && bMax > userRange.max) {
        rejected.push({ field: "company_profile.employee_range", values: [`max ${bMax}`], reason: "would widen the user's maximum" });
      }
      cp.employee_range = next;
    }
  }

  return {
    mission: { ...mission, company_profile: cp, field_provenance: prov },
    rejected_broadening: rejected,
    applied,
  };
}

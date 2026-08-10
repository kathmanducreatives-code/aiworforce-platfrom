// THE GPT MISSION COMPILER — the model interprets, code decides.
//
// WHAT WAS MISSING.
//
// `parseLeadMissionDeterministic` reads the user's sentence with a regex table.
// It knows "b2b saas" and "manufactur*" because someone typed those patterns in.
// It cannot tell that "integrators expanding commercially" is a commercial-signal
// mission, that "could partner with Agentory" needs no hiring evidence at all, or
// that "building their first sales team" is the SAME request as "hiring their
// first salesperson". Every query outside the table collapses to the same generic
// reading, and the run then spends real money answering it.
//
// So the model now proposes the mission. It does NOT get to run anything.
//
// THE DIVISION, exactly.
//
//   MODEL   what the query means; what evidence is needed; which constraints are
//           hard; which signals are preferred, adjacent or excluded; what
//           broadening is acceptable; which ABSTRACT capabilities are required.
//
//   CODE    which Actor implements a capability; whether a call is necessary;
//           input validation; budget; deadline; authorization; deduplication;
//           persistence; whether paid work is allowed at all.
//
// The model is given `catalogueForPrompt()`, which is built from three fields and
// contains no provider name. It therefore has no vocabulary in which to request
// `memo23/y-combinator-scraper`, and if it invents one anyway, `UNSAFE_VALUE`
// below rejects the whole proposal and the deterministic parser answers instead.
//
// THAT LAST CLAUSE IS MIGRATION-ERA BEHAVIOUR, NOT THE TARGET. The rule is:
// a new request compiles to a canonical Mission, and a compilation that fails or
// returns invalid output RETRIES and then fails explicitly. It never silently
// falls back to regex interpretation of the sentence, because that is a
// different reading of the request rather than a coarser copy of the same one.
// The deterministic path survives here only for shadow comparison, historical
// compatibility and migration verification. See the doctrine block in
// leadMissionCompilerBinding.ts; R2 implements it.
//
// PURE. No network, provider, model or database access — the caller injects the
// model call and passes its raw output in.

import {
  LEAD_MISSION_VERSION, mergeCompanyBrainIntoMission,
  parseLeadMissionDeterministic, validateLeadMission,
  EXECUTION_PREFERENCES,
  REQUESTED_OUTPUTS,
  type BrainMergeInput, type ExecutionPreference, type LeadMissionV1,
  type MissionDirectives, type RequestedOutput,
} from "./leadMission.ts";
import { isCapabilityId, type CapabilityId } from "./leadCapabilityGraph.ts";
import {
  catalogueForPrompt, isPublicCapability, offersFrom, toInternalCapabilities,
  PUBLIC_CAPABILITY_CATALOGUE, type PublicCapabilityId,
} from "./leadCapabilityCatalogue.ts";

export const MISSION_COMPILER_SCHEMA_VERSION = "lead-mission-compiler-v1" as const;

/** The hard ceiling the product supports, regardless of what anyone asks for. */
export const MAX_REQUESTED_OPPORTUNITIES = 100;
export const MIN_REQUESTED_OPPORTUNITIES = 1;

// ------------------------------------------------------------- the schema ----

export interface ProposalConstraint {
  field: string;
  operator: string;
  value: unknown;
  reason: string;
}

export interface ProposalPreference {
  field: string;
  value: unknown;
  reason: string;
}

/** Exactly what the model is asked to return. Nothing here names a provider. */
export interface GptMissionProposal {
  requested_opportunity_count: number;
  requested_contact_ready_count: number | null;
  company_types: string[];
  geographies: string[];
  employee_range: { min: number | null; max: number | null };
  decision_maker_roles: string[];
  hard_constraints: ProposalConstraint[];
  soft_preferences: ProposalPreference[];
  preferred_signals: string[];
  adjacent_signals: string[];
  excluded_signals: string[];
  allowed_broadening: {
    role_families: string[];
    company_types: string[];
    geographies: string[];
    employee_range: { min: number | null; max: number | null };
  };
  disallowed_broadening: string[];
  required_evidence: string[];
  required_capabilities: PublicCapabilityId[];
  preferred_source_strategy: SourceStrategy[];
  evaluation_instructions: string;
  founder_unlock_recommended: boolean;
  confidence: number;
  unknowns: string[];

  // ── R1 ADDITIONS ───────────────────────────────────────────────────────────
  //
  // Everything above was already asked for. Everything below existed ONLY as
  // regex output before R1, which meant the model was never even asked for it —
  // so a model reading the raw sentence could not contribute the very fields
  // most often got wrong. Each is carried onto LeadMissionV1; see
  // `proposalToMissionCandidate`.

  /**
   * Companies the USER SUPPLIED by name or domain. Non-empty means discovery
   * must be skipped entirely.
   *
   * The deterministic `extractKnownCompanies` matches DOMAINS only, so a request
   * naming "Fireworks AI, Notch, 1Commerce" resolved to zero supplied companies
   * and the mission compiled as ordinary sourcing — measured, not assumed.
   */
  known_companies: string[];
  /** Recency window the request implies, in days. Null when it implies none. */
  signal_recency_days: number | null;
  /**
   * The literal role/signal words the user typed ("RevOps", "SDR"), preserved
   * verbatim rather than mapped to a taxonomy key. A plan that drifts entirely
   * away from these is rejected downstream.
   */
  required_signal_terms: string[];
  /** The request explicitly forbade widening ("exactly", "strictly", "only"). */
  no_broadening_requested: boolean;
  /** The geography was STATED by the user, not inferred from workspace context. */
  geography_is_hard: boolean;
  /**
   * Actions the request forbids in its own words — "do not send outreach", "do
   * not invent contacts". Distinct from `excluded_signals`, which is about what
   * to look for; this is about what may be DONE.
   */
  prohibitions: string[];
  /**
   * What the model believes the user asked to RECEIVE.
   *
   * RECORDED, NOT AUTHORITATIVE. `validateLeadMission` overwrites
   * requested_output/target_entity/mission_type from the deterministic reading
   * unconditionally, so this cannot yet steer a run. It is carried so the
   * disagreement is visible and measurable; making it authoritative is R2's
   * cutover, not R1's.
   */
  output_intent: RequestedOutput | null;
}

/**
 * Abstract routing preferences. A CLOSED vocabulary, deliberately.
 *
 * "Prefer the startup cohort" is a judgement about the query. "Prefer memo23" is
 * a procurement decision, and the model does not make those. Anything outside
 * this list is dropped and named.
 */
export const SOURCE_STRATEGIES = [
  "startup_cohort_first",
  "job_signal_first",
  "company_profile_first",
  "known_companies_only",
  "evidence_reuse_first",
] as const;
export type SourceStrategy = typeof SOURCE_STRATEGIES[number];

// ------------------------------------------------------ the safety scanner ----

/**
 * Field names the model may never populate, however it spells them.
 *
 * Compared after stripping non-alphanumerics, so `actor_id`, `actorId` and
 * `actor-ids` are one entry. These are the things that would let a proposal
 * choose a provider, spend money, or reach another workspace.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "actor", "actorid", "actorids", "actorkey", "actorkeys", "actorinput",
  "provider", "providers", "providerid", "providerinput",
  "credential", "credentials", "apikey", "apitoken", "token", "secret",
  "servicerole", "servicerolekey", "authorization",
  "rawinput", "input", "scrapeurl", "scrapeurls", "url", "urls",
  "creditprice", "creditcost", "credits", "price", "pricing", "cost",
  "budget", "budgetoverride", "maxbudget", "maxspend",
  "workspaceid", "workspace", "orgid", "organizationid",
]);

/** Looks like `owner/actor-name` — an Apify Actor reference. */
const ACTOR_REF = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
/** Vendor and platform names that only appear if the model is naming providers. */
const VENDOR_WORDS =
  /\b(apify|harvestapi|memo23|solidcode|crawlworks|automation[- ]?lab|glassdoor)\b/i;
const ANY_URL = /https?:\/\//i;

export interface ProposalViolation {
  path: string;
  kind: "forbidden_field" | "actor_reference" | "vendor_name" | "url" | "not_an_object";
  detail: string;
}

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Walk the raw model output for anything it had no authority to say.
 *
 * Checks KEYS and STRING VALUES, at every depth. A violation is fatal — see
 * {@link compileLeadMission}, which today degrades to the deterministic parser
 * rather than trying to sanitise a proposal that was reaching outside its remit.
 * A proposal that names an Actor is not a good proposal with one bad field; it is
 * evidence the model misunderstood what it was being asked for.
 *
 * REFUSING THE PROPOSAL IS PERMANENT; DEGRADING TO REGEX IS NOT. Under the
 * architectural rule the correct response to a refused proposal is retry, then
 * an explicit compilation failure — not a second, regex-derived reading of the
 * user's sentence. Migration-era only; see leadMissionCompilerBinding.ts.
 */
export function scanProposalForViolations(raw: unknown): ProposalViolation[] {
  const found: ProposalViolation[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > 12 || found.length > 40) return;
    if (typeof node === "string") {
      const s = node.trim();
      if (ACTOR_REF.test(s) && s.length <= 120) {
        found.push({ path, kind: "actor_reference", detail: s });
      } else if (VENDOR_WORDS.test(s)) {
        found.push({ path, kind: "vendor_name", detail: s.slice(0, 80) });
      } else if (ANY_URL.test(s)) {
        found.push({ path, kind: "url", detail: s.slice(0, 80) });
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.has(normKey(k))) {
        found.push({ path: p, kind: "forbidden_field", detail: k });
        continue;
      }
      walk(v, p, depth + 1);
    }
  };

  // AN ARRAY IS NOT A PROPOSAL. `typeof [] === "object"`, so without this an
  // empty array read as a proposal with every field missing and produced a
  // confident, entirely empty mission.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [{
      path: "", kind: "not_an_object",
      detail: Array.isArray(raw) ? "array" : typeof raw,
    }];
  }
  walk(raw, "", 0);
  return found;
}

// ------------------------------------------------------------- the prompt ----

export const MISSION_COMPILER_SYSTEM_PROMPT = [
  "You interpret a sales prospecting request and describe it as a structured mission.",
  "You do NOT choose data providers, tools, scrapers or Actors, and you never name one.",
  "You do NOT decide budgets, prices or credits, and you never mention money.",
  "Request capabilities ONLY from the supplied catalogue, by their exact names.",
  "Wanting people information is expressed as 'offer_founder_unlock' — an offer the",
  "user may accept later. There is no way to look anyone up now, and asking for one",
  "is an error.",
  "Prefer 'embedded_hiring_evidence' over 'external_hiring_verification' whenever",
  "hiring evidence is needed at all; request the external one only when the query",
  "genuinely depends on verified, current hiring and embedded evidence would not settle it.",
  "Do not require hiring evidence for a query that does not ask about hiring.",
  "A constraint the user stated explicitly is HARD. Anything you inferred is SOFT.",
  "Never widen an explicit geography or business model.",
  "State what you are unsure about in 'unknowns' rather than guessing.",
  // ── R1: the fields the model was previously never asked for ────────────────
  "Copy the user's own role and signal words into 'required_signal_terms' verbatim —",
  "do not translate them into a category. Set 'no_broadening_requested' true when the",
  "request says exactly, strictly, only, or do not broaden. Set 'geography_is_hard'",
  "true only when the user themselves named the place. List every company the request",
  "names in 'known_companies', by name or domain, exactly as written; leave it empty",
  "when the request names none. Put actions the request forbids — sending outreach,",
  "inventing contacts — in 'prohibitions'. Say what the user asked to RECEIVE in",
  "'output_intent'. Report only what the request states: an empty list is the correct",
  "answer whenever it states nothing, and is always better than a plausible guess.",
  "Return only the requested JSON object.",
].join(" ");

export interface CompilerPromptContext {
  originalUserQuery: string;
  /** Workspace ICP, offered as CONTEXT. The model is told it may ignore it. */
  companyBrain?: {
    industries?: string[];
    business_models?: string[];
    stages?: string[];
    locations?: string[];
    employee_min?: number | null;
    employee_max?: number | null;
  } | null;
  /** Count an upstream intake already resolved, if any. */
  requestedCount?: number | null;
}

/**
 * The payload the model receives.
 *
 * `capability_catalogue` comes from `catalogueForPrompt()`, which cannot carry a
 * provider name. `limits` states the ceilings so a proposal that exceeds them is
 * a model error rather than a surprise. No workspace id, no credential, no price
 * and no Actor appears anywhere in this object.
 */
export function buildMissionCompilerPayload(
  ctx: CompilerPromptContext,
): Record<string, unknown> {
  return {
    schema_version: MISSION_COMPILER_SCHEMA_VERSION,
    instruction: MISSION_COMPILER_SYSTEM_PROMPT,
    user_query: String(ctx.originalUserQuery ?? ""),
    company_brain_context: {
      note:
        "Workspace targeting profile. Apply ONLY the parts relevant to this query. " +
        "Ignore categories the query did not ask about.",
      industries: ctx.companyBrain?.industries ?? [],
      business_models: ctx.companyBrain?.business_models ?? [],
      stages: ctx.companyBrain?.stages ?? [],
      locations: ctx.companyBrain?.locations ?? [],
      employee_min: ctx.companyBrain?.employee_min ?? null,
      employee_max: ctx.companyBrain?.employee_max ?? null,
    },
    capability_catalogue: catalogueForPrompt(),
    source_strategy_vocabulary: SOURCE_STRATEGIES,
    limits: {
      min_requested_opportunity_count: MIN_REQUESTED_OPPORTUNITIES,
      max_requested_opportunity_count: MAX_REQUESTED_OPPORTUNITIES,
      requested_count_hint: ctx.requestedCount ?? null,
    },
    rules: [
      "Never name a provider, Actor, vendor, tool or URL.",
      "Never state a price, credit amount or budget.",
      "Never include a workspace or organisation identifier.",
      "People information is only ever offered, never performed.",
    ],
    response_shape: {
      requested_opportunity_count: "number",
      requested_contact_ready_count: "number|null",
      company_types: "string[]",
      geographies: "string[]",
      employee_range: { min: "number|null", max: "number|null" },
      decision_maker_roles: "string[]",
      hard_constraints: [{ field: "string", operator: "string", value: "any", reason: "string" }],
      soft_preferences: [{ field: "string", value: "any", reason: "string" }],
      preferred_signals: "string[]",
      adjacent_signals: "string[]",
      excluded_signals: "string[]",
      allowed_broadening: {
        role_families: "string[]", company_types: "string[]", geographies: "string[]",
        employee_range: { min: "number|null", max: "number|null" },
      },
      disallowed_broadening: "string[]",
      required_evidence: "string[]",
      required_capabilities: "capability names from capability_catalogue",
      preferred_source_strategy: "values from source_strategy_vocabulary",
      evaluation_instructions: "string",
      founder_unlock_recommended: "boolean",
      confidence: "number 0..1",
      unknowns: "string[]",
      known_companies: "string[] — companies the request NAMES; empty if it names none",
      signal_recency_days: "number|null",
      required_signal_terms: "string[] — the user's own role/signal words, verbatim",
      no_broadening_requested: "boolean",
      geography_is_hard: "boolean",
      prohibitions: "string[] — actions the request forbids",
      output_intent: REQUESTED_OUTPUTS,
    },
  };
}

// ---------------------------------------------------------------- parsing ----

function strArray(x: unknown, cap = 40): string[] {
  return Array.isArray(x)
    ? [...new Set(x.map((s) => String(s ?? "").trim()).filter(Boolean))].slice(0, cap)
    : [];
}

/**
 * A number, or null — and `null` really does mean null.
 *
 * `Number(null)` is 0 and `Number("")` is 0, both finite. Without the guard
 * below, a proposal saying `employee_range: {min: null, max: null}` — which is
 * the schema's own way of saying "no size constraint", and what the model emits
 * most of the time — compiled into a mission demanding companies with between
 * ZERO and ZERO employees. Every company would have failed that gate, after the
 * discovery Actor had already been paid for.
 */
function numOrNull(x: unknown): number | null {
  if (x === null || x === undefined || x === "" || typeof x === "boolean") return null;
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function range(x: unknown): { min: number | null; max: number | null } {
  const r = (x ?? {}) as Record<string, unknown>;
  return { min: numOrNull(r.min), max: numOrNull(r.max) };
}

export interface ParsedProposal {
  proposal: GptMissionProposal | null;
  violations: ProposalViolation[];
  /** Non-fatal corrections made while reading the proposal. */
  repairs: string[];
}

/**
 * Read the model's output into the proposal type, or refuse it.
 *
 * A safety violation is FATAL and returns a null proposal. Everything else is
 * repaired and named: an unknown capability is dropped, an out-of-range count is
 * clamped, a missing array becomes empty. The distinction is deliberate — a
 * malformed field is a model being imprecise, whereas a forbidden field is a
 * model reaching for authority it does not have.
 */
export function parseMissionProposal(raw: unknown): ParsedProposal {
  const violations = scanProposalForViolations(raw);
  if (violations.length > 0) return { proposal: null, violations, repairs: [] };

  const c = raw as Record<string, unknown>;
  const repairs: string[] = [];

  // THE ONE REQUIRED FIELD. `requested_opportunity_count` shapes the whole run,
  // and a proposal that cannot state it as a number has not understood the
  // schema. Defaulting it would produce a confident mission built on a value
  // nobody supplied, so this is malformed rather than repairable.
  const rawCount = numOrNull(c.requested_opportunity_count);
  if (rawCount === null) {
    return {
      proposal: null,
      violations: [{
        path: "requested_opportunity_count", kind: "not_an_object",
        detail: `expected a number, got ${JSON.stringify(c.requested_opportunity_count)}`,
      }],
      repairs: [],
    };
  }
  let count = rawCount;
  if (count > MAX_REQUESTED_OPPORTUNITIES) {
    repairs.push(`requested_opportunity_count_capped:${count}->${MAX_REQUESTED_OPPORTUNITIES}`);
    count = MAX_REQUESTED_OPPORTUNITIES;
  }
  if (count < MIN_REQUESTED_OPPORTUNITIES) {
    repairs.push(`requested_opportunity_count_raised:${count}->${MIN_REQUESTED_OPPORTUNITIES}`);
    count = MIN_REQUESTED_OPPORTUNITIES;
  }

  const caps: PublicCapabilityId[] = [];
  for (const s of strArray(c.required_capabilities)) {
    if (isPublicCapability(s)) {
      if (!caps.includes(s)) caps.push(s);
    } else {
      repairs.push(`unknown_capability_dropped:${s}`);
    }
  }

  const strategies: SourceStrategy[] = [];
  for (const s of strArray(c.preferred_source_strategy)) {
    if ((SOURCE_STRATEGIES as readonly string[]).includes(s)) {
      if (!strategies.includes(s as SourceStrategy)) strategies.push(s as SourceStrategy);
    } else {
      repairs.push(`unknown_source_strategy_dropped:${s}`);
    }
  }

  const constraints: ProposalConstraint[] = Array.isArray(c.hard_constraints)
    ? c.hard_constraints
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .filter((x) => typeof x.field === "string" && String(x.field).trim())
      .slice(0, 20)
      .map((x) => ({
        field: String(x.field).trim(),
        operator: String(x.operator ?? "equals").trim(),
        value: x.value ?? null,
        reason: String(x.reason ?? "").trim(),
      }))
    : [];

  const preferences: ProposalPreference[] = Array.isArray(c.soft_preferences)
    ? c.soft_preferences
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .filter((x) => typeof x.field === "string" && String(x.field).trim())
      .slice(0, 20)
      .map((x) => ({
        field: String(x.field).trim(),
        value: x.value ?? null,
        reason: String(x.reason ?? "").trim(),
      }))
    : [];

  const ab = (c.allowed_broadening ?? {}) as Record<string, unknown>;
  const conf = Number(c.confidence);

  return {
    proposal: {
      requested_opportunity_count: count,
      requested_contact_ready_count: numOrNull(c.requested_contact_ready_count),
      company_types: strArray(c.company_types),
      geographies: strArray(c.geographies),
      employee_range: range(c.employee_range),
      decision_maker_roles: strArray(c.decision_maker_roles),
      hard_constraints: constraints,
      soft_preferences: preferences,
      preferred_signals: strArray(c.preferred_signals),
      adjacent_signals: strArray(c.adjacent_signals),
      excluded_signals: strArray(c.excluded_signals),
      allowed_broadening: {
        role_families: strArray(ab.role_families),
        company_types: strArray(ab.company_types),
        geographies: strArray(ab.geographies),
        employee_range: range(ab.employee_range),
      },
      disallowed_broadening: strArray(c.disallowed_broadening),
      required_evidence: strArray(c.required_evidence),
      required_capabilities: caps,
      preferred_source_strategy: strategies,
      evaluation_instructions: String(c.evaluation_instructions ?? "").trim().slice(0, 2000),
      founder_unlock_recommended: c.founder_unlock_recommended === true,
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      unknowns: strArray(c.unknowns),

      // ── R1 additions ────────────────────────────────────────────────────────
      // Read defensively, exactly like every field above: a model that omits one
      // gets the empty/false reading, never a fabricated constraint.
      known_companies: strArray(c.known_companies),
      signal_recency_days: recencyDays(c.signal_recency_days, repairs),
      required_signal_terms: strArray(c.required_signal_terms),
      no_broadening_requested: c.no_broadening_requested === true,
      geography_is_hard: c.geography_is_hard === true,
      prohibitions: strArray(c.prohibitions),
      output_intent: (REQUESTED_OUTPUTS as readonly string[])
          .includes(String(c.output_intent ?? ""))
        ? String(c.output_intent) as RequestedOutput
        : null,
    },
    violations: [],
    repairs,
  };
}

/** The recency ceiling. Beyond this a "recent" signal is not a signal. */
export const MAX_SIGNAL_RECENCY_DAYS = 730;

/**
 * A recency window in days, or null.
 *
 * Clamped rather than rejected: a model saying "recently funded" as 3650 days
 * has understood the request and misjudged the number, and the safe reading of
 * an over-long window is the longest one the product supports — not a mission
 * with no recency constraint at all.
 */
function recencyDays(x: unknown, repairs: string[]): number | null {
  const n = numOrNull(x);
  if (n === null) return null;
  if (n <= 0) { repairs.push(`signal_recency_days_dropped:${n}`); return null; }
  if (n > MAX_SIGNAL_RECENCY_DAYS) {
    repairs.push(`signal_recency_days_capped:${n}->${MAX_SIGNAL_RECENCY_DAYS}`);
    return MAX_SIGNAL_RECENCY_DAYS;
  }
  return n;
}

// -------------------------------------------------------------- compiling ----

export type ParserSource = "gpt_validated" | "gpt_repaired" | "deterministic_fallback";

export interface WorkspaceContextRecord {
  consulted: boolean;
  categories_offered: string[];
  categories_applied: string[];
  categories_ignored: Array<{ value: string; reason: string }>;
}

export interface CapabilityDecisionRecord {
  requested: string[];
  approved: PublicCapabilityId[];
  rejected: Array<{ capability: string; reason: string }>;
  /** Offers surfaced in the Workbench. These run nothing. */
  offers: PublicCapabilityId[];
  internal: CapabilityId[];
}

export interface CompiledMissionResult {
  parser_source: ParserSource;
  original_query: string;
  gpt_proposal: GptMissionProposal | null;
  validator_changes: string[];
  final_mission: LeadMissionV1;
  schema_version: typeof MISSION_COMPILER_SCHEMA_VERSION;
  /** Part 4 — what the workspace profile contributed and what it did not. */
  workspace_context: WorkspaceContextRecord;
  /** Part 9 — which capabilities were asked for, allowed and refused. */
  capability_decision: CapabilityDecisionRecord;
  confidence: number;
  unknowns: string[];
  /** Present only when a proposal was refused outright. */
  safety_violations: ProposalViolation[];
}

export interface CompileMissionInput {
  originalUserQuery: string;
  /** Raw model output. Absent/null means "no model ran" — not an error. */
  proposal?: unknown;
  companyBrain?: BrainMergeInput | null;
  requestedCount?: number | null;
}

/**
 * Turn a query (and optionally a model proposal) into the mission everything
 * downstream will obey.
 *
 * PRECEDENCE, in this order and no other:
 *   1. the explicit user query      — `parseLeadMissionDeterministic` reads it
 *      and its findings overwrite the model's on every field it resolved;
 *   2. the validated model proposal — fills what the user left open;
 *   3. the workspace Company Brain  — fills what is still open, and may refine
 *      but never widen (`mergeCompanyBrainIntoMission` owns that rule);
 *   4. safe defaults.
 *
 * The model NEVER supplies `original_user_query`; `validateLeadMission`
 * overwrites it from the caller's copy unconditionally.
 */
export function compileLeadMission(i: CompileMissionInput): CompiledMissionResult {
  const query = String(i.originalUserQuery ?? "");
  const changes: string[] = [];

  const deterministic = () =>
    parseLeadMissionDeterministic(query, { requestedCount: i.requestedCount });

  let parsed: ParsedProposal = { proposal: null, violations: [], repairs: [] };
  let source: ParserSource = "deterministic_fallback";
  let mission: LeadMissionV1;
  let requestedCaps: string[] = [];
  let approvedCaps: PublicCapabilityId[] = [];
  const rejectedCaps: CapabilityDecisionRecord["rejected"] = [];

  if (i.proposal === undefined || i.proposal === null) {
    changes.push("no_model_proposal:deterministic_parser_used");
    mission = deterministic();
  } else {
    parsed = parseMissionProposal(i.proposal);
    if (!parsed.proposal) {
      // UNSAFE OR UNREADABLE. The run continues on the deterministic reading
      // rather than failing — a bad proposal must never cost the user a workflow.
      for (const v of parsed.violations) {
        changes.push(`proposal_rejected:${v.kind}:${v.path || "root"}`);
      }
      mission = deterministic();
    } else {
      requestedCaps = [...parsed.proposal.required_capabilities];
      for (const r of parsed.repairs) {
        changes.push(r);
        const m = /^unknown_capability_dropped:(.+)$/.exec(r);
        if (m) {
          requestedCaps.push(m[1]);
          rejectedCaps.push({ capability: m[1], reason: "not in the supported capability catalogue" });
        }
      }
      approvedCaps = [...parsed.proposal.required_capabilities];
      const internal = toInternalCapabilities(approvedCaps);

      const validated = validateLeadMission(
        proposalToMissionCandidate(parsed.proposal, internal, deterministic()),
        { originalUserQuery: query, isCapabilityId, requestedCount: i.requestedCount },
      );
      for (const r of validated.repairs) changes.push(r);
      mission = validated.mission;

      // ── THE OVERRIDE IS RECORDED, NOT SILENT ─────────────────────────────
      //
      // `validateLeadMission` lets the user's own words win over the model's
      // restatement, which is right — but it did so without saying anything, so
      // a model that proposed "Recruiting Agencies in India" for a US SaaS query
      // looked identical to one that agreed. The disagreement is the single most
      // useful thing to see when asking why a run targeted what it did.
      const overridden = (
        field: string, proposed: string[], final: string[],
      ) => {
        const lower = final.map((v) => v.toLowerCase());
        const dropped = proposed.filter((v) =>
          !lower.some((f) => f.includes(v.toLowerCase()) || v.toLowerCase().includes(f)));
        if (dropped.length) {
          changes.push(`${field}_overridden_by_user_words:${dropped.join(",")}`);
        }
      };
      overridden("company_types", parsed.proposal.company_types,
        mission.company_profile.verticals);
      overridden("geographies", parsed.proposal.geographies,
        mission.company_profile.locations);

      // ── OUTPUT INTENT: RECORDED, NOT OBEYED ──────────────────────────────
      //
      // validateLeadMission overwrites requested_output/target_entity/
      // mission_type from the deterministic reading unconditionally, so the
      // model's reading cannot steer the run. That precedence is R2's to
      // change. What R1 fixes is that the disagreement used to be invisible:
      // a model correctly reading "at these companies: ..." as an enrichment
      // request looked identical to one that agreed it was fresh sourcing.
      if (
        parsed.proposal.output_intent &&
        parsed.proposal.output_intent !== mission.requested_output
      ) {
        changes.push(
          `output_intent_proposed_not_authoritative:${parsed.proposal.output_intent}` +
          `->${mission.requested_output}`,
        );
      }
      source = validated.repairs.length || parsed.repairs.length
        ? "gpt_repaired" : "gpt_validated";
    }
  }

  // ── THE COUNT CEILING, enforced here and not only in the parser ────────────
  // `validateLeadMission` accepts up to 500 because it also serves other callers.
  // This product supports 100, and a mission that says otherwise would spend a
  // whole run discovering the limit.
  if (mission.requested_count > MAX_REQUESTED_OPPORTUNITIES) {
    changes.push(
      `requested_count_capped:${mission.requested_count}->${MAX_REQUESTED_OPPORTUNITIES}`);
    mission = { ...mission, requested_count: MAX_REQUESTED_OPPORTUNITIES };
  }
  if (mission.requested_count < MIN_REQUESTED_OPPORTUNITIES) {
    changes.push(
      `requested_count_raised:${mission.requested_count}->${MIN_REQUESTED_OPPORTUNITIES}`);
    mission = { ...mission, requested_count: MIN_REQUESTED_OPPORTUNITIES };
  }

  // ── PEOPLE STAGES ARE NEVER AUTOMATIC ──────────────────────────────────────
  // Whatever anyone asked for, the people stages are removed from the mission's
  // required set and named as prohibited. `buildCapabilityGraph` refuses to
  // insert them too; both guards exist because this is the one that spends money
  // on a person the user never agreed to buy.
  const peopleStages: CapabilityId[] = [
    "founder_discovery", "employer_verification", "contact_enrichment",
  ];
  const strippedPeople = mission.required_capabilities.filter((c) => peopleStages.includes(c));
  if (strippedPeople.length) {
    changes.push(`people_stages_removed_from_automatic_plan:${strippedPeople.join(",")}`);
  }
  mission = {
    ...mission,
    required_capabilities: mission.required_capabilities.filter(
      (c) => !peopleStages.includes(c)),
    prohibited_capabilities: [...new Set([
      ...mission.prohibited_capabilities, ...peopleStages,
    ])],
  };

  // ── THE WORKSPACE PROFILE, third in precedence ─────────────────────────────
  const offered = [
    ...(i.companyBrain?.industries ?? []),
    ...(i.companyBrain?.business_models ?? []),
  ];
  const workspace: WorkspaceContextRecord = {
    consulted: !!i.companyBrain,
    categories_offered: [...new Set(offered.map(String))],
    categories_applied: [],
    categories_ignored: [],
  };
  if (i.companyBrain) {
    const merged = mergeCompanyBrainIntoMission(mission, i.companyBrain);
    mission = merged.mission;
    workspace.categories_applied = [
      ...new Set(merged.applied.flatMap((a) => a.values.map(String))),
    ];
    workspace.categories_ignored = merged.rejected_broadening.flatMap((r) =>
      r.values.map((v) => ({ value: String(v), reason: r.reason })));
    for (const r of merged.rejected_broadening) {
      changes.push(`workspace_category_ignored:${r.values.join(",")}`);
    }
  }

  // ── DIRECTIVES: the model's judgement, carried to every later stage ────────
  // Part 8's whole point. Without this the classifier re-derives its own idea of
  // what matters and the two quietly disagree about the same run.
  const p = parsed.proposal;
  const directives: MissionDirectives = {
    preferred_signals: p?.preferred_signals ?? [],
    adjacent_signals: p?.adjacent_signals ?? [],
    excluded_signals: p?.excluded_signals ?? [],
    required_evidence: p?.required_evidence ?? [],
    allowed_broadening: p?.allowed_broadening ?? {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: p?.disallowed_broadening ?? [],
    evaluation_instructions: p?.evaluation_instructions ?? "",
    source_strategy: p?.preferred_source_strategy ?? [],
    requested_contact_ready_count: p?.requested_contact_ready_count ?? null,
    founder_unlock_recommended: p?.founder_unlock_recommended ?? true,
    // ABSTRACT ONLY. Validated against a closed vocabulary, so the field can
    // never become a place to name a vendor.
    execution_preference: EXECUTION_PREFERENCES.includes(
      String((i.proposal as Record<string, unknown> | null | undefined)
        ?.execution_preference ?? "") as ExecutionPreference)
      ? String((i.proposal as Record<string, unknown>).execution_preference) as ExecutionPreference
      : "balanced",
  };

  // Hard constraints from an explicit query must survive as hard constraints.
  const hard: Record<string, unknown> = { ...mission.hard_constraints };
  for (const hc of p?.hard_constraints ?? []) {
    hard[hc.field] = { operator: hc.operator, value: hc.value, reason: hc.reason };
  }
  // The user's own words outrank the model's constraint list on geography: if the
  // deterministic pass read a location out of the sentence, it is hard whatever
  // the model said about it.
  if (mission.company_profile.locations.length > 0) {
    hard["company_profile.locations"] = {
      operator: "in",
      value: [...mission.company_profile.locations],
      reason: "stated explicitly in the user's query",
    };
  }
  const soft: Record<string, unknown> = { ...mission.soft_preferences };
  for (const sp of p?.soft_preferences ?? []) {
    soft[sp.field] = { value: sp.value, reason: sp.reason };
  }

  mission = { ...mission, hard_constraints: hard, soft_preferences: soft, directives };

  const offers = offersFrom(approvedCaps);
  return {
    parser_source: source,
    original_query: query,
    gpt_proposal: parsed.proposal,
    validator_changes: changes,
    final_mission: mission,
    schema_version: MISSION_COMPILER_SCHEMA_VERSION,
    workspace_context: workspace,
    capability_decision: {
      requested: [...new Set(requestedCaps)],
      approved: approvedCaps,
      rejected: rejectedCaps,
      offers,
      internal: mission.required_capabilities,
    },
    confidence: p?.confidence ?? mission.confidence,
    unknowns: p?.unknowns ?? [],
    safety_violations: parsed.violations,
  };
}

/**
 * Adapt the public proposal onto the candidate shape `validateLeadMission` reads.
 *
 * Signals arrive as flat names (`hiring`, `funding`); the mission carries them as
 * typed objects. Only PREFERRED signals become required — an adjacent signal is
 * by definition one the mission will accept, not one it demands.
 */
function proposalToMissionCandidate(
  p: GptMissionProposal, internal: CapabilityId[], base: LeadMissionV1,
): Record<string, unknown> {
  return {
    // CARRIED FROM THE DETERMINISTIC READING, not left absent.
    //
    // The proposal schema has no `mission_type` / `target_entity` /
    // `requested_output` — those are internal shapes the model is deliberately
    // not asked about. Omitting them made `validateLeadMission` "repair" all
    // three on every proposal, so a perfectly good compilation reported itself
    // as `gpt_repaired` and the field stopped distinguishing anything.
    mission_type: base.mission_type,
    target_entity: base.target_entity,
    requested_output: base.requested_output,
    requested_count: p.requested_opportunity_count,
    company_profile: {
      verticals: p.company_types,
      locations: p.geographies,
      business_models: [],
      stages: [],
      employee_range: {
        ...(p.employee_range.min != null ? { min: p.employee_range.min } : {}),
        ...(p.employee_range.max != null ? { max: p.employee_range.max } : {}),
      },
      // SUPPLIED ENTITIES. `validateLeadMission` prefers the deterministic
      // reading when it found any, and takes this otherwise — which is the
      // realistic case, because extractKnownCompanies matches domains only and
      // returns nothing for a request naming companies in prose.
      known_companies: p.known_companies,
    },
    // RECENCY travels ON the signal, which is the only place it means anything:
    // "recently funded" constrains the funding signal, not the mission at large.
    required_signals: p.preferred_signals.map((s) => ({
      type: s,
      ...(p.signal_recency_days != null ? { timeframe_days: p.signal_recency_days } : {}),
    })),
    decision_makers: {
      roles: p.decision_maker_roles,
      current_employment_required: true,
    },
    required_capabilities: internal,
    prohibited_capabilities: [],
    confidence: p.confidence,

    // R1 constraints, carried whole onto the mission.
    no_broadening_requested: p.no_broadening_requested,
    required_signal_terms: p.required_signal_terms,
    prohibitions: p.prohibitions,
    geography_is_hard: p.geography_is_hard,
    ...(p.output_intent ? { proposed_output_intent: p.output_intent } : {}),
  };
}

/**
 * Does the mission still need a PAID hiring check?
 *
 * The answer is no whenever hiring is not required at all, and no whenever the
 * model asked for embedded evidence without asking for external verification.
 * This is the decision that stops a partner-fit query buying a job search it
 * never needed.
 */
export function needsExternalHiringVerification(
  caps: readonly PublicCapabilityId[], mission: LeadMissionV1,
): boolean {
  if (caps.length > 0) return caps.includes("external_hiring_verification");
  // No model proposal: fall back to the mission's own required signals.
  return mission.required_signals.some((s) => s.type === "hiring");
}

/** Human-readable reason a capability was chosen. Persisted, not logged. */
export function describeCapabilityChoice(id: PublicCapabilityId): string {
  const spec = PUBLIC_CAPABILITY_CATALOGUE[id];
  return spec.kind === "offer"
    ? `${id}: surfaced as a Workbench offer; no provider work`
    : spec.paid
    ? `${id}: paid provider work, via approved Actors only`
    : `${id}: free — no provider call`;
}

export const LEAD_MISSION_COMPILER_MISSION_VERSION = LEAD_MISSION_VERSION;

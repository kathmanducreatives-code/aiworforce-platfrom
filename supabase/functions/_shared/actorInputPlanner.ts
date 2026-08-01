// actorInputPlanner: Scout's actor-input planner. Gemini proposes the best
// GENERIC actor input JSON for the selected (already-decided) actor; this module
// validates/repairs it and ALWAYS has a deterministic fallback so sourcing never
// depends on the model being available or correct. Gemini never executes tools —
// it only shapes the input. Deterministic validators (actorInputValidator) and
// the existing capabilityValidator/actorRegistry remain authoritative.

import { generateJson, type ProviderName } from "./aiProvider.ts";
import { resolveSourcePlannerProvider } from "./providerRouting.ts";
import { getActorByKey } from "./actorRegistry.ts";
import { normalizeTerm, sanitizeQuery, capCount } from "./inputNormalize.ts";
import { roleAliases, industrySynonyms, broadenCompetitorQueries } from "./broaden.ts";
import {
  type ActorInputSchema,
  type LeadSourceType,
  getActorInputSchema,
} from "./actorInputSchemas.ts";
import {
  validateActorInputAgainstSchema,
  sanitizeActorInput,
  validateStrictConstraints,
  type StrictRequestContext,
  type ValidationResult,
} from "./actorInputValidator.ts";

export type NormalizedRequest = {
  role?: string;
  industry?: string;
  location?: string;
  company_category?: string;
  company_stage?: string;
  count: number;
  competitor?: string;
  topic?: string;
  strict_constraints?: string[];
};

export type ActorInputPlan = {
  actor_key: string;
  source_type: string;
  input: Record<string, unknown>;
  normalized_request: NormalizedRequest;
  query_strategy: {
    primary_query: string;
    role_aliases?: string[];
    industry_synonyms?: string[];
    negative_keywords?: string[];
    location_strategy?: "strict" | "flexible" | "global";
    broadening_level: 0 | 1 | 2 | 3;
  };
  expected_entity_type: "account" | "contact" | "signal";
  quality_requirements: string[];
  missing_info: string[];
  confidence: number;
};

export type PlanArgs = {
  user_request: string;
  actor_key: string;
  source_type: LeadSourceType | string;
  count: number;
  normalized?: Partial<NormalizedRequest>;
  brain_context?: string | null;
  previous_attempts?: Array<{ query?: string; accepted?: number; raw?: number; note?: string }>;
  strict?: { location?: boolean; industry?: boolean; stage?: boolean; count_exact?: boolean };
  strict_location_value?: string | null;
  competitors?: string[];
  post_urls?: string[];
};

export type PlanResult = {
  plan: ActorInputPlan;
  input: Record<string, unknown>;
  source: "ai" | "ai_repaired" | "deterministic";
  validation: ValidationResult;
  // Provider transparency for QA/budget. planner_mode: "claude" | "gemini" |
  // "deterministic_fallback".
  provider_used: ProviderName | "none";
  model_used: string;
  planner_mode: "claude" | "gemini" | "deterministic_fallback";
  ai_calls: number;
};

const CONFIDENCE_FLOOR = 0.65;

// Budget guard (Phase 3). Each run-agent invocation is a fresh isolate, so the
// module counter is effectively per sourcing run. Caps prevent runaway AI spend.
const SOURCE_PLANNER_MAX_AI_CALLS_PER_RUN = 3;
let _plannerAiCalls = 0;

function locationStrategy(strictLoc: boolean | undefined, location?: string): "strict" | "flexible" | "global" {
  if (strictLoc) return "strict";
  if (!location) return "global";
  return "flexible";
}

// ---------- Deterministic planner (pure, always available) ----------

export function buildDeterministicPlan(args: PlanArgs): ActorInputPlan {
  const schema = getActorInputSchema(args.actor_key);
  const cap = getActorByKey(args.actor_key)?.max_safe_results ?? 100;
  const n = capCount(args.count, { def: 5, max: cap });

  const role = args.normalized?.role ? normalizeTerm(args.normalized.role) : undefined;
  const industry = args.normalized?.industry ? normalizeTerm(args.normalized.industry) : undefined;
  const location = args.normalized?.location ? normalizeTerm(args.normalized.location) : undefined;
  const competitor = args.normalized?.competitor ?? (args.competitors && args.competitors[0]) ?? undefined;
  const topic = args.normalized?.topic ? normalizeTerm(args.normalized.topic) : undefined;
  const stage = args.normalized?.company_stage ?? undefined;

  const roles = role ? roleAliases(role) : [];
  const indSyn = industry ? industrySynonyms(industry) : [];
  const missing: string[] = [];

  let input: Record<string, unknown> = {};
  let primaryQuery = "";
  const entity = schema?.expected_entity_type ?? "account";

  switch (args.source_type) {
    case "hiring_signal":
    case "company_search": {
      primaryQuery = sanitizeQuery([role, industry].filter(Boolean).join(" ")) ?? (role ?? industry ?? args.user_request);
      input = { query: primaryQuery, location, role_keywords: roles.length ? roles : (role ? [role] : []), max_results: n };
      break;
    }
    case "people_profiles":
    case "icp_search": {
      // Industry/category MUST be in the query or the actor returns any "Founder
      // in <city>". Fold in industry + company_category; fall back to topic.
      const category = args.normalized?.company_category ? normalizeTerm(args.normalized.company_category) : undefined;
      let focus = [industry, category].filter(Boolean).join(" ");
      if (!focus && topic && topic.toLowerCase() !== (role ?? "").toLowerCase()) focus = topic;
      primaryQuery = sanitizeQuery([role, focus].filter(Boolean).join(" ")) ?? (role ?? args.user_request);
      const keywordTerms = [industry, category].filter(Boolean) as string[];
      input = {
        query: primaryQuery, location,
        role_keywords: roles.length ? roles : (role ? [role] : []),
        max_results: n,
        ...(keywordTerms.length ? { user_input: { keywords: keywordTerms } } : {}),
      };
      break;
    }
    case "linkedin_intent_posts": {
      const kws = topic ? [topic] : (industry ? indSyn : []);
      primaryQuery = sanitizeQuery(topic ?? industry ?? args.user_request) ?? (topic ?? args.user_request);
      input = { query: primaryQuery, max_results: n, user_input: { keywords: kws.length ? kws : [primaryQuery] } };
      break;
    }
    case "competitor_engagement": {
      const comps = (args.competitors && args.competitors.length ? args.competitors : (competitor ? [competitor] : []));
      const queries = comps.length ? broadenCompetitorQueries(0, comps, topic ?? industry ?? null) : (topic ? [topic] : []);
      primaryQuery = queries[0] ?? (competitor ?? topic ?? args.user_request);
      if (comps.length === 0) missing.push("competitor name");
      input = { query: primaryQuery, max_results: n, user_input: { keywords: queries.length ? queries : [primaryQuery], companies: comps } };
      break;
    }
    case "linkedin_comments": {
      const urls = args.post_urls ?? [];
      if (urls.length === 0) missing.push("LinkedIn post URL");
      input = { max_results: n, user_input: { postUrls: urls } };
      primaryQuery = "";
      break;
    }
    default: {
      primaryQuery = sanitizeQuery(args.user_request) ?? args.user_request;
      input = { query: primaryQuery, location, role_keywords: roles, max_results: n };
    }
  }

  const quality: string[] = [
    `entity type must be ${entity}`,
    "reject results missing a name/company",
    "dedupe across attempts",
  ];

  return {
    actor_key: args.actor_key,
    source_type: String(args.source_type),
    input,
    normalized_request: {
      role, industry, location, company_stage: stage, count: n,
      competitor, topic,
      strict_constraints: args.normalized?.strict_constraints,
    },
    query_strategy: {
      primary_query: primaryQuery,
      role_aliases: roles.length ? roles : undefined,
      industry_synonyms: indSyn.length ? indSyn : undefined,
      location_strategy: locationStrategy(args.strict?.location, location),
      broadening_level: 0,
    },
    expected_entity_type: entity,
    quality_requirements: quality,
    missing_info: missing,
    confidence: 0.7,
  };
}

// ---------- Gemini planner ----------

const SYSTEM_PROMPT = `You are Scout's actor input planner inside Agentory.

Your job is not to answer the user.
Your job is to create the best valid input JSON for the selected actor.

Use: user request, workflow decision, actor input schema, Company Brain, previous attempt logs, quality requirements, strict constraints.

Return only valid JSON matching the ActorInputPlan shape.

Rules:
- Match the actor schema exactly. Only use the schema's allowed fields/keys.
- Do not include unknown fields.
- Use normalized role/industry/location.
- Expand role aliases when useful.
- Respect strict constraints. If the user says "exactly", "only", "do not broaden", keep that field strict.
- Use the count requested by the user, capped by system limits.
- Do not invent contacts, companies, emails, phone numbers, or results.
- Do not use raw long descriptions as queries. Prefer concise, high-signal search terms.
- For hiring search, optimize for job/company intent.
- For people search, optimize for role/persona + industry + location.
- For LinkedIn posts, optimize for pain/intent phrases.
- For competitor engagement, include competitor names + alternatives + category pain.
- Never include any send/post/comment/dm/email field.`;

function buildUserPrompt(args: PlanArgs, schema: ActorInputSchema, det: ActorInputPlan): string {
  return [
    `USER REQUEST: ${args.user_request}`,
    `SELECTED ACTOR: ${schema.actor_key} (source_type=${schema.source_type}, entity=${schema.expected_entity_type})`,
    `ACTOR INPUT SCHEMA:\n${JSON.stringify({
      fields: schema.fields.map((f) => ({ name: f.path ?? f.name, type: f.type, required: !!f.required, description: f.description })),
      allowed_user_input_keys: schema.allowed_user_input_keys,
      max_results_field: schema.max_results_field,
      examples: schema.examples,
    }, null, 2)}`,
    args.brain_context ? `COMPANY BRAIN:\n${args.brain_context}` : "COMPANY BRAIN: (none)",
    args.strict ? `STRICT CONSTRAINTS: ${JSON.stringify(args.strict)}${args.strict_location_value ? ` location="${args.strict_location_value}"` : ""}` : "",
    (args.previous_attempts && args.previous_attempts.length)
      ? `PREVIOUS ATTEMPTS:\n${args.previous_attempts.map((a, i) => `#${i + 1} query="${a.query ?? ""}" raw=${a.raw ?? "?"} accepted=${a.accepted ?? "?"}${a.note ? ` note=${a.note}` : ""}`).join("\n")}`
      : "PREVIOUS ATTEMPTS: none",
    `DETERMINISTIC SEED (improve on this; keep the same JSON shape):\n${JSON.stringify({ input: det.input, normalized_request: det.normalized_request, query_strategy: det.query_strategy }, null, 2)}`,
    `Return ActorInputPlan JSON with keys: actor_key, source_type, input, normalized_request, query_strategy, expected_entity_type, quality_requirements, missing_info, confidence.`,
  ].filter(Boolean).join("\n\n");
}

function coercePlan(raw: unknown, det: ActorInputPlan): ActorInputPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const input = (r.input && typeof r.input === "object" && !Array.isArray(r.input)) ? r.input as Record<string, unknown> : null;
  if (!input) return null;
  const conf = typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.6;
  const qs = (r.query_strategy && typeof r.query_strategy === "object") ? r.query_strategy as Record<string, unknown> : {};
  const bl = Number((qs as Record<string, unknown>).broadening_level);
  return {
    actor_key: det.actor_key,
    source_type: det.source_type,
    input,
    normalized_request: (r.normalized_request && typeof r.normalized_request === "object")
      ? { ...det.normalized_request, ...(r.normalized_request as Record<string, unknown>) } as NormalizedRequest
      : det.normalized_request,
    query_strategy: {
      primary_query: typeof (qs as Record<string, unknown>).primary_query === "string" ? (qs as Record<string, string>).primary_query : det.query_strategy.primary_query,
      role_aliases: Array.isArray((qs as Record<string, unknown>).role_aliases) ? (qs as Record<string, string[]>).role_aliases : det.query_strategy.role_aliases,
      industry_synonyms: Array.isArray((qs as Record<string, unknown>).industry_synonyms) ? (qs as Record<string, string[]>).industry_synonyms : det.query_strategy.industry_synonyms,
      negative_keywords: Array.isArray((qs as Record<string, unknown>).negative_keywords) ? (qs as Record<string, string[]>).negative_keywords : undefined,
      location_strategy: (["strict", "flexible", "global"].includes(String((qs as Record<string, unknown>).location_strategy))) ? (qs as Record<string, "strict" | "flexible" | "global">).location_strategy : det.query_strategy.location_strategy,
      broadening_level: ([0, 1, 2, 3].includes(bl) ? bl : 0) as 0 | 1 | 2 | 3,
    },
    expected_entity_type: det.expected_entity_type,
    quality_requirements: Array.isArray(r.quality_requirements) ? (r.quality_requirements as unknown[]).filter((x) => typeof x === "string") as string[] : det.quality_requirements,
    missing_info: Array.isArray(r.missing_info) ? (r.missing_info as unknown[]).filter((x) => typeof x === "string") as string[] : [],
    confidence: conf,
  };
}

/**
 * Plan + validate the actor input. Always returns a runnable, schema-valid,
 * strict-constraint-respecting input — falling back to the deterministic plan
 * whenever Gemini is unavailable, low-confidence, or produces invalid JSON.
 */
export async function planActorInput(args: PlanArgs): Promise<PlanResult> {
  const schema = getActorInputSchema(args.actor_key);
  const det = buildDeterministicPlan(args);
  const strictCtx: StrictRequestContext = { strict: args.strict ?? {}, strict_location_value: args.strict_location_value ?? null };

  // Provider override (Phase 1): SOURCE_PLANNER_PROVIDER=anthropic|claude pins
  // the planner to Claude (e.g. when Lovable is 402). Otherwise default path
  // (Lovable/Gemini, with aiProvider's Anthropic fallback).
  const envProvider = (() => { try { return Deno.env.get("SOURCE_PLANNER_PROVIDER"); } catch { return null; } })();
  const preferredProvider = resolveSourcePlannerProvider(envProvider);

  // Track which provider/model actually answered so QA can see it.
  let providerUsed: ProviderName | "none" = "none";
  let modelUsed = "";

  // No schema → we can't safely validate AI output; use deterministic.
  if (!schema) {
    return {
      plan: det, input: det.input, source: "deterministic",
      validation: { ok: true, errors: [], warnings: ["no schema for actor"] },
      provider_used: "none", model_used: "", planner_mode: "deterministic_fallback", ai_calls: _plannerAiCalls,
    };
  }

  const finalize = (plan: ActorInputPlan, source: PlanResult["source"]): PlanResult => {
    const sanitized = sanitizeActorInput(plan.input, schema);
    const v = validateActorInputAgainstSchema(sanitized, schema);
    const sc = validateStrictConstraints(sanitized, strictCtx);
    const validation: ValidationResult = { ok: v.ok && sc.ok, reason: v.reason ?? sc.reason, errors: [...v.errors, ...sc.errors], warnings: [...v.warnings, ...sc.warnings] };
    const planner_mode: PlanResult["planner_mode"] =
      source === "deterministic" ? "deterministic_fallback"
        : providerUsed === "anthropic" ? "claude" : "gemini";
    return {
      plan: { ...plan, input: sanitized }, input: sanitized, source, validation,
      provider_used: source === "deterministic" ? "none" : providerUsed,
      model_used: source === "deterministic" ? "" : modelUsed,
      planner_mode, ai_calls: _plannerAiCalls,
    };
  };

  // Budget guard (Phase 3): cap AI planner calls per isolate/run.
  let ai: Awaited<ReturnType<typeof generateJson>> | null = null;
  if (_plannerAiCalls >= SOURCE_PLANNER_MAX_AI_CALLS_PER_RUN) {
    console.warn("[actorInputPlanner] AI call budget reached — deterministic fallback", { calls: _plannerAiCalls });
  } else {
    _plannerAiCalls++;
    try {
      ai = await generateJson({
        taskType: "helper",
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(args, schema, det) }],
        temperature: 0.2,
        maxTokens: 700,
        jsonMode: true,
        functionName: "actorInputPlanner",
        preferredProvider,
      });
    } catch { ai = null; }
    if (ai) { providerUsed = ai.provider; modelUsed = ai.model; }
    console.log("[actorInputPlanner] ai", { requested_provider: preferredProvider ?? "default", provider_used: providerUsed, model: modelUsed, ok: ai?.ok, calls: _plannerAiCalls });
  }

  if (ai?.ok && ai.json) {
    const coerced = coercePlan(ai.json, det);
    if (coerced && coerced.confidence >= CONFIDENCE_FLOOR) {
      const res = finalize(coerced, "ai");
      if (res.validation.ok) return res;
      // Repair once: drop AI input, keep AI normalized_request/query_strategy,
      // rebuild input deterministically from the AI's (possibly better) terms.
      const repairedSeed = buildDeterministicPlan({
        ...args,
        normalized: { ...args.normalized, ...coerced.normalized_request },
        competitors: coerced.normalized_request.competitor ? [coerced.normalized_request.competitor, ...(args.competitors ?? [])] : args.competitors,
      });
      const repaired = finalize({ ...repairedSeed, confidence: coerced.confidence }, "ai_repaired");
      if (repaired.validation.ok) return repaired;
    }
  }

  // Deterministic fallback (also covers confidence < floor, invalid JSON, budget cap).
  return finalize(det, "deterministic");
}

/** Test helper: reset the per-isolate AI call counter. */
export function _resetPlannerBudget(): void { _plannerAiCalls = 0; }

// ============================================================================
// HIRING-SOURCE SEMANTIC COMPILATION (PR #106)
// ============================================================================
//
// Extends THIS module — the existing compilation authority — rather than adding
// a parallel compiler registry. Semantic intent in, verified Actor input out.
//
// Every field below exists in the Actor's audited input schema. Where a source
// cannot express a requested filter the compiler REPAIRS deterministically and
// records why, or refuses. It never invents a field to make an intent fit:
// pretending Indeed supports a 45-day window, or that YC can filter by funding
// stage, would produce input the provider silently ignores and a plan that lies
// about what it searched.

import {
  resolveHiringSourceActor, type HiringSourceCapabilityId,
} from "./hiringSourceCatalog.ts";
import { canonicalJson as _canonicalJson, sha256Hex as _sha256Hex } from "./planHash.ts";

/** What a planner may ask for. Provider-neutral by construction. */
export interface HiringSourceIntent {
  capability: HiringSourceCapabilityId;
  /** Approved hiring-role aliases. NEVER decision-maker titles. */
  titleAliases: string[];
  roleFamily?: string | null;
  geography?: string | null;
  countryCode?: string | null;
  postingWindowDays?: number | null;
  employmentTypes?: string[] | null;
  remotePolicy?: "any" | "remote" | "hybrid" | "onsite" | null;
  candidateTarget?: number | null;
  /** Required for ats_job_verification only. */
  companies?: Array<{ ats?: string | null; slug: string }> | null;
}

export interface CompiledHiringSourceInput {
  ok: true;
  capability: HiringSourceCapabilityId;
  actorKey: string;
  input: Record<string, unknown>;
  inputHash: string;
  repairs: string[];
  /**
   * Mission constraints this Actor cannot express. Recorded, never invented as
   * provider fields; the qualification layer must enforce them post-fetch.
   */
  postFetchQualification: string[];
  /** Redacted summary safe for diagnostics. */
  summary: Record<string, unknown>;
}

export interface DeferredHiringSourceInput {
  ok: false;
  capability: HiringSourceCapabilityId;
  status: "deferred" | "rejected";
  reason: string;
}
export type HiringSourceCompileResult = CompiledHiringSourceInput | DeferredHiringSourceInput;

/**
 * The semantic recency policy. Agentory considers a hiring signal "current"
 * inside this window; a provider that can express a longer one is still bounded
 * by it, because a 365-day posting is not evidence of current hiring.
 */
export const MAX_SEMANTIC_POSTING_WINDOW_DAYS = 60;
export const DEFAULT_SEMANTIC_POSTING_WINDOW_DAYS = 30;

/**
 * Constraints NO job-board Actor can express. They are never fabricated as
 * provider fields; they are recorded here and enforced after the fetch by the
 * Company Brain / qualification layer.
 */
export const UNSUPPORTED_PROVIDER_CONSTRAINTS = [
  "business_model_saas",
  "startup_stage",
  "employee_count_range",
] as const;
export type UnsupportedProviderConstraint = typeof UNSUPPORTED_PROVIDER_CONSTRAINTS[number];

/** Indeed exposes exactly these `datePosted` buckets. Nothing else is valid. */
export const INDEED_DATE_POSTED_BUCKETS = [1, 3, 7, 14] as const;


/**
 * Map a requested window onto Indeed's supported buckets.
 *
 * Documented policy: 1 -> 1, 2-3 -> 3, 4-7 -> 7, 8-14 -> 14, >14 -> clamp to 14
 * and record a repair. The clamp is NARROWER than requested, which is the safe
 * direction: it under-reports recency rather than claiming a 45-day search the
 * source never performed.
 */
/**
 * Indeed's `datePosted`, using the values the LIVE actor accepts.
 *
 *   "" | "1" | "3" | "7" | "14"
 *
 * PR #123 changed this to the prose form ("last 24 hours" / "3 days" / ...) after
 * reading the published input-schema page. The live actor REJECTED that form:
 * production run b59b422b failed with `apify_input_schema_error` naming exactly
 * the five values above. Runtime truth beats the documentation page, so the
 * numeric-day strings are restored and pinned by fixture tests.
 *
 * FOURTEEN DAYS IS THE CEILING. Indeed cannot express 30, 45 or 60 days. A longer
 * semantic window is clamped to the strictest supported bucket and the
 * approximation is recorded — the existing broadening ladder and its tests depend
 * on that behaviour, and the 60-day bound is enforced after normalization
 * regardless. Only the emitted VALUE was wrong; the policy was not.
 */
export function indeedDatePostedBucket(days: number | null | undefined): { value: string; repair: string | null } {
  if (days == null || !Number.isFinite(days) || days <= 0) return { value: "", repair: null };
  const d = Math.floor(days);
  if (d <= 1) return { value: "1", repair: null };
  if (d <= 3) return { value: "3", repair: null };
  if (d <= 7) return { value: "7", repair: null };
  if (d <= 14) return { value: "14", repair: null };
  return {
    value: "14",
    repair: `posting_window_clamped:${d}d->14d (indeed datePosted supports only ""/"1"/"3"/"7"/"14")`,
  };
}

/** LinkedIn expresses recency in SECONDS, from a fixed set. */
export function linkedinTimePostedRange(days: number | null | undefined): { value: string; repair: string | null } {
  if (days == null || !Number.isFinite(days) || days <= 0) return { value: "", repair: null };
  const d = Math.floor(days);
  if (d <= 1) return { value: "86400", repair: null };
  if (d <= 3) return { value: "259200", repair: null };
  if (d <= 7) return { value: "604800", repair: null };
  if (d <= 30) return { value: "2592000", repair: null };
  return { value: "2592000", repair: `posting_window_clamped:${d}d->30d (linkedin supports 1/3/7/30 only)` };
}

/** YC's `roleFilter` enum. An unmapped family is omitted, never invented. */
const YC_ROLE_FILTER = new Set([
  "software-engineer", "designer", "product-manager", "data-scientist",
  "sales", "marketing", "support", "operations", "recruiting", "science",
]);
export function ycRoleFilter(roleFamily: string | null | undefined): { value: string; repair: string | null } {
  const r = String(roleFamily ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!r) return { value: "", repair: null };
  if (YC_ROLE_FILTER.has(r)) return { value: r, repair: null };
  if (/ops|operation/.test(r)) return { value: "operations", repair: `yc_role_mapped:${r}->operations` };
  if (/sales|revenue|gtm/.test(r)) return { value: "sales", repair: `yc_role_mapped:${r}->sales` };
  return { value: "", repair: `yc_role_unsupported:${r} (left unfiltered; keywords still applied)` };
}

const clampInt = (n: unknown, min: number, max: number, dflt: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(v)));
};

/**
 * Compile semantic intent into verified Actor input.
 *
 * Resolution goes through the catalog, so a disabled provider refuses here
 * rather than producing input nobody can run.
 */
export async function compileHiringSourceInput(intent: HiringSourceIntent): Promise<HiringSourceCompileResult> {
  const resolved = resolveHiringSourceActor(intent.capability);
  if (!resolved.ok) {
    return { ok: false, capability: intent.capability, status: "rejected", reason: resolved.reason };
  }
  const { capability, actorKey } = resolved;
  const repairs: string[] = [];

  const titles = [...new Set((intent.titleAliases ?? []).map((t) => String(t ?? "").trim()).filter(Boolean))];
  const query = titles.join(" OR ");
  const cap = capability.operatingPolicy.maximumResultsPerCall;
  const target = clampInt(intent.candidateTarget, 1, cap, Math.min(50, cap));
  if (intent.candidateTarget != null && Number(intent.candidateTarget) > cap) {
    repairs.push(`result_target_capped:${intent.candidateTarget}->${cap}`);
  }

  let input: Record<string, unknown>;

  switch (intent.capability) {
    case "indeed_job_discovery": {
      if (!query) return { ok: false, capability: intent.capability, status: "rejected", reason: "missing_title_aliases" };
      const dp = indeedDatePostedBucket(intent.postingWindowDays);
      if (dp.repair) repairs.push(dp.repair);
      const employment = (intent.employmentTypes ?? []).map((e) => String(e).toLowerCase());
      const jobType = employment.includes("full_time") || employment.includes("fulltime") ? "fulltime" : "";
      input = {
        query,
        location: intent.geography ?? "",
        country: (intent.countryCode ?? "US").toUpperCase(),
        maxItems: target,
        jobType,
        includeDescription: true,
      };
      // NEVER send `datePosted: ""`. Either a verified enum member is emitted,
      // or the field is omitted entirely and the Actor's own default applies.
      if (dp.value) {
        (input as Record<string, unknown>).datePosted = dp.value;
      } else if (intent.postingWindowDays != null) {
        repairs.push("posting_window_unmappable:indeed_datePosted_omitted");
      }
      break;
    }

    case "linkedin_job_discovery": {
      if (!query) return { ok: false, capability: intent.capability, status: "rejected", reason: "missing_title_aliases" };
      const tp = linkedinTimePostedRange(intent.postingWindowDays);
      if (tp.repair) repairs.push(tp.repair);
      const remote = intent.remotePolicy;
      // NO WORKPLACE RESTRICTION unless the mission asked for one. The previous
      // shape sent onSite:true / remote:false / hybrid:false whenever the policy
      // was absent, which silently excluded every remote and hybrid posting —
      // exactly the population a distributed startup mission depends on.
      const unrestricted = remote == null || remote === "any";
      input = {
        query,
        location: intent.geography ?? "",
        // REQUIRED by the schema (1-1000); Agentory caps far tighter.
        jobsToFetch: target,
        onSite: unrestricted || remote === "onsite",
        remote: unrestricted || remote === "remote",
        hybrid: unrestricted || remote === "hybrid",
        fullTime: true,
        enrichCompanyDetails: true,
      };
      if (tp.value) {
        (input as Record<string, unknown>).timePostedRange = tp.value;
      } else if (intent.postingWindowDays != null) {
        repairs.push("posting_window_unmappable:linkedin_timePostedRange_omitted");
      }
      break;
    }

    case "glassdoor_job_discovery": {
      // BOTH are required by the verified schema. Refuse rather than send junk.
      if (!query) return { ok: false, capability: intent.capability, status: "rejected", reason: "glassdoor_requires_keywords" };
      if (!intent.geography) return { ok: false, capability: intent.capability, status: "rejected", reason: "glassdoor_requires_location" };
      // Bounded by the SEMANTIC recency policy, not by the Actor's own 365-day
      // ceiling: a 90-day "recent hiring signal" is not a recent hiring signal.
      const requested = intent.postingWindowDays ?? DEFAULT_SEMANTIC_POSTING_WINDOW_DAYS;
      const days = clampInt(requested, 1, MAX_SEMANTIC_POSTING_WINDOW_DAYS, DEFAULT_SEMANTIC_POSTING_WINDOW_DAYS);
      if (Number(requested) > MAX_SEMANTIC_POSTING_WINDOW_DAYS) {
        repairs.push(`posting_window_clamped:${Math.floor(Number(requested))}d->${MAX_SEMANTIC_POSTING_WINDOW_DAYS}d (semantic recency policy)`);
      }
      input = {
        keywords: query,
        location: intent.geography,
        daysOld: days,
        limit: target,
        sortBy: "date_desc",
      };
      break;
    }


    case "yc_job_discovery": {
      const rf = ycRoleFilter(intent.roleFamily);
      if (rf.repair) repairs.push(rf.repair);
      // NO stage / batch / team-size fields: the Actor has none. Those remain
      // Company Brain constraints applied downstream.
      input = {
        searchQuery: query,
        roleFilter: rf.value,
        locationFilter: intent.geography ?? "",
        maxResults: target,
      };
      break;
    }

    case "ats_job_verification": {
      const companies = (intent.companies ?? [])
        .map((c) => ({ ats: c.ats ? String(c.ats).toLowerCase() : undefined, company: String(c.slug ?? "").trim() }))
        .filter((c) => !!c.company);
      // The Actor cannot verify without a company slug. This is a DEFERRAL, not
      // a failure: the company may become identifiable after enrichment.
      if (companies.length === 0) {
        return {
          ok: false, capability: intent.capability, status: "deferred",
          reason: "ats_verification_requires_resolved_company_slug",
        };
      }
      input = {
        companies,
        titleKeyword: titles[0] ?? "",
        locationKeyword: intent.geography ?? "",
        maxJobsPerCompany: clampInt(intent.candidateTarget, 1, 50, 10),
        includeDescriptions: false,
        outputProfile: "compact",
      };
      break;
    }
  }

  const inputHash = await _sha256Hex(_canonicalJson({ actorKey, input }));
  return {
    ok: true, capability: intent.capability, actorKey, input, inputHash, repairs,
    postFetchQualification: [...UNSUPPORTED_PROVIDER_CONSTRAINTS],
    summary: {
      capability: intent.capability,
      actor_key: actorKey,
      title_alias_count: titles.length,
      geography: intent.geography ?? null,
      result_target: target,
      posting_window_days: intent.postingWindowDays ?? null,
      repairs,
      post_fetch_qualification: [...UNSUPPORTED_PROVIDER_CONSTRAINTS],
      input_hash: inputHash,
    },

  };
}

// ============================================================================
// BROADENING COMPATIBILITY — can this source actually express this rung?
// ============================================================================
//
// PR #110 found YC Jobs being offered `extend_recency_window` even though the
// verified YC Actor input has no posting-window field at all. The rung compiled
// to a byte-identical call: a second paid request for the same rows, presented to
// the strategy layer as if it had broadened something.
//
// The defence is behavioural rather than a hand-maintained table. A rung is
// COMPATIBLE only when applying it changes the compiled input — and because the
// compiled input IS the Actor's verified schema shape, a changed hash proves a
// supported field moved. There is nothing to keep in sync when a schema changes:
// the compiler is the single source of truth, and this reads it.
//
// One application function serves BOTH the compatibility check and the runtime's
// real call, so the rung assessed at plan time is the rung that later executes.

/** A rung, structurally. Not imported from the plan module, to keep this leaf-ward. */
export interface BroadeningIntentChange {
  action: string;
  aliases?: string[];
  wording?: string;
  remotePolicy?: string;
  postingWindowDays?: number;
  candidateTarget?: number;
  capability?: string;
}

/**
 * Apply one approved rung to a semantic intent.
 *
 * THE ONLY PLACE a rung becomes a change. Three rungs are deliberately absent:
 *
 *   use_equivalent_query_wording — free text with no registry behind it. The
 *     alias rung is restricted to the approved role-family registry; `wording` is
 *     not, so compiling it would be a hole in exactly the constraint that keeps a
 *     broadened search on-role. Left unapplied, it compiles identically and is
 *     therefore never offered, which is the honest outcome for something we
 *     cannot express safely.
 *
 *   activate_broader_approved_source / activate_fallback_source — these do not
 *     change THIS step's input; they mean "run a different source". That is what
 *     `advance_to_next_source` already does, through the ordered chain, with the
 *     activation conditions the plan authored. Treating them as input broadening
 *     would be a second, unordered way to reach a source.
 */
export function applyBroadeningToIntent(
  intent: HiringSourceIntent,
  rung: BroadeningIntentChange | null | undefined,
): HiringSourceIntent {
  if (!rung) return intent;
  switch (rung.action) {
    case "add_approved_role_aliases":
      if (!rung.aliases?.length) return intent;
      return { ...intent, titleAliases: [...new Set([...(intent.titleAliases ?? []), ...rung.aliases])] };

    case "increase_result_target":
      if (rung.candidateTarget == null) return intent;
      return { ...intent, candidateTarget: rung.candidateTarget };

    case "extend_recency_window":
      if (rung.postingWindowDays == null) return intent;
      return { ...intent, postingWindowDays: rung.postingWindowDays };

    case "include_supported_remote_variants": {
      const policy = String(rung.remotePolicy ?? "").trim().toLowerCase();
      // Only the four the intent contract defines. An unrecognised policy is not
      // guessed at — it simply does not apply, and the rung drops out as a no-op.
      if (policy !== "any" && policy !== "remote" && policy !== "hybrid" && policy !== "onsite") return intent;
      return { ...intent, remotePolicy: policy };
    }

    default:
      return intent;
  }
}

export interface BroadeningCompatibility {
  supported: boolean;
  /** Safe, stable code. Null when supported. */
  reason:
    | "unsupported_by_source_schema"
    | "not_an_input_change"
    | "uncompilable_before"
    | "uncompilable_after"
    | null;
}

/** Rungs that describe activating another source rather than changing this input. */
const SOURCE_ACTIVATION_RUNGS = new Set([
  "activate_broader_approved_source", "activate_fallback_source",
]);

/**
 * Would this rung meaningfully change the call this step makes?
 *
 * Compiles the intent twice — before and after — and compares the normalized
 * hashes. Identical means the Actor's schema has nowhere to put the change (YC and
 * recency), or the value lands in the same repaired bucket (Indeed 14 -> 30 days,
 * both of which clamp to `datePosted: "14"`), or the value was already there.
 *
 * A rung that cannot compile at all is likewise not offered: `deferred` is the
 * right answer for ATS without a resolved slug, but it is not a broadening option.
 */
export async function assessBroadeningCompatibility(
  intent: HiringSourceIntent,
  rung: BroadeningIntentChange,
): Promise<BroadeningCompatibility> {
  if (SOURCE_ACTIVATION_RUNGS.has(rung.action)) {
    return { supported: false, reason: "not_an_input_change" };
  }

  const before = await compileHiringSourceInput(intent);
  if (!before.ok) return { supported: false, reason: "uncompilable_before" };

  const after = await compileHiringSourceInput(applyBroadeningToIntent(intent, rung));
  if (!after.ok) return { supported: false, reason: "uncompilable_after" };

  if (after.inputHash === before.inputHash) {
    return { supported: false, reason: "unsupported_by_source_schema" };
  }
  return { supported: true, reason: null };
}

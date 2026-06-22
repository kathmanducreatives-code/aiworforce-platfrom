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
      primaryQuery = sanitizeQuery([role, industry].filter(Boolean).join(" ")) ?? (role ?? args.user_request);
      input = { query: primaryQuery, location, role_keywords: roles.length ? roles : (role ? [role] : []), max_results: n };
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

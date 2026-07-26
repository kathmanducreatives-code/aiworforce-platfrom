// CANONICAL MISSION CONTEXT — the one bounded, prompt-safe projection of a
// workspace's Company Brain and ICP, shared by the future Lead, Signal and Content
// planners.
//
// WHAT THIS IS NOT: a second Company Brain loader. Workspace isolation, membership
// verification and brain compilation already exist and are correct in
// `_shared/getCompiledCompanyBrainForWorkspace.ts`. This module WRAPS that loader
// and adds only what a planner needs and the existing loader deliberately does not
// do: bounding, secret filtering, deterministic ordering, and an explicit
// confirmed-vs-inferred / hard-vs-soft split.
//
// WHY BOUND AT ALL. `CanonicalCompanyBrain` carries `compiled`, `normalized` and
// `completeness` escape hatches — the whole raw record. Handing that to a model is
// how a stored integration blob, a webhook URL or a pasted credential ends up in a
// prompt. A planner gets a projection, never a database row.
//
// PURE, except `loadMissionContext`, which delegates its one query to the existing
// loader. No new table, no write, no direct SQL.

import {
  getCompiledCompanyBrainForWorkspace,
  type BrainDbClient,
  type CanonicalCompanyBrain,
  type GetBrainOptions,
} from "../getCompiledCompanyBrainForWorkspace.ts";
import type { MissionCompanyBrain, MissionIcp } from "./mission.ts";

// ------------------------------------------------------------ size bounds ----
//
// Chosen to keep an assembled prompt bounded regardless of how large a workspace's
// brain grows. Every limit truncates deterministically (see `bounded`), so the same
// brain always yields the same context.

export const CONTEXT_LIMITS = {
  /** Maximum entries kept per list field. */
  maxListItems: 20,
  /** Maximum characters per individual string. */
  maxStringLength: 300,
  /** Maximum characters for the free-text description. */
  maxDescriptionLength: 1_000,
  /** Hard ceiling on the serialized context. Exceeding it is a bug, not a warning. */
  maxSerializedChars: 20_000,
} as const;

// --------------------------------------------------------- secret filtering --
//
// Field names that must never reach a prompt, matched case-insensitively against
// the KEY. Value-shaped detection is deliberately separate: a key called
// `notes` can still hold a pasted key.

const SECRET_KEY_RE =
  /(api[_-]?key|secret|password|passwd|token|bearer|authorization|credential|private[_-]?key|access[_-]?key|client[_-]?secret|session|cookie|signature|webhook[_-]?url|connection[_-]?string|dsn)/i;

/** Value shapes that look like credentials regardless of the key they arrived under. */
const SECRET_VALUE_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,            // OpenAI / Anthropic style
  /\bsk_(?:live|test)_[A-Za-z0-9]{10,}/, // Stripe
  /\bapify_api_[A-Za-z0-9]{10,}/i,
  /\bfc-[A-Za-z0-9]{20,}/,              // Firecrawl
  /\bghp_[A-Za-z0-9]{20,}/,             // GitHub
  /\bey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/, // JWT
  /\bAKIA[0-9A-Z]{16}\b/,               // AWS access key id
  /\b(?:api[_ -]?key|secret|password|token)\b\s*[:=]\s*\S{8,}/i,
];

/**
 * Value-shape detection applies to PRIMITIVES only.
 *
 * Stringifying a container to test it would condemn the whole container for one bad
 * element — a competitors list with a single pasted key would vanish entirely,
 * silently removing legitimate context. Containers are walked instead, so the one
 * offending element is dropped and its siblings survive.
 */
export function looksLikeSecret(key: string, value: unknown): boolean {
  if (SECRET_KEY_RE.test(String(key ?? ""))) return true;
  if (value === null || typeof value === "object") return false;
  const s = String(value ?? "");
  return SECRET_VALUE_RES.some((re) => re.test(s));
}

/** Drop every secret-shaped key/value, at any depth. Structure is otherwise kept. */
export function stripSecrets<T>(value: T): T {
  const walk = (v: unknown, key: string): unknown => {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${key}[${i}]`)).filter((x) => x !== undefined);
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>)) {
        const child = (v as Record<string, unknown>)[k];
        if (looksLikeSecret(k, child)) continue;
        out[k] = walk(child, k);
      }
      return out;
    }
    if (typeof v === "string" && SECRET_VALUE_RES.some((re) => re.test(v))) return undefined;
    return v;
  };
  return walk(value, "") as T;
}

// ---------------------------------------------------------------- bounding ---

function boundedString(v: unknown, max: number): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Bound a list: strip secrets, drop blanks, de-duplicate case-insensitively, sort
 * for determinism, then truncate. Sorting is what makes two loads of the same brain
 * produce the same prompt, and therefore the same input hash.
 */
export function bounded(values: unknown, limit = CONTEXT_LIMITS.maxListItems): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (raw === null || typeof raw === "object") continue;
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (SECRET_VALUE_RES.some((re) => re.test(s))) continue;
    const clipped = s.length > CONTEXT_LIMITS.maxStringLength ? s.slice(0, CONTEXT_LIMITS.maxStringLength) : s;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipped);
  }
  out.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  return out.slice(0, limit);
}

// ------------------------------------------------------------- the context ---

export interface MissionContext {
  workspace_id: string;
  company_brain: MissionCompanyBrain;
  icp: MissionIcp;
  /**
   * Honesty layer, carried straight through from the existing loader. A planner
   * that cannot see the brain is incomplete will confidently plan against a
   * fabricated ICP.
   */
  readiness: {
    brain_present: boolean;
    icp_present: boolean;
    setup_required: boolean;
    missing_fields: string[];
    warnings: string[];
  };
}

export type MissionContextError = "forbidden" | "not_found";

export interface MissionContextResult {
  ok: boolean;
  context: MissionContext | null;
  error?: MissionContextError;
}

/** An empty, safe context. Used when a workspace has no brain at all. */
export function emptyMissionContext(workspaceId: string): MissionContext {
  return {
    workspace_id: workspaceId,
    company_brain: {
      products: [], services: [], value_propositions: [], target_problems: [],
      proof_points: [], differentiators: [], competitors: [], exclusions: [],
      source_ids: [], confidence: 0,
    },
    icp: {
      industries: [], company_types: [], company_verticals: [], company_stages: [],
      geographies: [], target_roles: [], buying_problems: [], buying_signals: [],
      exclusions: [], hard_constraints: [], soft_preferences: [], source_ids: [], confidence: 0,
    },
    readiness: {
      brain_present: false, icp_present: false, setup_required: true,
      missing_fields: [], warnings: [],
    },
  };
}

/**
 * Project a loaded canonical brain into the bounded planner context.
 *
 * PURE — this is the half that tests exercise directly, so workspace isolation,
 * secret filtering, ordering and bounds are all provable without a database.
 *
 * `workspaceId` is the caller's authoritative workspace. When the loaded brain
 * carries a DIFFERENT one, that is a cross-tenant leak in the making, and this
 * returns the empty context rather than the mismatched brain. The existing loader
 * already scopes its query; this is defence in depth, not a substitute for it.
 */
export function buildMissionContext(
  workspaceId: string,
  brain: CanonicalCompanyBrain | null | undefined,
): MissionContext {
  if (!brain) return emptyMissionContext(workspaceId);

  // TENANT GUARD. Never project a brain belonging to another workspace.
  if (String(brain.workspace_id ?? "") !== String(workspaceId)) {
    return emptyMissionContext(workspaceId);
  }

  const safe = stripSecrets(brain) as CanonicalCompanyBrain;
  const summary = (safe.company_summary ?? {}) as Record<string, unknown>;
  const target = (safe.target_customer ?? {}) as CanonicalCompanyBrain["target_customer"];
  const positioning = (safe.positioning ?? {}) as CanonicalCompanyBrain["positioning"];
  const rules = (safe.qualification_rules ?? {}) as CanonicalCompanyBrain["qualification_rules"];

  const industries = bounded(target.industries);
  const buyers = bounded(rolesOf(safe.buyer_personas));

  // HARD vs SOFT. The brain's own qualification rules are hard: they say what makes
  // an account unqualified. Everything descriptive is a preference. Conflating them
  // is how a planner "optimizes away" a rule the workspace actually meant.
  const hard = bounded([...(rules.required_evidence ?? []), ...(rules.reject_if ?? [])]);
  const soft = bounded([...(rules.manual_review_if ?? []), ...bounded(target.segments)]);

  const icpPresent = industries.length > 0 || buyers.length > 0;

  return {
    workspace_id: workspaceId,
    company_brain: {
      company_name: boundedString(summary.name ?? summary.company_name, CONTEXT_LIMITS.maxStringLength),
      description: boundedString(summary.description ?? summary.what_we_do, CONTEXT_LIMITS.maxDescriptionLength),
      products: bounded((summary as { products?: unknown }).products),
      services: bounded((summary as { services?: unknown }).services),
      value_propositions: bounded([positioning.promise, ...(positioning.proof_themes ?? [])]),
      target_problems: bounded(safe.pain_points),
      proof_points: bounded(positioning.proof_themes),
      differentiators: bounded(safe.content_angles),
      competitors: bounded(safe.competitors),
      // Banned claims are exclusions with teeth: the workspace has said not to say them.
      exclusions: bounded([...(positioning.banned_claims ?? []), ...(safe.brand_voice?.banned_claims ?? [])]),
      source_ids: bounded(sourceIdsOf(safe)),
      confidence: confidenceOf(safe),
    },
    icp: {
      industries,
      company_types: bounded(target.business_models),
      company_verticals: bounded(target.categories),
      employee_range: rangeOf(target.company_size),
      company_stages: bounded(target.maturity_stage),
      geographies: bounded(target.geography),
      target_roles: buyers,
      buying_problems: bounded(safe.pain_points),
      buying_signals: bounded(flattenStrings(safe.triggers)),
      exclusions: bounded(flattenStrings(safe.disqualifiers)),
      hard_constraints: hard,
      soft_preferences: soft,
      source_ids: bounded(sourceIdsOf(safe)),
      confidence: confidenceOf(safe),
    },
    readiness: {
      brain_present: true,
      icp_present: icpPresent,
      setup_required: safe.setup_required === true || !icpPresent,
      missing_fields: bounded(safe.missing_fields),
      warnings: bounded(safe.warnings),
    },
  };
}

function labelOf(v: unknown): string {
  if (typeof v === "string") return v;
  const o = (v ?? {}) as Record<string, unknown>;
  return String(o.label ?? o.name ?? o.value ?? o.term ?? o.role ?? o.title ?? "").trim();
}

/**
 * Collect strings from a field that may be an array OR an object-of-arrays.
 *
 * The canonical brain uses both shapes: `competitors` is a flat array, while
 * `triggers` and `disqualifiers` are grouped objects (`{ hiring: [], funding: [] }`).
 * Keys are visited in sorted order so the result stays deterministic.
 */
function flattenStrings(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(labelOf).filter(Boolean);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: string[] = [];
    for (const k of Object.keys(o).sort()) out.push(...flattenStrings(o[k]));
    return out;
  }
  const s = String(v).trim();
  return s ? [s] : [];
}

/**
 * Target roles specifically.
 *
 * When `buyer_personas` is the grouped object, only `titles` is a target role —
 * flattening the whole object would pull `negative_title_keywords` in and turn an
 * exclusion into a target.
 */
function rolesOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(labelOf).filter(Boolean);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.titles)) return flattenStrings(o.titles);
  }
  return [];
}
function rangeOf(size: unknown): { min?: number; max?: number } | undefined {
  const o = (size ?? {}) as { min?: unknown; max?: unknown };
  const min = Number(o.min), max = Number(o.max);
  const has = Number.isFinite(min) || Number.isFinite(max);
  if (!has) return undefined;
  return {
    ...(Number.isFinite(min) ? { min } : {}),
    ...(Number.isFinite(max) ? { max } : {}),
  };
}
function sourceIdsOf(brain: CanonicalCompanyBrain): string[] {
  const compiled = (brain.compiled ?? {}) as unknown as Record<string, unknown>;
  const ids = compiled.source_ids ?? compiled.sources ?? [];
  return Array.isArray(ids) ? ids.map((x) => (typeof x === "string" ? x : String((x as { id?: unknown })?.id ?? ""))) : [];
}
function confidenceOf(brain: CanonicalCompanyBrain): number {
  const c = brain.brain_confidence as unknown;
  const n = typeof c === "number" ? c : Number((c as { score?: unknown })?.score);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Serialized size of a context, for the prompt-budget assertion. */
export function contextSize(ctx: MissionContext): number {
  return JSON.stringify(ctx).length;
}

export function withinPromptBudget(ctx: MissionContext): boolean {
  return contextSize(ctx) <= CONTEXT_LIMITS.maxSerializedChars;
}

// ---------------------------------------------------------------- the load ---

/**
 * Load and project one workspace's context.
 *
 * The query, the membership check and the tenant scope are the EXISTING loader's
 * job and are not reimplemented here. This adds the projection and re-asserts the
 * tenant match on the way out.
 */
export async function loadMissionContext(
  db: BrainDbClient,
  workspaceId: string,
  opts: GetBrainOptions = {},
): Promise<MissionContextResult> {
  const res = await getCompiledCompanyBrainForWorkspace(db, workspaceId, opts);
  if (!res.ok) {
    return { ok: false, context: null, error: res.error };
  }
  return { ok: true, context: buildMissionContext(workspaceId, res.brain) };
}

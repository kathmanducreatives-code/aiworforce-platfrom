// Company Brain v2 save + activation (Onboarding v3, Phase 4).
//
// The ONLY place onboarding writes a Brain. It merges a v2 patch onto the
// existing profile without clobbering legacy top-level keys, recomputes the
// derived flags (setup_status / brain_confidence / missing_fields) from the
// normalizer + completeness rules, and decides whether the workspace may be
// marked `onboarding_completed`.
//
// Hard rule: a Brain that does not meet the minimum requirements can be SAVED
// as a draft but can NEVER be activated. Radar/Leads/Content trust that flag.
//
// Pure (no DB, no network) → fully unit-testable.

import { normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";
import { computeCompanyBrainCompleteness, type CompletenessResult } from "./companyBrainCompleteness.ts";

/** Fields a caller may write. Derived flags are never accepted from the client. */
export type CompanyBrainV2Patch = Partial<Omit<
  CompanyBrainV2,
  "schema_version" | "legacy" | "setup_required" | "brain_confidence" | "setup_status" | "missing_fields"
>>;

const DERIVED_KEYS = new Set([
  "schema_version", "legacy", "setup_required", "brain_confidence", "setup_status", "missing_fields",
]);

/**
 * Merge a v2 patch onto an existing raw profile.
 * - arrays replace wholesale (the user's edit is authoritative)
 * - objects shallow-merge (so a partial `company` patch keeps other keys)
 * - unknown/legacy top-level keys are preserved untouched
 * - client-supplied derived flags are ignored
 */
export function mergeV2Patch(
  existing: Record<string, unknown> | null | undefined,
  patch: CompanyBrainV2Patch,
): Record<string, unknown> {
  const base: Record<string, unknown> = existing && typeof existing === "object" ? { ...existing } : {};
  base.schema_version = 2;

  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v == null || DERIVED_KEYS.has(k)) continue;
    if (Array.isArray(v)) { base[k] = v; continue; }
    if (typeof v === "object") {
      const cur = base[k] && typeof base[k] === "object" && !Array.isArray(base[k])
        ? (base[k] as Record<string, unknown>) : {};
      base[k] = { ...cur, ...(v as Record<string, unknown>) };
      continue;
    }
    base[k] = v;
  }
  return base;
}

export interface SaveOptions {
  /** Caller asked to ACTIVATE (finish onboarding), not just save a draft. */
  activate?: boolean;
}

export interface SaveResult {
  /** The raw profile JSONB to persist. */
  profile: Record<string, unknown>;
  /** Normalized view of what was saved. */
  normalized: CompanyBrainV2;
  completeness: CompletenessResult;
  /** Only ever true when activate was requested AND every requirement is met. */
  onboarding_completed: boolean;
  /** Why activation was refused (empty when it succeeded or wasn't requested). */
  blocked_reasons: string[];
}

/**
 * Apply an onboarding patch and compute the resulting save decision.
 * Never marks a Brain complete unless it truly is.
 */
export function applyBrainSave(
  existing: Record<string, unknown> | null | undefined,
  patch: CompanyBrainV2Patch,
  opts: SaveOptions = {},
): SaveResult {
  const merged = mergeV2Patch(existing, patch);

  // Recompute every derived flag from the merged truth — writers can't fake them.
  const normalized = normalizeCompanyBrain(merged);
  const completeness = computeCompanyBrainCompleteness(normalized);

  const wantsActivate = !!opts.activate;
  const onboarding_completed = wantsActivate && completeness.complete;
  const blocked_reasons = wantsActivate && !completeness.complete
    ? completeness.missing.map((m) => `Missing: ${m}`)
    : [];

  merged.setup_status = onboarding_completed
    ? "complete"
    : (completeness.required_met > 0 ? "in_progress" : "incomplete");
  merged.brain_confidence = completeness.confidence;
  merged.missing_fields = completeness.missing_keys;
  // Once activated the Brain is no longer a draft.
  merged.is_draft = onboarding_completed ? false : (merged.is_draft === true);

  return {
    profile: merged,
    normalized: normalizeCompanyBrain(merged),
    completeness,
    onboarding_completed,
    blocked_reasons,
  };
}

/**
 * Derive signal_preferences from the Brain so Radar has usable defaults without
 * a second setup step. Only emits keys the Brain can actually support.
 */
export function deriveSignalPreferences(brain: CompanyBrainV2): Record<string, unknown> {
  const prefs: Record<string, unknown> = {};
  if (brain.target_customer.industries.length) prefs.industries = brain.target_customer.industries;
  if (brain.buyer_personas.length) prefs.hiring_roles = brain.buyer_personas;
  if (brain.competitors.length) prefs.competitors = brain.competitors;
  if (brain.pain_points.length) prefs.pain_points = brain.pain_points;
  if (brain.content_angles.length) prefs.linkedin_topics = brain.content_angles;
  if (brain.target_customer.geography.length) prefs.geographies = brain.target_customer.geography;
  const disq = brain.target_customer.disqualifiers;
  if (disq.industries.length) prefs.disqualifiers = disq.industries;
  if (disq.keywords.length) prefs.negative_keywords = disq.keywords;
  return prefs;
}

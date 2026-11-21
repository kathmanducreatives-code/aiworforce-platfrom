// Company Brain UPDATE — the one write path for editing an existing Brain.
//
// WHY THIS EXISTS
//   Onboarding saved through applyBrainSave, which projects the structured (v2)
//   Brain back into the legacy `profile.icp` block. The Company Brain page wrote
//   the row directly with a shallow merge and never ran that projection. Three
//   readers then disagreed after a single edit (docs/audits/company-brain-
//   onboarding, Appendix A):
//
//     · the agent prompt block read the STALE legacy `icp.*`,
//     · the lead compiler UNIONED v2 with the stale legacy copy and with the
//       radar's `signal_preferences` copy,
//     · and a cleared field came back, because the legacy copy still held it.
//
//   This module makes the structured Brain authoritative at the WRITE: every
//   update recomputes the legacy mirror from the structured truth — empties
//   included — and removes, from the radar's derived copy, every value the Brain
//   no longer holds. The lead compiler's unions then return exactly the
//   structured answer, without editing the compiler.
//
// WHAT IT REUSES
//   resolveOriginAwareSave (origin `manual_edit`), mergeV2Patch, the normalizer
//   and the completeness rules — the same pieces onboarding's save uses.
//
// Pure — no DB, no network, no model. The edge handler owns the conditional
// write that makes the version check atomic.
import { mergeV2Patch, type CompanyBrainV2Patch } from "./companyBrainV2Save.ts";
import { normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";
import { computeCompanyBrainCompleteness } from "./companyBrainCompleteness.ts";
import { resolveOriginAwareSave } from "./companyBrainOriginSave.ts";
import { reconcileDerivedCopies, structuredAuthoritative } from "./companyBrainMirror.ts";

// Re-exported: callers and tests import them from here since #147.
export { mirrorLegacyIcp, reconcileDerivedCopies, structuredAuthoritative } from "./companyBrainMirror.ts";

type Raw = Record<string, unknown>;

/** Top-level keys an update may write. Derived flags and legacy blocks are never client-writable. */
export const UPDATABLE_KEYS = new Set([
  "company", "founder", "target_customer", "buyer_personas", "triggers", "jobs_to_watch",
  "competitors", "tools", "pain_points", "positive_examples", "negative_examples",
  "content_angles", "positioning", "brand_voice", "qualification_rules", "signal_preferences",
  // Company Brain V2 (B2.0): goals, go-to-market and evidence are completed on
  // the Brain page. Their shape is fixed by COMPLETION_SHAPES below.
  "goals", "gtm", "evidence",
]);

/**
 * B2.0 · The only fields `goals`, `gtm` and `evidence` may carry, and their
 * types. Anything else in such a patch is refused, so the update path cannot be
 * used to store arbitrary blobs in the profile.
 */
export const COMPLETION_SHAPES: Readonly<Record<"goals" | "gtm" | "evidence", Readonly<Record<string, "text" | "list">>>> = {
  goals: { gtm: "text", content: "text", competitor_tracking: "text", outreach: "text", hiring: "text" },
  gtm: { motion: "text", primary_channel: "text", preferred_channels: "list", biggest_bottleneck: "text", current_tools: "list", thirty_day_goal: "text" },
  evidence: { source_pages: "list", linkedin_sources: "list", confidence_notes: "list" },
};
const MAX_TEXT = 500;
const MAX_ITEMS = 25;

/** Validate and clean a `goals` / `gtm` / `evidence` patch. Returns the error, or the cleaned object. */
export function sanitizeCompletionPatch(top: "goals" | "gtm" | "evidence", value: unknown): { ok: true; value: Raw } | { ok: false; detail: string } {
  if (!isObj(value)) return { ok: false, detail: `${top} must be an object` };
  const shape = COMPLETION_SHAPES[top];
  const out: Raw = {};
  for (const [k, v] of Object.entries(value)) {
    const kind = shape[k];
    if (!kind) return { ok: false, detail: `${top}.${k} is not a known field` };
    if (kind === "text") {
      if (v != null && typeof v !== "string") return { ok: false, detail: `${top}.${k} must be text` };
      out[k] = typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
    } else {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return { ok: false, detail: `${top}.${k} must be a list of text` };
      const seen = new Set<string>();
      out[k] = (v as string[]).map((x) => x.trim().slice(0, MAX_TEXT)).filter((x) => {
        const key = x.toLowerCase();
        if (!x || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_ITEMS);
    }
  }
  return { ok: true, value: out };
}

export interface BrainUpdateInput {
  /** The stored profile, or null when the workspace has no Brain row. */
  existing: Raw | null;
  /** `company_brain.updated_at` as stored. */
  currentUpdatedAt: string | null;
  /** The version the editor loaded. Required — an update never writes blind. */
  expectedUpdatedAt: unknown;
  patch: unknown;
  /** `onboarding_completed` on the row. An edit never activates or deactivates. */
  alreadyActive: boolean;
}

export type BrainUpdateRejection = "brain_not_found" | "missing_expected_version" | "stale" | "invalid_patch";

export type BrainUpdatePlan =
  | { ok: false; reason: BrainUpdateRejection; detail?: string }
  | { ok: true; profile: Raw; normalized: CompanyBrainV2; applied_paths: string[] };

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);

export function planBrainUpdate(i: BrainUpdateInput): BrainUpdatePlan {
  if (!i.existing) return { ok: false, reason: "brain_not_found" };
  if (typeof i.expectedUpdatedAt !== "string" || !i.expectedUpdatedAt) {
    return { ok: false, reason: "missing_expected_version" };
  }
  if (i.currentUpdatedAt !== i.expectedUpdatedAt) return { ok: false, reason: "stale" };
  if (!isObj(i.patch)) return { ok: false, reason: "invalid_patch", detail: "patch must be an object" };
  const unknown = Object.keys(i.patch).filter((k) => !UPDATABLE_KEYS.has(k));
  if (unknown.length) return { ok: false, reason: "invalid_patch", detail: `not updatable: ${unknown.join(", ")}` };
  const cleanPatch: Raw = { ...i.patch };
  for (const top of ["goals", "gtm", "evidence"] as const) {
    if (!(top in cleanPatch)) continue;
    const r = sanitizeCompletionPatch(top, cleanPatch[top]);
    if (!r.ok) return { ok: false, reason: "invalid_patch", detail: r.detail };
    cleanPatch[top] = r.value;
  }

  const decision = resolveOriginAwareSave({
    existing: i.existing,
    patch: cleanPatch,
    origin: "manual_edit",
    expectedUpdatedAt: i.expectedUpdatedAt,
    currentUpdatedAt: i.currentUpdatedAt,
  });
  if (!decision.ok) return { ok: false, reason: "invalid_patch", detail: decision.rejected_reason };

  const before = normalizeCompanyBrain(i.existing);
  const merged = mergeV2Patch(i.existing, decision.safe_patch as CompanyBrainV2Patch);
  // The truth to mirror. The normalizer falls back to the legacy copy when a
  // structured list is empty — read through it here and a cleared list would be
  // re-derived from the very copy it is meant to overwrite.
  const after = normalizeCompanyBrain(structuredAuthoritative(merged));

  // Derived flags, recomputed — never taken from the client. An edit keeps the
  // activation it found: the row's `onboarding_completed` is not written here.
  const completeness = computeCompanyBrainCompleteness(after);
  merged.setup_status = i.alreadyActive
    ? (completeness.complete ? "complete" : "in_progress")
    : (completeness.required_met > 0 ? "in_progress" : "incomplete");
  merged.brain_confidence = completeness.confidence;
  merged.missing_fields = completeness.missing_keys;
  merged.is_draft = i.alreadyActive ? false : merged.is_draft === true;

  reconcileDerivedCopies(merged, before, i.existing, after, "signal_preferences" in cleanPatch);

  return { ok: true, profile: merged, normalized: normalizeCompanyBrain(merged), applied_paths: decision.applied_paths };
}

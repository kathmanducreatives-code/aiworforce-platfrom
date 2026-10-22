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
import { flattenDisqualifiers, normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";
import { computeCompanyBrainCompleteness } from "./companyBrainCompleteness.ts";
import { resolveOriginAwareSave } from "./companyBrainOriginSave.ts";

type Raw = Record<string, unknown>;

/** Top-level keys an update may write. Derived flags and legacy blocks are never client-writable. */
export const UPDATABLE_KEYS = new Set([
  "company", "founder", "target_customer", "buyer_personas", "triggers", "jobs_to_watch",
  "competitors", "tools", "pain_points", "positive_examples", "negative_examples",
  "content_angles", "positioning", "brand_voice", "qualification_rules", "signal_preferences",
]);

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
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

export function planBrainUpdate(i: BrainUpdateInput): BrainUpdatePlan {
  if (!i.existing) return { ok: false, reason: "brain_not_found" };
  if (typeof i.expectedUpdatedAt !== "string" || !i.expectedUpdatedAt) {
    return { ok: false, reason: "missing_expected_version" };
  }
  if (i.currentUpdatedAt !== i.expectedUpdatedAt) return { ok: false, reason: "stale" };
  if (!isObj(i.patch)) return { ok: false, reason: "invalid_patch", detail: "patch must be an object" };
  const unknown = Object.keys(i.patch).filter((k) => !UPDATABLE_KEYS.has(k));
  if (unknown.length) return { ok: false, reason: "invalid_patch", detail: `not updatable: ${unknown.join(", ")}` };

  const decision = resolveOriginAwareSave({
    existing: i.existing,
    patch: i.patch,
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

  reconcileDerivedCopies(merged, before, i.existing, after, "signal_preferences" in i.patch);

  return { ok: true, profile: merged, normalized: normalizeCompanyBrain(merged), applied_paths: decision.applied_paths };
}

/**
 * The raw profile with each legacy `icp` field removed wherever its structured
 * counterpart is present, so normalizing it yields the structured truth — an
 * explicit empty list stays empty. A legacy-only profile (no structured field)
 * keeps its legacy values: there, they ARE the truth.
 */
export function structuredAuthoritative(raw: Raw): Raw {
  if (!isObj(raw.icp)) return raw;
  const tc = isObj(raw.target_customer) ? raw.target_customer : {};
  const icp: Raw = { ...raw.icp };
  if (Array.isArray(tc.industries)) delete icp.industries;
  if (Array.isArray(raw.buyer_personas)) delete icp.buyer_roles;
  if (isObj(tc.disqualifiers)) delete icp.disqualifiers;
  if (isObj(tc.company_size)) delete icp.company_size;
  if (Array.isArray(tc.geography)) delete icp.geography;
  if (Array.isArray(raw.pain_points)) delete icp.pain_points;
  return { ...raw, icp };
}

/**
 * Bring every copy the readers union back in line with the structured Brain.
 * Mutates `merged`.
 *
 * · `icp.*` (legacy) becomes an exact mirror — empty lists included, so a clear
 *   clears. Other legacy `icp` keys are kept.
 * · `signal_preferences` (the radar's copy) loses every value the Brain held
 *   before — in its structured OR legacy form — and no longer holds. Values the
 *   radar alone was given are kept. Skipped when this update edits the radar
 *   preferences itself: then the user's list is the truth.
 * · `competitors.known` (legacy object) loses removed competitors the same way.
 */
export function reconcileDerivedCopies(
  merged: Raw,
  before: CompanyBrainV2,
  existingRaw: Raw,
  after: CompanyBrainV2,
  radarEditedDirectly: boolean,
): void {
  merged.icp = mirrorLegacyIcp(merged.icp, after, merged.target_customer);

  const oldIcp = isObj(existingRaw.icp) ? existingRaw.icp : {};
  const removed = (structuredBefore: string[], legacyBefore: string[], now: string[]): Set<string> => {
    const keep = lower(now);
    return new Set([...structuredBefore, ...legacyBefore].map((x) => x.toLowerCase()).filter((x) => !keep.has(x)));
  };
  const tc = (b: CompanyBrainV2) => b.target_customer;
  const drops: Record<string, Set<string>> = {
    industries: removed(tc(before).industries, strings(oldIcp.industries), tc(after).industries),
    hiring_roles: removed(before.buyer_personas, strings(oldIcp.buyer_roles), after.buyer_personas),
    competitors: removed(before.competitors, [], after.competitors),
    pain_points: removed(before.pain_points, strings(oldIcp.pain_points), after.pain_points),
    linkedin_topics: removed(before.content_angles, [], after.content_angles),
    geographies: removed(tc(before).geography, [], tc(after).geography),
    disqualifiers: removed(tc(before).disqualifiers.industries, strings(oldIcp.disqualifiers), tc(after).disqualifiers.industries),
    negative_keywords: removed(tc(before).disqualifiers.keywords, [], tc(after).disqualifiers.keywords),
  };

  if (!radarEditedDirectly && isObj(merged.signal_preferences)) {
    const prefs: Raw = { ...merged.signal_preferences };
    for (const [key, drop] of Object.entries(drops)) {
      if (!drop.size || !Array.isArray(prefs[key])) continue;
      prefs[key] = strings(prefs[key]).filter((v) => !drop.has(v.toLowerCase()));
    }
    merged.signal_preferences = prefs;
  }

  if (isObj(merged.competitors) && Array.isArray(merged.competitors.known) && drops.competitors.size) {
    merged.competitors = {
      ...merged.competitors,
      known: strings(merged.competitors.known).filter((v) => !drops.competitors.has(v.toLowerCase())),
    };
  }
}

/**
 * The legacy `icp` block as an exact projection of the structured Brain. Unlike
 * `mergeLegacyIcpProjection` (onboarding), an empty structured list writes an
 * empty legacy list. The size is the STRUCTURED size only: the normalizer's
 * fallback to the seller's own `company.team_size` is never copied into the
 * legacy block, where it would outlive a fix to that fallback.
 */
export function mirrorLegacyIcp(existingIcp: unknown, v2: CompanyBrainV2, rawTargetCustomer: unknown): Raw {
  const base: Raw = isObj(existingIcp) ? { ...existingIcp } : {};
  const t = v2.target_customer;
  const rawSize = isObj(rawTargetCustomer) && isObj(rawTargetCustomer.company_size) ? rawTargetCustomer.company_size : {};
  const label = typeof rawSize.label === "string" ? rawSize.label.trim() : "";
  const min = typeof rawSize.min === "number" ? rawSize.min : null;
  const max = typeof rawSize.max === "number" ? rawSize.max : null;
  base.industries = [...t.industries];
  base.buyer_roles = [...v2.buyer_personas];
  base.disqualifiers = flattenDisqualifiers(t.disqualifiers);  // the same flattening onboarding writes
  base.company_size = label || (min != null && max != null ? `${min}-${max} employees` : "");
  base.geography = t.geography[0] ?? "";
  base.pain_points = [...v2.pain_points];
  return base;
}

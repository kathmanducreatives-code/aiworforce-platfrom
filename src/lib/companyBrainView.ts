// View-model helpers for the saved Company Brain dashboard.
// Reads the raw `company_brain.profile` JSON, normalizes it into v2, and
// exposes a mutable copy that section editors can patch. Writes go back to
// `company_brain.profile` as a shallow merge that preserves any fields the
// saved view does not know about (evidence, suggested_fixes, signal_preferences,
// legacy top-level keys, etc.).

import { normalizeCompanyBrain, type CompanyBrainV2 } from './normalizeCompanyBrain';

export type BrainProfile = Record<string, unknown>;

export interface SavedBrainView {
  /** Normalized read model (safe defaults for missing fields). */
  brain: CompanyBrainV2;
  /** The raw profile as stored — used as the merge base for patches. */
  raw: BrainProfile;
}

export function toSavedBrainView(profile: BrainProfile | null | undefined): SavedBrainView {
  const raw = (profile ?? {}) as BrainProfile;
  return { brain: normalizeCompanyBrain(raw), raw };
}

/** Shallow-merge a partial patch onto the raw profile. Top-level keys only. */
export function mergeProfilePatch(raw: BrainProfile, patch: BrainProfile): BrainProfile {
  return { ...raw, ...patch };
}

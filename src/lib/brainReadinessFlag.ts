// Roadmap Phase 2 switch for the frontend: VITE_BRAIN_READINESS_V2=true makes the
// route guard and the capability pages follow companyBrainReadiness instead of
// the single `onboarding_completed` flag. Off (default): unchanged behaviour.
// The backend has its own switch (BRAIN_READINESS_V2); turn the backend on first.

import { companyBrainReadiness, type BrainReadiness } from './companyBrainReadiness';
import { normalizeCompanyBrain } from './normalizeCompanyBrain';

export function brainReadinessV2(): boolean {
  // Cast: Deno (tests) has no Vite types; esbuild strips it, so Vite still sees import.meta.env.
  return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_BRAIN_READINESS_V2 === 'true';
}

interface BrainRow { profile?: unknown; onboarding_completed?: boolean | null }

/** Readiness of a loaded `company_brain` row, or null while it is unknown. */
export function readinessOfRow(row: BrainRow | null | undefined): BrainReadiness | null {
  if (!row) return null;
  return companyBrainReadiness(normalizeCompanyBrain((row.profile ?? {}) as Record<string, unknown>), row.onboarding_completed === true);
}

/** For the route guard: true only with the switch on and a Brain that is usable but not activated. */
export function brainUsableForRoutes(row: BrainRow | null | undefined, enabled = brainReadinessV2()): boolean {
  return enabled && readinessOfRow(row)?.state === 'usable';
}

// The onboarding progress request and its answer, for either Brain scope
// (roadmap Phase 2; client scope is Phase 3c, held). Pure: no network, no
// React, no app client — the page sends it through onboardingProgressSave and
// the database-contract lane drives the real handler with it.
import type { Answers, ProgressSaveOutcome } from './onboardingAutosave';
import { AGENCY_SCOPE, brainScopeBody, type BrainScope } from './brainScope';

export type ProgressSaveResult = ProgressSaveOutcome;

export interface ProgressSaveInput {
  workspaceId: string; step: number; answers: Answers;
  /** The version this save builds on: updated_at for the agency Brain, the integer version (as a string) for a client's. */
  expectedUpdatedAt: string | null;
  /** Which Brain. Omitted = the agency Brain, exactly as before (Phase 3c, held). */
  scope?: BrainScope;
}

/** The request body. The agency body is unchanged; a client body names its client and its integer version. */
export function buildProgressSaveBody(input: ProgressSaveInput): Record<string, unknown> {
  const scope = input.scope ?? AGENCY_SCOPE;
  const body: Record<string, unknown> = {
    action: 'save_draft',
    workspace_id: input.workspaceId,
    patch: {},
    change_origin: 'onboarding_seller_confirmation',
    setup: { step: input.step, answers: input.answers },
  };
  if (scope.kind === 'agency') {
    body.expected_updated_at = input.expectedUpdatedAt;
  } else {
    Object.assign(body, brainScopeBody(scope));
    body.expected_version = input.expectedUpdatedAt === null ? null : Number(input.expectedUpdatedAt);
  }
  return body;
}

/** The server's answer as an autosave outcome, for either scope. */
export function readProgressSaveResponse(body: Record<string, unknown> | null, errorMessage?: string): ProgressSaveResult {
  const versionOf = (v: unknown, u: unknown) =>
    typeof v === 'number' ? String(v) : typeof u === 'string' ? u : null;
  if (body?.ok === true) return { kind: 'saved', updatedAt: versionOf(body.version, body.updated_at) };
  if (body?.rejected_reason === 'stale') {
    return { kind: 'stale', serverProfile: body.profile ?? null, currentUpdatedAt: versionOf(body.current_version, body.current_updated_at) };
  }
  return { kind: 'failed', message: String(body?.detail ?? body?.rejected_reason ?? body?.reason ?? body?.error ?? errorMessage ?? 'save failed') };
}

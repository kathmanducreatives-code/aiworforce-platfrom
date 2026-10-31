// The one way the app EDITS a Company Brain: the authorized backend `update`
// action (generate-company-brain-draft). It runs the same origin-aware save as
// onboarding, keeps the legacy copies agents and lead search read in line with
// the structured Brain, and refuses a write built on an out-of-date copy.
//
// Pages never write `company_brain` directly. A direct write skipped all of
// that, which is how the page, the agents and lead search came to disagree
// (docs/audits/company-brain-onboarding).
import { supabase } from '@/integrations/supabase/client';

export type BrainProfile = Record<string, unknown>;

export interface BrainSaveResult {
  ok: boolean;
  /** Set when ok. */
  profile?: BrainProfile;
  updatedAt?: string;
  /** The Brain changed since it was loaded (another tab, a teammate, onboarding): reload and redo the edit. */
  conflict?: boolean;
  /** Why it failed, in words for a person. */
  message?: string;
}

export async function saveCompanyBrainPatch(input: {
  workspaceId: string;
  /** Top-level structured keys only (company, target_customer, positioning, signal_preferences, …). */
  patch: BrainProfile;
  /** `company_brain.updated_at` of the copy being edited. */
  expectedUpdatedAt: string | null;
}): Promise<BrainSaveResult> {
  if (!input.expectedUpdatedAt) {
    return { ok: false, conflict: true, message: 'The Company Brain is still loading. Try again in a moment.' };
  }
  const { data, error } = await supabase.functions.invoke('generate-company-brain-draft', {
    body: {
      action: 'update',
      workspace_id: input.workspaceId,
      patch: input.patch,
      expected_updated_at: input.expectedUpdatedAt,
    },
  });
  // supabase-js reports a non-2xx as `error` and keeps the body on `error.context`.
  const body = (data ?? (await readErrorBody(error))) as Record<string, unknown> | null;
  if (body?.ok === true && typeof body.updated_at === 'string') {
    return { ok: true, profile: (body.profile ?? {}) as BrainProfile, updatedAt: body.updated_at };
  }
  if (body?.rejected_reason === 'stale') {
    return { ok: false, conflict: true, message: 'The Company Brain was changed elsewhere. Showing the latest version — please make your change again.' };
  }
  const reason = typeof body?.detail === 'string' ? body.detail : typeof body?.rejected_reason === 'string' ? body.rejected_reason : error?.message;
  return { ok: false, conflict: false, message: reason || 'Save failed' };
}

async function readErrorBody(error: unknown): Promise<unknown> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

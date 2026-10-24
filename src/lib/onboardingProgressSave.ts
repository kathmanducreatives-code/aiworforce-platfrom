// Saves onboarding progress to the server (roadmap Phase 2): `save_draft` with
// `setup` and the version it builds on. The Brain itself is not touched by an
// autosave (empty patch) — the explicit "Save draft" / "Activate" still save it.
import { supabase } from '@/integrations/supabase/client';
import type { Answers } from './onboardingAutosave';

export type ProgressSaveResult =
  | { kind: 'saved'; updatedAt: string | null }
  | { kind: 'stale'; serverProfile: unknown; currentUpdatedAt: string | null }
  | { kind: 'failed'; message: string };

export async function saveOnboardingProgress(input: {
  workspaceId: string; step: number; answers: Answers; expectedUpdatedAt: string | null;
}): Promise<ProgressSaveResult> {
  const { data, error } = await supabase.functions.invoke('generate-company-brain-draft', {
    body: {
      action: 'save_draft',
      workspace_id: input.workspaceId,
      patch: {},
      change_origin: 'onboarding_seller_confirmation',
      setup: { step: input.step, answers: input.answers },
      expected_updated_at: input.expectedUpdatedAt,
    },
  });
  const body = (data ?? (await readErrorBody(error))) as Record<string, unknown> | null;
  if (body?.ok === true) return { kind: 'saved', updatedAt: typeof body.updated_at === 'string' ? body.updated_at : null };
  if (body?.rejected_reason === 'stale') {
    return { kind: 'stale', serverProfile: body.profile ?? null, currentUpdatedAt: typeof body.current_updated_at === 'string' ? body.current_updated_at : null };
  }
  return { kind: 'failed', message: String(body?.detail ?? body?.rejected_reason ?? error?.message ?? 'save failed') };
}

async function readErrorBody(error: unknown): Promise<unknown> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

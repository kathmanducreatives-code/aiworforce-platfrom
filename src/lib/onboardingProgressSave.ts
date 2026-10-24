// Saves onboarding progress to the server (roadmap Phase 2): `save_draft` with
// `setup` and the version it builds on. The Brain itself is not touched by an
// autosave (empty patch) — the explicit "Save draft" / "Activate" still save it.
import { supabase } from '@/integrations/supabase/client';
import { buildProgressSaveBody, readProgressSaveResponse, type ProgressSaveInput, type ProgressSaveResult } from './brainProgressRequest';

export type { ProgressSaveInput, ProgressSaveResult };

export async function saveOnboardingProgress(input: ProgressSaveInput): Promise<ProgressSaveResult> {
  const { data, error } = await supabase.functions.invoke('generate-company-brain-draft', { body: buildProgressSaveBody(input) });
  const body = (data ?? (await readErrorBody(error))) as Record<string, unknown> | null;
  return readProgressSaveResponse(body, error?.message);
}

async function readErrorBody(error: unknown): Promise<unknown> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

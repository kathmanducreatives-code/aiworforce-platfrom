// The page's `invoke` for client Brain requests (Phase 3c, held): sends a body
// to generate-company-brain-draft and returns the response body, including the
// body of a non-2xx answer (supabase-js keeps it on `error.context`).
import { supabase } from '@/integrations/supabase/client';
import { buildBrainUpdateBody, readBrainUpdateResponse, type BrainInvoke, type BrainPatchResult, type BrainProfile } from './clientBrainApi';
import type { BrainScope } from './brainScope';

export const invokeBrain: BrainInvoke = async (body) => {
  const { data, error } = await supabase.functions.invoke('generate-company-brain-draft', { body });
  if (data) return data as Record<string, unknown>;
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== 'function') return error ? { error: error.message } : null;
  try { return (await ctx.json()) as Record<string, unknown>; } catch { return null; }
};

/** A manual edit of one CLIENT's Brain, built on the version the page loaded. */
export async function saveClientBrainPatch(input: {
  workspaceId: string; scope: Extract<BrainScope, { kind: 'client' }>; patch: BrainProfile; expectedVersion: number | null;
}): Promise<BrainPatchResult> {
  const body = await invokeBrain(buildBrainUpdateBody({
    workspaceId: input.workspaceId, scope: input.scope, patch: input.patch,
    expectedVersion: input.expectedVersion === null ? null : String(input.expectedVersion),
  }));
  return readBrainUpdateResponse(input.scope, body);
}

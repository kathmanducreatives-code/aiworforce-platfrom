// THE CONTENT SERVICE — one typed surface, whatever the entrypoint.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Content had four ways in — the page, signal cards, the prompt box, chat — and
// each built its own English sentence and dispatched it. Nothing shared a
// contract, so "generate from a signal" meant something slightly different in
// every one of them, and none of them persisted anything.
//
// Every caller now goes through here. The Content page, the signal buttons and
// (next) Pilot produce the SAME `content_item` and the SAME version, because
// they call the same operations with the same typed request.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
//
// No provider, no model, no key, no prompt assembly beyond the brief. The
// backend chooses the text provider (`aiProvider`) and the image provider
// (`imageProvider`), and the Company Brain is assembled server-side by the
// loader `run-agent` already uses. A frontend that named a model would be a
// frontend that has to be redeployed to change one.

import { supabase } from '@/integrations/supabase/client';
import {
  createContentItem, updateContentItem, listContentItems, getContentItem,
  listContentItemVersions,
  type ContentFormat, type ContentSourceType, type ContentStatus, type ContentItem,
} from '@/lib/content/contentItems';
import { buildContentInstruction } from '@/lib/content/contentInstruction';
import { generateContentDraft } from '@/lib/content/generateContentDraft';

/** What a caller asks for, wherever it is calling from. */
export interface ContentGenerationRequest {
  workspaceId: string;
  contentType: ContentFormat;
  sourceType: ContentSourceType;
  sourceSignalId?: string | null;
  /** The signal's own title, used to brief Scribe. Never a substitute for the id. */
  sourceSignalTitle?: string | null;
  /** The user's words. Required for an idea; an optional angle on a signal. */
  idea?: string;
  existingContentItemId?: string | null;
  operation: ContentOperation;
}

export type ContentOperation =
  | 'create'
  | 'regenerate_text'
  | 'generate_image'
  | 'regenerate_image';

export interface ContentResult {
  ok: boolean;
  item?: ContentItem | null;
  assetId?: string | null;
  error?: string;
}

/**
 * Create a draft and ask Scribe for the copy.
 *
 * THE ROW EXISTS BEFORE THE MODEL IS CALLED, always. A failed generation then
 * leaves the user a draft to retry rather than a toast and nothing — which is
 * what every Content action used to leave.
 */
export async function createContent(req: ContentGenerationRequest): Promise<ContentResult> {
  if (!req.workspaceId) return { ok: false, error: 'no_workspace' };
  if (req.sourceType === 'signal' && !req.sourceSignalId) {
    // The database enforces this too; refusing here gives a better message than
    // a constraint violation.
    return { ok: false, error: 'signal_source_requires_signal_id' };
  }

  const instruction = buildContentInstruction({
    format: req.contentType,
    sourceType: req.sourceType,
    idea: req.idea ?? '',
    signalTitle: req.sourceSignalTitle ?? null,
  });

  const { item, error } = await createContentItem({
    workspace_id: req.workspaceId,
    title: req.sourceType === 'signal'
      ? (req.sourceSignalTitle ?? 'From a signal')
      : (req.idea ?? '').slice(0, 80),
    format: req.contentType,
    source: 'content_surface',
    source_type: req.sourceType,
    source_signal_id: req.sourceSignalId ?? null,
    body: '',
    metadata: { brief: instruction, topic: req.idea || req.sourceSignalTitle },
  });
  if (error || !item) return { ok: false, error: error ?? 'content_create_failed' };

  const gen = await generateContentDraft({
    contentItemId: item.id,
    workspaceId: req.workspaceId,
    instruction,
    format: req.contentType,
    topic: req.idea || req.sourceSignalTitle,
    relatedSignalIds: req.sourceSignalId ? [req.sourceSignalId] : [],
  });
  // The draft is real either way. Only the generation failed, and saying so
  // truthfully is what lets the user press Regenerate.
  if (!gen.ok) return { ok: false, item, error: gen.error ?? 'generation_failed' };

  const fresh = await getContentItem(item.id);
  return { ok: true, item: fresh.item ?? item };
}

/**
 * Ask Scribe to write it again, from the draft's OWN stored brief.
 *
 * Writes a new version; the previous wording stays readable. Text regeneration
 * never touches the image — separate cost, separate decision.
 */
export async function regenerateContentText(
  workspaceId: string, item: ContentItem,
): Promise<ContentResult> {
  const gen = await generateContentDraft({
    contentItemId: item.id,
    workspaceId,
    instruction: (item.metadata?.brief as string | undefined)
      ?? `Rewrite this ${item.format.replace(/_/g, ' ')}. Draft only.`,
    format: item.format,
    topic: (item.metadata?.topic as string | undefined) ?? item.title,
    relatedSignalIds: item.source_signal_id ? [item.source_signal_id] : [],
    regenerate: true,
  });
  if (!gen.ok) return { ok: false, item, error: gen.error ?? 'regeneration_failed' };
  const fresh = await getContentItem(item.id);
  return { ok: true, item: fresh.item ?? item };
}

/**
 * A human edit. Records a new version through the database trigger and, by
 * that same trigger, NO model provenance — a person wrote this one.
 */
export async function saveContentEdit(
  itemId: string, patch: { body?: string; title?: string | null },
): Promise<ContentResult> {
  const { item, error } = await updateContentItem(itemId, {
    ...patch,
    // Stated explicitly so a hand edit never inherits the model and task of the
    // generation it edited.
    last_generation_source: 'manual_edit',
  });
  if (error || !item) return { ok: false, error: error ?? 'save_failed' };
  return { ok: true, item };
}

export async function approveContent(itemId: string): Promise<ContentResult> {
  const { item, error } = await updateContentItem(itemId, { status: 'approved' });
  if (error || !item) return { ok: false, error: error ?? 'approve_failed' };
  return { ok: true, item };
}

/**
 * Generate an image for the draft's CURRENT text.
 *
 * A separate operation on purpose: regenerating copy must not silently spend on
 * a new picture, and a new picture must not rewrite the copy. Calling this
 * again is `regenerate_image` — it writes a second asset and moves the pointer,
 * keeping the first.
 */
export async function generateContentImage(
  workspaceId: string, contentItemId: string,
): Promise<ContentResult> {
  const { data, error } = await supabase.functions.invoke('generate-content-image', {
    body: { workspace_id: workspaceId, content_item_id: contentItemId },
  });
  if (error) return { ok: false, error: error.message ?? 'image_generation_failed' };
  const res = data as { ok?: boolean; asset_id?: string; error?: string; detail?: string } | null;
  if (!res || res.ok !== true) {
    return { ok: false, error: res?.detail ?? res?.error ?? 'image_generation_failed' };
  }
  return { ok: true, assetId: res.asset_id ?? null };
}

/** The workspace's content, newest first. */
export async function listContent(workspaceId: string, opts?: { status?: ContentStatus }) {
  return listContentItems(workspaceId, opts);
}

export const getContentVersions = listContentItemVersions;

/** Assets for one item, newest first. Read-only: the server writes these. */
export async function getContentAssets(contentItemId: string) {
  const { data, error } = await supabase
    .from('content_asset')
    .select('id, content_item_id, content_version_id, status, storage_path, provider, model, generation_prompt, generation_source, width, height, failure_reason, created_at')
    .eq('content_item_id', contentItemId)
    .order('created_at', { ascending: false });
  if (error) return { assets: [], error: error.message };
  return { assets: (data ?? []) as unknown as ContentAssetRow[], error: null };
}

export interface ContentAssetRow {
  id: string;
  content_item_id: string;
  content_version_id: string | null;
  status: 'pending' | 'ready' | 'failed';
  storage_path: string | null;
  provider: string | null;
  model: string | null;
  generation_prompt: string | null;
  generation_source: string;
  width: number | null;
  height: number | null;
  failure_reason: string | null;
  created_at: string;
}

/**
 * A viewable URL for a stored asset.
 *
 * SIGNED, because the bucket is private: content drafts are unpublished work,
 * and a public bucket would make every generated image world-readable by URL.
 */
export async function signedAssetUrl(storagePath: string, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from('content-assets')
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return { url: null, error: error.message };
  return { url: data?.signedUrl ?? null, error: null };
}

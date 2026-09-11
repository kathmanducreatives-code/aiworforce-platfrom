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
import {
  buildContentInstruction, signalSubjectFrom,
  type ContentBriefFields, type InstructionInput, type SignalSubject,
} from '@/lib/content/contentInstruction';
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
  /** Who the signal happened to. Absent on a signal means "someone other than us". */
  sourceSignalSubject?: SignalSubject | null;
  fields?: ContentBriefFields | null;
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

  const briefInput: InstructionInput = {
    format: req.contentType,
    sourceType: req.sourceType,
    idea: req.idea ?? '',
    signalTitle: req.sourceSignalTitle ?? null,
    signalSubject: req.sourceSignalSubject ?? null,
    fields: req.fields ?? null,
  };
  const instruction = buildContentInstruction(briefInput);

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
    metadata: { brief: instruction, brief_input: briefInput, topic: req.idea || req.sourceSignalTitle },
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
  return writeContentText(workspaceId, item, true);
}

/**
 * The FIRST draft of an empty item — the same rebuilt brief as a regeneration,
 * recorded honestly as a generation rather than a rewrite of nothing.
 */
export async function draftContentText(
  workspaceId: string, item: ContentItem,
): Promise<ContentResult> {
  return writeContentText(workspaceId, item, false);
}

async function writeContentText(
  workspaceId: string, item: ContentItem, regenerate: boolean,
): Promise<ContentResult> {
  // THE BRIEF IS REBUILT, NOT REPLAYED. From the typed input kept on the row,
  // with the signal's ownership re-read from the signal itself — so a draft
  // written before attribution existed stops claiming a competitor's launch the
  // next time it is regenerated, and a Studio edit to the brief takes effect.
  const brief = await currentBrief(item);
  if (brief.changed) {
    const merged = { ...(item.metadata ?? {}), brief: brief.text, brief_input: brief.input };
    const { error } = await updateContentItem(item.id, { metadata: merged });
    if (error) return { ok: false, item, error };
  }
  const gen = await generateContentDraft({
    contentItemId: item.id,
    workspaceId,
    instruction: brief.text,
    format: item.format,
    topic: (item.metadata?.topic as string | undefined) ?? item.title,
    relatedSignalIds: item.source_signal_id ? [item.source_signal_id] : [],
    regenerate,
  });
  if (!gen.ok) return { ok: false, item, error: gen.error ?? 'regeneration_failed' };
  const fresh = await getContentItem(item.id);
  return { ok: true, item: fresh.item ?? item };
}

/** The source row's own relationship fields, for an item made from a canonical signal. */
export async function signalForItem(signalId: string): Promise<{ title: string | null; subject: SignalSubject } | null> {
  const { data, error } = await supabase
    .from('signal_events')
    .select('id, signal_type, subject_type, subject_key, normalized_value')
    .eq('id', signalId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    signal_type?: string | null; subject_type?: string | null; subject_key?: string | null;
    normalized_value?: Record<string, unknown> | null;
  };
  const nv = row.normalized_value ?? {};
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    title: s(nv.title),
    subject: signalSubjectFrom({
      subject_type: row.subject_type, subject_key: row.subject_key, signal_type: row.signal_type,
      company_name: s(nv.company_name), competitor_name: s(nv.competitor_name),
    }),
  };
}

/**
 * The typed brief input for an item: the one it was created with, or — for a
 * row made before inputs were kept — the closest honest reconstruction from its
 * own columns. Never invents a signal it does not reference.
 */
export function briefInputFor(item: ContentItem): InstructionInput {
  const kept = item.metadata?.brief_input as InstructionInput | undefined;
  if (kept && typeof kept === 'object' && kept.format && kept.sourceType) {
    return { ...kept, format: item.format };
  }
  const legacy = item.metadata?.legacy_signal as { title?: string | null } | undefined;
  return {
    format: item.format,
    sourceType: item.source_type,
    idea: (item.metadata?.topic as string | undefined) ?? (item.source_type === 'idea' ? item.title ?? '' : ''),
    signalTitle: legacy?.title ?? null,
    // A legacy signal is someone else's news even without its id.
    signalSubject: legacy ? { relationship: 'external', name: null } : null,
    fields: null,
  };
}

/** The brief to generate from now, and whether it differs from the stored one. */
export async function currentBrief(
  item: ContentItem, fields?: ContentBriefFields | null,
): Promise<{ text: string; input: InstructionInput; changed: boolean }> {
  const base = briefInputFor(item);
  let input: InstructionInput = fields !== undefined ? { ...base, fields } : base;
  if (item.source_type === 'signal' && item.source_signal_id) {
    const sig = await signalForItem(item.source_signal_id);
    if (sig) input = { ...input, signalTitle: sig.title ?? input.signalTitle, signalSubject: sig.subject };
  }
  const text = buildContentInstruction(input);
  return { text, input, changed: text !== (item.metadata?.brief as string | undefined) };
}

/**
 * Save the Studio's creative brief. Metadata only — the trigger writes versions
 * for copy, not for the brief — and the next generation reads it.
 */
export async function saveContentBrief(
  item: ContentItem, fields: ContentBriefFields,
): Promise<ContentResult> {
  const brief = await currentBrief(item, fields);
  const { item: saved, error } = await updateContentItem(item.id, {
    metadata: { ...(item.metadata ?? {}), brief: brief.text, brief_input: brief.input },
  });
  if (error || !saved) return { ok: false, error: error ?? 'save_failed' };
  return { ok: true, item: saved };
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
 * Archive — out of the working set, never deleted. Status only, so no version
 * is written and every version and asset stays readable in History.
 */
export async function archiveContent(itemId: string): Promise<ContentResult> {
  const { item, error } = await updateContentItem(itemId, { status: 'archived' });
  if (error || !item) return { ok: false, error: error ?? 'archive_failed' };
  return { ok: true, item };
}

/** Back to the working set, as a draft awaiting a decision again. */
export async function restoreContent(itemId: string): Promise<ContentResult> {
  const { item, error } = await updateContentItem(itemId, { status: 'draft' });
  if (error || !item) return { ok: false, error: error ?? 'restore_failed' };
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

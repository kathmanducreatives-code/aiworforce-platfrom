// THE CONTENT PAGE'S DRAFTS, LOADED FROM THE DATABASE.
//
// Content's drafts list has always read `saved_outputs` filtered to content
// types, of which there are zero and have always been zero — nothing writes
// them. This hook loads `content_item`, the object drafts actually live in, so
// the list reflects work that survives a refresh.
//
// Deliberately small: load, create, save, remove. No generation, no polling, no
// realtime — a draft changes when this user changes it.

import { useCallback, useEffect, useState } from 'react';
import {
  listContentItems, createContentItem, updateContentItem, deleteContentItem,
  type ContentItem, type CreateContentItemInput, type ContentStatus,
} from '@/lib/content/contentItems';

export interface UseContentItems {
  items: ContentItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: Omit<CreateContentItemInput, 'workspace_id'>) => Promise<ContentItem | null>;
  save: (id: string, patch: { title?: string | null; body?: string; status?: ContentStatus }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useContentItems(workspaceId: string | null | undefined): UseContentItems {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceId) { setItems([]); return; }
    setLoading(true);
    const { items: rows, error: err } = await listContentItems(workspaceId);
    setItems(rows);
    setError(err);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (
    input: Omit<CreateContentItemInput, 'workspace_id'>,
  ): Promise<ContentItem | null> => {
    if (!workspaceId) return null;
    const { item, error: err } = await createContentItem({ ...input, workspace_id: workspaceId });
    if (err || !item) { setError(err); return null; }
    // Prepend rather than reload: the list is ordered newest-first, so the new
    // draft belongs at the top and a round trip would only confirm that.
    setItems((prev) => [item, ...prev]);
    return item;
  }, [workspaceId]);

  const save = useCallback(async (
    id: string,
    patch: { title?: string | null; body?: string; status?: ContentStatus },
  ) => {
    // A PERSON'S EDIT IS RECORDED AS ONE. Without this the version trigger
    // copied whatever `last_generation_source` the row still held — so an edit
    // made after a Scribe draft was stamped `scribe_generation`, with Scribe's
    // model and task: a version claiming a provenance it does not have.
    const touchesCopy = patch.body !== undefined || patch.title !== undefined;
    const { item, error: err } = await updateContentItem(id, touchesCopy
      ? { ...patch, last_generation_source: 'manual_edit' }
      : patch);
    // THROWS on failure, deliberately. The editor keeps the user's text and
    // shows the error; swallowing it here would let a failed save look
    // identical to a successful one, which is how an edit gets lost.
    if (err || !item) throw new Error(err ?? 'Could not save draft');
    setItems((prev) => prev.map((it) => (it.id === id ? item : it)));
  }, []);

  const remove = useCallback(async (id: string) => {
    const { error: err } = await deleteContentItem(id);
    if (err) throw new Error(err);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  return { items, loading, error, reload, create, save, remove };
}

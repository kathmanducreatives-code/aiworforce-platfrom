// CONTENT — the Studio.
//
// One workflow, left to right:
//
//   SOURCES            CONTENT STUDIO                  SCRIBE / HISTORY
//   Drafts             strategy · hook · draft ·       contextual revisions,
//   For You            visual · save / regenerate /    Ask Scribe, this draft's
//   Trends             approve                         versions and images
//   Comments
//   Ideas
//
// Find a source → create → edit → generate a visual → approve.
//
// Everything persisted is read through the canonical Content objects —
// `content_item`, its immutable versions, `content_asset` — and every write goes
// through `contentService`, which reaches Scribe on the one generation path
// (Company Brain, model ledger and spend controls on the server). The page holds
// only an unsaved editing buffer. The open draft is in the URL, so a reload
// reopens exactly what is saved.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, PanelLeft, FileText, Sparkles, PenLine } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSignalFeed } from '@/hooks/useSignalFeed';
import { useContentItems } from '@/hooks/useContentItems';
import type { ContentItem } from '@/lib/content/contentItems';
import { generateContentDraft } from '@/lib/content/generateContentDraft';
import { listContentItemVersions, type ContentFormat, type ContentItemVersion } from '@/lib/content/contentItems';
import { buildContentInstruction, type ContentBriefFields } from '@/lib/content/contentInstruction';
import {
  regenerateContentText, draftContentText, reviseContentText, generateContentImage, getContentAssets, signedAssetUrl,
  saveContentEdit, saveContentBrief, approveContent, archiveContent, restoreContent, signalForItem,
} from '@/lib/content/contentService';
import { forYou } from '@/lib/content/contentStudioModel';
import { toast } from 'sonner';
import { useSignalReviews } from '@/hooks/useSignalReviews';
import { useIntegrationReadiness } from '@/hooks/useIntegrationReadiness';
import { sendAgentCommand } from '@/lib/agentCommand';
import { postDraftOutputs, commentDraftOutputs, commentDraftRows } from '@/lib/contentBuckets';
import type { FeedSignal } from '@/lib/signalFeedModel';
import { signalContentSource, buildSignalContextMetadata } from '@/lib/signalIdeaActions';
import ContentComposer, { type ComposerSubmission } from '@/components/content/ContentComposer';
import ContentStudioEditor, { type StudioAsset } from '@/components/content/ContentStudioEditor';
import ContentSourcesPanel, { type SourceNav, type CommentSource } from '@/components/content/ContentSourcesPanel';
import ScribePanel from '@/components/content/ScribePanel';
import SourcePreview from '@/components/content/SourcePreview';
import { ACCENT, PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/content/studioStyles';
import { AmbientBackdrop } from '@/components/layout/AmbientBackdrop';
import { METRIC_LABEL } from '@/components/layout/workspaceStyles';
import { classifyProviderState } from '@/components/signals/ProviderBadge';

const dispatch = (text: string) =>
  void sendAgentCommand(text, { success: 'Sent to your workforce', action_source: 'content_action' });

/**
 * A `content_item` in the shape the legacy saved_outputs readers use, so an
 * older read-only draft and a canonical one can be told apart by one lookup.
 */
function contentItemAsOutput(item: ContentItem) {
  return {
    id: item.id,
    type: 'content_draft',
    title: item.title,
    body: item.body,
    created_at: item.created_at,
    raw: { subtype: item.format, status: item.status, source: item.source, ...item.metadata } as Record<string, unknown>,
  };
}

/** Small screens show one area at a time. */
type Pane = 'sources' | 'studio' | 'scribe';

const SCRIBE_COLLAPSED_KEY = 'agentory.content.scribeCollapsed';
const readScribeCollapsed = () => { try { return localStorage.getItem(SCRIBE_COLLAPSED_KEY) === '1'; } catch { return false; } };

export default function Content() {
  const { workspaceId } = useWorkspace();
  const { savedOutputs, drafts, signals, loading } = useSignalFeed(workspaceId);
  const {
    items: contentItems, create: createContentDraft, reload: reloadContentDrafts,
  } = useContentItems(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);
  const { providers } = useIntegrationReadiness();

  // THE OPEN DRAFT LIVES IN THE URL — a reload reopens the same persisted item.
  const [params, setParams] = useSearchParams();
  const openDraftId = params.get('item');
  const setOpenDraftId = useCallback((id: string | null) => {
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('item', id); else n.delete('item'); return n; }, { replace: true });
  }, [setParams]);

  const [nav, setNav] = useState<SourceNav>('drafts');
  const [pane, setPane] = useState<Pane>('studio');
  const [selectedSignal, setSelectedSignal] = useState<FeedSignal | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [versions, setVersions] = useState<ContentItemVersion[]>([]);
  const [previewVersion, setPreviewVersion] = useState<ContentItemVersion | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [scribeCollapsed, setScribeCollapsed] = useState(readScribeCollapsed);
  const [scribeOverlay, setScribeOverlay] = useState(false);

  const toggleScribe = useCallback(() => {
    setScribeCollapsed((v) => {
      try { localStorage.setItem(SCRIBE_COLLAPSED_KEY, v ? '0' : '1'); } catch { /* per-viewer convenience only */ }
      return !v;
    });
  }, []);

  // ---- data (all real) ------------------------------------------------------

  // Persisted content items first, then any legacy content-shaped saved_outputs
  // (read-only, never written).
  const posts = useMemo(
    () => [...contentItems.map(contentItemAsOutput), ...postDraftOutputs(savedOutputs)],
    [contentItems, savedOutputs],
  );

  const commentSources: CommentSource[] = useMemo(() => [
    // CANONICAL FIRST. Engagement comments are `content_item` rows, one per post.
    ...contentItems.filter((it) => it.format === 'linkedin_comment' && it.status !== 'archived').map((it) => ({
      id: it.id, title: it.title ?? 'Comment draft', status: it.status, preview: it.body || undefined, canonical: true,
    })),
    ...commentDraftRows(drafts).map((d) => ({
      id: d.id, title: d.subject ?? 'Comment draft', status: d.status, preview: d.body ?? undefined, canonical: false,
    })),
    ...commentDraftOutputs(savedOutputs).map((o) => ({
      id: o.id, title: o.title ?? 'Comment draft', status: (o.raw as { status?: string } | null)?.status ?? 'draft',
      preview: o.body ?? undefined, canonical: false,
    })),
  ], [contentItems, drafts, savedOutputs]);

  const contentSignals = useMemo(() => {
    const KEEP = ['news', 'funding', 'hiring', 'launch', 'product', 'post', 'engagement', 'competitor'];
    return signals
      .filter((s) => KEEP.some((k) => (s.signal_type ?? '').toLowerCase().includes(k)))
      .filter((s) => reviewsBySignal[s.id]?.status !== 'ignored')
      .slice(0, 10);
  }, [signals, reviewsBySignal]);
  const forYouSignals = useMemo(() => forYou(contentSignals), [contentSignals]);
  const savedIdeas = useMemo(
    () => signals.filter((s) => reviewsBySignal[s.id]?.status === 'saved'),
    [signals, reviewsBySignal],
  );

  const apifyState = classifyProviderState({
    ready: providers.apify?.status === 'connected', reason: providers.apify?.reason, integrationStatus: providers.apify?.status,
  });
  const linkedinState = classifyProviderState({
    ready: providers.linkedin?.status === 'connected', reason: providers.linkedin?.reason, integrationStatus: providers.linkedin?.status,
  });
  const commentDiscoveryReady = apifyState === 'ready' || linkedinState === 'ready';

  const stats = {
    trends: contentSignals.length,
    drafts: contentItems.filter((it) => it.status === 'draft').length,
    awaiting: contentItems.filter((it) => it.status === 'draft' && (it.body ?? '').trim()).length,
    approved: contentItems.filter((it) => it.status === 'approved').length,
  };

  // ---- opening things -------------------------------------------------------

  const openInStudio = useCallback((id: string) => {
    setSelectedSignal(null);
    setPreviewVersion(null);
    setOpenDraftId(id);
    setPane('studio');
  }, [setOpenDraftId]);

  const selectSignal = useCallback((s: FeedSignal) => {
    setOpenDraftId(null);
    setPreviewVersion(null);
    setSelectedSignal(s);
    setPane('studio');
  }, [setOpenDraftId]);

  // SIGNAL -> CONTENT, TYPED: the canonical row first, then Scribe.
  const turnSignalInto = useCallback(async (kind: 'post' | 'comment', sg: FeedSignal) => {
    if (!workspaceId) { toast.error('No workspace'); return; }
    const format: ContentFormat = kind === 'comment' ? 'linkedin_comment' : 'linkedin_post';
    // ONLY A CANONICAL SIGNAL IS A SIGNAL SOURCE. A legacy-only feed row has no
    // `signal_events` row for the FK to point at, so it becomes an idea about
    // that signal, with where it came from kept on the row — never a fake FK.
    const source = signalContentSource(sg);
    // WHO IT HAPPENED TO travels with the brief — for a legacy signal too. A
    // competitor's launch is theirs; Company Brain says who WE are.
    const briefInput = {
      format, sourceType: source.source_type, idea: '', signalTitle: sg.title,
      signalSubject: source.subject, fields: null,
    };
    const instruction = buildContentInstruction(briefInput);
    const item = await createContentDraft({
      title: sg.title, format, source: 'content_surface',
      source_type: source.source_type, source_signal_id: source.source_signal_id, body: '',
      metadata: { brief: instruction, brief_input: briefInput, topic: sg.title, ...source.metadata },
    });
    if (!item) { toast.error('Could not create the draft'); return; }
    openInStudio(item.id);
    const res = await generateContentDraft({
      contentItemId: item.id, workspaceId, instruction, format,
      topic: sg.title,
      // Scribe's related signals are canonical ids only, like the FK.
      relatedSignalIds: source.source_signal_id ? [source.source_signal_id] : [],
    });
    // The draft exists either way; only the generation can fail.
    if (!res.ok) toast.error(res.error ?? 'Scribe could not write this draft');
    await reloadContentDrafts();
  }, [workspaceId, createContentDraft, reloadContentDrafts, openInStudio]);

  // ── THE OPEN DRAFT ────────────────────────────────────────────────────
  //
  // Versions and assets for the open draft only, through the service. Images
  // are shown from SIGNED urls minted here and never stored — the bucket is
  // private because a draft is unpublished work.
  const [studioAssets, setStudioAssets] = useState<StudioAsset[]>([]);

  const loadAssets = useCallback(async () => {
    if (!openDraftId) { setStudioAssets([]); return; }
    const { assets } = await getContentAssets(openDraftId);
    const signed = await Promise.all(assets.map(async (a) => ({
      ...a,
      url: a.status === 'ready' && a.storage_path ? (await signedAssetUrl(a.storage_path)).url : null,
    })));
    setStudioAssets(signed);
  }, [openDraftId]);

  const loadVersions = useCallback(async () => {
    if (!openDraftId) { setVersions([]); return; }
    const { versions: rows } = await listContentItemVersions(openDraftId);
    setVersions(rows);
  }, [openDraftId]);

  useEffect(() => { void loadAssets(); void loadVersions(); setPreviewVersion(null); }, [loadAssets, loadVersions]);

  const studioItem = useMemo(
    () => (openDraftId ? contentItems.find((it) => it.id === openDraftId) ?? null : null),
    [openDraftId, contentItems],
  );

  // A LEGACY saved_outputs draft has nothing to save back to, so it opens
  // read-only; every action needs a real content_item.
  const legacyOpen = useMemo(
    () => (openDraftId && !contentItems.some((it) => it.id === openDraftId)
      ? posts.find((p) => p.id === openDraftId) ?? null : null),
    [openDraftId, contentItems, posts],
  );

  // WHOSE NEWS IT IS, read from the signal row for the open draft.
  const [studioSignal, setStudioSignal] = useState<Awaited<ReturnType<typeof signalForItem>>>(null);
  useEffect(() => {
    let live = true;
    const id = studioItem?.source_type === 'signal' ? studioItem.source_signal_id : null;
    if (!id) { setStudioSignal(null); return; }
    void signalForItem(id).then((s) => { if (live) setStudioSignal(s); });
    return () => { live = false; };
  }, [studioItem?.source_type, studioItem?.source_signal_id]);

  /** After any write: re-read the row, its versions and its assets — the server is the writer. */
  const refreshStudio = useCallback(async () => {
    await reloadContentDrafts();
    await loadVersions();
    await loadAssets();
  }, [reloadContentDrafts, loadVersions, loadAssets]);

  // EVERY STUDIO ACTION GOES THROUGH THE SERVICE, and throws its real reason so
  // the editor can show it — a spend-ceiling refusal and a provider failure are
  // different facts.
  const studioHandlers = studioItem && workspaceId ? {
    onSave: async ({ body, fields }: { body?: string; fields?: ContentBriefFields }) => {
      if (fields) {
        const r = await saveContentBrief(studioItem, fields);
        if (!r.ok) throw new Error(r.error ?? 'Could not save the brief');
      }
      if (body !== undefined) {
        // A person's edit: a new version, recorded as `manual_edit`, no model.
        const r = await saveContentEdit(studioItem.id, { body });
        if (!r.ok) throw new Error(r.error ?? 'Could not save');
      }
      await refreshStudio();
    },
    onWriteText: async () => {
      // Text only. The image pointer is not touched, so the picture stays.
      const res = (studioItem.body ?? '').trim()
        ? await regenerateContentText(workspaceId, studioItem)
        : await draftContentText(workspaceId, studioItem);
      if (!res.ok) throw new Error(res.error ?? 'Scribe could not write this draft');
      await refreshStudio();
    },
    onImage: async () => {
      // Image only. A new asset and a moved pointer; the text is not touched.
      const res = await generateContentImage(workspaceId, studioItem.id);
      if (!res.ok) throw new Error(res.error ?? 'Could not generate an image');
      await refreshStudio();
    },
    onApprove: async () => {
      const res = await approveContent(studioItem.id);
      if (!res.ok) throw new Error(res.error ?? 'Could not approve');
      await refreshStudio();
    },
    onArchive: async () => {
      const res = await archiveContent(studioItem.id);
      if (!res.ok) throw new Error(res.error ?? 'Could not archive');
      await refreshStudio();
    },
    onRestore: async () => {
      const res = await restoreContent(studioItem.id);
      if (!res.ok) throw new Error(res.error ?? 'Could not restore');
      await refreshStudio();
    },
  } : null;

  /** Scribe's contextual revisions — the same one generation path, a new version each. */
  const onRevise = useCallback(async (revision: string) => {
    if (!studioItem || !workspaceId) throw new Error('Open a draft first');
    const res = await reviseContentText(workspaceId, studioItem, revision);
    if (!res.ok) throw new Error(res.error ?? 'Scribe could not revise this draft');
    await refreshStudio();
  }, [studioItem, workspaceId, refreshStudio]);

  const scribe = (
    <ScribePanel
      collapsed={scribeCollapsed}
      onToggle={toggleScribe}
      item={studioItem}
      dirty={editorDirty}
      versions={versions}
      assets={studioAssets}
      previewId={previewVersion?.id ?? null}
      onPreview={setPreviewVersion}
      onRevise={onRevise}
      onImage={async () => { if (!studioHandlers) throw new Error('Open a draft first'); await studioHandlers.onImage(); }}
    />
  );

  // ---- render ----------------------------------------------------------------

  return (
    <div className="relative flex h-[calc(100vh-49px)] min-h-[560px] flex-col overflow-hidden">
      <AmbientBackdrop variant="content" />
      {/* ── header: compact ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-[rgba(5,7,6,0.35)] px-5 py-4 backdrop-blur-xl lg:px-7">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-foreground">Content</h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground/70">Create and refine content with Scribe.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <dl className="hidden items-stretch overflow-hidden rounded-xl border border-white/[0.06] bg-[rgba(12,16,15,0.55)] backdrop-blur-xl md:flex">
            <Stat label="trends" value={stats.trends} />
            <Stat label="drafts" value={stats.drafts} />
            <Stat label="awaiting review" value={stats.awaiting} />
            <Stat label="approved" value={stats.approved} />
          </dl>
          <button onClick={() => setCreateOpen(true)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors ${PRIMARY_BUTTON}`}>
            <Plus className="h-4 w-4" /> New content
          </button>
        </div>
      </header>

      {/* ── small screens: one area at a time ──────────────────────────── */}
      <div className="flex shrink-0 gap-1 border-b border-white/[0.06] px-4 lg:hidden" role="tablist" aria-label="Content areas">
        {([['sources', 'Sources', PanelLeft], ['studio', 'Studio', FileText], ['scribe', 'Scribe', Sparkles]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={pane === id} onClick={() => setPane(id)}
            className={`relative inline-flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-medium ${
              pane === id ? ACCENT.accentText : 'text-muted-foreground/65'
            }`}>
            <Icon className="h-3.5 w-3.5" /> {label}
            {pane === id && <span className="absolute inset-x-4 -bottom-px h-[2px] rounded-full bg-emerald-500/80" aria-hidden />}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ── SOURCES ─────────────────────────────────────────────────── */}
        <aside className={`${pane === 'sources' ? 'flex' : 'hidden'} w-full min-w-0 flex-col px-3 py-4 lg:flex lg:w-[284px] lg:shrink-0 lg:border-r lg:border-white/[0.06] lg:bg-[rgba(10,13,12,0.45)] lg:backdrop-blur-xl`}>
          <ContentSourcesPanel
            nav={nav}
            onNav={setNav}
            items={contentItems}
            openId={openDraftId}
            onOpenItem={openInStudio}
            forYou={forYouSignals}
            trends={contentSignals}
            ideas={savedIdeas}
            comments={commentSources}
            selectedSignalId={selectedSignal?.id ?? null}
            onSelectSignal={(s) => selectSignal(s as FeedSignal)}
            onNewIdea={() => setCreateOpen(true)}
            onFindComments={() => dispatch('Lyra, find 5 LinkedIn posts from ICP accounts to engage with — Scribe will draft comments, drafts only.')}
            commentDiscoveryReady={commentDiscoveryReady}
            loading={loading}
          />
        </aside>

        {/* ── CONTENT STUDIO — the dominant area ─────────────────────── */}
        <main className={`${pane === 'studio' ? 'block' : 'hidden'} min-w-0 flex-1 overflow-y-auto lg:block`}>
          <div className="mx-auto w-full max-w-[760px] px-5 py-7 lg:px-10 lg:py-9">
            {studioItem && studioHandlers ? (
              <ContentStudioEditor
                item={studioItem}
                versions={versions}
                assets={studioAssets}
                signal={studioSignal}
                preview={previewVersion}
                onExitPreview={() => setPreviewVersion(null)}
                onDirtyChange={setEditorDirty}
                {...studioHandlers}
              />
            ) : selectedSignal ? (
              <SourcePreview
                signal={selectedSignal}
                onCreate={(kind) => turnSignalInto(kind, selectedSignal)}
                onAskPilot={async (text) => {
                  // THE PROVEN CHAT PATH: the signal's id as metadata, verified
                  // by Pilot against the workspace — never a title in a sentence.
                  const ok = await sendAgentCommand(`Context: Signal: ${selectedSignal.title}. ${text}`, {
                    success: 'Sent to Pilot',
                    action_source: 'content_copilot',
                    metadata: buildSignalContextMetadata(selectedSignal),
                  });
                  if (!ok) throw new Error("Couldn't reach Pilot. Open the chat and try again.");
                }}
              />
            ) : legacyOpen ? (
              <article>
                <p className="text-[12px] text-muted-foreground/60">Earlier draft · read-only</p>
                <h2 className="mt-2 text-[20px] font-semibold text-foreground">{legacyOpen.title ?? 'Untitled'}</h2>
                <p className="mt-5 whitespace-pre-wrap text-[15px] leading-[1.7] text-foreground/85">{legacyOpen.body}</p>
                <p className="mt-6 text-[12px] text-muted-foreground/55">Written before drafts were versioned. It can be read, not edited.</p>
              </article>
            ) : (
              <EmptyStudio onNew={() => setCreateOpen(true)} onSources={() => { setNav('foryou'); setPane('sources'); }} />
            )}
          </div>
        </main>

        {/* ── SCRIBE / HISTORY: inline on wide screens ───────────────── */}
        <div className="hidden min-h-0 xl:flex">{scribe}</div>
        {/* medium screens: a drawer over the Studio */}
        <button onClick={() => setScribeOverlay(true)} aria-label="Open Scribe"
          className={`fixed bottom-28 right-5 z-30 hidden items-center gap-1.5 rounded-full border ${ACCENT.accentBorder} bg-[#050505]/80 px-3.5 py-2 text-[12.5px] font-medium ${ACCENT.accentText} shadow-[0_0_22px_-10px_rgba(16,185,129,0.6)] backdrop-blur-xl lg:inline-flex xl:hidden`}>
          <Sparkles className="h-3.5 w-3.5" /> Scribe
        </button>
        {scribeOverlay && (
          <div className="fixed inset-0 z-40 hidden lg:block xl:hidden" onClick={() => setScribeOverlay(false)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="absolute right-0 top-0 h-full bg-[rgba(8,11,10,0.92)] shadow-[-30px_0_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
              <ScribePanel
                collapsed={false}
                onToggle={() => setScribeOverlay(false)}
                item={studioItem}
                dirty={editorDirty}
                versions={versions}
                assets={studioAssets}
                previewId={previewVersion?.id ?? null}
                onPreview={setPreviewVersion}
                onRevise={onRevise}
                onImage={async () => { if (!studioHandlers) throw new Error('Open a draft first'); await studioHandlers.onImage(); }}
              />
            </div>
          </div>
        )}
        {/* small screens: its own pane */}
        <div className={`${pane === 'scribe' ? 'flex' : 'hidden'} min-h-0 w-full lg:hidden [&>aside]:w-full [&>aside]:border-l-0`}>
          <ScribePanel
            collapsed={false}
            onToggle={() => setPane('studio')}
            item={studioItem}
            dirty={editorDirty}
            versions={versions}
            assets={studioAssets}
            previewId={previewVersion?.id ?? null}
            onPreview={(v) => { setPreviewVersion(v); if (v) setPane('studio'); }}
            onRevise={onRevise}
            onImage={async () => { if (!studioHandlers) throw new Error('Open a draft first'); await studioHandlers.onImage(); }}
          />
        </div>
      </div>

      {/* THE TYPED CREATION PATH. The draft row is created first, then Scribe is
          asked — so a failed model call leaves the user a draft to retry. */}
      <ContentComposer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        signals={contentSignals.map((sg) => ({
          id: sg.id, title: sg.title,
          signal_type: sg.signal_type, account_name: sg.account_name,
        }))}
        onSubmit={async (input: ComposerSubmission) => {
          if (!workspaceId) throw new Error('No workspace');
          // THE SAME TRUTHFUL SOURCE AS A SIGNAL CARD — a legacy-only feed id
          // never reaches the FK; its subject travels either way.
          const picked = input.signalId ? contentSignals.find((sg) => sg.id === input.signalId) ?? null : null;
          const source = picked ? signalContentSource(picked) : null;
          const briefInput = {
            format: input.format,
            sourceType: source ? source.source_type : input.sourceType,
            idea: input.idea,
            signalTitle: input.signalTitle ?? null,
            signalSubject: source?.subject ?? null,
            fields: null,
          };
          const instruction = buildContentInstruction(briefInput);
          const item = await createContentDraft({
            title: input.sourceType === 'signal'
              ? (input.signalTitle ?? 'From a signal')
              : input.idea.slice(0, 80),
            format: input.format,
            source: 'content_surface',
            source_type: briefInput.sourceType,
            source_signal_id: source ? source.source_signal_id : null,
            body: '',
            metadata: {
              brief: instruction, brief_input: briefInput,
              topic: input.idea || input.signalTitle, ...(source?.metadata ?? {}),
            },
          });
          if (!item) throw new Error('Could not create the draft');
          openInStudio(item.id);
          const res = await generateContentDraft({
            contentItemId: item.id,
            workspaceId,
            instruction,
            format: input.format,
            topic: input.idea || input.signalTitle,
            relatedSignalIds: source?.source_signal_id ? [source.source_signal_id] : [],
          });
          if (!res.ok) throw new Error(res.error ?? 'Scribe could not write this draft');
          await reloadContentDrafts();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse justify-center gap-1 px-3.5 py-1.5 [&+&]:border-l [&+&]:border-white/[0.05]">
      <dd className="text-[15px] font-semibold leading-none tabular-nums text-foreground">{value}</dd>
      <dt className={METRIC_LABEL}>{label}</dt>
    </div>
  );
}

function EmptyStudio({ onNew, onSources }: { onNew: () => void; onSources: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-start justify-center">
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(16,185,129,0.04))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_30px_-10px_rgba(16,185,129,0.55)]">
        <PenLine className="h-5 w-5 text-emerald-300" />
      </div>
      <p className={`text-[12px] font-medium ${ACCENT.accentText}`}>Content Studio</p>
      <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.01em] text-foreground">Pick something to work on</h2>
      <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted-foreground/70">
        Open a draft, choose a source from For You or Trends, or start from your own idea. Scribe drafts it here for your review.
      </p>
      <div className="mt-6 flex gap-2">
        <button onClick={onNew} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13.5px] transition-colors ${PRIMARY_BUTTON}`}>
          <Plus className="h-4 w-4" /> New content
        </button>
        <button onClick={onSources} className={`inline-flex h-9 items-center rounded-lg px-4 text-[13.5px] font-medium transition-colors ${SECONDARY_BUTTON}`}>
          Browse sources
        </button>
      </div>
    </div>
  );
}

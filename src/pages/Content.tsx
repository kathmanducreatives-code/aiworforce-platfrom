// Content — LinkedIn Growth Desk (Premium Refinement)
//
// A premium content intelligence workspace with bigger typography, generous
// spacing, and a refined Mira copilot. Four views: For You, Top 10 Trends,
// Comment Opportunities, Plan & Drafts.
//
// All data is real. Everything is approval-first. Backend unchanged.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, FileEdit, RefreshCw, ChevronRight,
  TrendingUp, AlertCircle, PenLine,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSignalFeed } from '@/hooks/useSignalFeed';
import { useContentItems } from '@/hooks/useContentItems';
import type { ContentItem } from '@/lib/content/contentItems';
import { generateContentDraft } from '@/lib/content/generateContentDraft';
import { listContentItemVersions, type ContentFormat, type ContentItemVersion } from '@/lib/content/contentItems';
import { buildContentInstruction } from '@/lib/content/contentInstruction';
import {
  regenerateContentText, draftContentText, generateContentImage, getContentAssets, signedAssetUrl,
  saveContentEdit, saveContentBrief, approveContent, archiveContent, restoreContent, signalForItem,
} from '@/lib/content/contentService';
import {
  CONTENT_TYPE_LABEL, STATUS_LABEL, describeContentSource, relationshipLabel,
} from '@/lib/content/contentStudioModel';
import { toast } from 'sonner';
import { useSignalReviews } from '@/hooks/useSignalReviews';
import { useIntegrationReadiness } from '@/hooks/useIntegrationReadiness';
import { sendAgentCommand } from '@/lib/agentCommand';
import {
  postDraftOutputs, workflowSummaryOutputs,
  commentDraftOutputs, commentDraftRows,
} from '@/lib/contentBuckets';
import { deriveDraftStatus, DRAFT_STATUS_LABELS, deriveContentBrief, type ContentBriefSignal } from '@/lib/contentOps';
import type { FeedSignal } from '@/lib/signalFeedModel';
import { signalContentSource } from '@/lib/signalIdeaActions';
import ContentComposer, { type ComposerSubmission } from '@/components/content/ContentComposer';
import ContentStudioEditor, { type StudioAsset } from '@/components/content/ContentStudioEditor';
import ManualContentSource from '@/components/content/ManualContentSource';
import { classifyProviderState } from '@/components/signals/ProviderBadge';
import { MiraCopilot } from '@/components/content/MiraCopilot';
import scribeImg from '@/assets/agents/scribe.webp';

const dispatch = (text: string) =>
  void sendAgentCommand(text, { success: 'Sent to your workforce', action_source: 'content_action' });

/**
 * A `content_item` rendered in the drafts list.
 *
 * The list already renders `saved_outputs`-shaped rows, and everything
 * downstream — bucketing, status labels, the detail drawer — reads that shape.
 * Adapting here means content items go through the SAME derivation as
 * everything else rather than getting a parallel, special-cased path.
 *
 * `raw.status` carries the real lifecycle so `deriveDraftStatus` keeps working:
 * 'approved' -> Approved, 'in_review' -> Needs review, 'draft' -> Draft ready.
 */
function contentItemAsOutput(item: ContentItem) {
  return {
    id: item.id,
    type: 'content_draft',
    title: item.title,
    body: item.body,
    created_at: item.created_at,
    raw: {
      subtype: item.format,
      status: item.status,
      source: item.source,
      source_url: (item.metadata?.source_url as string | undefined) ?? null,
      ...item.metadata,
    } as Record<string, unknown>,
  };
}

// THREE PLACES, ONE OBJECT. Sources is where a draft starts, the Studio is where
// one draft is worked on, History is everything the workspace has made — every
// one of them the same `content_item`, read through the same service.
type ViewId = 'sources' | 'studio' | 'history';
type SourceViewId = 'foryou' | 'trends' | 'comments';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'studio', label: 'Content Studio' },
  { id: 'history', label: 'History' },
];

const SOURCE_VIEWS: { id: SourceViewId; label: string }[] = [
  { id: 'foryou', label: 'For You' },
  { id: 'trends', label: 'Top 10 Trends' },
  { id: 'comments', label: 'Comment Opportunities' },
];

export default function Content() {
  const { workspaceId } = useWorkspace();
  const { savedOutputs, drafts, signals, loading } = useSignalFeed(workspaceId);
  // The drafts that actually persist. `savedOutputs` has never contained a
  // content draft — nothing writes them — so this is the real list.
  const {
    items: contentItems, create: createContentDraft, save: saveContentDraft,
    reload: reloadContentDrafts,
  } = useContentItems(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);
  const { providers } = useIntegrationReadiness();
  const [view, setView] = useState<ViewId>('sources');
  const [sourceView, setSourceView] = useState<SourceViewId>('foryou');
  const [createOpen, setCreateOpen] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ContentItemVersion[]>([]);
  const [miraCollapsed, setMiraCollapsed] = useState(false);
  const [miraContext, setMiraContext] = useState<string | null>(null);
  // THE SIGNAL MIRA WAS ASKED ABOUT, when it was one. Sent with the message as
  // metadata so Pilot can make a signal-sourced draft of THAT signal; a title in
  // the context sentence is all the model would otherwise have to go on.
  const [miraSignal, setMiraSignal] = useState<FeedSignal | null>(null);
  const [sourceIssuesOpen, setSourceIssuesOpen] = useState(false);
  const [miraImgFailed, setMiraImgFailed] = useState(false);

  // ---- data bucketing (all real data) ---------------------------------------

  // Persisted content items first (newest work the user owns), then any legacy
  // content-shaped saved_outputs. The second list is empty in every workspace
  // observed, but reading it costs nothing and drops nothing if one appears.
  const posts = useMemo(
    () => [...contentItems.map(contentItemAsOutput), ...postDraftOutputs(savedOutputs)],
    [contentItems, savedOutputs],
  );
  const workflowRecaps = useMemo(() => workflowSummaryOutputs(savedOutputs), [savedOutputs]);
  const commentDraftsData = useMemo(() => [
    // CANONICAL FIRST. Engagement-loop comments are `content_item` rows now, one
    // per post; `saved_outputs` comment rows are kept only for what older runs
    // wrote before that, and are read, never written.
    ...contentItems.filter((it) => it.format === 'linkedin_comment').map((it) => ({
      id: it.id, title: it.title ?? 'Comment draft', status: it.status, date: it.created_at,
      preview: it.body || undefined,
    })),
    ...commentDraftRows(drafts).map((d) => ({
      id: d.id, title: d.subject ?? 'Comment draft', status: d.status, date: d.created_at,
      preview: d.body ?? undefined,
    })),
    ...commentDraftOutputs(savedOutputs).map((o) => ({
      id: o.id, title: o.title ?? 'Comment draft', status: (o.raw as any)?.status ?? 'draft', date: o.created_at,
      preview: o.body ?? undefined,
    })),
  ], [contentItems, drafts, savedOutputs]);

  const contentSignals = useMemo(() => {
    const KEEP = ['news', 'funding', 'hiring', 'launch', 'product', 'post', 'engagement', 'competitor'];
    return signals
      .filter((s) => KEEP.some((k) => (s.signal_type ?? '').toLowerCase().includes(k)))
      .filter((s) => reviewsBySignal[s.id]?.status !== 'ignored')
      .slice(0, 10);
  }, [signals, reviewsBySignal]);

  const briefSignals: ContentBriefSignal[] = useMemo(() =>
    contentSignals.map((s) => ({
      title: s.title, signal_type: s.signal_type, score: s.fit_score ?? 0,
      company: s.account_name ?? null, source_url: s.source_url ?? null,
    })), [contentSignals]);
  const brief = useMemo(() => deriveContentBrief(briefSignals, posts.length), [briefSignals, posts.length]);

  const draftGroups = useMemo(() => {
    const groups: Record<string, typeof posts> = {
      'Needs review': [], 'Draft ready': [], 'Approved': [], 'Published': [],
    };
    for (const p of posts) {
      const raw = (p.raw ?? {}) as Record<string, any>;
      const st = deriveDraftStatus(raw.status ?? 'draft', Boolean(raw.source_url));
      if (st === 'approved') groups['Approved'].push(p);
      else if (st === 'manually_posted') groups['Published'].push(p);
      else if (st === 'needs_review' || st === 'needs_proof') groups['Needs review'].push(p);
      else groups['Draft ready'].push(p);
    }
    return groups;
  }, [posts]);

  const apifyState = classifyProviderState({
    ready: providers.apify?.status === 'connected', reason: providers.apify?.reason, integrationStatus: providers.apify?.status,
  });
  const linkedinState = classifyProviderState({
    ready: providers.linkedin?.status === 'connected', reason: providers.linkedin?.reason, integrationStatus: providers.linkedin?.status,
  });
  const sourceIssues = [apifyState, linkedinState].filter((s) => s !== 'ready');
  const commentDiscoveryReady = apifyState === 'ready' || linkedinState === 'ready';

  const stats = {
    planned: contentSignals.length,
    drafts: posts.filter((p) => { const r = (p.raw ?? {}) as any; return !r.status?.includes('publish'); }).length,
    trends: contentSignals.length,
    comments: commentDraftsData.length,
    awaiting: (draftGroups['Needs review']?.length ?? 0) + commentDraftsData.filter((d) => !d.status?.includes('approve')).length,
  };

  // THE BRIEF, BUILT FROM DATA. This is the one place an English sentence is
  // still produced — but it is a prompt for Scribe, not a chat command, and it
  // is stored on the row so a regeneration can reuse exactly it.
  // SIGNAL -> CONTENT, TYPED. This used to be
  // `dispatch(buildTurnIntoCommand(...))` — an English sentence thrown at Pilot
  // that persisted nothing and returned nothing. It now takes the same path as
  // the composer: a real signal-sourced draft, then Scribe.
  const turnSignalInto = useCallback(async (kind: 'post' | 'comment', sg: FeedSignal) => {
    if (!workspaceId) { toast.error('No workspace'); return; }
    const format: ContentFormat = kind === 'comment' ? 'linkedin_comment' : 'linkedin_post';
    // ONLY A CANONICAL SIGNAL IS A SIGNAL SOURCE. A legacy-only feed row has no
    // `signal_events` row for the FK to point at, so it becomes an idea about
    // that signal, with where it came from kept on the row — never a fake FK.
    const source = signalContentSource(sg);
    // WHO IT HAPPENED TO travels with the brief — for a legacy signal too, whose
    // row is `idea` only because it has no FK target. A competitor's launch is
    // theirs; Company Brain says who WE are.
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
    // The draft exists either way; only the generation can fail, and saying so
    // truthfully is what lets the user press Regenerate instead of wondering.
    if (!res.ok) toast.error(res.error ?? 'Scribe could not write this draft');
    await reloadContentDrafts();
  }, [workspaceId, createContentDraft, reloadContentDrafts]);

  // ── THE STUDIO'S VIEW OF ONE DRAFT ─────────────────────────────────────
  //
  // Versions and assets are read for the open draft only, through the service.
  // Images are shown from SIGNED urls minted here and never stored: the bucket
  // is private because a draft is unpublished work, and a cached signature is
  // just a link that expires where the user cannot see why.
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

  // Opening a draft loads its history; closing clears it, so the next draft
  // never flashes the previous one's picture or versions.
  useEffect(() => { void loadAssets(); void loadVersions(); }, [loadAssets, loadVersions]);

  const openInStudio = useCallback((id: string) => {
    setOpenDraftId(id);
    setView('studio');
  }, []);

  const studioItem = useMemo(
    () => (openDraftId ? contentItems.find((it) => it.id === openDraftId) ?? null : null),
    [openDraftId, contentItems],
  );

  // A LEGACY saved_outputs draft is an append-only record with nothing to save
  // back to, so it opens read-only; every action needs a real content_item.
  const legacyOpen = useMemo(
    () => (openDraftId && !contentItems.some((it) => it.id === openDraftId)
      ? posts.find((p) => p.id === openDraftId) ?? null : null),
    [openDraftId, contentItems, posts],
  );

  // WHOSE NEWS IT IS, read from the signal row for the open draft — the same
  // read a regeneration makes, so the Studio never shows a draft as ours when
  // its source says otherwise, including drafts made before attribution existed.
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
  // the editor can show it — a refusal by the spend ceiling and a provider
  // failure are different facts.
  const studioHandlers = studioItem && workspaceId ? {
    onSave: async ({ body, fields }: { body?: string; fields?: import('@/lib/content/contentInstruction').ContentBriefFields }) => {
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

  // ---- render ----------------------------------------------------------------

  return (
    <div className="flex min-h-screen">
      {/* main workspace */}
      <div className="flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-7 pb-36 lg:px-9 lg:py-9">
          {/* premium header */}
          <header className="mb-6 flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fuchsia-400/55">LinkedIn Growth Desk</p>
              <h1 className="mt-1.5 text-[38px] font-bold leading-[1.05] tracking-[-0.02em] text-foreground lg:text-[44px]">
                Content
              </h1>
              <p className="mt-2.5 max-w-[52ch] text-[16px] leading-relaxed text-muted-foreground/85 lg:text-[17px]">
                Know what to post, where to join the conversation, and how to attract the right buyers.
              </p>
            </div>

            {/* Mira identity chip + actions */}
            <div className="flex shrink-0 flex-col items-end gap-2.5">
              <div className="flex items-center gap-2.5 rounded-xl border border-fuchsia-400/15 bg-fuchsia-500/[0.04] px-3 py-2">
                <div className="overflow-hidden rounded-full border border-fuchsia-400/25 shadow-[0_0_12px_-3px_rgba(217,70,239,0.25)]">
                  {miraImgFailed ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-fuchsia-500/15 text-[12px] font-semibold text-fuchsia-300">M</div>
                  ) : (
                    <img src={scribeImg} alt="Mira" onError={() => setMiraImgFailed(true)} className="h-8 w-8 rounded-full object-cover" />
                  )}
                </div>
                <div className="leading-tight">
                  <p className="text-[13px] font-semibold text-foreground">Mira</p>
                  <p className="text-[11px] text-muted-foreground/70">AI Message Strategist · <span className="text-fuchsia-400/70">On duty</span></p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-500/15 px-3.5 py-2 text-[13px] font-semibold text-fuchsia-200 border border-fuchsia-400/20 transition-all hover:bg-fuchsia-500/25 active:scale-[0.97]"
                >
                  <FileEdit className="h-4 w-4" /> Build this week's plan
                </button>
                <button
                  onClick={() => dispatch('Lyra, refresh LinkedIn trends for my market — draft only.')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/35 bg-card/25 px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition-all hover:text-foreground active:scale-[0.97]"
                >
                  <RefreshCw className="h-4 w-4" /> Refresh trends
                </button>
              </div>
            </div>
          </header>

          {/* status strip — bigger, more readable */}
          <StatusStrip stats={stats} loading={loading} />

          {/* source issues */}
          {sourceIssues.length > 0 && (
            <div className="mb-4">
              <button
                onClick={() => setSourceIssuesOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-1.5 text-[13px] text-amber-300/80 transition-colors hover:bg-amber-500/[0.08]"
              >
                <AlertCircle className="h-4 w-4" />
                {sourceIssues.length} source{sourceIssues.length > 1 ? 's' : ''} need attention
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${sourceIssuesOpen ? 'rotate-90' : ''}`} />
              </button>
              {sourceIssuesOpen && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-amber-500/15 bg-card/20 p-3">
                  {providers.apify?.status !== 'connected' && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-400/70" />
                        <span className="text-[13px] text-foreground/80">Apify (LinkedIn)</span>
                      </div>
                      <span className="text-[12px] text-muted-foreground/60">{providers.apify?.reason ?? 'Not configured'}</span>
                    </div>
                  )}
                  {providers.linkedin?.status !== 'connected' && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-400/70" />
                        <span className="text-[13px] text-foreground/80">LinkedIn</span>
                      </div>
                      <span className="text-[12px] text-muted-foreground/60">{providers.linkedin?.reason ?? 'Not configured'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* tab navigation — bigger, more premium */}
          <nav className="mb-6 flex gap-0.5 border-b border-border/12">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`relative px-4 py-2.5 text-[14px] font-medium transition-colors ${
                  view === v.id ? 'text-fuchsia-300' : 'text-muted-foreground/55 hover:text-foreground/80'
                }`}
              >
                {v.label}
                {view === v.id && (
                  <motion.div
                    layoutId="content-tab"
                    className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-fuchsia-400/60"
                  />
                )}
              </button>
            ))}
          </nav>

          {/* view content */}
          <div className="min-h-[400px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {view === 'sources' && (
                  <div>
                    <div className="mb-4 flex flex-wrap gap-1.5">
                      {SOURCE_VIEWS.map((sv) => (
                        <button key={sv.id} onClick={() => setSourceView(sv.id)}
                          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                            sourceView === sv.id
                              ? 'border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200'
                              : 'border-border/20 text-muted-foreground/65 hover:text-foreground/85'
                          }`}>
                          {sv.label}
                        </button>
                      ))}
                      <button onClick={() => setCreateOpen(true)}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/25 px-3 py-1.5 text-[12.5px] font-medium text-foreground/85 hover:border-border/45">
                        <PenLine className="h-3.5 w-3.5" /> Start from an idea
                      </button>
                    </div>
                    {sourceView === 'foryou' && (
                      <ForYouView
                        brief={brief}
                        posts={posts}
                        commentDrafts={commentDraftsData}
                        contentSignals={contentSignals}
                        loading={loading}
                        onOpenDraft={openInStudio}
                        onTurnInto={(kind, s) => { void turnSignalInto(kind, s); }}
                        onReviewComment={() => setSourceView('comments')}
                        onAskMira={(ctx) => { setMiraContext(ctx); setMiraSignal(null); setMiraCollapsed(false); }}
                      />
                    )}
                    {sourceView === 'trends' && (
                      <TrendsView
                        signals={contentSignals}
                        loading={loading}
                        onTurnIntoPost={(s) => { void turnSignalInto('post', s); }}
                        onAskMira={(ctx, sg) => { setMiraContext(ctx); setMiraSignal(sg ?? null); setMiraCollapsed(false); }}
                      />
                    )}
                    {sourceView === 'comments' && (
                      <CommentsView
                        commentDrafts={commentDraftsData}
                        commentDiscoveryReady={commentDiscoveryReady}
                        loading={loading}
                        onOpen={(id) => { if (contentItems.some((it) => it.id === id)) openInStudio(id); }}
                        onDraft={(ctx) => dispatch(`Mira, refine this comment draft — draft only: ${ctx}`)}
                        onFindPosts={() => dispatch('Lyra, find 5 LinkedIn posts from ICP accounts to engage with — Mira will draft comments, drafts only.')}
                        onAskMira={(ctx) => { setMiraContext(ctx); setMiraSignal(null); setMiraCollapsed(false); }}
                      />
                    )}
                  </div>
                )}
                {view === 'studio' && (
                  <StudioView
                    items={contentItems.filter((it) => it.status !== 'archived')}
                    openId={openDraftId}
                    onOpen={openInStudio}
                    onCreate={() => setCreateOpen(true)}
                    legacy={legacyOpen}
                  >
                    {studioItem && studioHandlers && (
                      <ContentStudioEditor
                        item={studioItem}
                        versions={versions}
                        assets={studioAssets}
                        signal={studioSignal}
                        {...studioHandlers}
                      />
                    )}
                  </StudioView>
                )}
                {view === 'history' && (
                  <HistoryView
                    items={contentItems}
                    earlier={postDraftOutputs(savedOutputs)}
                    workflowRecaps={workflowRecaps}
                    loading={loading}
                    onOpen={openInStudio}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mira Content Copilot panel */}
      <div className="sticky top-0 hidden h-screen lg:block">
        <MiraCopilot
          collapsed={miraCollapsed}
          onToggle={() => setMiraCollapsed((v) => !v)}
          contextLabel={miraContext}
          contextSignal={miraSignal}
          onContextClear={() => { setMiraContext(null); setMiraSignal(null); }}
        />
      </div>

      {/* mobile Mira launcher */}
      <button
        onClick={() => setMiraCollapsed(false)}
        className="fixed bottom-24 right-4 z-30 flex items-center gap-2 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-3.5 py-2.5 text-[13px] font-medium text-fuchsia-200 backdrop-blur-xl lg:hidden"
      >
        <Sparkles className="h-4 w-4" /> Ask Mira
      </button>

      {/* THE TYPED CREATION PATH. The draft row is created first, then Scribe is
          asked — so a failed model call leaves the user a draft to retry rather
          than a toast and nothing at all. */}
      <ContentComposer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        signals={contentSignals.map((sg) => ({
          id: sg.id, title: sg.title,
          signal_type: sg.signal_type, account_name: sg.account_name,
        }))}
        onSubmit={async (input: ComposerSubmission) => {
          if (!workspaceId) throw new Error('No workspace');
          // THE SAME TRUTHFUL SOURCE AS A SIGNAL CARD. The composer lists feed
          // signals, and a legacy-only one has no `signal_events` row — its id
          // in `source_signal_id` violated the FK. Its subject travels either way.
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

// ============================================================ Status Strip ===

function StatusStrip({ stats, loading }: { stats: { planned: number; drafts: number; trends: number; comments: number; awaiting: number }; loading: boolean }) {
  const items = [
    { label: 'posts planned', value: stats.planned },
    { label: 'drafts ready', value: stats.drafts },
    { label: 'trends ranked', value: stats.trends },
    { label: 'comment opportunities', value: stats.comments },
    { label: 'awaiting review', value: stats.awaiting, accent: stats.awaiting > 0 },
  ];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 overflow-hidden rounded-xl border border-border/12 bg-card/[0.10] px-4 py-3 backdrop-blur-xl">
      {items.map((it, i) => (
        <div key={it.label} className="flex items-baseline gap-1.5">
          <span className={`text-[18px] font-bold tabular-nums ${it.accent ? 'text-amber-400' : 'text-foreground/90'}`}>
            {loading ? '—' : it.value}
          </span>
          <span className="text-[12px] text-muted-foreground/65">{it.label}</span>
        </div>
      ))}
      <span className="ml-auto text-[11px] text-muted-foreground/40">Updated just now</span>
    </div>
  );
}

// ============================================================ For You View ===

function ForYouView({ brief, posts, commentDrafts, contentSignals, loading, onOpenDraft, onTurnInto, onReviewComment, onAskMira }: {
  brief: ReturnType<typeof deriveContentBrief>;
  posts: ReturnType<typeof postDraftOutputs>;
  commentDrafts: { id: string; title: string; status: string | null; date: string | null; preview?: string }[];
  contentSignals: FeedSignal[];
  loading: boolean;
  onOpenDraft: (id: string) => void;
  onTurnInto: (kind: 'post' | 'comment', s: FeedSignal) => void;
  onReviewComment: () => void;
  onAskMira: (ctx: string) => void;
}) {
  const topDraft = posts[0];
  const topComments = commentDrafts.slice(0, 3);
  const topSignal = contentSignals[0];

  return (
    <div className="space-y-7">
      {/* A. Post This Next — hero card */}
      <section>
        <SectionLabel>Post this next</SectionLabel>
        {brief.isEmpty && !topDraft ? (
          <EmptyPanel
            title="No recommendation yet"
            subtext="Mira will recommend your next post once Lyra finds trending conversations in your market."
            action={{ label: 'Ask Mira', onClick: () => onAskMira('Plan my next post') }}
          />
        ) : (
          <div className="rounded-2xl border border-fuchsia-400/15 bg-gradient-to-br from-fuchsia-500/[0.05] to-violet-500/[0.02] p-5 lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fuchsia-400/50">
                  {topSignal ? 'Founder insight · Text post' : 'LinkedIn post'}
                </p>
                {topDraft ? (
                  <>
                    <p className="mt-2.5 text-[19px] font-semibold leading-snug text-foreground lg:text-[21px]">
                      "{topDraft.title ?? 'Untitled draft'}"
                    </p>
                    {topDraft.body && (
                      <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-muted-foreground/80">
                        {topDraft.body}
                      </p>
                    )}
                  </>
                ) : brief.sourceSignal ? (
                  <>
                    <p className="mt-2.5 text-[19px] font-semibold leading-snug text-foreground lg:text-[21px]">
                      "{brief.angle ?? brief.sourceSignal.title}"
                    </p>
                    <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground/75">{brief.direction}</p>
                  </>
                ) : null}

                {/* Company Brain alignment */}
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
                  <AlignChip label="ICP match" value={topSignal ? 'Strong' : 'Not yet scored'} />
                  <AlignChip label="Pain relevance" value={brief.angle ? 'High' : 'Medium'} />
                  <AlignChip label="Conversation potential" value="Medium" />
                </div>

                {/* agent handoff */}
                {topSignal && (
                  <p className="mt-3 text-[12px] text-muted-foreground/45">
                    Lyra found the conversation · Atlas ranked its Company Brain relevance · Mira created the angle
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              {topDraft ? (
                <button
                  onClick={() => onOpenDraft(topDraft.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-500/15 px-4 py-2 text-[13px] font-semibold text-fuchsia-200 transition-all hover:bg-fuchsia-500/25 active:scale-[0.97]"
                >
                  Review draft <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => onTurnInto('post', topSignal)}
                  className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-500/15 px-4 py-2 text-[13px] font-semibold text-fuchsia-200 transition-all hover:bg-fuchsia-500/25 active:scale-[0.97]"
                >
                  Create draft <ChevronRight className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => onAskMira('Improve my next hook')}
                className="text-[13px] font-medium text-muted-foreground/65 transition-colors hover:text-foreground"
              >
                Change angle
              </button>
            </div>
          </div>
        )}
      </section>

      {/* B. This Week's Post Queue */}
      <section>
        <SectionLabel>This week's post queue</SectionLabel>
        {posts.length <= 1 && !loading ? (
          <EmptyPanel
            title="No posts planned yet"
            subtext="Mira can help build a weekly content plan from your signals and Company Brain."
            action={{ label: 'Build weekly plan', onClick: () => onAskMira('Plan my next five LinkedIn posts') }}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/12 bg-card/10">
            {posts.slice(0, 7).map((p, i) => {
              const raw = (p.raw ?? {}) as Record<string, any>;
              const st = DRAFT_STATUS_LABELS[deriveDraftStatus(raw.status ?? 'draft', Boolean(raw.source_url))];
              const days = ['Monday', 'Wednesday', 'Friday', 'Sunday'];
              return (
                <QueueRow
                  key={p.id}
                  day={i < days.length ? days[i] : `Day ${i + 1}`}
                  format={(raw.subtype as string) ?? 'Founder post'}
                  title={p.title ?? 'Untitled'}
                  status={st}
                  onClick={() => onOpenDraft(p.id)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* C. Comment Today */}
      <section>
        <div className="flex items-center justify-between">
          <SectionLabel>Comment today</SectionLabel>
          {topComments.length > 0 && (
            <button onClick={onReviewComment} className="text-[12px] font-medium text-fuchsia-300/70 hover:text-fuchsia-300">
              View all →
            </button>
          )}
        </div>
        {topComments.length === 0 ? (
          <EmptyPanel
            title="No comment opportunities yet"
            subtext="Lyra can find relevant LinkedIn posts for thoughtful participation — drafts only."
            action={{ label: 'Find posts', onClick: onReviewComment }}
          />
        ) : (
          <div className="space-y-2.5">
            {topComments.map((c) => (
              <button
                key={c.id}
                onClick={() => onAskMira(`Draft a comment: ${c.title}`)}
                className="w-full rounded-xl border border-border/12 bg-card/10 px-4 py-3 text-left transition-colors hover:border-border/25 hover:bg-card/15"
              >
                <p className="text-[14px] font-medium text-foreground/90">{c.title}</p>
                {c.preview && <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground/65">{c.preview}</p>}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================ Trends View ====

function TrendsView({ signals, loading, onTurnIntoPost, onAskMira }: {
  signals: FeedSignal[];
  loading: boolean;
  onTurnIntoPost: (s: FeedSignal) => void;
  onAskMira: (ctx: string, signal?: FeedSignal) => void;
}) {
  if (loading) return <LoadingRow />;
  if (signals.length === 0) {
    return (
      <EmptyPanel
        title="No trends ranked yet"
        subtext="Lyra discovers trending LinkedIn conversations in your market. Run a signal scan or ask her to find relevant posts."
        action={{ label: 'Ask Lyra to find trends', onClick: () => onAskMira('Find trending LinkedIn conversations for my market') }}
      />
    );
  }
  return (
    <div className="space-y-2.5">
      <p className="mb-3 text-[14px] text-muted-foreground/65">
        Top {signals.length} LinkedIn conversation{signals.length === 1 ? '' : 's'} for your market — ranked by Company Brain relevance, not just popularity.
      </p>
      {signals.map((s, i) => {
        const score = s.fit_score ?? 0;
        const relevance = score > 0 ? Math.min(99, Math.round(score)) : null;
        return (
          <div key={s.id} className="group flex items-center gap-4 rounded-xl border border-border/10 bg-card/[0.08] px-4 py-3 transition-colors hover:border-border/22 hover:bg-card/15">
            <span className="w-8 shrink-0 text-center text-[16px] font-bold tabular-nums text-muted-foreground/40">#{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-foreground/90">{s.title}</p>
              <div className="mt-1 flex items-center gap-2.5 text-[11px] text-muted-foreground/50">
                {s.account_name && <span>{s.account_name}</span>}
                {s.signal_type && <span className="rounded bg-background/30 px-1.5 py-0.5">{s.signal_type}</span>}
                {relevance !== null && <span className="text-teal-400/60">ICP relevance: {relevance}</span>}
              </div>
            </div>
            <button
              onClick={() => onTurnIntoPost(s)}
              className="shrink-0 rounded-md bg-background/25 px-2.5 py-1 text-[12px] font-medium text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              Create angle
            </button>
            <button
              onClick={() => onAskMira(`Trend: ${s.title}`, s)}
              className="shrink-0 rounded-md px-1.5 py-1 text-muted-foreground/40 opacity-0 transition-opacity hover:text-fuchsia-300 group-hover:opacity-100"
              aria-label="Ask Mira"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================ Comments View ===

function CommentsView({ commentDrafts, commentDiscoveryReady, loading, onOpen, onDraft, onFindPosts, onAskMira }: {
  commentDrafts: { id: string; title: string; status: string | null; date: string | null; preview?: string }[];
  commentDiscoveryReady: boolean;
  loading: boolean;
  /** Opens a canonical comment draft in the Studio. Older read-only rows ignore it. */
  onOpen: (id: string) => void;
  onDraft: (ctx: string) => void;
  onFindPosts: () => void;
  onAskMira: (ctx: string) => void;
}) {
  if (loading) return <LoadingRow />;
  return (
    <div className="space-y-4">
      {!commentDiscoveryReady && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-4 py-3">
          <p className="text-[13px] font-medium text-amber-300/80">Comment discovery needs setup</p>
          <p className="mt-1 text-[12px] text-muted-foreground/60">
            Connect LinkedIn or Apify in Integrations to discover posts worth commenting on.
          </p>
          <button
            onClick={() => (window.location.href = '/settings/integrations')}
            className="mt-2 text-[12px] font-medium text-amber-300 hover:underline"
          >
            Open Integrations →
          </button>
        </div>
      )}
      <button
        onClick={onFindPosts}
        className="w-full rounded-xl border border-border/12 bg-card/10 px-4 py-3.5 text-left transition-colors hover:border-fuchsia-400/20 hover:bg-fuchsia-500/[0.03]"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-400/60" />
          <span className="text-[14px] font-medium text-foreground/90">Find posts worth commenting on</span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground/55">
          Lyra discovers relevant LinkedIn conversations. Mira drafts thoughtful comments for your review.
        </p>
      </button>
      {commentDrafts.length === 0 ? (
        <EmptyPanel
          title="No comment drafts yet"
          subtext="Found posts will appear here with suggested comment angles for your review."
        />
      ) : (
        <div className="space-y-2.5">
          <SectionLabel>{commentDrafts.length} comment opportunit{commentDrafts.length === 1 ? 'y' : 'ies'}</SectionLabel>
          {commentDrafts.map((c) => (
            <div key={c.id} className="group rounded-xl border border-border/10 bg-card/[0.08] px-4 py-3 transition-colors hover:border-border/25">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <button onClick={() => onOpen(c.id)} className="text-left text-[14px] font-medium text-foreground/90 hover:text-fuchsia-200">{c.title}</button>
                  {c.preview && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/70">{c.preview}</p>}
                  <span className="mt-1.5 inline-block text-[11px] text-muted-foreground/45">
                    {DRAFT_STATUS_LABELS[deriveDraftStatus(c.status)] ?? 'Draft'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onDraft(c.title)}
                    className="rounded-md bg-background/25 px-2.5 py-1 text-[12px] font-medium text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  >
                    Refine
                  </button>
                  <button
                    onClick={() => onAskMira(`Comment: ${c.title}`)}
                    className="rounded-md px-1.5 py-1 text-muted-foreground/40 opacity-0 transition-opacity hover:text-fuchsia-300 group-hover:opacity-100"
                  >
                    <Sparkles className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================ Content Studio ===

type StudioListItem = { id: string; title: string | null; status: string; format: string; updated_at: string;
  body: string; source: string | null; source_type: string; source_signal_id: string | null;
  current_version_id: string | null; metadata: Record<string, unknown> | null };

function StudioView({ items, openId, onOpen, onCreate, legacy, children }: {
  items: StudioListItem[];
  openId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  legacy: ReturnType<typeof postDraftOutputs>[number] | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-1.5">
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel>Working drafts</SectionLabel>
          <button onClick={onCreate} className="text-[12px] text-fuchsia-300/80 hover:text-fuchsia-200">+ New</button>
        </div>
        {items.length === 0 && (
          <p className="text-[13px] text-muted-foreground/60">No drafts yet. Start one from Sources.</p>
        )}
        {items.map((it) => {
          const src = describeContentSource(it);
          return (
            <button key={it.id} onClick={() => onOpen(it.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                it.id === openId ? 'border-fuchsia-400/30 bg-fuchsia-500/[0.07]' : 'border-border/15 hover:border-border/35'
              }`}>
              <p className="truncate text-[13px] font-medium text-foreground/90">{it.title || 'Untitled draft'}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">
                {STATUS_LABEL[it.status] ?? it.status} · {CONTENT_TYPE_LABEL[it.format] ?? it.format} · {src.label}
              </p>
            </button>
          );
        })}
      </aside>
      <main className="min-w-0">
        {children ?? (legacy ? (
          <div className="rounded-xl border border-border/15 bg-card/[0.08] p-4">
            <SectionLabel>Earlier draft (read-only)</SectionLabel>
            <p className="mt-2 text-[14px] font-medium text-foreground/90">{legacy.title ?? 'Untitled'}</p>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground/85">{legacy.body}</p>
            <p className="mt-3 text-[12px] text-muted-foreground/55">Written before drafts were versioned. It can be read, not edited.</p>
          </div>
        ) : (
          <EmptyPanel
            title="Pick a draft to work on"
            subtext="Open one from the list, turn a signal into a post from Sources, or start from your own idea."
            action={{ label: 'Start from an idea', onClick: onCreate }}
          />
        ))}
      </main>
    </div>
  );
}

// ================================================================== History ===

function HistoryView({ items, earlier, workflowRecaps, loading, onOpen }: {
  items: StudioListItem[];
  earlier: ReturnType<typeof postDraftOutputs>;
  workflowRecaps: ReturnType<typeof workflowSummaryOutputs>;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading) return <LoadingRow />;
  // Every status, archived included — archiving takes a draft out of the
  // working set, never out of the record.
  const groups: Array<[string, StudioListItem[]]> = (['draft', 'approved', 'archived'] as const)
    .map((st) => [STATUS_LABEL[st], items.filter((it) => it.status === st)] as [string, StudioListItem[]]);
  // `earlier` holds legacy saved_outputs drafts only; canonical rows are never there.
  const legacyOnly = earlier.filter((e) => !items.some((it) => it.id === e.id));
  return (
    <div className="space-y-6">
      {groups.map(([label, rows]) => (
        <section key={label}>
          <SectionLabel>{label} · {rows.length}</SectionLabel>
          {rows.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground/55">None.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {rows.map((it) => {
                const src = describeContentSource(it);
                const about = relationshipLabel(src.subject);
                return (
                  <li key={it.id}>
                    <button onClick={() => onOpen(it.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border/15 px-3 py-2 text-left hover:border-border/35">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground/90">{it.title || 'Untitled draft'}</span>
                        <span className="block truncate text-[11px] text-muted-foreground/60">
                          {CONTENT_TYPE_LABEL[it.format] ?? it.format} · {src.label}{about ? ` · ${about}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground/50">{new Date(it.updated_at).toLocaleDateString()}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {legacyOnly.length > 0 && (
        <section>
          <SectionLabel>Earlier, read-only · {legacyOnly.length}</SectionLabel>
          <ul className="mt-2 space-y-1.5">
            {legacyOnly.map((e) => (
              <li key={e.id}>
                <button onClick={() => onOpen(e.id)} className="w-full truncate rounded-lg border border-border/10 px-3 py-2 text-left text-[13px] text-muted-foreground/75 hover:border-border/30">
                  {e.title ?? 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {workflowRecaps.length > 0 && (
        <section>
          <SectionLabel>Workflow recaps</SectionLabel>
          <ul className="mt-2 space-y-1">
            {workflowRecaps.slice(0, 5).map((w) => (
              <li key={w.id} className="truncate text-[12.5px] text-muted-foreground/70">{w.title ?? 'Workflow summary'}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/55">
      {children}
    </p>
  );
}

function AlignChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-muted-foreground/50">{label}:</span>
      <span className={`text-[13px] font-medium ${value === 'Strong' || value === 'High' ? 'text-teal-400/75' : 'text-muted-foreground/75'}`}>
        {value}
      </span>
    </div>
  );
}

function QueueRow({ day, format, title, status, onClick }: {
  day: string;
  format: string;
  title: string;
  status: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 border-b border-border/8 px-4 py-3 text-left transition-all last:border-b-0 hover:bg-background/12 active:scale-[0.995]"
    >
      <span className="w-[60px] shrink-0 text-[12px] font-medium text-muted-foreground/55">{day}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-foreground/85">{title}</p>
        <span className="text-[11px] text-muted-foreground/45">{format}</span>
      </div>
      <StatusBadge status={status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/30" />
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status.includes('Approved') || status.includes('Published')
    ? 'text-teal-400/70 border-teal-400/20 bg-teal-500/[0.05]'
    : status.includes('review') || status.includes('proof')
      ? 'text-amber-400/70 border-amber-400/20 bg-amber-500/[0.05]'
      : 'text-muted-foreground/55 border-border/20 bg-background/20';
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function EmptyPanel({ title, subtext, action }: {
  title: string;
  subtext: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/12 bg-card/[0.05] px-5 py-8 text-center">
      <p className="text-[14px] font-medium text-foreground/80">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground/55">{subtext}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-fuchsia-500/10 px-4 py-2 text-[13px] font-semibold text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-16 text-[14px] text-muted-foreground/50">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading…
    </div>
  );
}

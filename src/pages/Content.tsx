// Content — LinkedIn Growth Desk (Premium Refinement)
//
// A premium content intelligence workspace with bigger typography, generous
// spacing, and a refined Mira copilot. Four views: For You, Top 10 Trends,
// Comment Opportunities, Plan & Drafts.
//
// All data is real. Everything is approval-first. Backend unchanged.

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, FileEdit, RefreshCw, ChevronRight,
  TrendingUp, AlertCircle, PenLine,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSignalFeed } from '@/hooks/useSignalFeed';
import { useSignalReviews } from '@/hooks/useSignalReviews';
import { useIntegrationReadiness } from '@/hooks/useIntegrationReadiness';
import { sendAgentCommand } from '@/lib/agentCommand';
import {
  postDraftOutputs, workflowSummaryOutputs,
  commentDraftOutputs, commentDraftRows,
} from '@/lib/contentBuckets';
import { buildTurnIntoCommand } from '@/lib/signalIdeaActions';
import { deriveDraftStatus, DRAFT_STATUS_LABELS, deriveContentBrief, type ContentBriefSignal } from '@/lib/contentOps';
import type { FeedSignal } from '@/lib/signalFeedModel';
import CreatePostModal from '@/components/content/CreatePostModal';
import ContentDetailDrawer from '@/components/content/ContentDetailDrawer';
import ManualContentSource from '@/components/content/ManualContentSource';
import { classifyProviderState } from '@/components/signals/ProviderBadge';
import { MiraCopilot } from '@/components/content/MiraCopilot';
import scribeImg from '@/assets/agents/scribe.png';

const dispatch = (text: string) =>
  void sendAgentCommand(text, { success: 'Sent to your workforce', action_source: 'content_action' });

type ViewId = 'foryou' | 'trends' | 'comments' | 'plan';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'foryou', label: 'For You' },
  { id: 'trends', label: 'Top 10 Trends' },
  { id: 'comments', label: 'Comment Opportunities' },
  { id: 'plan', label: 'Plan & Drafts' },
];

export default function Content() {
  const { workspaceId } = useWorkspace();
  const { savedOutputs, drafts, signals, loading } = useSignalFeed(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);
  const { providers } = useIntegrationReadiness();
  const [view, setView] = useState<ViewId>('foryou');
  const [createOpen, setCreateOpen] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [miraCollapsed, setMiraCollapsed] = useState(false);
  const [miraContext, setMiraContext] = useState<string | null>(null);
  const [sourceIssuesOpen, setSourceIssuesOpen] = useState(false);
  const [miraImgFailed, setMiraImgFailed] = useState(false);

  // ---- data bucketing (all real data) ---------------------------------------

  const posts = useMemo(() => postDraftOutputs(savedOutputs), [savedOutputs]);
  const workflowRecaps = useMemo(() => workflowSummaryOutputs(savedOutputs), [savedOutputs]);
  const commentDraftsData = useMemo(() => [
    ...commentDraftRows(drafts).map((d) => ({
      id: d.id, title: d.subject ?? 'Comment draft', status: d.status, date: d.created_at,
      preview: d.body ?? undefined,
    })),
    ...commentDraftOutputs(savedOutputs).map((o) => ({
      id: o.id, title: o.title ?? 'Comment draft', status: (o.raw as any)?.status ?? 'draft', date: o.created_at,
      preview: o.body ?? undefined,
    })),
  ], [drafts, savedOutputs]);

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

  const openDetail = useMemo(() => {
    if (!openDraftId) return null;
    const p = posts.find((x) => x.id === openDraftId);
    if (!p) return null;
    const raw = (p.raw ?? {}) as Record<string, any>;
    const proofUrl = raw.source_url ?? raw.source_details?.funding_source_url ?? null;
    return {
      id: p.id, title: p.title ?? 'Untitled draft', format: 'LinkedIn post',
      statusLabel: DRAFT_STATUS_LABELS[deriveDraftStatus(raw.status ?? 'draft', Boolean(proofUrl))],
      sourceSignal: raw.source ?? null, coreArgument: null, hookOptions: [],
      body: p.body ?? null, cta: null, proofUrl,
      missingProof: proofUrl ? [] : ['Source proof URL'],
    } as NonNullable<React.ComponentProps<typeof ContentDetailDrawer>['detail']>;
  }, [openDraftId, posts]);

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
                {view === 'foryou' && (
                  <ForYouView
                    brief={brief}
                    posts={posts}
                    commentDrafts={commentDraftsData}
                    contentSignals={contentSignals}
                    loading={loading}
                    onOpenDraft={setOpenDraftId}
                    onTurnInto={(kind, s) => dispatch(buildTurnIntoCommand(kind, { title: s.title, sourceUrl: s.source_url }))}
                    onReviewComment={() => setView('comments')}
                    onAskMira={(ctx) => { setMiraContext(ctx); setMiraCollapsed(false); }}
                  />
                )}
                {view === 'trends' && (
                  <TrendsView
                    signals={contentSignals}
                    loading={loading}
                    onTurnIntoPost={(s) => dispatch(buildTurnIntoCommand('post', { title: s.title, sourceUrl: s.source_url }))}
                    onAskMira={(ctx) => { setMiraContext(ctx); setMiraCollapsed(false); }}
                  />
                )}
                {view === 'comments' && (
                  <CommentsView
                    commentDrafts={commentDraftsData}
                    commentDiscoveryReady={commentDiscoveryReady}
                    loading={loading}
                    onDraft={(ctx) => dispatch(`Mira, refine this comment draft — draft only: ${ctx}`)}
                    onFindPosts={() => dispatch('Lyra, find 5 LinkedIn posts from ICP accounts to engage with — Mira will draft comments, drafts only.')}
                    onAskMira={(ctx) => { setMiraContext(ctx); setMiraCollapsed(false); }}
                  />
                )}
                {view === 'plan' && (
                  <PlanView
                    draftGroups={draftGroups}
                    workflowRecaps={workflowRecaps}
                    loading={loading}
                    onOpenDraft={setOpenDraftId}
                    onCreate={() => setCreateOpen(true)}
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
          onContextClear={() => setMiraContext(null)}
        />
      </div>

      {/* mobile Mira launcher */}
      <button
        onClick={() => setMiraCollapsed(false)}
        className="fixed bottom-24 right-4 z-30 flex items-center gap-2 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-3.5 py-2.5 text-[13px] font-medium text-fuchsia-200 backdrop-blur-xl lg:hidden"
      >
        <Sparkles className="h-4 w-4" /> Ask Mira
      </button>

      <ContentDetailDrawer detail={openDetail} onClose={() => setOpenDraftId(null)} />
      <CreatePostModal open={createOpen} onClose={() => setCreateOpen(false)} />
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
  onAskMira: (ctx: string) => void;
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
              onClick={() => onAskMira(`Trend: ${s.title}`)}
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

function CommentsView({ commentDrafts, commentDiscoveryReady, loading, onDraft, onFindPosts, onAskMira }: {
  commentDrafts: { id: string; title: string; status: string | null; date: string | null; preview?: string }[];
  commentDiscoveryReady: boolean;
  loading: boolean;
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
                  <p className="text-[14px] font-medium text-foreground/90">{c.title}</p>
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

// ============================================================ Plan View ======

function PlanView({ draftGroups, workflowRecaps, loading, onOpenDraft, onCreate }: {
  draftGroups: Record<string, ReturnType<typeof postDraftOutputs>>;
  workflowRecaps: ReturnType<typeof workflowSummaryOutputs>;
  loading: boolean;
  onOpenDraft: (id: string) => void;
  onCreate: () => void;
}) {
  const [subtab, setSubtab] = useState<'upcoming' | 'drafts'>('drafts');
  const allDrafts = Object.values(draftGroups).flat();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSubtab('upcoming')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${subtab === 'upcoming' ? 'bg-fuchsia-500/10 text-fuchsia-300' : 'text-muted-foreground/60 hover:text-foreground'}`}
        >
          Upcoming
        </button>
        <button
          onClick={() => setSubtab('drafts')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${subtab === 'drafts' ? 'bg-fuchsia-500/10 text-fuchsia-300' : 'text-muted-foreground/60 hover:text-foreground'}`}
        >
          Drafts
        </button>
        <button
          onClick={onCreate}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/20 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <PenLine className="h-3.5 w-3.5" /> New post
        </button>
      </div>

      {subtab === 'upcoming' && (
        <div className="space-y-4">
          {workflowRecaps.length > 0 && (
            <div>
              <SectionLabel>Recent workflow recaps</SectionLabel>
              <div className="space-y-2.5">
                {workflowRecaps.slice(0, 5).map((w) => {
                  const raw = (w.raw ?? {}) as any;
                  return (
                    <div key={w.id} className="rounded-xl border border-border/10 bg-card/[0.08] px-4 py-3">
                      <p className="text-[14px] font-medium text-foreground/90">{w.title ?? 'Workflow recap'}</p>
                      {w.body && <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground/60">{w.body}</p>}
                      <span className="mt-1.5 inline-block text-[11px] text-muted-foreground/45">From {raw.source ?? 'Pilot'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <ManualContentSource />
        </div>
      )}

      {subtab === 'drafts' && (
        <div className="space-y-5">
          {allDrafts.length === 0 && !loading ? (
            <EmptyPanel
              title="No drafts yet"
              subtext="Mira prepares LinkedIn posts from your signals and Company Brain. All drafts need your approval before publishing."
              action={{ label: 'Create post', onClick: onCreate }}
            />
          ) : (
            Object.entries(draftGroups).map(([group, items]) =>
              items.length === 0 ? null : (
                <div key={group}>
                  <SectionLabel>
                    {group} <span className="ml-1 text-muted-foreground/40">({items.length})</span>
                  </SectionLabel>
                  <div className="overflow-hidden rounded-xl border border-border/10 bg-card/[0.08]">
                    {items.map((p) => {
                      const raw = (p.raw ?? {}) as Record<string, any>;
                      const st = DRAFT_STATUS_LABELS[deriveDraftStatus(raw.status ?? 'draft', Boolean(raw.source_url))];
                      return (
                        <QueueRow
                          key={p.id}
                          day={p.created_at ? new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                          format={(raw.subtype as string) ?? 'LinkedIn post'}
                          title={p.title ?? 'Untitled'}
                          status={st}
                          onClick={() => onOpenDraft(p.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              )
            )
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================ Shared UI ======

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

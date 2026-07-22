import { useMemo, useState } from "react";
import { FileEdit, MessageSquare, Repeat, Search, Lightbulb } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSignalFeed } from "@/hooks/useSignalFeed";
import { useSignalReviews } from "@/hooks/useSignalReviews";
import { useIntegrationReadiness } from "@/hooks/useIntegrationReadiness";
import ContentPromptBox from "@/components/content/ContentPromptBox";
import CreatePostModal from "@/components/content/CreatePostModal";
import ContentDraftCard, { type DraftStatus } from "@/components/content/ContentDraftCard";
import ContentBrief from "@/components/content/ContentBrief";
import ContentOpportunityCard from "@/components/content/ContentOpportunityCard";
import DraftApprovalQueue, { type QueueDraft } from "@/components/content/DraftApprovalQueue";
import CommentOpportunityCard, { type CommentOpportunity } from "@/components/content/CommentOpportunityCard";
import ContentDetailDrawer, { type ContentDetail } from "@/components/content/ContentDetailDrawer";
import ContentLoopPreview from "@/components/content/ContentLoopPreview";
import ManualContentSource from "@/components/content/ManualContentSource";
import ProviderBadge, { classifyProviderState } from "@/components/signals/ProviderBadge";
import { sendAgentCommand } from "@/lib/agentCommand";
import { postDraftOutputs, workflowSummaryOutputs, commentDraftOutputs, commentDraftRows } from "@/lib/contentBuckets";
import { buildTurnIntoCommand } from "@/lib/signalIdeaActions";
import { deriveDraftStatus, DRAFT_STATUS_LABELS } from "@/lib/contentOps";
import type { FeedSignal } from "@/lib/signalFeedModel";

const dispatchChat = (text: string) =>
  void sendAgentCommand(text, { success: "Sent to Pilot", action_source: "content_action" });

function deriveStatus(status: string | null | undefined): DraftStatus {
  const s = (status ?? "").toLowerCase();
  if (s.includes("publish")) return "published";
  if (s.includes("approve")) return "approved";
  if (s.includes("review")) return "review_needed";
  if (s.includes("block")) return "blocked";
  if (s.includes("draft") || s.includes("ready")) return "draft_ready";
  return "needs_input";
}

export default function Content() {
  const { workspaceId } = useWorkspace();
  const { savedOutputs, drafts, signals, loading } = useSignalFeed(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);
  const { providers } = useIntegrationReadiness();
  const [createOpen, setCreateOpen] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);

  // Turn a content-worthy signal into an approval-gated draft (never posts).
  const turnInto = (kind: "post" | "comment", s: FeedSignal) =>
    void sendAgentCommand(buildTurnIntoCommand(kind, { title: s.title, sourceUrl: s.source_url }), {
      success: "Sent to Pilot", action_source: "content_action",
    });

  // Bucket by the saved-output types Scribe/pilot-chat actually write, so counts
  // reflect real data instead of a "brief" string that never matches.
  const workflowRecaps = useMemo(() => workflowSummaryOutputs(savedOutputs), [savedOutputs]);
  const posts = useMemo(() => postDraftOutputs(savedOutputs), [savedOutputs]);
  const commentDrafts = useMemo(
    () => [
      ...commentDraftRows(drafts).map((d) => ({
        id: d.id, title: d.subject ?? "Comment draft", status: d.status, date: d.created_at, preview: d.body ?? undefined,
      })),
      ...commentDraftOutputs(savedOutputs).map((o) => ({
        id: o.id, title: o.title ?? "Comment draft", status: (o.raw as any)?.status ?? "draft", date: o.created_at, preview: o.body ?? undefined,
      })),
    ],
    [drafts, savedOutputs]
  );
  const contentSignals = useMemo(() => {
    const KEEP = ["news", "funding", "hiring", "launch", "product", "post", "engagement", "competitor"];
    return signals
      .filter((s) => KEEP.some((k) => (s.signal_type ?? "").toLowerCase().includes(k)))
      // Ignored ideas drop out of the suggestion list so they don't reappear.
      .filter((s) => reviewsBySignal[s.id]?.status !== "ignored")
      .sort((a, b) => (b.source_url ? 1 : 0) - (a.source_url ? 1 : 0))
      .slice(0, 8);
  }, [signals, reviewsBySignal]);

  // Drafts awaiting approval (real content_draft saved_outputs).
  const queueDrafts: QueueDraft[] = useMemo(() => posts.slice(0, 8).map((p) => {
    const raw = (p.raw ?? {}) as Record<string, any>;
    const proofUrl = raw.source_url ?? raw.source_details?.funding_source_url ?? null;
    return {
      id: p.id,
      title: p.title ?? "Untitled draft",
      format: "LinkedIn post",
      status: deriveDraftStatus(raw.status ?? "draft", Boolean(proofUrl)),
      date: p.created_at,
      preview: p.body ?? null,
      sourceUrl: proofUrl,
    };
  }), [posts]);

  // Comment opportunities from real comment drafts.
  const commentOpportunities: CommentOpportunity[] = useMemo(() => commentDrafts.slice(0, 6).map((d) => ({
    id: d.id,
    context: d.title,
    why: "A relevant conversation worth engaging authentically.",
    angle: "Add a specific, experience-based perspective — not a pitch.",
    draft: d.preview ?? null,
    statusLabel: DRAFT_STATUS_LABELS[deriveDraftStatus(d.status)],
    sourceUrl: null,
  })), [commentDrafts]);

  const draftsAwaiting = useMemo(
    () => queueDrafts.filter((d) => d.status !== "approved" && d.status !== "manually_posted").length + commentOpportunities.length,
    [queueDrafts, commentOpportunities],
  );

  const openDetail: ContentDetail | null = useMemo(() => {
    if (!openDraftId) return null;
    const p = posts.find((x) => x.id === openDraftId);
    if (!p) return null;
    const raw = (p.raw ?? {}) as Record<string, any>;
    const proofUrl = raw.source_url ?? raw.source_details?.funding_source_url ?? null;
    return {
      id: p.id,
      title: p.title ?? "Untitled draft",
      format: "LinkedIn post",
      statusLabel: DRAFT_STATUS_LABELS[deriveDraftStatus(raw.status ?? "draft", Boolean(proofUrl))],
      sourceSignal: raw.source ?? null,
      coreArgument: null,
      hookOptions: [],
      body: p.body ?? null,
      cta: null,
      proofUrl,
      missingProof: proofUrl ? [] : ["Source proof URL"],
    };
  }, [openDraftId, posts]);

  const linkedin = providers.linkedin;
  const apify = providers.apify;
  const linkedinState = classifyProviderState({
    ready: linkedin?.status === "connected",
    reason: linkedin?.reason,
    integrationStatus: linkedin?.status,
  });
  const apifyState = classifyProviderState({
    ready: apify?.status === "connected",
    reason: apify?.reason,
    integrationStatus: apify?.status,
  });
  const commentDiscoveryReady = apifyState === "ready" || linkedinState === "ready";

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1360px] mx-auto px-6 lg:px-8 py-8 pb-40 space-y-6">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[30px] md:text-[32px] font-bold text-foreground tracking-tight">Content Workspace</h1>
            <p className="text-[15px] md:text-[16px] text-muted-foreground mt-1.5">
              Turn signals into founder posts, comments, and approval-ready drafts. You approve everything — nothing publishes on its own.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TopBtn primary icon={<FileEdit className="h-4 w-4" />} label="Create post" onClick={() => setCreateOpen(true)} />
            <TopBtn
              icon={<MessageSquare className="h-4 w-4" />}
              label="Find posts to comment on"
              badge={<ProviderBadge state={commentDiscoveryReady ? "ready" : apifyState} />}
              onClick={() =>
                dispatchChat(
                  commentDiscoveryReady
                    ? "Nova, find 5 LinkedIn posts from ICP accounts to engage with — Mira will draft comments, drafts only."
                    : "Comment discovery requires LinkedIn or Apify. Open integrations or paste a post URL manually."
                )
              }
            />
            <TopBtn icon={<Repeat className="h-4 w-4" />} label="Build content loop" onClick={() => dispatchChat("Help me configure a weekly content loop — draft only.")} />
          </div>
        </header>

        {/* Today's Content Brief — real-data summary */}
        <ContentBrief signals={contentSignals} draftsAwaiting={draftsAwaiting} onStart={(t) => dispatchChat(t)} />

        {/* Prompt */}
        <ContentPromptBox />

        {/* 2-col grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left */}
          <div className="lg:col-span-7 space-y-6">
            <Section title="Workflow recaps" count={workflowRecaps.length} loading={loading}>
              {workflowRecaps.length === 0 ? (
                <EmptyState
                  title="No workflow recaps yet."
                  subtext="When Pilot runs a workflow (sourcing, research, drafts), Agentory saves a recap here."
                  actions={[{ label: "Ask Agentory", onClick: () => dispatchChat("Summarize what my workforce has done recently.") }]}
                />
              ) : (
                workflowRecaps.slice(0, 5).map((b) => (
                  <ContentDraftCard
                    key={b.id}
                    id={b.id}
                    title={b.title ?? "Workflow recap"}
                    contentType="Workflow recap"
                    source={(b.raw as any)?.source ?? "Pilot"}
                    sourceUrl={(b.raw as any)?.source_url ?? null}
                    sourceVerified={Boolean((b.raw as any)?.source_url)}
                    status={deriveStatus((b.raw as any)?.status)}
                    date={b.created_at}
                    preview={b.body ?? undefined}
                    nextAction="Review, then turn into a post if useful."
                  />
                ))
              )}
            </Section>

            <Section title="Drafts awaiting approval" count={queueDrafts.length} loading={loading}>
              <DraftApprovalQueue drafts={queueDrafts} onOpen={setOpenDraftId} />
            </Section>

            <ManualContentSource />
          </div>

          {/* Right */}
          <div className="lg:col-span-5 space-y-6">
            <Section title="Comment opportunities" count={commentOpportunities.length} loading={loading}>
              {commentOpportunities.length === 0 ? (
                <EmptyState
                  title={commentDiscoveryReady ? "No comment drafts yet." : "No engagement opportunities yet."}
                  subtext={
                    commentDiscoveryReady
                      ? "Find posts from your ICP, competitors, or saved signals. Mira will draft thoughtful comments for review."
                      : "Nova can find relevant posts once LinkedIn sources are configured. You can also paste a post manually."
                  }
                  actions={[
                    { label: commentDiscoveryReady ? "Find posts to comment on" : "Find opportunities", primary: true, onClick: () => dispatchChat("Scout, find 5 LinkedIn posts to engage with — draft comments only.") },
                    { label: "Use saved signals", onClick: () => dispatchChat("Penn, draft comments from my saved signals — draft only.") },
                    { label: "Paste post URL", onClick: () => dispatchChat("Penn, I'll paste a LinkedIn post URL — draft a comment on it, draft only.") },
                  ]}
                />
              ) : (
                commentOpportunities.map((o) => (
                  <CommentOpportunityCard
                    key={o.id}
                    opportunity={o}
                    onDraft={() => dispatchChat(`Penn, refine this comment draft — draft only: ${o.context}`)}
                  />
                ))
              )}
            </Section>

            <Section title="Signals worth turning into content" count={contentSignals.length} loading={loading} icon={<Lightbulb className="h-4 w-4 text-primary" />}>
              {contentSignals.length === 0 ? (
                <EmptyState
                  title="No content-worthy signals yet."
                  subtext="Run a Scout radar scan or paste a source below."
                  actions={[{ label: "Open Signals", onClick: () => (window.location.href = "/signals") }]}
                />
              ) : (
                contentSignals.map((s) => (
                  <ContentOpportunityCard
                    key={s.id}
                    signal={s}
                    onTurnIntoPost={() => turnInto("post", s)}
                    onTurnIntoComment={() => turnInto("comment", s)}
                  />
                ))
              )}
            </Section>

            <Section title="Content loop" count={0} loading={false}>
              <ContentLoopPreview />
            </Section>
          </div>
        </div>
      </div>

      <ContentDetailDrawer detail={openDetail} onClose={() => setOpenDraftId(null)} />
      <CreatePostModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function TopBtn({ icon, label, onClick, primary, badge }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; badge?: React.ReactNode }) {
  const cls = primary
    ? "bg-primary text-primary-foreground hover:opacity-90"
    : "border border-border bg-card text-foreground hover:bg-muted/40";
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[14px] font-semibold transition ${cls}`}>
      {icon}{label}
      {badge && <span className="ml-1">{badge}</span>}
    </button>
  );
}

function Section({ title, count, loading, children, icon }: { title: string; count: number; loading: boolean; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[18px] md:text-[19px] font-semibold text-foreground flex items-center gap-2">
          {icon ?? <Search className="h-4 w-4 text-primary" />}
          {title}
        </h3>
        <span className="text-[12px] text-muted-foreground tabular-nums">{loading ? "…" : count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function EmptyState({ title, subtext, actions }: { title: string; subtext: string; actions?: { label: string; onClick: () => void; primary?: boolean }[] }) {
  return (
    <div className="text-center py-6 px-3">
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      <p className="text-[14px] text-muted-foreground mt-1.5 max-w-md mx-auto">{subtext}</p>
      {actions && actions.length > 0 && (
        <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              className={`text-[14px] font-semibold px-3 py-1.5 rounded-lg transition ${a.primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border/70 bg-background/50 text-foreground/90 hover:border-primary/40"}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

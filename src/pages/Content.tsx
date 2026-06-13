import { useMemo } from "react";
import { FileEdit, MessageSquare, Sparkles, Repeat } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSignalFeed } from "@/hooks/useSignalFeed";

const dispatchChat = (text: string) => {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: { text } }));
};

export default function Content() {
  const { workspaceId } = useWorkspace();
  const { savedOutputs, drafts, signals, loading } = useSignalFeed(workspaceId);

  const posts = useMemo(
    () => savedOutputs.filter((o) => (o.type ?? "").includes("content") || (o.type ?? "").includes("post")),
    [savedOutputs]
  );
  const commentDrafts = useMemo(
    () => drafts.filter((d) => (d.channel ?? "").toLowerCase().includes("comment")),
    [drafts]
  );
  const engagementOpps = useMemo(
    () => signals.filter((s) => (s.signal_type ?? "").toLowerCase().includes("engagement") || (s.signal_type ?? "").toLowerCase().includes("post")),
    [signals]
  );

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Content</h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Create founder content and find engagement opportunities.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={<FileEdit className="h-3.5 w-3.5" />} label="Create post"
              onClick={() => dispatchChat("Scribe, draft a LinkedIn post about what we shipped this week.")} />
            <ActionButton icon={<MessageSquare className="h-3.5 w-3.5" />} label="Find posts to comment on"
              onClick={() => dispatchChat("Scout, find 5 LinkedIn posts from ICP accounts we should engage with.")} />
            <ActionButton icon={<Repeat className="h-3.5 w-3.5" />} label="Build content loop"
              onClick={() => dispatchChat("Run the content engagement loop: Scribe drafts a post, Scout finds related discussions, Aria ranks them, Scribe drafts comments — drafts only.")} />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Founder post drafts" count={posts.length} loading={loading}>
            {posts.length === 0
              ? <EmptyHint text="No drafts yet. Click Create post to start." />
              : posts.slice(0, 6).map((p) => (
                <Row key={p.id} title={p.title ?? "Untitled draft"} body={p.body ?? ""} time={p.created_at} />
              ))}
          </Section>

          <Section title="Comment drafts" count={commentDrafts.length} loading={loading}>
            {commentDrafts.length === 0
              ? <EmptyHint text="No comment drafts. Find posts to comment on to get started." />
              : commentDrafts.slice(0, 6).map((d) => (
                <Row key={d.id} title={d.subject ?? "Comment"} body={d.body ?? ""} time={d.created_at} />
              ))}
          </Section>

          <Section title="Engagement opportunities" count={engagementOpps.length} loading={loading}>
            {engagementOpps.length === 0
              ? <EmptyHint text="Scout hasn't surfaced engagement opportunities yet." />
              : engagementOpps.slice(0, 6).map((s) => (
                <Row key={s.id} title={s.title ?? s.signal_label ?? "Signal"} body={s.description ?? ""} time={s.created_at} />
              ))}
          </Section>

          <Section title="Related signals" count={signals.length} loading={loading}>
            {signals.length === 0
              ? <EmptyHint text="No signals yet." />
              : signals.slice(0, 6).map((s) => (
                <Row key={s.id} title={s.title ?? s.signal_label ?? "Signal"} body={s.description ?? ""} time={s.created_at} />
              ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted/50 text-foreground transition-colors">
      {icon}{label}
    </button>
  );
}

function Section({ title, count, loading, children }: { title: string; count: number; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> {title}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">{loading ? "…" : count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ title, body, time }: { title: string; body: string; time: string | null }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground line-clamp-1">{title}</p>
        {time && <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{new Date(time).toLocaleDateString()}</span>}
      </div>
      {body && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{body}</p>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-4 text-center">{text}</p>;
}

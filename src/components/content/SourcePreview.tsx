// A SOURCE, OPENED IN THE STUDIO — before anything is written.
//
// What happened, to whom, why it is relevant, which angle to take. Creating a
// post or a comment from it goes through the page's canonical creator (the row
// first, then Scribe), with the signal's ownership in the brief — a competitor's
// news is never written as ours.
//
// "Ask Pilot about this" keeps the proven chat path: the signal's id travels as
// action metadata and Pilot verifies it against the workspace.

import { useState } from "react";
import { Loader2, FileText, MessageSquare, ArrowUp, ExternalLink } from "lucide-react";
import { sourceCardOf, type SourceSignalLike } from "@/lib/content/contentStudioModel";

export default function SourcePreview({ signal, onCreate, onAskPilot }: {
  signal: SourceSignalLike;
  onCreate: (kind: "post" | "comment") => Promise<void>;
  onAskPilot: (text: string) => Promise<void>;
}) {
  const c = sourceCardOf(signal);
  const [busy, setBusy] = useState<null | "post" | "comment" | "ask">(null);
  const [ask, setAsk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const run = async (key: "post" | "comment" | "ask", fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(null); }
  };

  return (
    <article className="max-w-[720px]">
      <p className="text-[12px] text-muted-foreground/65">
        {[signal.store === "signals" ? "Earlier signal" : "Signal", c.about, c.relevance !== null ? `Relevance ${c.relevance}` : null]
          .filter(Boolean).join(" · ")}
      </p>
      <h2 className="mt-2 text-[22px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{c.title}</h2>
      {c.about && c.about !== "External" && (
        <p className="mt-2 text-[13px] text-muted-foreground/70">This is {c.company ? `${c.company}'s` : "someone else's"} news — Scribe writes our point of view on it, never as if we did it.</p>
      )}
      {c.context && <p className="mt-5 text-[14.5px] leading-[1.7] text-foreground/85">{c.context}</p>}
      {c.angle && (
        <div className="mt-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">Recommended angle</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-foreground/85">{c.angle}</p>
        </div>
      )}
      {signal.source_url && (
        <a href={signal.source_url} target="_blank" rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground/70 hover:text-foreground">
          <ExternalLink className="h-3.5 w-3.5" /> View source
        </a>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <button onClick={() => run("post", () => onCreate("post"))} disabled={!!busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-500 px-4 text-[13.5px] font-medium text-white hover:bg-violet-400 disabled:opacity-60">
          {busy === "post" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Create post
        </button>
        <button onClick={() => run("comment", () => onCreate("comment"))} disabled={!!busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/[0.05] px-4 text-[13.5px] font-medium text-foreground/90 hover:bg-white/[0.09] disabled:opacity-60">
          {busy === "comment" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />} Create comment
        </button>
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground/55">
        Scribe drafts it in the Studio for your review. Nothing is ever posted.
      </p>

      <form className="mt-10 max-w-[560px]"
        onSubmit={(e) => {
          e.preventDefault();
          const t = ask.trim();
          if (!t) return;
          void run("ask", async () => { await onAskPilot(t); setAsk(""); setSent(true); });
        }}>
        <label className="text-[12px] text-muted-foreground/60" htmlFor="ask-pilot">Ask Pilot about this signal</label>
        <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-1.5 ring-1 ring-white/[0.06] focus-within:ring-white/[0.14]">
          <input id="ask-pilot" value={ask} onChange={(e) => { setAsk(e.target.value); setSent(false); }}
            placeholder="e.g. What does this mean for our positioning?"
            className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-foreground/90 outline-none placeholder:text-muted-foreground/40" />
          <button type="submit" disabled={!ask.trim() || !!busy} aria-label="Send to Pilot"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.08] text-foreground disabled:text-muted-foreground/40">
            {busy === "ask" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
          </button>
        </div>
        {sent && <p className="mt-2 text-[12px] text-muted-foreground/65">Sent to Pilot — the reply is in your workforce chat.</p>}
      </form>
      {error && <p className="mt-3 text-[12.5px] text-amber-300/90">{error}</p>}
    </article>
  );
}

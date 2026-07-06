import { useState } from "react";
import { Link2 } from "lucide-react";
import ProviderBadge, { classifyProviderState } from "@/components/signals/ProviderBadge";
import { useIntegrationReadiness } from "@/hooks/useIntegrationReadiness";
import { sendAgentCommand } from "@/lib/agentCommand";

const dispatchChat = (text: string) =>
  void sendAgentCommand(text, { success: "Sent to Pilot", action_source: "content_action" });

const SOURCE_TYPES = [
  { value: "linkedin_post", label: "LinkedIn post URL" },
  { value: "signal_url", label: "Signal URL" },
  { value: "company_site", label: "Company website" },
  { value: "product_update", label: "Product update text" },
  { value: "founder_thought", label: "Founder thought" },
];

export default function ManualContentSource() {
  const [type, setType] = useState(SOURCE_TYPES[0].value);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const { providers } = useIntegrationReadiness();
  const fc = providers.firecrawl;
  const fcState = classifyProviderState({
    ready: fc?.status === "connected",
    reason: fc?.reason,
    integrationStatus: fc?.status,
  });

  const needsUrl = type === "linkedin_post" || type === "signal_url" || type === "company_site";
  const providerReady = fcState === "ready";

  const run = (action: string) => {
    const src = needsUrl ? url.trim() : text.trim();
    if (!src) return;
    dispatchChat(`${action} from ${type === "founder_thought" ? "founder thought" : type.replace("_", " ")}: ${src}. Draft only.`);
  };

  return (
    <section className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <h3 className="text-[18px] font-semibold text-foreground">Create from source</h3>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          Firecrawl <ProviderBadge state={fcState} />
        </div>
      </div>

      {!providerReady && needsUrl && (
        <p className="text-[13px] text-amber-300 bg-amber-500/[0.06] border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
          Provider setup needed. You can still paste text manually.
        </p>
      )}

      <div className="space-y-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded-lg bg-background/60 border border-border/70 px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {SOURCE_TYPES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {needsUrl ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg bg-background/60 border border-border/70 px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={type === "founder_thought" ? "Your rough idea, POV, or reaction…" : "Paste the update…"}
            className="w-full rounded-lg bg-background/60 border border-border/70 px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Btn primary onClick={() => run("Scribe, generate a post brief")}>Generate post brief</Btn>
        <Btn onClick={() => run("Scribe, draft a LinkedIn post")}>Draft LinkedIn post</Btn>
        <Btn onClick={() => run("Penn, draft a comment")}>Draft comment</Btn>
        <Btn onClick={() => run("Save as content idea")}>Save as idea</Btn>
      </div>
    </section>
  );
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  const cls = primary
    ? "bg-primary text-primary-foreground hover:opacity-90"
    : "border border-border/70 bg-background/50 text-foreground/90 hover:border-primary/40";
  return (
    <button onClick={onClick} className={`text-[14px] font-semibold px-3 py-1.5 rounded-lg transition ${cls}`}>{children}</button>
  );
}

import { useState } from "react";
import { Sparkles, Send, Info } from "lucide-react";
import ProviderBadge, { classifyProviderState } from "@/components/signals/ProviderBadge";
import { useIntegrationReadiness } from "@/hooks/useIntegrationReadiness";
import { sendAgentCommand } from "@/lib/agentCommand";

const CHIPS = [
  "Turn latest signals into a post",
  "Write about this week's product update",
  "Create a founder POV post",
  "Find posts to comment on",
  "Build 7-day content loop",
  "Repurpose saved signals",
  "Draft launch post",
  "Turn competitor signal into POV",
];

const dispatchChat = (text: string) =>
  void sendAgentCommand(text, { success: "Sent to Pilot", action_source: "content_action" });

export default function ContentPromptBox() {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const { providers } = useIntegrationReadiness();

  const firecrawl = providers.firecrawl;
  const apify = providers.apify;
  const firecrawlState = classifyProviderState({
    ready: firecrawl?.status === "connected",
    reason: firecrawl?.reason,
    integrationStatus: firecrawl?.status,
  });
  const apifyState = classifyProviderState({
    ready: apify?.status === "connected",
    reason: apify?.reason,
    integrationStatus: apify?.status,
  });

  const preview = (text: string) => setPending(text);
  const confirm = () => {
    if (pending) {
      dispatchChat(`Scribe, ${pending}. Draft only — do not publish.`);
      setPending(null);
      setValue("");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card/60 backdrop-blur p-5 md:p-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-[18px] md:text-[20px] font-semibold text-foreground">
          What should Scribe write today?
        </h2>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Turn signals, product updates, founder thoughts, or market trends into content…"
        rows={3}
        className="w-full rounded-xl bg-background/60 border border-border/70 px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
      />
      <div className="flex flex-wrap gap-2 mt-3">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => preview(c)}
            className="text-[13px] px-3 py-1.5 rounded-full border border-border/70 bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Providers:</span>
          <span className="inline-flex items-center gap-1">Firecrawl <ProviderBadge state={firecrawlState} /></span>
          <span className="inline-flex items-center gap-1">Apify <ProviderBadge state={apifyState} /></span>
        </div>
        <button
          onClick={() => value.trim() && preview(value.trim())}
          disabled={!value.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[14px] font-semibold bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
        >
          <Send className="h-3.5 w-3.5" /> Prepare brief
        </button>
      </div>

      {pending && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/[0.06] p-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-foreground">Confirm before Scribe drafts</p>
              <p className="text-[13px] text-muted-foreground mt-1">"{pending}"</p>
              <ul className="text-[13px] text-muted-foreground mt-3 space-y-1">
                <li>• Estimated credits: ~2</li>
                <li>• Sources used: saved signals, company brain, product updates</li>
                <li>• Missing context: founder POV / this week's shipped features (Scribe will ask)</li>
                <li className="text-emerald-300">• Nothing will be sent, posted, or DM'd. Draft only.</li>
              </ul>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={confirm} className="px-3 py-1.5 rounded-lg text-[14px] font-semibold bg-primary text-primary-foreground hover:opacity-90">Start</button>
                <button onClick={() => setPending(null)} className="px-3 py-1.5 rounded-lg text-[14px] font-medium border border-border/70 text-foreground hover:bg-muted/40">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

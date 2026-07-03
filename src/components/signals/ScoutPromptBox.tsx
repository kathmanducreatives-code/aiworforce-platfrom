// Signal-specific prompt box + confirmation card. Nothing runs until Start.
import { useState } from "react";
import { Radar, Loader2, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import ProviderBadge, { classifyProviderState, type ProviderState } from "./ProviderBadge";

const EXAMPLES = [
  "Founders hiring assistant roles",
  "AI SDR pain posts",
  "Clay competitor conversations",
  "Claude Code workflows",
  "Founder ops hiring",
  "Lead gen complaints",
  "GTM automation trends",
];

export interface ProviderPreview {
  key: string;
  label: string;
  state: ProviderState;
  reason?: string | null;
}

export interface ScoutPromptBoxProps {
  onStart: (prompt: string) => Promise<void> | void;
  scanning: boolean;
  providers: ProviderPreview[];
  estimatedCredits: number;
}

export default function ScoutPromptBox({ onStart, scanning, providers, estimatedCredits }: ScoutPromptBoxProps) {
  const [prompt, setPrompt] = useState("");
  const [confirming, setConfirming] = useState(false);

  const readyProviders = providers.filter((p) => p.state === "ready");
  const blockedProviders = providers.filter((p) => p.state !== "ready");
  const anyReady = readyProviders.length > 0;
  const effectiveCredits = anyReady ? estimatedCredits : 0;

  const openConfirm = (text?: string) => {
    if (text) setPrompt(text);
    setConfirming(true);
  };

  const runNow = async () => {
    await onStart(prompt.trim() || "Run default radar scan");
    setConfirming(false);
    setPrompt("");
  };

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
          <Radar className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-[#F0F6FC]">Ask Scout what to watch</h2>
          <p className="text-[14px] text-neutral-400 mt-0.5">
            Describe what Scout should scan — a role, a topic, a competitor, or a workflow trend.
          </p>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Find hiring signals, founder pain, competitor conversations, or workflow trends…"
        rows={2}
        className="w-full text-[15px] leading-relaxed px-3.5 py-3 rounded-lg border border-white/[0.08] bg-[#0d1117] text-[#F0F6FC] placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/40 resize-none"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => openConfirm(ex)}
            className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] text-neutral-300 hover:bg-white/[0.05] hover:text-neutral-100 transition-colors"
          >
            <Sparkles className="h-3 w-3 text-emerald-300/70" /> {ex}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 justify-end">
        <Button onClick={() => openConfirm()} disabled={scanning} size="sm" className="text-[14px] font-semibold">
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
          Prepare scan
        </Button>
      </div>

      {confirming && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4 space-y-3">
          <div className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-300 mt-0.5" />
            <div>
              <div className="text-[14px] font-semibold text-[#F0F6FC]">Confirm scan</div>
              <div className="text-[13px] text-neutral-400">
                Nothing will be sent, DM'd, commented, or posted. Scout only reads and saves signals.
              </div>
            </div>
          </div>

          {prompt && (
            <div className="text-[13px] text-neutral-200 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              "{prompt}"
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1.5">Providers needed</div>
              <div className="flex flex-wrap gap-1.5">
                {providers.map((p) => (
                  <span key={p.key} className="inline-flex items-center gap-1.5 text-[12px] text-neutral-300">
                    {p.label} <ProviderBadge state={p.state} />
                  </span>
                ))}
                {providers.length === 0 && <span className="text-neutral-500">No providers wired.</span>}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1.5">Estimated credits</div>
              <div className="text-[24px] font-semibold text-[#F0F6FC]">{effectiveCredits}</div>
              {!anyReady && (
                <div className="text-[12px] text-neutral-500 mt-0.5">No providers ready · no credits will be used.</div>
              )}
            </div>
          </div>

          {blockedProviders.length > 0 && (
            <div className="text-[12px] text-amber-200/80">
              {blockedProviders.length} provider{blockedProviders.length > 1 ? "s" : ""} not ready:{" "}
              {blockedProviders.map((p) => p.label).join(", ")}. Scout will skip those categories.
            </div>
          )}

          <div className="flex items-center gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} className="text-[14px]">
              Cancel
            </Button>
            <Button size="sm" onClick={() => void runNow()} disabled={scanning} className="text-[14px] font-semibold">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
              Start scan
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

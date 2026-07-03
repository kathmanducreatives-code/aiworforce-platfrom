// Manual source analyzer. Honest about provider availability: no fake output.
import { useState } from "react";
import { Link2, Loader2, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { ProviderState } from "./ProviderBadge";
import ProviderBadge from "./ProviderBadge";

const SOURCE_TYPES = [
  { key: "website", label: "Company website" },
  { key: "jobs",    label: "Job / careers page" },
  { key: "linkedin", label: "LinkedIn post" },
  { key: "competitor", label: "Competitor page" },
  { key: "text",    label: "Plain text" },
] as const;

type SourceType = typeof SOURCE_TYPES[number]["key"];

export interface ManualSourceInputProps {
  firecrawlState: ProviderState;
}

export default function ManualSourceInput({ firecrawlState }: ManualSourceInputProps) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState<SourceType>("website");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const needsFirecrawl = type !== "text";
  const disabled = needsFirecrawl && firecrawlState !== "ready";

  const analyze = async () => {
    if (disabled) return;
    if (needsFirecrawl && !url.trim()) { toast.error("Paste a URL to analyze"); return; }
    if (!needsFirecrawl && !text.trim()) { toast.error("Paste some text to analyze"); return; }
    setLoading(true);
    setResult(null);
    try {
      if (needsFirecrawl) {
        const { data, error } = await supabase.functions.invoke("firecrawl-scrape", {
          body: { url: url.trim(), formats: ["markdown", "summary"] },
        });
        if (error) throw error;
        const summary = (data as any)?.summary ?? (data as any)?.data?.summary ?? (data as any)?.markdown?.slice?.(0, 600) ?? null;
        setResult(summary ?? "No content returned. This page may block scraping.");
      } else {
        setResult(text.trim().slice(0, 800));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-[#F0F6FC]">Analyze a source manually</h2>
          <p className="text-[14px] text-neutral-400 mt-0.5 max-w-2xl">
            Paste a company website, job page, LinkedIn post URL, competitor page, or text snippet.
            Scout will analyze it and save it as a signal only if source proof exists.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-neutral-400">
          Firecrawl <ProviderBadge state={firecrawlState} />
        </div>
      </div>

      {disabled && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 flex items-start gap-2 text-[13px] text-amber-100">
          <ShieldAlert className="h-4 w-4 text-amber-300 mt-0.5" />
          <div>
            <div className="font-medium">Firecrawl isn't configured yet</div>
            <div className="text-amber-200/70 text-[12px] mt-0.5">
              You can still paste plain text to analyze. To scan URLs, open Settings → Integrations.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#0d1117] px-3">
          <Link2 className="h-4 w-4 text-neutral-500" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/careers/executive-assistant"
            disabled={!needsFirecrawl}
            className="flex-1 h-11 bg-transparent text-[14px] text-[#F0F6FC] placeholder:text-neutral-500 focus:outline-none disabled:opacity-40"
          />
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as SourceType)}
          className="h-11 px-3 rounded-lg border border-white/[0.08] bg-[#0d1117] text-[14px] text-[#F0F6FC]"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {!needsFirecrawl && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Paste text here (e.g. a LinkedIn post you copied)…"
          className="w-full text-[14px] leading-relaxed px-3.5 py-3 rounded-lg border border-white/[0.08] bg-[#0d1117] text-[#F0F6FC] placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/40 resize-none"
        />
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => void analyze()} disabled={loading || disabled} size="sm" className="text-[14px] font-semibold">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
          Analyze source
        </Button>
        <span className="text-[12px] text-neutral-500">
          Analysis is preview-only. Nothing is saved as a signal without source proof.
        </span>
      </div>

      {result && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[13px] text-neutral-200 whitespace-pre-wrap max-h-64 overflow-auto">
          {result}
        </div>
      )}
    </section>
  );
}

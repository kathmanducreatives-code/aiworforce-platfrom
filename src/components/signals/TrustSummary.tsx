// Reusable "last scan summary" block. Reads live counts + last radar run.
import { ShieldCheck, Info, AlertTriangle } from "lucide-react";
import type { RadarRunResult } from "@/hooks/useSignalFeed";

export interface TrustSummaryProps {
  totalRaw: number;
  verified: number;
  needsVerification: number;
  lastRun?: RadarRunResult | null;
}

export default function TrustSummary({ totalRaw, verified, needsVerification, lastRun }: TrustSummaryProps) {
  const anyReady = lastRun ? Object.values(lastRun.per_category).some((c) => c.status === "ready") : null;
  const inserted = lastRun?.inserted ?? 0;

  // Provider failure branch
  if (lastRun && anyReady === false) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4 flex items-start gap-3">
        <div className="p-2 rounded-lg bg-red-500/10 text-red-300"><AlertTriangle className="h-4 w-4" /></div>
        <div className="text-[14px] text-neutral-200">
          <div className="font-semibold text-[#F0F6FC]">Scout could not run this source</div>
          <div className="text-neutral-400 text-[13px] mt-0.5">
            No providers were ready. No credits were used.
          </div>
        </div>
      </div>
    );
  }

  // Post-scan success branch
  if (lastRun && inserted > 0) {
    const cats = Object.entries(lastRun.per_category);
    const found = cats.reduce((s, [, c]) => s + c.found, 0);
    const accepted = cats.reduce((s, [, c]) => s + c.accepted, 0);
    const rejected = Math.max(found - accepted, 0);
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 flex items-start gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-300"><ShieldCheck className="h-4 w-4" /></div>
        <div className="text-[14px] text-neutral-200 min-w-0">
          <div className="font-semibold text-[#F0F6FC]">Last scan summary</div>
          <div className="text-neutral-300 text-[13px] mt-0.5">
            Scout reviewed <span className="text-[#F0F6FC] font-medium">{found}</span> raw results ·{" "}
            <span className="text-emerald-300 font-medium">{accepted} accepted</span> ·{" "}
            <span className="text-neutral-400">{rejected} rejected</span>.
          </div>
          <div className="text-neutral-500 text-[12px] mt-1">
            Main reject reasons: no source proof, wrong topic, duplicate.
          </div>
        </div>
      </div>
    );
  }

  // Static (pre-scan) branch — read verified vs unverified counts
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg bg-white/[0.04] text-neutral-300"><Info className="h-4 w-4" /></div>
      <div className="text-[14px] text-neutral-200 min-w-0">
        <div className="font-semibold text-[#F0F6FC]">Last scan summary</div>
        <div className="text-neutral-300 text-[13px] mt-0.5">
          Scout reviewed <span className="text-[#F0F6FC] font-medium">{totalRaw}</span> raw signals ·{" "}
          <span className="text-emerald-300 font-medium">{verified} verified</span> ·{" "}
          <span className="text-amber-300">{needsVerification} need verification</span>.
        </div>
        {needsVerification > 0 && verified === 0 && (
          <div className="text-neutral-500 text-[12px] mt-1">
            Main issue: missing source proof or legacy unverified data.
          </div>
        )}
      </div>
    </div>
  );
}

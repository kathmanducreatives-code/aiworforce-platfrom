import { Sparkles, ArrowRight } from 'lucide-react';
import type { Recommendation } from './credits';

interface Props {
  rec: Recommendation;
  onRun: () => void;
}

export default function RecommendationBanner({ rec, onRun }: Props) {
  return (
    <div className="mx-3 mt-3 rounded-lg border border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.08] to-emerald-500/[0.02] p-2.5 flex items-center gap-3">
      <div className="h-7 w-7 rounded-md border border-emerald-500/30 bg-emerald-500/[0.10] flex items-center justify-center shrink-0">
        <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-emerald-300/80">Recommended</div>
        <div className="text-[12.5px] text-[#F0F6FC] font-medium truncate">{rec.label}</div>
        <div className="text-[11px] text-[#9aa4af] truncate">{rec.reason}</div>
      </div>
      <button
        onClick={onRun}
        className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-100 hover:bg-emerald-500/[0.20] transition-colors"
      >
        Run
        {rec.estimated_credits > 0 && (
          <span className="text-emerald-300/80 font-mono">~{rec.estimated_credits}c</span>
        )}
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

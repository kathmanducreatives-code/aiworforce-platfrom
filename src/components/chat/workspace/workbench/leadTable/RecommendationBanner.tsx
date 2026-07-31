import { Sparkles, ArrowRight } from 'lucide-react';
import { isRecommendationDispatchable, type Recommendation } from './credits';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';

interface Props {
  rec: Recommendation;
  onRun: () => void;
}

export default function RecommendationBanner({ rec, onRun }: Props) {
  const tools = useToolAvailability();
  const isApifyPeopleReady = tools.apify_people?.configured && tools.apify_people?.enabled;
  const providerMissing = rec.action === 'find_contacts' && !isApifyPeopleReady;
  // A missing PREREQUISITE is different from a missing PROVIDER: the provider can
  // be configured, but there is genuinely nothing to act on yet. Both suppress the
  // button; only the provider case is a setup problem.
  const prerequisiteMissing = !isRecommendationDispatchable(rec);
  const isBlocked = providerMissing || prerequisiteMissing;

  return (
    <div className="mx-3 mt-3 rounded-lg border border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.08] to-emerald-500/[0.02] p-2.5 flex items-center gap-3">
      <div className="h-7 w-7 rounded-md border border-emerald-500/30 bg-emerald-500/[0.10] flex items-center justify-center shrink-0">
        <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-emerald-300/80">
          {prerequisiteMissing ? 'Next step' : 'Recommended next step'}: {rec.label}
        </div>
        <div className="text-[12px] text-[#9aa4af] leading-relaxed mt-0.5">
          {rec.reason}
        </div>
      </div>
      {isBlocked ? (
        <div className="shrink-0 text-[11.5px] font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 rounded-md">
          {prerequisiteMissing ? 'Not available yet' : 'Setup needed: People/company employee provider'}
        </div>
      ) : (
        <button
          onClick={onRun}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-100 hover:bg-emerald-500/[0.20] transition-colors"
        >
          {rec.label}
          {rec.estimated_credits > 0 && (
            <span className="text-emerald-300/80 font-mono ml-1">~{rec.estimated_credits}c</span>
          )}
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}


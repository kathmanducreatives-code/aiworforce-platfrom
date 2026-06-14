import { useNavigate } from 'react-router-dom';
import { Brain, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODULES = ['ICP', 'Offer', 'Competitors', 'Brand voice', 'Goals'];

export default function CompanyBrainStrip({ visible = true }: { visible?: boolean }) {
  const navigate = useNavigate();
  if (!visible) return null;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl px-4 py-3 mb-4',
        'bg-white/[0.025] border border-white/[0.06] backdrop-blur-xl',
        'flex flex-col md:flex-row md:items-center gap-3',
      )}
    >
      <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-400/60 to-amber-500/30" />
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Brain className="h-4 w-4 text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white">Company Brain is incomplete</p>
          <p className="text-[12px] text-neutral-400 truncate">
            Teach your AI workforce your ICP, offer, competitors, brand voice, and goals.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {MODULES.map((m) => (
          <span key={m} className="inline-flex items-center h-6 px-2 rounded-md text-[11px] text-neutral-300 bg-white/[0.03] border border-white/[0.06]">
            {m}
          </span>
        ))}
      </div>
      <button
        onClick={() => navigate('/onboarding/company-brain')}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium text-black bg-gradient-to-b from-emerald-300 to-emerald-500 hover:from-emerald-200 hover:to-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.30)] shrink-0"
      >
        Continue setup
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

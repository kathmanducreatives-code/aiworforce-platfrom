import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { X, Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const oldSteps = [
  'Post job → wait 2 weeks for candidates',
  'Agency sends 3 candidates → pay $8,000 upfront',
  'Screen 300 CVs manually → 8 hours wasted',
  '2 bad hires → $60,000 lost',
  'Repeat next quarter',
];

const newSteps = [
  'Post job → AI activates immediately',
  'ICP Engine analyzes your best employees',
  '300 CVs screened automatically → 8 minutes',
  'Top 10 ranked by match score → interview ready',
  'Hire your A player. Pay zero agency fees.',
];

const statusLabels: Record<number, string> = {
  0: 'OLD WAY',
  15: 'SCANNING...',
  35: 'ANALYZING BEHAVIOR...',
  62: 'MATCHING DNA...',
  85: 'RANKING CANDIDATES...',
  100: '✓',
};

function getStatusLabel(pct: number): string {
  if (pct >= 100) return statusLabels[100];
  if (pct >= 85) return statusLabels[85];
  if (pct >= 62) return statusLabels[62];
  if (pct >= 35) return statusLabels[35];
  if (pct >= 15) return statusLabels[15];
  return statusLabels[0];
}

const OldVsNewComparison = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const oldCardRef = useRef<HTMLDivElement>(null);
  const newCardRef = useRef<HTMLDivElement>(null);
  const oldItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const newItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [progress, setProgress] = useState(0);

  const circumference = 2 * Math.PI * 140;
  const dashoffset = circumference - (progress / 100) * circumference;
  const dependency = Math.max(0, Math.round(96 - (progress / 100) * 96));
  const isComplete = progress >= 100;

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: '+=300%',
          pin: true,
          scrub: 1,
          onUpdate: (self) => {
            setProgress(Math.round(self.progress * 100));
          },
        },
      });

      // Phase 1: OLD WAY card slides in, items stagger
      tl.fromTo(oldCardRef.current, { opacity: 0, x: -80 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' }, 0);

      oldItemRefs.current.forEach((item, i) => {
        if (!item) return;
        tl.fromTo(item, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.15 }, 0.1 + i * 0.05);
      });

      // Phase 2-3: OLD WAY fades, ring animates (handled by state)
      tl.to(oldCardRef.current, { opacity: 0.15, x: -40, duration: 0.5, ease: 'power2.in' }, 0.4);

      // Phase 4: NEW WAY slides in
      tl.fromTo(newCardRef.current, { opacity: 0, x: 80 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' }, 0.6);

      newItemRefs.current.forEach((item, i) => {
        if (!item) return;
        tl.fromTo(item, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.15 }, 0.65 + i * 0.05);
      });

    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen overflow-hidden bg-zinc-50/50"
    >
      <div className="h-screen flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-8 px-4 lg:px-8">

        {/* OLD WAY Card */}
        <div ref={oldCardRef} className="flex-1 max-w-sm w-full opacity-0">
          <div className="bg-white/80 backdrop-blur-xl border border-zinc-200/60 rounded-2xl p-7 shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
            <h3 className="font-sans font-bold text-2xl text-zinc-400 mb-6 tracking-wide uppercase">
              The Old Way
            </h3>
            <div className="space-y-4">
              {oldSteps.map((step, i) => (
                <div
                  key={i}
                  ref={el => { oldItemRefs.current[i] = el; }}
                  className="flex items-start gap-3 opacity-0"
                >
                  <X className="w-5 h-5 text-zinc-400 mt-0.5 shrink-0" />
                  <p className="font-sans text-sm text-zinc-500">{step}</p>
                </div>
              ))}
            </div>
            <p className="font-mono text-xs text-zinc-400 mt-6 tracking-wide">
              COST: $247,000/year + 340 hours
            </p>
          </div>
        </div>

        {/* CENTER RING */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div className="relative w-[280px] h-[280px] md:w-[360px] md:h-[360px]">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 300 300">
              {/* Track */}
              <circle
                cx="150" cy="150" r="140" fill="none"
                stroke="rgba(0,0,0,0.06)" strokeWidth="8"
              />
              {/* Arc */}
              <circle
                cx="150" cy="150" r="140" fill="none"
                stroke="#059669"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashoffset}
                style={{
                  transition: 'stroke-dashoffset 0.15s linear',
                  filter: isComplete ? 'drop-shadow(0 0 16px rgba(5,150,105,0.4))' : 'none',
                }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-sans font-bold text-lg md:text-xl tracking-wide text-center px-6 transition-colors duration-300 ${isComplete ? 'text-emerald-600 text-4xl' : progress < 15 ? 'text-zinc-400' : 'text-emerald-600'
                }`}>
                {getStatusLabel(progress)}
              </span>
              {!isComplete && (
                <span className="font-mono text-2xl md:text-3xl mt-2 text-emerald-600 font-bold tabular-nums">
                  {progress}%
                </span>
              )}
            </div>
          </div>

          {/* Agency Dependency Badge */}
          <div className="mt-6">
            <div className={`rounded-full px-5 py-2.5 text-center transition-all duration-500 ${isComplete
                ? 'bg-emerald-600 shadow-[0_0_30px_rgba(5,150,105,0.3)]'
                : 'bg-white/80 backdrop-blur-md border border-zinc-200/60 shadow-sm'
              }`}>
              {isComplete ? (
                <p className="font-mono text-sm font-bold text-white tracking-wider">
                  AGENCY DEPENDENCY: 100% ELIMINATED
                </p>
              ) : (
                <p className="font-mono text-sm text-zinc-500 tracking-wider">
                  AGENCY DEPENDENCY:{' '}
                  <span className="text-zinc-900 font-bold tabular-nums">{dependency}%</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* NEW WAY Card */}
        <div ref={newCardRef} className="flex-1 max-w-sm w-full opacity-0">
          <div className="bg-white/80 backdrop-blur-xl border border-emerald-200/40 rounded-2xl p-7 shadow-[0_4px_24px_rgba(5,150,105,0.06)]">
            <h3 className="font-sans font-bold text-2xl text-emerald-600 mb-6 tracking-wide uppercase">
              The ScreeningPilot Way
            </h3>
            <div className="space-y-4">
              {newSteps.map((step, i) => (
                <div
                  key={i}
                  ref={el => { newItemRefs.current[i] = el; }}
                  className="flex items-start gap-3 opacity-0"
                >
                  <Check className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                  <p className="font-sans text-sm text-zinc-600">{step}</p>
                </div>
              ))}
            </div>
            <p className="font-mono text-xs text-emerald-600 mt-6 tracking-wide">
              COST: Fraction of agency fees + 8 minutes
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OldVsNewComparison;

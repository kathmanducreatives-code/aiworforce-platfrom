import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { X, Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const oldSteps = [
  'Post job → wait 2 weeks',
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

const ringLabels: Record<number, string> = {
  0: 'OLD WAY',
  25: 'SCANNING...',
  50: 'ANALYZING BEHAVIOR...',
  75: 'RANKING CANDIDATES...',
  100: 'TOP 1% IDENTIFIED ✓',
};

function getRingLabel(pct: number) {
  if (pct >= 100) return ringLabels[100];
  if (pct >= 75) return ringLabels[75];
  if (pct >= 50) return ringLabels[50];
  if (pct >= 25) return ringLabels[25];
  return ringLabels[0];
}

const OldVsNewComparison = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  const circumference = 2 * Math.PI * 90;
  const dashoffset = circumference - (progress / 100) * circumference;
  const dependency = Math.max(0, Math.round(100 - progress));

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

      // Old way fades out
      tl.to(oldRef.current, { opacity: 0, x: -60, duration: 1, ease: 'power2.in' }, 0);
      // New way fades in
      tl.fromTo(newRef.current, { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 1, ease: 'power2.out' }, 0.3);
    }, containerRef);

    return () => ctx.revert();
  }, []);

  const ringColor = progress >= 100 ? '#00e5a0' : '#00e5a0';
  const textColor = progress < 10 ? '#ef4444' : '#00e5a0';

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen overflow-hidden"
      style={{ backgroundColor: '#080808' }}
    >
      <div className="h-screen flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-4 px-4 lg:px-8">
        {/* OLD WAY */}
        <div ref={oldRef} className="flex-1 max-w-sm w-full">
          <h3 className="font-bebas text-2xl md:text-3xl text-red-500 mb-6 tracking-wide">THE OLD WAY</h3>
          <div className="space-y-4">
            {oldSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <X className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                <p className="font-syne text-sm md:text-base text-white/70">{step}</p>
              </div>
            ))}
          </div>
          <p className="font-jetbrains text-xs md:text-sm text-red-400 mt-6">
            COST: $247,000/year + 340 hours of your time
          </p>
        </div>

        {/* CENTER RING */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div className="relative w-[180px] h-[180px] md:w-[220px] md:h-[220px]">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="90" fill="none" stroke="#1e1e1e" strokeWidth="6" />
              <circle
                cx="100" cy="100" r="90" fill="none"
                stroke={ringColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashoffset}
                style={{
                  transition: 'stroke-dashoffset 0.1s linear',
                  filter: progress >= 100 ? 'drop-shadow(0 0 12px rgba(0,229,160,0.5))' : 'none',
                }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="font-bebas text-lg md:text-xl tracking-wide text-center px-4"
                style={{ color: textColor }}
              >
                {getRingLabel(progress)}
              </span>
              <span className="font-jetbrains text-xs mt-1" style={{ color: '#00e5a0' }}>
                {progress}%
              </span>
            </div>
          </div>

          {/* Agency dependency counter */}
          <div className="mt-6 text-center">
            <p className="font-jetbrains text-xs md:text-sm tracking-wider">
              {dependency === 0 ? (
                <span className="relative">
                  <span className="text-red-500 line-through">AGENCY DEPENDENCY: 100%</span>
                  <br />
                  <span style={{ color: '#00e5a0' }} className="font-bold">ELIMINATED</span>
                </span>
              ) : (
                <span className="text-white/60">
                  AGENCY DEPENDENCY: <span className="text-white font-bold">{dependency}%</span>
                </span>
              )}
            </p>
          </div>
        </div>

        {/* NEW WAY */}
        <div ref={newRef} className="flex-1 max-w-sm w-full opacity-0">
          <h3 className="font-bebas text-2xl md:text-3xl tracking-wide mb-6" style={{ color: '#00e5a0' }}>
            THE SCREENING PILOT WAY
          </h3>
          <div className="space-y-4">
            {newSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <Check className="w-5 h-5 mt-0.5 shrink-0" style={{ color: '#00e5a0' }} />
                <p className="font-syne text-sm md:text-base text-white/70">{step}</p>
              </div>
            ))}
          </div>
          <p className="font-jetbrains text-xs md:text-sm mt-6" style={{ color: '#00e5a0' }}>
            COST: Fraction of agency fees + 8 minutes of your time
          </p>
        </div>
      </div>
    </section>
  );
};

export default OldVsNewComparison;

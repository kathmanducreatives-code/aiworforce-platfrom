import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const oldWayItems = [
  'Post job → wait 3–4 weeks',
  'Agency sends 3 candidates → pay €15,000 upfront',
  'Screen manually → 45 hours per search',
  'Get 30–50 candidates. Maybe.',
  'Bad hire → €60,000 lost. Repeat next quarter.',
];
const newWayItems = [
  'Paste one profile → AI activates instantly',
  '2,000+ candidates found in 15 minutes',
  'All ranked by match score. Emails revealed.',
  'Personalized outreach sent automatically',
  'Hire your A-player. Pay zero agency fees.',
];

const OldVsNewComparison = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'old' | 'scanning' | 'complete'>('old');
  const [progress, setProgress] = useState(4);
  const [dependency, setDependency] = useState(96);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Left card entrance
      gsap.fromTo(leftRef.current, { opacity: 0, x: -60 }, {
        opacity: 1, x: 0, duration: 0.7, ease: 'expo.out',
        scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
      });
      const leftItems = leftRef.current?.querySelectorAll('.opp-item');
      if (leftItems) {
        leftItems.forEach((item, i) => {
          gsap.fromTo(item, { opacity: 0, x: -20 }, {
            opacity: 1, x: 0, duration: 0.4, delay: 0.5 + i * 0.15,
            scrollTrigger: { trigger: sectionRef.current, start: 'top 55%', toggleActions: 'play none none none' },
          });
        });
      }

      // Ring + scanning sequence
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: 'top 40%',
        onEnter: () => {
          setPhase('scanning');
          let p = 4;
          const interval = setInterval(() => {
            p += 2;
            setProgress(Math.min(p, 100));
            setDependency(Math.max(96 - p, 0));
            if (p >= 100) {
              clearInterval(interval);
              setPhase('complete');
              // Animate right card
              gsap.fromTo(rightRef.current, { opacity: 0, x: 60 }, {
                opacity: 1, x: 0, duration: 0.7, ease: 'expo.out',
              });
              const rightItems = rightRef.current?.querySelectorAll('.new-item');
              if (rightItems) {
                rightItems.forEach((item, i) => {
                  gsap.fromTo(item, { opacity: 0, x: 20 }, {
                    opacity: 1, x: 0, duration: 0.4, delay: 0.3 + i * 0.15,
                  });
                });
              }
            }
          }, 60);
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const ringDash = 2 * Math.PI * 160;
  const ringOffset = ringDash - (ringDash * progress) / 100;

  return (
    <section ref={sectionRef} className="relative px-4 py-28 md:py-36 overflow-hidden">
      <div className="text-center mb-16">
        <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ The Transformation</p>
        <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
          FROM AGENCY DEPENDENCY<br />TO TOTAL CONTROL
        </h2>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
        {/* Left — Old Way */}
        <div ref={leftRef} className="opacity-0">
          <div className={`glass rounded-2xl p-6 transition-all duration-700 ${phase === 'complete' ? 'opacity-30' : ''}`}>
            <h3 className="font-display font-bold text-lg text-white/60 mb-5 uppercase tracking-wide">The Old Way</h3>
            {oldWayItems.map((item, i) => (
              <div key={i} className="opp-item flex items-start gap-3 py-2 opacity-0">
                <span className="text-white/20 text-sm mt-0.5">✕</span>
                <span className="text-sm text-white/40">{item}</span>
              </div>
            ))}
            <p className="mt-4 font-mono text-xs text-white/20 border-t border-white/[0.06] pt-4">
              COST: €82,000/year + 340 hours
            </p>
          </div>
        </div>

        {/* Center — Ring */}
        <div ref={ringRef} className="flex flex-col items-center justify-center">
          <div className="relative w-[280px] h-[280px] md:w-[340px] md:h-[340px]">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 340 340">
              <circle cx="170" cy="170" r="160" stroke="rgba(255,255,255,0.06)" strokeWidth="8" fill="none" />
              <circle cx="170" cy="170" r="160" stroke="#059669" strokeWidth="8" fill="none"
                strokeDasharray={ringDash} strokeDashoffset={ringOffset}
                strokeLinecap="round" className="transition-all duration-100"
                style={{ filter: progress > 90 ? 'drop-shadow(0 0 12px rgba(5,150,105,0.5))' : 'none' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              {phase === 'old' && (
                <>
                  <p className="font-display font-bold text-lg text-white/50">OLD WAY</p>
                  <p className="font-mono text-sm text-white/25">{progress}%</p>
                </>
              )}
              {phase === 'scanning' && (
                <>
                  <p className="font-display font-bold text-lg text-emerald-400 animate-pulse">
                    {progress < 35 ? 'SCANNING...' : progress < 65 ? 'ANALYZING...' : 'MATCHING...'}
                  </p>
                  <p className="font-mono text-2xl text-emerald-400 tabular-nums">{progress}%</p>
                </>
              )}
              {phase === 'complete' && (
                <div className="text-emerald-400">
                  <svg className="w-16 h-16 mx-auto animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </div>
          <div className={`mt-4 px-4 py-2 rounded-full text-xs font-mono font-semibold transition-all duration-300 ${phase === 'complete' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-[0_0_20px_rgba(5,150,105,0.2)]' : 'bg-white/[0.04] text-white/30 border border-white/[0.06]'
            }`}>
            AGENCY DEPENDENCY: {phase === 'complete' ? '100% ELIMINATED' : `${dependency}%`}
          </div>
        </div>

        {/* Right — New Way */}
        <div ref={rightRef} className="opacity-0">
          <div className="glass-strong rounded-2xl p-6 border-l-4 border-l-emerald-500">
            <h3 className="font-display font-bold text-lg text-emerald-400 mb-5 uppercase tracking-wide">The ScreeningPilot Way</h3>
            {newWayItems.map((item, i) => (
              <div key={i} className="new-item flex items-start gap-3 py-2 opacity-0">
                <span className="text-emerald-400 text-sm mt-0.5">✓</span>
                <span className="text-sm text-white/60">{item}</span>
              </div>
            ))}
            <p className="mt-4 font-mono text-xs text-emerald-400/60 border-t border-white/[0.06] pt-4">
              COST: €149/month · Unlimited hires
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OldVsNewComparison;

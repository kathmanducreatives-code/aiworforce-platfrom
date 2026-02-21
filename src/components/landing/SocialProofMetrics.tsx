import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const metrics = [
  { end: 90, display: (v: number) => `${v}%`, label: 'Reduction in time-to-hire', sublabel: 'From weeks to days' },
  { end: 247, display: (v: number) => `$${v}K`, label: 'Average annual savings vs agencies', sublabel: 'Per 10 hires at senior level' },
  { end: 8, display: (v: number) => `${v} MIN`, label: 'To screen 300 candidates', sublabel: 'vs 6-8 hours manual screening' },
  { end: 3, display: (v: number) => `${v}X`, label: 'Better quality shortlists', sublabel: 'Matched to your top performer DNA' },
];

const ticker = 'AGENCY FEES ELIMINATED ◈ SCREENING TIME REDUCED 94% ◈ BUILT FOR SAAS FOUNDERS ◈ ICP LOOKALIKE ENGINE ◈ 300 CVS IN 8 MINUTES ◈ ';

const SocialProofMetrics = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [counters, setCounters] = useState(metrics.map(() => 0));

  useEffect(() => {
    const ctx = gsap.context(() => {
      metrics.forEach((m, i) => {
        gsap.to({ val: 0 }, {
          val: m.end,
          duration: 1.8,
          ease: 'power2.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 80%', toggleActions: 'play none none none' },
          onUpdate: function () {
            setCounters(prev => {
              const next = [...prev];
              next[i] = Math.round(this.targets()[0].val);
              return next;
            });
          },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-24 md:py-32 px-4 overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(0,229,160,0.06) 0%, #080808 70%)',
      }}
    >
      <div className="max-w-6xl mx-auto">
        <p className="font-jetbrains text-xs md:text-sm uppercase tracking-[0.25em] mb-4" style={{ color: '#00e5a0' }}>
          ◈ The Numbers
        </p>
        <h2 className="font-bebas text-[36px] md:text-[56px] lg:text-[80px] leading-[0.95] text-white mb-16">
          WHAT HAPPENS WHEN YOU<br />FIRE YOUR RECRUITING AGENCY
        </h2>

        {/* 2x2 Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-20">
          {metrics.map((m, i) => (
            <div
              key={i}
              className="rounded-xl p-8 text-center"
              style={{ backgroundColor: '#0f0f0f', border: '1px solid #1e1e1e' }}
            >
              <div className="font-bebas text-[48px] md:text-[72px] leading-none mb-2" style={{ color: '#00e5a0' }}>
                {m.display(counters[i])}
              </div>
              <p className="font-syne text-base text-white/80 mb-1">{m.label}</p>
              <p className="font-syne text-sm text-white/40">{m.sublabel}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ticker */}
      <div className="w-full overflow-hidden py-4" style={{ borderTop: '1px solid #1e1e1e', borderBottom: '1px solid #1e1e1e' }}>
        <div className="ticker-track font-jetbrains text-sm tracking-[0.15em] whitespace-nowrap" style={{ color: '#00e5a0' }}>
          <span>{ticker.repeat(4)}</span>
          <span>{ticker.repeat(4)}</span>
        </div>
      </div>
    </section>
  );
};

export default SocialProofMetrics;

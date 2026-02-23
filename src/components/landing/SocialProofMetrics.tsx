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
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
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

      // Stagger card scale-in
      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, scale: 0.9 }, {
          opacity: 1, scale: 1, duration: 0.6, delay: i * 0.1,
          ease: 'back.out(1.2)',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', toggleActions: 'play none none none' },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex flex-col justify-center px-4 py-24 md:py-32 overflow-hidden"
    >
      {/* Animated mesh background */}
      <div className="absolute inset-0 landing-mesh-bg" />

      <div className="max-w-6xl mx-auto relative z-10">
        <p className="font-mono text-xs md:text-sm uppercase tracking-[0.25em] mb-4 text-primary">
          ◈ The Numbers
        </p>
        <h2 className="font-sans font-bold text-[36px] md:text-[56px] lg:text-[80px] leading-[0.95] text-foreground mb-16">
          WHAT HAPPENS WHEN YOU<br />FIRE YOUR RECRUITING AGENCY
        </h2>

        {/* 2x2 Grid - Glass cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-20">
          {metrics.map((m, i) => (
            <div
              key={i}
              ref={el => { cardRefs.current[i] = el; }}
              className="glass-card-landing rounded-2xl p-8 text-center opacity-0"
            >
              <div
                className="font-mono font-bold text-[48px] md:text-[72px] leading-none mb-2 text-primary"
                style={{ textShadow: '0 0 30px hsl(var(--primary) / 0.3)' }}
              >
                {m.display(counters[i])}
              </div>
              <p className="font-sans text-base text-foreground/80 mb-1">{m.label}</p>
              <p className="font-sans text-sm text-muted-foreground">{m.sublabel}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ticker - Glass track */}
      <div className="w-full overflow-hidden py-4 bg-card/30 backdrop-blur-sm border-y border-border/30">
        <div className="ticker-track font-mono text-sm tracking-[0.15em] whitespace-nowrap text-primary">
          <span>{ticker.repeat(4)}</span>
          <span>{ticker.repeat(4)}</span>
        </div>
      </div>
    </section>
  );
};

export default SocialProofMetrics;

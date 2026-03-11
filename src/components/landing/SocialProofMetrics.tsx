import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const metrics = [
  { end: 90, display: (v: number) => `${v}%`, label: 'Reduction in time-to-hire', sublabel: 'From weeks to days' },
  { end: 247, display: (v: number) => `$${v}K`, label: 'Average annual savings', sublabel: 'Per 10 hires at senior level', emphasis: true },
  { end: 8, display: (v: number) => `${v} MIN`, label: 'To screen 300 candidates', sublabel: 'vs 6-8 hours manual screening' },
  { end: 3, display: (v: number) => `${v}X`, label: 'Better quality shortlists', sublabel: 'Matched to your top performer DNA' },
];

const SocialProofMetrics = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [counters, setCounters] = useState(metrics.map(() => 0));

  useEffect(() => {
    const ctx = gsap.context(() => {
      metrics.forEach((m, i) => {
        gsap.to({ val: 0 }, {
          val: m.end,
          duration: 2,
          ease: 'power2.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
          onUpdate: function () {
            setCounters(prev => {
              const next = [...prev];
              next[i] = Math.round(this.targets()[0].val);
              return next;
            });
          },
        });
      });

      const delays = [0, 0.15, 0.30, 0.45];
      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, y: 30 }, {
          opacity: 1, y: 0, duration: 0.7, delay: delays[i],
          ease: 'power3.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative bg-background px-4 py-28 md:py-36">
      <div className="max-w-5xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-primary font-semibold">
          ◆ The Numbers
        </p>
        <h2 className="font-sans font-extrabold text-[clamp(1.8rem,4.5vw,3.5rem)] leading-[1.05] tracking-[-0.03em] text-foreground mb-16">
          WHAT HAPPENS WHEN YOU<br />FIRE YOUR RECRUITING AGENCY
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {metrics.map((m, i) => (
            <div
              key={i}
              ref={el => { cardRefs.current[i] = el; }}
              className={`rounded-2xl p-8 text-center opacity-0 border transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(16,185,129,0.08)] ${m.emphasis
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-card border-border'
                }`}
            >
              <div className="font-mono font-bold text-5xl md:text-7xl leading-none mb-3 text-primary tabular-nums tracking-tighter">
                {m.display(counters[i])}
              </div>
              <p className="font-sans font-medium text-base text-foreground mb-1">{m.label}</p>
              <p className="font-sans text-sm text-muted-foreground">{m.sublabel}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SocialProofMetrics;
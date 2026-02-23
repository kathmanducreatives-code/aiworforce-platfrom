import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Brain, Crosshair, Zap } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const cards = [
  {
    icon: Brain,
    title: 'Behavioral DNA Mapping',
    body: 'Upload your top 5 performers. The engine extracts 47 behavioral and skill markers that made them exceptional. Patterns invisible to humans. Obvious to AI.',
  },
  {
    icon: Crosshair,
    title: 'Blind Scoring Engine',
    body: 'Every applicant is scored against your ICP profile automatically. Names, photos, and demographic data are hidden during scoring. Only merit reaches the shortlist.',
  },
  {
    icon: Zap,
    title: '8 Minute Shortlist',
    body: '300 applicants enter. The engine reads, scores, and ranks every single one in under 8 minutes. You receive the top 10 with match scores, behavioral notes, and interview question suggestions.',
  },
];

const stats = [
  { end: 8, suffix: ' MIN', label: 'Average time to shortlist 300 candidates' },
  { end: 94, suffix: '%', label: 'Reduction in screening time vs manual' },
  { end: 0, prefix: '$', suffix: '', label: 'Agency fees paid by Screening Pilot customers' },
];

const BehavioralEngine = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [counters, setCounters] = useState(stats.map(() => 0));

  useEffect(() => {
    const ctx = gsap.context(() => {
      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, y: 50, rotateX: 5 }, {
          opacity: 1, y: 0, rotateX: 0, duration: 0.7, delay: i * 0.15,
          ease: 'power3.out',
          scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none none' },
        });
      });

      stats.forEach((stat, i) => {
        gsap.to({ val: 0 }, {
          val: stat.end,
          duration: 1.5,
          ease: 'power2.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 50%', toggleActions: 'play none none none' },
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
    <section ref={sectionRef} className="relative min-h-screen flex flex-col justify-center px-4 py-24 md:py-32">
      {/* Floating decorative dots */}
      <div className="absolute w-3 h-3 rounded-full bg-primary/20 top-[15%] right-[10%]" style={{ animation: 'float-slow 7s ease-in-out infinite' }} />
      <div className="absolute w-2 h-2 rounded-full bg-primary/15 top-[30%] left-[5%]" style={{ animation: 'float-gentle 9s ease-in-out infinite 2s' }} />
      <div className="absolute w-4 h-4 rounded-full bg-primary/10 bottom-[20%] right-[20%]" style={{ animation: 'float-slow 11s ease-in-out infinite 4s' }} />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Label */}
        <p className="font-mono text-xs md:text-sm uppercase tracking-[0.25em] mb-4 text-primary">
          ◈ The Core Technology
        </p>

        {/* Headline */}
        <h2 className="font-sans font-bold text-[36px] md:text-[64px] lg:text-[100px] leading-[0.95] text-foreground mb-6">
          WE DON'T SCREEN RESUMES.<br />WE DECODE PEOPLE.
        </h2>

        {/* Subheadline */}
        <p className="font-sans text-base md:text-xl text-muted-foreground max-w-3xl mb-16 leading-relaxed">
          The ICP Lookalike Engine analyzes the behavioral DNA of your best existing employees —
          how they think, how they work, how they solve problems under pressure. Then it finds more of them.
        </p>

        {/* Cards - Glassmorphism */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {cards.map((card, i) => (
            <div
              key={i}
              ref={el => { cardRefs.current[i] = el; }}
              className="glass-card-landing rounded-2xl p-8 opacity-0 border-t-2 border-t-primary/40 relative overflow-hidden group"
              style={{ perspective: '1000px' }}
            >
              {/* Shine sweep on hover */}
              <div className="glass-shine-sweep absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent pointer-events-none opacity-0" />

              <div className="w-14 h-14 rounded-xl bg-primary/10 backdrop-blur-sm border border-primary/20 flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110">
                <card.icon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="font-sans font-bold text-2xl text-foreground mb-3 tracking-wide">{card.title}</h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>

        {/* Stat bar - Glass pills */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 py-10">
          {stats.map((stat, i) => (
            <div key={i} className="text-center">
              <div className="glass-panel rounded-2xl p-6 inline-block mx-auto">
                <div
                  className="font-mono font-bold text-[40px] md:text-[72px] leading-none text-primary"
                  style={{ textShadow: '0 0 30px hsl(var(--primary) / 0.3)' }}
                >
                  {stat.prefix || ''}{counters[i]}{stat.suffix}
                </div>
              </div>
              <p className="font-sans text-xs md:text-sm text-muted-foreground mt-3">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BehavioralEngine;

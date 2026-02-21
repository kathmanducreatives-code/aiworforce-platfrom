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
      // Card reveals
      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, y: 40 }, {
          opacity: 1, y: 0, duration: 0.6, delay: i * 0.15,
          scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none none' },
        });
      });

      // Stat counters
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
    <section ref={sectionRef} className="relative py-24 md:py-32 px-4" style={{ backgroundColor: '#080808' }}>
      <div className="max-w-6xl mx-auto">
        {/* Label */}
        <p className="font-jetbrains text-xs md:text-sm uppercase tracking-[0.25em] mb-4" style={{ color: '#00e5a0' }}>
          ◈ The Core Technology
        </p>

        {/* Headline */}
        <h2 className="font-bebas text-[36px] md:text-[64px] lg:text-[100px] leading-[0.95] text-white mb-6">
          WE DON'T SCREEN RESUMES.<br />WE DECODE PEOPLE.
        </h2>

        {/* Subheadline */}
        <p className="font-syne text-base md:text-xl text-white/80 max-w-3xl mb-16 leading-relaxed">
          The ICP Lookalike Engine analyzes the behavioral DNA of your best existing employees —
          how they think, how they work, how they solve problems under pressure. Then it finds more of them.
        </p>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {cards.map((card, i) => (
            <div
              key={i}
              ref={el => { cardRefs.current[i] = el; }}
              className="rounded-xl p-8 opacity-0"
              style={{
                backgroundColor: '#0f0f0f',
                border: '1px solid #1e1e1e',
                borderTop: '3px solid #00e5a0',
              }}
            >
              <card.icon className="w-8 h-8 mb-4" style={{ color: '#00e5a0' }} />
              <h3 className="font-bebas text-2xl text-white mb-3 tracking-wide">{card.title}</h3>
              <p className="font-syne text-sm text-white/60 leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>

        {/* Stat bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 py-10 border-t border-b" style={{ borderColor: '#1e1e1e' }}>
          {stats.map((stat, i) => (
            <div key={i} className="text-center">
              <div className="font-bebas text-[40px] md:text-[72px] leading-none" style={{ color: '#00e5a0' }}>
                {stat.prefix || ''}{counters[i]}{stat.suffix}
              </div>
              <p className="font-syne text-xs md:text-sm text-white/40 mt-2">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BehavioralEngine;

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
    body: '300 applicants enter. The engine reads, scores, and ranks every single one in under 8 minutes. You receive the top 10 with match scores and interview question suggestions.',
  },
];

const BehavioralEngine = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Headline line-by-line entrance
      headlineRefs.current.forEach((line, i) => {
        if (!line) return;
        gsap.fromTo(line, { opacity: 0, y: 40 }, {
          opacity: 1, y: 0, duration: 0.8, delay: i * 0.2,
          ease: 'power3.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 75%', toggleActions: 'play none none none' },
        });
      });

      // Card staggered entrance
      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, y: 30 }, {
          opacity: 1, y: 0, duration: 0.7, delay: i * 0.12,
          ease: 'power3.out',
          scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none none' },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative bg-white px-4 py-28 md:py-36">
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Label */}
        <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-emerald-600 font-semibold">
          ◆ The Core Technology
        </p>

        {/* Headline - two lines */}
        <div className="mb-8">
          <div
            ref={el => { headlineRefs.current[0] = el; }}
            className="opacity-0"
          >
            <h2 className="font-sans font-extrabold text-[clamp(2rem,5vw,4.5rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950">
              WE DON'T SCREEN RESUMES.
            </h2>
          </div>
          <div
            ref={el => { headlineRefs.current[1] = el; }}
            className="opacity-0"
          >
            <h2 className="font-sans font-extrabold text-[clamp(2rem,5vw,4.5rem)] leading-[1.05] tracking-[-0.03em] text-emerald-600">
              WE DECODE PEOPLE.
            </h2>
          </div>
        </div>

        {/* Description */}
        <p className="font-sans text-lg md:text-xl text-zinc-500 max-w-3xl mb-16 leading-relaxed">
          The ICP Lookalike Engine analyzes the behavioral DNA of your best existing employees —
          how they think, how they work, how they solve problems under pressure. Then it finds more of them.
        </p>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map((card, i) => (
            <div
              key={i}
              ref={el => { cardRefs.current[i] = el; }}
              className="group bg-white border border-zinc-200/60 rounded-2xl p-8 opacity-0 relative overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] hover:border-emerald-200/60"
            >
              {/* Green top border on hover */}
              <div className="absolute top-0 left-0 w-full h-[3px] bg-emerald-500 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />

              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-6 transition-transform duration-300 group-hover:scale-110">
                <card.icon className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="font-sans font-bold text-xl text-zinc-900 mb-3">{card.title}</h3>
              <p className="font-sans text-sm text-zinc-500 leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BehavioralEngine;

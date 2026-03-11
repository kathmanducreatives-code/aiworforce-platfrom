import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Brain, Scan, Shield } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const cards = [
  { icon: Brain, title: 'Behavioral DNA Analysis', body: 'We map how your top performers think — decision-making speed, stress responses, collaboration style — creating a behavioral blueprint unique to your company.' },
  { icon: Scan, title: 'Pattern Recognition', body: 'The engine cross-references 47+ behavioral markers against your existing team, identifying candidates who think and work like your best people.' },
  { icon: Shield, title: 'Risk Assessment', body: 'Real-time red flag detection and consistency scoring eliminate bad hires before they happen. No more gut feelings — just data.' },
];

const BehavioralEngine = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      headlineRefs.current.forEach((el, i) => {
        if (!el) return;
        gsap.fromTo(el, { opacity: 0, x: -40 }, {
          opacity: 1, x: 0, duration: 0.8, delay: i * 0.2,
          ease: 'power3.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 70%', toggleActions: 'play none none none' },
        });
      });

      cardRefs.current.forEach((card, i) => {
        if (!card) return;
        gsap.fromTo(card, { opacity: 0, y: 40 }, {
          opacity: 1, y: 0, duration: 0.7, delay: 0.4 + i * 0.15,
          ease: 'power3.out',
          scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative bg-background px-4 py-28 md:py-36">
      <div className="max-w-6xl mx-auto relative z-10">
        {/* Label */}
        <p className="font-mono text-xs uppercase tracking-[0.25em] mb-5 text-primary font-semibold">
          ◆ The Core Technology
        </p>

        {/* Headline - two lines */}
        <div className="mb-8">
          <div
            ref={el => { headlineRefs.current[0] = el; }}
            className="opacity-0"
          >
            <h2 className="font-sans font-extrabold text-[clamp(2rem,5vw,4.5rem)] leading-[1.05] tracking-[-0.03em] text-foreground">
              WE DON'T SCREEN RESUMES.
            </h2>
          </div>
          <div
            ref={el => { headlineRefs.current[1] = el; }}
            className="opacity-0"
          >
            <h2 className="font-sans font-extrabold text-[clamp(2rem,5vw,4.5rem)] leading-[1.05] tracking-[-0.03em] text-primary">
              WE DECODE PEOPLE.
            </h2>
          </div>
        </div>

        {/* Description */}
        <p className="font-sans text-lg md:text-xl text-muted-foreground max-w-3xl mb-16 leading-relaxed">
          The ICP Lookalike Engine analyzes the behavioral DNA of your best existing employees —
          how they think, how they work, how they solve problems under pressure. Then it finds more of them.
        </p>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map((card, i) => (
            <div
              key={i}
              ref={el => { cardRefs.current[i] = el; }}
              className="group bg-card border border-border rounded-2xl p-8 opacity-0 relative overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_12px_40px_rgba(16,185,129,0.08)] hover:border-primary/30"
            >
              {/* Green top border on hover */}
              <div className="absolute top-0 left-0 w-full h-[3px] bg-primary origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />

              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 transition-transform duration-300 group-hover:scale-110">
                <card.icon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="font-sans font-bold text-xl text-foreground mb-3">{card.title}</h3>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BehavioralEngine;
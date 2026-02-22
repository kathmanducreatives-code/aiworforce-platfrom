import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import NoiseOverlay from './NoiseOverlay';
import { ChevronDown } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const HeroHook = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [counterVal, setCounterVal] = useState(0);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const chars = headlineRef.current?.querySelectorAll('.char');
      if (chars) {
        gsap.fromTo(chars, { opacity: 0 }, {
          opacity: 1,
          stagger: 0.03,
          duration: 0.05,
          ease: 'none',
          delay: 0.3,
        });
      }

      gsap.fromTo(bodyRef.current, { opacity: 0, y: 20 }, {
        opacity: 1, y: 0, duration: 0.8, delay: 1.5, ease: 'power2.out',
      });

      gsap.to({ val: 0 }, {
        val: 247000,
        duration: 2,
        delay: 2,
        ease: 'power2.out',
        onUpdate: function () {
          setCounterVal(Math.floor(this.targets()[0].val));
        },
      });

      gsap.fromTo(arrowRef.current, { opacity: 0, y: -10 }, {
        opacity: 1, y: 0, duration: 0.6, delay: 3, ease: 'power2.out',
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  const headlineText = "RECRUITING AGENCIES\nARE STEALING FROM YOU";
  const chars = headlineText.split('');

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-background"
    >
      <NoiseOverlay />

      <div className="relative z-20 text-center px-4 max-w-5xl mx-auto">
        {/* Headline */}
        <h1
          ref={headlineRef}
          className="font-sans font-bold text-[48px] md:text-[80px] lg:text-[120px] leading-[0.95] tracking-tight text-foreground mb-8"
          style={{ whiteSpace: 'pre-line' }}
        >
          {chars.map((char, i) => (
            <span key={i} className="char inline-block opacity-0">
              {char === '\n' ? <br /> : char === ' ' ? '\u00A0' : char}
            </span>
          ))}
        </h1>

        {/* Body copy */}
        <div ref={bodyRef} className="opacity-0 mb-12">
          <p className="font-sans text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Every hire through an agency costs you 20% of that person's annual salary.
            <br />For a $120,000 engineer — that is <strong className="text-foreground">$24,000 gone forever.</strong>
            <br />Per hire. Every time. No exceptions.
          </p>
        </div>

        {/* Counter */}
        <div ref={counterRef} className="mb-16">
          <p className="font-mono text-xs md:text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Average Agency Fees Paid by SaaS Startups Per Year
          </p>
          <div className="font-sans font-bold text-[48px] md:text-[80px] leading-none text-primary" style={{ textShadow: 'var(--shadow-glow)' }}>
            ${counterVal.toLocaleString()}
          </div>
        </div>

        {/* Scroll arrow */}
        <div ref={arrowRef} className="opacity-0 flex flex-col items-center gap-2">
          <p className="font-sans text-sm text-primary">
            Scroll to see a better way
          </p>
          <ChevronDown className="w-6 h-6 animate-bounce text-primary" />
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

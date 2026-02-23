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
        gsap.fromTo(chars, { opacity: 0, y: 20 }, {
          opacity: 1, y: 0,
          stagger: 0.03,
          duration: 0.08,
          ease: 'power2.out',
          delay: 0.3,
        });
      }

      gsap.fromTo(bodyRef.current, { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.8, delay: 1.5, ease: 'power2.out',
      });

      gsap.fromTo(counterRef.current, { opacity: 0, scale: 0.9 }, {
        opacity: 1, scale: 1, duration: 0.6, delay: 1.8, ease: 'back.out(1.4)',
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

      // Parallax on scroll
      gsap.to(headlineRef.current, {
        y: -50,
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  const headlineText = "RECRUITING AGENCIES\nARE STEALING FROM YOU";
  const chars = headlineText.split('');

  return (
    <section
      ref={sectionRef}
      className="relative h-screen flex flex-col items-center justify-center overflow-hidden"
    >
      <NoiseOverlay />

      {/* Animated mesh background */}
      <div className="absolute inset-0 landing-mesh-bg" />

      {/* Decorative floating glass circles */}
      <div
        className="absolute w-20 h-20 rounded-full border border-primary/10 bg-primary/5 backdrop-blur-sm top-[15%] left-[10%]"
        style={{ animation: 'float-slow 8s ease-in-out infinite' }}
      />
      <div
        className="absolute w-12 h-12 rounded-full border border-primary/15 bg-primary/5 backdrop-blur-sm top-[25%] right-[15%]"
        style={{ animation: 'float-gentle 10s ease-in-out infinite 1s' }}
      />
      <div
        className="absolute w-16 h-16 rounded-full border border-primary/10 bg-primary/5 backdrop-blur-sm bottom-[20%] left-[20%]"
        style={{ animation: 'float-gentle 12s ease-in-out infinite 3s' }}
      />

      <div className="relative z-20 text-center px-4 max-w-5xl mx-auto">
        {/* Headline */}
        <h1
          ref={headlineRef}
          className="font-sans font-bold text-[48px] md:text-[80px] lg:text-[120px] leading-[0.95] tracking-tight text-foreground mb-8"
          style={{ whiteSpace: 'pre-line' }}
        >
          {chars.map((char, i) => {
            // Highlight "STEALING" word
            const stealingStart = headlineText.indexOf('STEALING');
            const inStealing = i >= stealingStart && i < stealingStart + 8;
            return (
              <span
                key={i}
                className={`char inline-block opacity-0 ${inStealing ? 'bg-gradient-to-r from-destructive to-destructive/70 bg-clip-text text-transparent' : ''}`}
              >
                {char === '\n' ? <br /> : char === ' ' ? '\u00A0' : char}
              </span>
            );
          })}
        </h1>

        {/* Body copy */}
        <div ref={bodyRef} className="opacity-0 mb-12">
          <p className="font-sans text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Every hire through an agency costs you 20% of that person's annual salary.
            <br />For a $120,000 engineer — that is <strong className="text-foreground">$24,000 gone forever.</strong>
            <br />Per hire. Every time. No exceptions.
          </p>
        </div>

        {/* Counter - Glass container */}
        <div ref={counterRef} className="mb-16 opacity-0">
          <div className="glass-panel rounded-2xl p-8 max-w-lg mx-auto shadow-xl">
            <p className="font-mono text-xs md:text-sm uppercase tracking-[0.2em] text-muted-foreground mb-3">
              Average Agency Fees Paid by SaaS Startups Per Year
            </p>
            <div
              className="font-sans font-bold text-[48px] md:text-[80px] leading-none text-primary"
              style={{ textShadow: '0 0 40px hsl(var(--primary) / 0.3)' }}
            >
              ${counterVal.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Scroll arrow - Glass pill */}
        <div ref={arrowRef} className="opacity-0 flex flex-col items-center gap-2">
          <div className="glass-panel rounded-full px-6 py-3 flex items-center gap-2">
            <p className="font-sans text-sm text-primary">
              Scroll to see a better way
            </p>
            <ChevronDown className="w-5 h-5 animate-bounce text-primary" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

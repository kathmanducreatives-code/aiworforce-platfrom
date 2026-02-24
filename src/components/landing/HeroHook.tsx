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
  const [hasCounted, setHasCounted] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const words = headlineRef.current?.querySelectorAll('.word');
      if (words) {
        gsap.fromTo(words, {
          opacity: 0,
          y: 40,
        }, {
          opacity: 1,
          y: 0,
          stagger: 0.15,
          duration: 0.8,
          ease: 'power3.out',
          delay: 0.2,
        });
      }

      gsap.fromTo(bodyRef.current, { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.8, delay: 0.8, ease: 'power2.out',
      });

      gsap.fromTo(counterRef.current, { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.8, delay: 1.0, ease: 'power2.out',
        scrollTrigger: {
          trigger: counterRef.current,
          start: "top bottom-=100",
          onEnter: () => setHasCounted(true)
        }
      });

      gsap.fromTo(arrowRef.current, { opacity: 0, y: -10 }, {
        opacity: 1, y: 0, duration: 0.6, delay: 1.5, ease: 'power2.out',
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

  useEffect(() => {
    if (hasCounted) {
      gsap.to({ val: 0 }, {
        val: 247000,
        duration: 2.5,
        ease: 'power3.out',
        onUpdate: function () {
          setCounterVal(Math.floor(this.targets()[0].val));
        },
      });
    }
  }, [hasCounted]);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-white text-zinc-950 pt-20"
    >
      <NoiseOverlay />

      {/* Animated mesh grid background */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.4]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(5, 150, 105, 0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(5, 150, 105, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Clean minimalist floating orbs */}
      <div
        className="absolute w-64 h-64 rounded-full bg-emerald-500/5 blur-[80px] top-[15%] left-[10%]"
        style={{ animation: 'float-slow 8s ease-in-out infinite' }}
      />
      <div
        className="absolute w-96 h-96 rounded-full bg-emerald-600/5 blur-[100px] bottom-[10%] right-[10%]"
        style={{ animation: 'float-gentle 12s ease-in-out infinite 2s' }}
      />

      <div className="relative z-20 text-center px-4 w-full max-w-[95vw] lg:max-w-[1400px] 2xl:max-w-[1800px] mx-auto">
        {/* Headline */}
        <h1
          ref={headlineRef}
          className="font-sans font-bold text-[clamp(2.5rem,6vw,5.5rem)] leading-[1.1] tracking-[-0.03em] text-zinc-950 mb-8 flex flex-col items-center justify-center gap-2"
          style={{ wordBreak: 'keep-all', overflowWrap: 'normal' }}
        >
          {/* Line 1 */}
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.5rem,1.5vw,1rem)]">
            <span className="word inline-block opacity-0 whitespace-nowrap">RECRUITING</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">AGENCIES</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">ARE</span>
          </div>

          {/* Line 2 */}
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.5rem,1.5vw,1rem)] mt-2">
            <span className="word inline-block opacity-0 whitespace-nowrap text-emerald-600 relative group">
              STEALING
              <div className="absolute -bottom-1 left-0 w-full h-2 bg-emerald-100 rounded-full overflow-hidden">
                <div className="w-full h-full bg-emerald-500 transform origin-left scale-x-0 animate-[draw-line_0.8s_ease-out_forwards] delay-1000" />
              </div>
            </span>
            <span className="word inline-block opacity-0 whitespace-nowrap">FROM</span>
            <span className="word inline-block opacity-0 whitespace-nowrap text-emerald-700 bg-emerald-50 rounded-lg px-2 py-1 border border-emerald-200/50 shadow-[0_4px_20px_rgba(16,185,129,0.15)] hover:scale-105 hover:-translate-y-1 transition-all duration-300">
              YOU
            </span>
          </div>
        </h1>

        {/* Body copy */}
        <div ref={bodyRef} className="opacity-0 mb-12">
          <p className="font-sans text-base md:text-xl text-zinc-600 max-w-2xl mx-auto leading-relaxed">
            Every hire through an agency costs you 20% of that person's annual salary.
            <br className="hidden sm:block" />For a $120,000 engineer — that is <strong className="text-zinc-900 font-semibold">$24,000 gone forever.</strong>
            <br className="hidden sm:block" />Per hire. Every time. No exceptions.
          </p>
        </div>

        {/* Counter - Clean Card */}
        <div ref={counterRef} className="mb-16 opacity-0 px-4">
          <div className="bg-white/60 backdrop-blur-xl border border-zinc-200/50 rounded-2xl p-8 max-w-lg mx-auto shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 transform hover:-translate-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold tracking-wide mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              AVERAGE ANNUAL SPEND
            </div>
            <div className="font-mono font-bold text-[48px] md:text-[80px] leading-none text-emerald-600 tracking-tighter">
              ${counterVal.toLocaleString()}
            </div>
            <p className="text-sm text-zinc-500 mt-2 font-medium">
              spent on agency fees by SaaS startups per year
            </p>
          </div>
        </div>

        {/* Scroll arrow - Glass pill */}
        <div ref={arrowRef} className="opacity-0 flex flex-col items-center gap-2">
          <div className="bg-white/60 backdrop-blur-md rounded-full px-6 py-3 flex items-center gap-2 border border-zinc-200 shadow-sm">
            <p className="font-sans text-sm text-emerald-600 font-medium">
              Scroll to see a better way
            </p>
            <ChevronDown className="w-5 h-5 animate-bounce text-emerald-600" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

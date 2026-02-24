import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import NoiseOverlay from './NoiseOverlay';
import { ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const HeroHook = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subtextRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLDivElement>(null);
  const [counterVal, setCounterVal] = useState(0);
  const [hasCounted, setHasCounted] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Word-by-word headline entrance
      const words = headlineRef.current?.querySelectorAll('.word');
      if (words) {
        gsap.fromTo(words, {
          opacity: 0,
          y: 50,
        }, {
          opacity: 1,
          y: 0,
          stagger: 0.08,
          duration: 0.7,
          ease: 'power3.out',
          delay: 0.3,
        });
      }

      // STEALING underline draw
      const underline = headlineRef.current?.querySelector('.stealing-underline');
      if (underline) {
        gsap.fromTo(underline, { scaleX: 0 }, {
          scaleX: 1,
          duration: 0.8,
          ease: 'power2.out',
          delay: 1.0,
        });
      }

      // Subtext fade in
      gsap.fromTo(subtextRef.current, { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.8, delay: 1.2, ease: 'power2.out',
      });

      // CTA fade in
      gsap.fromTo(ctaRef.current, { opacity: 0, y: 20 }, {
        opacity: 1, y: 0, duration: 0.6, delay: 1.5, ease: 'power2.out',
      });

      // Counter card - scroll triggered
      ScrollTrigger.create({
        trigger: counterRef.current,
        start: 'top bottom-=100',
        onEnter: () => setHasCounted(true),
      });

      gsap.fromTo(counterRef.current, { opacity: 0, y: 40, scale: 0.95 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.8, delay: 1.8, ease: 'back.out(1.4)',
      });

      // Parallax on scroll
      gsap.to(headlineRef.current, {
        y: -60,
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

  // Count-up animation
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
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-white pt-24 pb-16"
    >
      <NoiseOverlay />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(5, 150, 105, 0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(5, 150, 105, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />

      {/* Floating orbs */}
      <div
        className="absolute w-72 h-72 rounded-full bg-emerald-500/[0.06] blur-[100px] top-[10%] left-[5%]"
        style={{ animation: 'float-slow 8s ease-in-out infinite' }}
      />
      <div
        className="absolute w-96 h-96 rounded-full bg-emerald-600/[0.04] blur-[120px] bottom-[5%] right-[5%]"
        style={{ animation: 'float-gentle 12s ease-in-out infinite 2s' }}
      />

      <div className="relative z-20 text-center px-4 w-full max-w-5xl mx-auto">
        {/* Headline */}
        <h1
          ref={headlineRef}
          className="font-sans font-extrabold text-[clamp(2.2rem,5.5vw,5rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-8"
          style={{ wordBreak: 'keep-all', overflowWrap: 'normal' }}
        >
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)]">
            <span className="word inline-block opacity-0 whitespace-nowrap">RECRUITING</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">AGENCIES</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">ARE</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)] mt-2">
            <span className="word inline-block opacity-0 whitespace-nowrap text-emerald-600 relative">
              STEALING
              <span
                className="stealing-underline absolute -bottom-1 left-0 w-full h-2 bg-emerald-200 rounded-full origin-left"
                style={{ transform: 'scaleX(0)' }}
              />
            </span>
            <span className="word inline-block opacity-0 whitespace-nowrap">FROM</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">
              <span className="bg-emerald-50 text-emerald-700 rounded-lg px-3 py-1 border border-emerald-200/60">
                YOU
              </span>
            </span>
          </div>
        </h1>

        {/* Subtext */}
        <div ref={subtextRef} className="opacity-0 mb-10">
          <p className="font-sans text-lg md:text-xl text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            Every hire through an agency costs you 20% of that person's annual salary.
            <br className="hidden sm:block" />
            For a $120,000 engineer — that is{' '}
            <strong className="text-zinc-900 font-semibold">$24,000 gone forever.</strong>
            <br className="hidden sm:block" />
            Per hire. Every time. No exceptions.
          </p>
        </div>

        {/* CTA */}
        <div ref={ctaRef} className="opacity-0 mb-16">
          <button
            onClick={() => navigate('/auth')}
            className="group inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-lg px-8 py-4 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_30px_rgba(5,150,105,0.3)] active:scale-[0.98]"
          >
            Eliminate Agency Fees
            <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
          </button>
          <p className="text-sm text-zinc-400 mt-4 font-medium">
            No credit card required · Setup in 5 minutes · Cancel anytime
          </p>
        </div>

        {/* Stat Card */}
        <div ref={counterRef} className="opacity-0 max-w-md mx-auto">
          <div className="bg-white/80 backdrop-blur-xl border border-zinc-200/60 rounded-2xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_50px_rgba(0,0,0,0.08)] transition-all duration-500 hover:-translate-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold tracking-wider mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              AVERAGE ANNUAL SPEND
            </div>
            <div className="font-mono font-bold text-5xl md:text-7xl leading-none text-emerald-600 tracking-tighter">
              ${counterVal.toLocaleString()}
            </div>
            <p className="text-sm text-zinc-500 mt-3 font-medium">
              spent on agency fees by SaaS startups per year
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

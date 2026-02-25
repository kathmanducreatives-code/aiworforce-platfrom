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
  const statRef = useRef<HTMLDivElement>(null);
  const [agencyVal, setAgencyVal] = useState(0);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const words = headlineRef.current?.querySelectorAll('.word');
      if (words) {
        gsap.fromTo(words, { opacity: 0, y: 50 }, {
          opacity: 1, y: 0, stagger: 0.08, duration: 0.7, ease: 'power3.out', delay: 0.3,
        });
      }
      const underline = headlineRef.current?.querySelector('.stealing-underline');
      if (underline) {
        gsap.fromTo(underline, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power2.out', delay: 1.0 });
      }
      gsap.fromTo(subtextRef.current, { opacity: 0, y: 30 }, {
        opacity: 1, y: 0, duration: 0.8, delay: 1.2, ease: 'power2.out',
      });
      gsap.fromTo(ctaRef.current, { opacity: 0, y: 20 }, {
        opacity: 1, y: 0, duration: 0.6, delay: 1.5, ease: 'power2.out',
      });
      gsap.fromTo(statRef.current, { opacity: 0, y: 40, scale: 0.95 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.8, delay: 1.8, ease: 'back.out(1.4)',
      });

      // Agency cost count-up
      ScrollTrigger.create({
        trigger: statRef.current,
        start: 'top bottom-=100',
        onEnter: () => {
          gsap.to({ val: 0 }, {
            val: 82000, duration: 2, ease: 'power3.out',
            onUpdate: function () { setAgencyVal(Math.floor(this.targets()[0].val)); },
          });
        },
      });

      gsap.to(headlineRef.current, {
        y: -60,
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: 1 },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-white pt-24 pb-16">
      <NoiseOverlay />
      <div className="absolute inset-0 z-0 pointer-events-none opacity-30" style={{
        backgroundImage: 'linear-gradient(to right, rgba(5,150,105,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(5,150,105,0.04) 1px, transparent 1px)',
        backgroundSize: '50px 50px',
      }} />
      <div className="absolute w-72 h-72 rounded-full bg-emerald-500/[0.06] blur-[100px] top-[10%] left-[5%]" style={{ animation: 'float-slow 8s ease-in-out infinite' }} />
      <div className="absolute w-96 h-96 rounded-full bg-emerald-600/[0.04] blur-[120px] bottom-[5%] right-[5%]" style={{ animation: 'float-gentle 12s ease-in-out infinite 2s' }} />

      <div className="relative z-20 text-center px-4 w-full max-w-5xl mx-auto">
        <h1 ref={headlineRef} className="font-sans font-extrabold text-[clamp(2.2rem,5.5vw,5rem)] leading-[1.05] tracking-[-0.03em] text-zinc-950 mb-8" style={{ wordBreak: 'keep-all', overflowWrap: 'normal' }}>
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)]">
            <span className="word inline-block opacity-0 whitespace-nowrap">RECRUITING</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">AGENCIES</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">ARE</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)] mt-2">
            <span className="word inline-block opacity-0 whitespace-nowrap text-emerald-600 relative">
              STEALING
              <span className="stealing-underline absolute -bottom-1 left-0 w-full h-2 bg-emerald-200 rounded-full origin-left" style={{ transform: 'scaleX(0)' }} />
            </span>
            <span className="word inline-block opacity-0 whitespace-nowrap">FROM</span>
            <span className="word inline-block opacity-0 whitespace-nowrap">
              <span className="bg-emerald-50 text-emerald-700 rounded-lg px-3 py-1 border border-emerald-200/60">YOU</span>
            </span>
          </div>
        </h1>

        <div ref={subtextRef} className="opacity-0 mb-10">
          <p className="font-sans text-lg md:text-xl text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            You're paying agencies €15,000–€30,000 per hire. ScreeningPilot does the same job in 15 minutes for <strong className="text-zinc-900">€149/month</strong>. Unlimited hires. No per-hire fees. No middlemen.
          </p>
        </div>

        <div ref={ctaRef} className="opacity-0 mb-16">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button onClick={() => navigate('/auth')} className="group inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-lg px-8 py-4 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_30px_rgba(5,150,105,0.3)] active:scale-[0.98]">
              Start Hiring for €149/mo
              <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <button onClick={() => navigate('/get-demo')} className="inline-flex items-center gap-2 bg-transparent border-2 border-emerald-600 text-emerald-700 font-semibold text-lg px-8 py-4 rounded-full transition-all duration-300 hover:bg-emerald-600 hover:text-white hover:scale-[1.03] active:scale-[0.98]">
              Book a Demo
            </button>
          </div>
          <p className="text-sm text-zinc-400 mt-4 font-medium">
            No per-hire fees · Cancel anytime · Replaces your agency from day one
          </p>
        </div>

        <div ref={statRef} className="opacity-0 max-w-xl mx-auto">
          <div className="bg-white/80 backdrop-blur-xl border border-zinc-200/60 rounded-2xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04),0_1px_3px_rgba(0,0,0,0.06)]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="text-center sm:border-r border-zinc-100">
                <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mb-2">What agencies charge (10 hires)</p>
                <p className="font-mono font-bold text-3xl text-zinc-400 line-through tabular-nums">€{agencyVal.toLocaleString()}<span className="text-sm">/year</span></p>
              </div>
              <div className="text-center">
                <p className="text-xs text-emerald-600 uppercase tracking-wider font-semibold mb-2">ScreeningPilot · Same 10 hires</p>
                <p className="font-mono font-bold text-3xl text-emerald-600 tabular-nums">€1,788<span className="text-sm">/year</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

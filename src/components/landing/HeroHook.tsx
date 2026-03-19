import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
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
        gsap.fromTo(words, { opacity: 0, y: 60, filter: 'blur(10px)' }, {
          opacity: 1, y: 0, filter: 'blur(0px)', stagger: 0.1, duration: 1.2, ease: 'expo.out', delay: 0.2,
        });
      }
      const underline = headlineRef.current?.querySelector('.headline-underline');
      if (underline) {
        gsap.fromTo(underline, { scaleX: 0 }, { scaleX: 1, duration: 1.2, ease: 'expo.out', delay: 1.0 });
      }
      gsap.fromTo(subtextRef.current, { opacity: 0, y: 30, filter: 'blur(5px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, delay: 1.2, ease: 'power3.out' });
      gsap.fromTo(ctaRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1.0, delay: 1.5, ease: 'power3.out' });
      gsap.fromTo(statRef.current, { opacity: 0, y: 40, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 1.2, delay: 1.8, ease: 'back.out(1.2)' });

      ScrollTrigger.create({
        trigger: statRef.current,
        start: 'top bottom-=100',
        onEnter: () => {
          gsap.to({ val: 0 }, { val: 82000, duration: 2, ease: 'power3.out', onUpdate: function () { setAgencyVal(Math.floor(this.targets()[0].val)); } });
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-24 pb-16">
      <div className="relative z-20 text-center px-4 w-full max-w-6xl mx-auto">
        <h1 ref={headlineRef} className="text-glow-green font-display font-black text-[clamp(2.5rem,6vw,5.5rem)] leading-[1.0] tracking-[-0.05em] text-white mb-10">
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)]">
            <span className="word inline-block opacity-0">RECRUITING</span>
            <span className="word inline-block opacity-0">AGENCIES</span>
            <span className="word inline-block opacity-0">ARE</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)] mt-2">
            <span className="word inline-block opacity-0 text-shimmer relative">
              STEALING FROM YOU
              <span className="headline-underline absolute -bottom-1 left-0 w-full h-2 bg-emerald-500/30 rounded-full origin-left" style={{ transform: 'scaleX(0)' }} />
            </span>
          </div>
        </h1>

        <div ref={subtextRef} className="opacity-0 mb-10">
          <p className="font-display text-lg md:text-xl text-white/60 max-w-2xl mx-auto leading-relaxed">
            The average recruiting agency charges 20% of first-year salary. That's €24,000 per hire — for sending you the same LinkedIn results you could find yourself. We built the tool that makes them irrelevant.
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto text-left">
            <p className="text-sm text-white/70">• 20% average agency fee per placement</p>
            <p className="text-sm text-white/70">• €24,000 cost per senior hire</p>
            <p className="text-sm text-white/70">• 340+ hours wasted on manual screening per year</p>
            <p className="text-sm text-white/70">• 67% of agency candidates don't pass first interview</p>
          </div>
        </div>

        <div ref={ctaRef} className="opacity-0 mb-16">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button onClick={() => navigate('/get-demo')} className="liquid-fill-btn group h-[44px] inline-flex items-center gap-3 bg-emerald-600 border border-emerald-400 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] shadow-[0_4px_24px_rgba(5,150,105,0.4)] active:scale-[0.98]">
              Stop Paying Agency Fees Forever
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <button onClick={() => navigate('/auth')} className="h-[44px] inline-flex items-center gap-2 bg-transparent border border-white/15 text-white/70 hover:text-white hover:border-white/30 font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:bg-white/5 hover:scale-[1.03] active:scale-[0.98]">
              See How It Works
            </button>
          </div>
          <p className="text-sm text-white/40 mt-4 font-medium">
            No credit card required · Replace your agency in 48 hours
          </p>
        </div>

        <div ref={statRef} className="opacity-0 max-w-xl mx-auto">
          <div className="glass-strong rounded-2xl p-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="text-center sm:border-r border-white/10">
                <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-2">Average agency cost (10 hires)</p>
                <p className="font-mono font-bold text-3xl text-white/30 line-through tabular-nums">€{agencyVal.toLocaleString()}<span className="text-sm">/year</span></p>
              </div>
              <div className="text-center">
                <p className="text-xs text-emerald-400/80 uppercase tracking-wider font-semibold mb-2">ScreeningPilot · same results</p>
                <p className="font-mono font-bold text-3xl text-emerald-400 tabular-nums">€1,788<span className="text-sm">/year</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

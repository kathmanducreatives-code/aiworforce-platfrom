import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ArrowRight, Users, TrendingUp, Pen, Eye, BarChart2 } from 'lucide-react';

const deptAvatars = [
  { icon: Users, label: 'Talent', color: 'bg-emerald-500/20 border-emerald-500/40' },
  { icon: TrendingUp, label: 'Growth', color: 'bg-blue-500/20 border-blue-500/40' },
  { icon: Pen, label: 'Content', color: 'bg-purple-500/20 border-purple-500/40' },
  { icon: Eye, label: 'Intelligence', color: 'bg-amber-500/20 border-amber-500/40' },
  { icon: BarChart2, label: 'Command', color: 'bg-emerald-500/20 border-emerald-500/40' },
];

const HeroHook = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subtextRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const words = headlineRef.current?.querySelectorAll('.word');
      if (words) {
        gsap.fromTo(words, { opacity: 0, y: 60, filter: 'blur(10px)' }, {
          opacity: 1, y: 0, filter: 'blur(0px)', stagger: 0.1, duration: 1.2, ease: 'expo.out', delay: 0.2,
        });
      }
      gsap.fromTo(subtextRef.current, { opacity: 0, y: 30, filter: 'blur(5px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, delay: 1.2, ease: 'power3.out' });
      gsap.fromTo(ctaRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1.0, delay: 1.5, ease: 'power3.out' });
      gsap.fromTo(agentRef.current, { opacity: 0, y: 40, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 1.2, delay: 1.8, ease: 'back.out(1.2)' });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-24 pb-16">
      <div className="relative z-20 text-center px-4 w-full max-w-4xl mx-auto">
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-primary font-semibold mb-6">THE AI WORKFORCE PLATFORM</p>

        <h1 ref={headlineRef} className="font-display font-black text-[clamp(2.5rem,6vw,5.5rem)] leading-[1.0] tracking-[-0.05em] text-foreground mb-10">
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)]">
            {['You','are','doing','the','work'].map(w => <span key={w} className="word inline-block opacity-0">{w}</span>)}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)] mt-2">
            {['of','ten','people.'].map(w => <span key={w} className="word inline-block opacity-0">{w}</span>)}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-[clamp(0.4rem,1.2vw,0.8rem)] mt-2">
            <span className="word inline-block opacity-0 text-primary">Now you don't have to.</span>
          </div>
        </h1>

        <div ref={subtextRef} className="opacity-0 mb-10">
          <p className="font-display text-lg md:text-xl text-foreground/60 max-w-2xl mx-auto leading-relaxed">
            ScreeningPilot gives you a full AI workforce — five departments, fifteen agents, one company brain. They recruit, sell, create, research, and report. You make the decisions. They do everything else.
          </p>
        </div>

        {/* Agent presence row */}
        <div ref={agentRef} className="opacity-0 mb-12">
          <div className="relative flex items-center justify-center gap-6 md:gap-8">
            {/* Connecting line */}
            <div className="absolute top-7 left-1/2 -translate-x-1/2 hidden md:block" style={{ width: `${(deptAvatars.length - 1) * 80}px`, height: 1 }}>
              <div className="w-full h-px bg-primary/20" />
              <div className="absolute top-0 left-0 w-3 h-px bg-primary animate-[travelDot_3s_linear_infinite]"
                style={{ boxShadow: "0 0 6px hsl(var(--primary) / 0.6)" }} />
            </div>
            <style>{`@keyframes travelDot { 0% { left: 0; } 100% { left: calc(100% - 12px); } }`}</style>

            {deptAvatars.map((dept, i) => {
              const Icon = dept.icon;
              return (
                <div key={dept.label} className="flex flex-col items-center gap-2 relative z-10">
                  <div className="relative w-14 h-14 rounded-full flex items-center justify-center bg-primary/10 border-[1.5px] border-primary/40">
                    <Icon className="w-6 h-6 text-primary" />
                    <span className="absolute inset-0 rounded-full animate-[pulseRing_2s_ease-in-out_infinite]"
                      style={{
                        animationDelay: `${i * 0.4}s`,
                      }} />
                  </div>
                  <span className="text-[11px] text-foreground/50 font-medium uppercase tracking-[0.1em]">{dept.label}</span>
                </div>
              );
            })}
          </div>
          <style>{`@keyframes pulseRing { 0% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.4); } 70% { box-shadow: 0 0 0 8px hsl(var(--primary) / 0); } 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); } }`}</style>
        </div>

        <div ref={ctaRef} className="opacity-0 mb-8">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button onClick={() => navigate('/auth')} className="liquid-fill-btn group h-[44px] inline-flex items-center gap-3 bg-primary hover:bg-primary/90 border border-primary/60 text-primary-foreground font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] shadow-[0_4px_24px_hsl(var(--primary)/0.35)] active:scale-[0.98]">
              Build your AI workforce
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <a href="#day-timeline" className="h-[44px] inline-flex items-center gap-2 bg-transparent border border-border text-foreground/70 hover:text-foreground hover:border-foreground/30 font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:bg-foreground/5 hover:scale-[1.03] active:scale-[0.98]">
              See how it works
            </a>
          </div>
          <p className="text-sm text-foreground/40 mt-4 font-medium">
            Trusted by founders from 50+ countries · Set up in 10 minutes · Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
};

export default HeroHook;

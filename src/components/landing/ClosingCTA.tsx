import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const comparisons = [
  { old: '$28,000 agency fee per hire', replacement: '$0 with ScreeningPilot' },
  { old: '6 hours screening CVs manually', replacement: '8 minutes automated' },
  { old: '3 months to fill a senior role', replacement: 'Shortlist ready same day' },
];

const ClosingCTA = () => {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      lineRefs.current.forEach((line, i) => {
        if (!line) return;
        const oldText = line.querySelector('.old-text');
        const newText = line.querySelector('.new-text');
        gsap.fromTo(oldText, { opacity: 1 }, {
          textDecoration: 'line-through',
          opacity: 0.4,
          duration: 0.6,
          delay: i * 0.3,
          scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
        });
        gsap.fromTo(newText, { opacity: 0, x: 20 }, {
          opacity: 1, x: 0,
          duration: 0.5,
          delay: 0.3 + i * 0.3,
          scrollTrigger: { trigger: sectionRef.current, start: 'top 60%', toggleActions: 'play none none none' },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-24 bg-emerald-600 overflow-hidden"
    >
      {/* Decorative circle */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full border border-white/10 bg-white/5 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ animation: 'float-gentle 15s ease-in-out infinite', filter: 'blur(1px)' }}
      />

      {/* Dot pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="max-w-4xl mx-auto text-center relative z-10">
        <h2 className="font-sans font-extrabold text-[clamp(2.5rem,5vw,5rem)] leading-[1.05] tracking-[-0.03em] mb-8 text-white">
          STOP PAYING THE<br />HIRING TAX.
        </h2>

        <p className="font-sans text-lg md:text-xl max-w-2xl mx-auto mb-12 leading-relaxed text-white/80">
          Every month you use a recruiting agency is another $20,000 you will never see again.
          ScreeningPilot gives you back your money, your time, and your hiring power.
        </p>

        {/* Comparisons */}
        <div className="space-y-4 mb-14 max-w-xl mx-auto text-left">
          {comparisons.map((c, i) => (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el; }}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 rounded-xl px-5 py-3 bg-white/10 backdrop-blur-sm border border-white/10"
            >
              <span className="old-text font-sans text-sm text-white/60">
                ✕ {c.old}
              </span>
              <span className="new-text font-sans text-sm font-bold opacity-0 text-white">
                → ✓ {c.replacement}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate('/auth')}
          className="font-sans font-bold text-lg tracking-wide uppercase px-10 py-4 rounded-full transition-all duration-300 bg-white text-emerald-700 hover:bg-emerald-50 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:scale-[1.03] active:scale-[0.98]"
        >
          ELIMINATE AGENCY DEPENDENCY — START FREE
        </button>

        <p className="font-mono text-xs mt-6 text-white/60">
          No credit card. No agency. No middleman. Setup in under 10 minutes.
        </p>
      </div>
    </section>
  );
};

export default ClosingCTA;

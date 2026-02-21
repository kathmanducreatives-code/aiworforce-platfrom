import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const comparisons = [
  { old: '$28,000 agency fee per hire', replacement: '$0 with Screening Pilot' },
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
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-24"
      style={{ backgroundColor: '#00e5a0' }}
    >
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="font-bebas text-[48px] md:text-[80px] lg:text-[120px] leading-[0.95] mb-8" style={{ color: '#080808' }}>
          STOP PAYING THE<br />HIRING TAX.
        </h2>

        <p className="font-syne text-base md:text-xl max-w-2xl mx-auto mb-12 leading-relaxed" style={{ color: '#080808' }}>
          Every month you use a recruiting agency is another $20,000 you will never see again.
          Screening Pilot gives you back your money, your time, and your hiring power.
        </p>

        {/* Comparisons */}
        <div className="space-y-5 mb-14 max-w-xl mx-auto text-left">
          {comparisons.map((c, i) => (
            <div
              key={i}
              ref={el => { lineRefs.current[i] = el; }}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4"
            >
              <span className="old-text font-syne text-sm md:text-base" style={{ color: '#080808' }}>
                ❌ {c.old}
              </span>
              <span className="new-text font-syne text-sm md:text-base font-bold opacity-0" style={{ color: '#080808' }}>
                → ✓ {c.replacement}
              </span>
            </div>
          ))}
        </div>

        {/* CTA Button */}
        <button
          onClick={() => navigate('/auth')}
          className="group font-bebas text-xl md:text-2xl tracking-[3px] px-10 md:px-12 py-4 md:py-5 rounded-full transition-all duration-300"
          style={{
            backgroundColor: '#080808',
            color: '#00e5a0',
          }}
          onMouseEnter={e => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#00e5a0';
            (e.target as HTMLButtonElement).style.color = '#080808';
            (e.target as HTMLButtonElement).style.boxShadow = '0 0 30px rgba(0,229,160,0.4)';
            (e.target as HTMLButtonElement).style.border = '2px solid #080808';
          }}
          onMouseLeave={e => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#080808';
            (e.target as HTMLButtonElement).style.color = '#00e5a0';
            (e.target as HTMLButtonElement).style.boxShadow = 'none';
            (e.target as HTMLButtonElement).style.border = 'none';
          }}
        >
          KILL YOUR AGENCY DEPENDENCY — START FREE
        </button>

        <p className="font-jetbrains text-xs mt-6" style={{ color: '#080808', opacity: 0.7 }}>
          No credit card. No agency. No middleman.<br />
          Setup in under 10 minutes.
        </p>
      </div>

      {/* Bottom right branding */}
      <div className="absolute bottom-6 right-6">
        <p className="font-jetbrains text-xs" style={{ color: '#080808', opacity: 0.5 }}>
          screeningpilot.com
        </p>
      </div>
    </section>
  );
};

export default ClosingCTA;

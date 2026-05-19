import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const rows = [
  { task: 'Sourcing & Screening', manual: '€60,000/year + 6 weeks per hire', sp: 'Scout + Aria · Always active' },
  { task: 'Outreach Drafting', manual: '€50,000/year SDR + low reply rates', sp: 'Penn · Personalized drafts on demand' },
  { task: 'Content Writing', manual: '€45,000/year + 2 posts per week', sp: 'Scribe · Drafts in your brand voice' },
  { task: 'Competitor Monitoring', manual: '€40,000/year + weekly reports', sp: 'Hawk · Tracks rivals 24/7' },
  { task: 'Total cost', manual: '€195,000/year + hiring time', sp: '€149/month · Five working agents', highlight: true },
];

const TimeMath = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.1, rootMargin: "-50px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Counter animation
  useEffect(() => {
    if (!inView) return;
    const target = 192212;
    const duration = 800;
    let raf: number;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const rowEls = tableRef.current?.querySelectorAll('.time-row');
      if (rowEls) {
        rowEls.forEach((row, i) => {
          gsap.fromTo(row, { opacity: 0, x: -20 }, {
            opacity: 1, x: 0, duration: 0.5, delay: i * 0.15, ease: 'power3.out',
            scrollTrigger: { trigger: tableRef.current, start: 'top 70%', toggleActions: 'play none none none' },
          });
          const spCell = row.querySelector('.sp-cell');
          if (spCell) {
            gsap.fromTo(spCell, { opacity: 0, x: 30 }, {
              opacity: 1, x: 0, duration: 0.4, delay: 0.3 + i * 0.15, ease: 'power3.out',
              scrollTrigger: { trigger: tableRef.current, start: 'top 70%', toggleActions: 'play none none none' },
            });
          }
        });
      }
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative px-4 py-28 md:py-36" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ THE MATH DOESN'T LIE</p>
          <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
            Five working AI agents vs. a human team.
          </h2>
        </div>

        {/* Big savings number */}
        <div className="text-center mb-12">
          <div className="font-display font-black text-[clamp(3rem,8vw,5rem)] text-emerald-400 tabular-nums tracking-tight leading-none">
            €{count.toLocaleString()}
          </div>
          <div className="text-lg text-white/40 mt-2">saved every year vs a human team</div>
        </div>

        <div ref={tableRef} className="glass-strong rounded-2xl overflow-hidden">
          <div className="grid grid-cols-3 gap-0 text-xs font-semibold text-white/30 uppercase tracking-wider px-6 py-4 border-b border-white/[0.06]">
            <span>Task</span><span>Human Team</span><span className="text-emerald-400">Your AI Workforce</span>
          </div>
          {rows.map((row, i) => (
            <div key={i} className={`time-row grid grid-cols-3 gap-0 px-6 py-4 border-b border-white/[0.03] last:border-0 ${row.highlight ? 'bg-emerald-500/[0.06]' : ''}`}>
              <span className={`text-sm ${row.highlight ? 'font-bold text-white' : 'text-white/60'}`}>{row.task}</span>
              <span className="text-sm text-white/40">{row.manual}</span>
              <span className={`sp-cell text-sm font-semibold ${row.highlight ? 'text-emerald-400 text-base' : 'text-emerald-400/80'}`}>{row.sp}</span>
            </div>
          ))}
        </div>
        <p className="text-center text-white/70 text-sm mt-6">
          Same output. Same quality. No equity. No benefits. No notice period. No bad days.
        </p>
      </div>
    </section>
  );
};

export default TimeMath;

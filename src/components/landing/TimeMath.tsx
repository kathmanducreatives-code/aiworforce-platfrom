import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const rows = [
  { task: 'Your company context', manual: 'Re-explained to every tool, every session', sp: 'Told once. Shared by every employee.' },
  { task: 'Moving work along', manual: 'You copy the output of one tool into the next', sp: 'Employees hand work to each other' },
  { task: 'Where the work lives', manual: 'Research here, content there, leads somewhere else', sp: 'One place' },
  { task: 'Your role', manual: 'The connection between everything', sp: 'Review the results and decide' },
  { task: 'What it costs you', manual: 'Several subscriptions, and hours of coordination', sp: 'One subscription, minutes of review', highlight: true },
];

const TimeMath = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
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
          <p className="font-mono text-xs uppercase tracking-[0.15em] mb-4 text-emerald-400 font-semibold">◆ THE MATH</p>
          <h2 className="font-display font-black text-[clamp(1.5rem,3.5vw,3rem)] leading-[1.1] tracking-[-0.03em] text-white">
            What this replaces.
          </h2>
        </div>

        {/* Qualitative headline in the same slot the savings figure occupied. */}
        <div className="text-center mb-12">
          <div className="font-display font-black text-[clamp(3rem,8vw,5rem)] text-emerald-400 tabular-nums tracking-tight leading-none">
            One place
          </div>
          <div className="text-lg text-white/40 mt-2">instead of a stack of tools that don't talk to each other</div>
        </div>

        <div ref={tableRef} className="glass-strong rounded-2xl overflow-hidden">
          <div className="grid grid-cols-3 gap-0 text-xs font-semibold text-white/30 uppercase tracking-wider px-6 py-4 border-b border-white/[0.06]">
            <span>Task</span><span>Doing it the current way</span><span className="text-emerald-400">With Agentory</span>
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
          Not your team — the stack of separate tools you're paying for, and the hours you spend moving work between them.
        </p>
      </div>
    </section>
  );
};

export default TimeMath;

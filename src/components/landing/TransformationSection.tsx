import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';

const withoutItems = [
  '15 tools that forget you every session',
  '6 hours/week briefing AI with the same context',
  '€195,000/year in human team costs',
  'Recruiting: 6 weeks per hire',
  'You are the connection between everything',
];

const withItems = [
  '1 Company Brain shared across all agents',
  '10 minutes setup. Context stored forever.',
  '€149/month for your entire AI workforce',
  'Recruiting: 48 hours from post to shortlist',
  'Agents brief each other automatically',
];

export const TransformationSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold: 0.1, rootMargin: "-50px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative w-full px-4 py-28 md:py-36 z-10" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.6 }}
          className="text-center mb-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] mb-4 text-emerald-500 font-semibold">THE REALITY</p>
          <h2 className="font-display font-black text-[clamp(2rem,4.5vw,3.8rem)] leading-[1.05] tracking-[-0.04em] text-white">
            Right now you are the only connection<br />between tools that do not know each other.
          </h2>
        </motion.div>

        {/* Two-column comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 relative max-w-4xl mx-auto">
          {/* Vertical divider with VS */}
          <div className="hidden md:flex absolute left-1/2 top-0 bottom-0 -translate-x-1/2 flex-col items-center justify-center z-10">
            <div className="w-px flex-1 bg-white/[0.08]" />
            <div className="w-10 h-10 rounded-full border border-white/[0.15] bg-[#0a0e14] flex items-center justify-center my-3">
              <span className="text-[10px] font-bold text-white/40 uppercase">vs</span>
            </div>
            <div className="w-px flex-1 bg-white/[0.08]" />
          </div>

          {/* LEFT — Without Pilot */}
          <div className="pr-4 md:pr-10 pb-8 md:pb-0">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-2 h-2 rounded-full bg-red-400/60" />
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-red-400/60 font-semibold">RIGHT NOW</span>
            </div>
            <div className="space-y-4">
              {withoutItems.map((item, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.4, delay: i * 0.1 }}
                  className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5 border border-red-500/20">
                    <X className="w-3 h-3 text-red-400/60" />
                  </div>
                  <span className="text-sm text-white/40">{item}</span>
                </motion.div>
              ))}
            </div>
            <div className="mt-8 font-mono text-xs text-white/25 border-t border-white/[0.06] pt-4">
              COST: €195,000/year + your sanity
            </div>
          </div>

          {/* RIGHT — With Pilot */}
          <div className="pl-4 md:pl-10 pt-8 md:pt-0 border-t md:border-t-0 border-white/[0.06]">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-400 font-semibold">WITH PILOT</span>
            </div>
            <div className="space-y-4">
              {withItems.map((item, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, x: 16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
                  className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5 border border-emerald-500/25">
                    <Check className="w-3 h-3 text-emerald-400" />
                  </div>
                  <span className="text-sm text-white/80 font-medium">{item}</span>
                </motion.div>
              ))}
            </div>
            <div className="mt-8 font-mono text-xs border-t border-emerald-500/15 pt-4">
              <div className="bg-emerald-600 rounded-lg p-3 text-white shadow-[0_8px_20px_rgba(16,185,129,0.3)] flex justify-between items-center text-sm font-bold tracking-wide border border-emerald-400/20">
                <span>€149/MONTH</span><span>·</span><span>ALL FIVE DEPARTMENTS</span>
              </div>
            </div>
          </div>
        </div>

        <motion.p initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.5, delay: 0.8 }}
          className="text-center font-display font-bold text-xl md:text-2xl text-white/70 mt-16 max-w-lg mx-auto">
          There is a better way to run a company.
        </motion.p>
      </div>
    </section>
  );
};

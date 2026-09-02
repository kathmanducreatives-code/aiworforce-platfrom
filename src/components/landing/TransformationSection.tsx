/**
 * THE STANDING ORDER — section two.
 *
 * The hero says "AI employees". The objection a visitor forms one second later
 * is "I already have AI, I pay for a chatbot". Nothing else on the page
 * answers it, so this section does, and it answers it with the one difference
 * that actually holds: who starts the work.
 *
 * You prompt a tool every single time. You brief an employee once. So the
 * device is a single instruction that never changes while everything beneath
 * it moves — and one counter, the number of times you had to ask, that stays
 * at 1 while the others climb into the thousands. That frozen 1 is the whole
 * argument; the rest of the panel exists to make it visible.
 *
 * This replaces a two-column comparison headed "you are the only connection
 * between tools that do not know each other" — an argument TimeMath further
 * down already makes, in the same two-column form, with more evidence.
 *
 * Deliberately no chart, no dashboard, no before/after. Type and numbers only.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { pinEnd, SCRUB } from './scrollSystem';

gsap.registerPlugin(ScrollTrigger);

/** Four beats is enough to read as "this kept going" without labouring it. */
const STAGES = [
  {
    day: 'Day 1',
    note: 'Reading your market for the first time',
    checked: 96,
    qualified: 0,
    drafts: 0,
    decisions: 0,
    latest: 'Started watching 48 sources and 327 companies.',
  },
  {
    day: 'Day 12',
    note: 'First accounts worth your time',
    checked: 640,
    qualified: 4,
    drafts: 2,
    decisions: 1,
    latest: 'Four companies matched your ICP. Two drafts waiting.',
  },
  {
    day: 'Day 40',
    note: 'Still working, still no follow-up',
    checked: 1842,
    qualified: 12,
    drafts: 9,
    decisions: 3,
    latest: 'A competitor cut pricing. Draft prepared the same morning.',
  },
  {
    day: 'Day 90',
    note: 'Running on the same sentence',
    checked: 4118,
    qualified: 31,
    drafts: 24,
    decisions: 8,
    latest: 'Eight decisions reached you. Nothing left without your approval.',
  },
];

const METRICS: { key: keyof (typeof STAGES)[number]; label: string }[] = [
  { key: 'checked', label: 'Companies checked' },
  { key: 'qualified', label: 'Accounts qualified' },
  { key: 'drafts', label: 'Drafts written' },
  { key: 'decisions', label: 'Brought to you' },
];

export const TransformationSection = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    // Below lg the section renders flat at its final state rather than holding
    // a pinned frame on a small screen.
    if (!window.matchMedia('(min-width: 1024px)').matches) { setStage(STAGES.length - 1); return; }

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        end: pinEnd(2.6),
        pin: true,
        scrub: SCRUB,
        anticipatePin: 1,
        fastScrollEnd: true,
        onUpdate: (self) => {
          const p = self.progress;
          const next = p < 0.24 ? 0 : p < 0.5 ? 1 : p < 0.76 ? 2 : 3;
          setStage((prev) => (prev === next ? prev : next));
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const s = STAGES[stage];

  return (
    <section
      ref={sectionRef}
      id="standing-order"
      className="relative w-full scroll-frame overflow-hidden z-10"
    >
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex items-center">
        <div className="grid lg:grid-cols-[0.82fr_1.18fr] gap-10 lg:gap-16 w-full items-center">
          {/* ── The claim ─────────────────────────────────────────────── */}
          <div className="min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-400 mb-5 block">
              Delegation
            </span>
            <h2 className="font-display font-black text-[clamp(2rem,3.6vw,3.2rem)] leading-[1.05] tracking-[-0.04em] text-white mb-6">
              Most AI waits<br />to be asked.<br />
              <span className="text-white/45">Your business doesn't.</span>
            </h2>
            <p className="text-white/55 text-[15.5px] leading-[1.65] max-w-[430px]">
              You prompt a tool every single time you want something. You brief an employee once.
              Agentory takes a standing instruction and keeps acting on it — for as long as it
              stays true.
            </p>
          </div>

          {/* ── The proof ─────────────────────────────────────────────── */}
          <div className="min-w-0">
            <div
              className="rounded-xl border border-white/[0.08] overflow-hidden"
              style={{ background: 'rgba(9,11,14,0.86)' }}
            >
              {/* The instruction. It never changes for the whole section. */}
              <div className="px-6 pt-6 pb-5 border-b border-white/[0.07]">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/30 mb-3">
                  Standing order · given once
                </p>
                <p className="text-[19px] md:text-[21px] text-white leading-[1.4] font-display">
                  “Tell me which companies are worth talking to, and draft the outreach.”
                </p>
                <p className="text-[12.5px] text-white/30 mt-3">— you, once, ninety days ago</p>
              </div>

              {/* Everything below moves. */}
              <div className="px-6 py-5">
                <div className="flex items-baseline justify-between gap-4 mb-5">
                  <span
                    key={s.day}
                    className="font-display font-black text-[30px] text-white leading-none tabular-nums"
                  >
                    {s.day}
                  </span>
                  <span className="text-[12.5px] text-white/35 text-right">{s.note}</span>
                </div>

                <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-5">
                  {METRICS.map((m) => (
                    <div key={m.label} className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] pb-2">
                      <span className="text-[12.5px] text-white/40">{m.label}</span>
                      <span className="font-display font-black text-[19px] text-white/90 tabular-nums transition-all duration-500">
                        {(s[m.key] as number).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-[13px] text-white/45 leading-snug mb-5 min-h-[36px]">{s.latest}</p>

                {/* The number that does not move. */}
                <div
                  className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3.5"
                  style={{ borderColor: 'rgba(52,211,153,0.28)', background: 'rgba(52,211,153,0.07)' }}
                >
                  <span className="text-[13.5px] text-white/70">Times you had to ask</span>
                  <span className="font-display font-black text-[26px] text-emerald-400 leading-none tabular-nums">1</span>
                </div>
              </div>
            </div>

            <p className="text-[13px] text-white/35 mt-4 text-center lg:text-left">
              It never stopped. It also never sent anything without you.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TransformationSection;

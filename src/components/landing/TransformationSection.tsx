/**
 * SECTION TWO — your next four hires might not be human.
 *
 * The hero says "AI employees". This section makes that concrete by framing
 * the four as roles a growing company would otherwise hire, contract or buy a
 * tool for — and then filling them.
 *
 * THE DEVICE is a roster, not four cards in a row. Each row is a real
 * responsibility with an owner column, and the owner column starts empty:
 * "Open · still on your plate". As the reader scrolls, the seats fill. The
 * transformation from open seat to named owner is the whole visual argument,
 * and the footer states the cost of it: four responsibilities, four owners,
 * zero hires.
 *
 * It introduces the cast at roster depth only — name, function, status, what
 * they own. The agent sequence further down is where each one is actually
 * explained, and this section exists to make the reader want that.
 *
 * ABSORBED: this replaces the old "you are the only connection between tools"
 * comparison AND the section that followed it, "Different employees.
 * Different jobs.", which was the same four portraits with the same four role
 * labels. Running both back to back would have introduced the cast twice in
 * a row; the hiring frame is what that section was missing.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { WORKFORCE, type Employee } from './employees';
import { AgentPortrait } from './agentSystem';
import { pinEnd, SCRUB } from './scrollSystem';

gsap.registerPlugin(ScrollTrigger);

interface Seat {
  employee: Employee;
  /** The capability, in the words a founder would use writing a job spec. */
  need: string;
  /** What the role owns, kept to three words so the roster stays scannable. */
  owns: string;
  status: string;
}

const SEATS: Seat[] = WORKFORCE.map((employee) => {
  const byId: Record<string, Omit<Seat, 'employee'>> = {
    mira: {
      need: 'Someone watching the market properly',
      owns: 'Pricing · hiring · competitor moves',
      status: 'Monitoring',
    },
    atlas: {
      need: 'Someone keeping the pipeline full',
      owns: 'ICP search · qualification · priority',
      status: 'Prospecting',
    },
    lyra: {
      need: 'Someone publishing consistently',
      owns: 'Ideas · drafts · repurposing',
      status: 'Drafting',
    },
    orion: {
      need: 'Someone deciding what matters today',
      owns: 'Briefing · priorities · recommendations',
      status: 'Synthesizing',
    },
  };
  return { employee, ...byId[employee.id] };
});

export const TransformationSection = () => {
  const sectionRef = useRef<HTMLElement>(null);
  /** How many seats are filled. 0 = every role still open. */
  const [filled, setFilled] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) { setFilled(SEATS.length); return; }

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        end: pinEnd(2.8),
        pin: true,
        scrub: SCRUB,
        anticipatePin: 1,
        fastScrollEnd: true,
        onUpdate: (self) => {
          // A beat with every seat open, then one hire per band.
          const p = self.progress;
          const next = p < 0.16 ? 0 : Math.min(SEATS.length, Math.floor((p - 0.16) / 0.19) + 1);
          setFilled((prev) => (prev === next ? prev : next));
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} id="your-next-hires" className="relative w-full scroll-frame overflow-hidden z-10">
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex flex-col justify-center">
        <div className="text-center mb-8 lg:mb-10">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-400 mb-4 block">
            The team you don't have to hire for
          </span>
          <h2 className="font-display font-black text-[clamp(1.9rem,3.6vw,3.1rem)] leading-[1.06] tracking-[-0.04em] text-white mb-5">
            Your next four hires<br />might not be human.
          </h2>
          <p className="text-white/50 text-[15.5px] leading-[1.6] max-w-[560px] mx-auto">
            Content, leads, signals and executive intelligence are real jobs inside a growing company.
            Agentory gives them an owner — before you add another tool, freelancer or headcount.
          </p>
        </div>

        {/* ── The roster ─────────────────────────────────────────────────── */}
        <div
          className="rounded-2xl border border-white/[0.08] overflow-hidden"
          style={{ background: 'rgba(9,11,14,0.78)' }}
        >
          <div className="hidden lg:grid grid-cols-[1.15fr_1.05fr_1.1fr] gap-6 px-6 py-3 border-b border-white/[0.07]">
            {['The responsibility', 'What it owns', 'Owner'].map((h) => (
              <span key={h} className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/28">{h}</span>
            ))}
          </div>

          {SEATS.map((seat, i) => {
            const open = i >= filled;
            const accent = seat.employee.accent;
            return (
              <div
                key={seat.employee.id}
                className="relative grid lg:grid-cols-[1.15fr_1.05fr_1.1fr] gap-3 lg:gap-6 items-center px-6 py-4 lg:py-[18px] border-b border-white/[0.05] last:border-b-0 transition-colors duration-500"
                style={{ background: open ? 'transparent' : `${accent}0a` }}
              >
                {/* Accent edge lights when the seat is taken. */}
                <span
                  className="absolute left-0 top-0 bottom-0 w-[2px] transition-all duration-500"
                  style={{ background: accent, opacity: open ? 0 : 0.85 }}
                  aria-hidden="true"
                />

                <p className="text-[15.5px] text-white/85 leading-snug">{seat.need}</p>

                <p className="text-[13.5px] text-white/40 leading-snug">{seat.owns}</p>

                {/* The seat: empty, then taken. */}
                <div className="min-h-[42px] flex items-center">
                  {open ? (
                    <span className="inline-flex items-center gap-2.5 rounded-lg border border-dashed border-white/15 px-3 py-2">
                      <span className="w-[26px] h-[26px] rounded-full border border-dashed border-white/20" aria-hidden="true" />
                      <span className="text-[13px] text-white/35">Open · still on your plate</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-3 animate-[seatFill_500ms_ease-out]">
                      <AgentPortrait employee={seat.employee} size={34} />
                      <span className="min-w-0">
                        <span className="block text-[15.5px] font-display font-black leading-none" style={{ color: accent }}>
                          {seat.employee.name}
                        </span>
                        <span className="block text-[12.5px] text-white/45 mt-1">{seat.employee.function}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 ml-1">
                        <span className="agent-status-dot" style={{ ['--a' as string]: accent }} aria-hidden="true" />
                        <span className="text-[12px] text-white/45">{seat.status}</span>
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-white/[0.07] bg-white/[0.015]">
            <div className="flex items-center gap-7">
              {[
                ['4', 'responsibilities'],
                [String(filled), 'owners'],
                ['0', 'hires'],
              ].map(([n, label], i) => (
                <span key={label} className="inline-flex items-baseline gap-2">
                  <span
                    className="font-display font-black text-[19px] tabular-nums transition-colors duration-500"
                    style={{ color: i === 2 ? '#34d399' : 'rgba(255,255,255,0.92)' }}
                  >
                    {n}
                  </span>
                  <span className="text-[12.5px] text-white/40">{label}</span>
                </span>
              ))}
            </div>
            <p className="text-[13px] text-white/35">
              {filled < SEATS.length ? 'Give the work an owner.' : 'Build the team before the headcount.'}
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes seatFill { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .animate-\\[seatFill_500ms_ease-out\\] { animation: none; } }
      `}</style>
    </section>
  );
};

export default TransformationSection;

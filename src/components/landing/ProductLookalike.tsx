/**
 * RECRUITING — from open role to ranked shortlist.
 *
 * This was a static mockup of a candidate list. It is now a scroll-driven
 * account of how the product is actually used: a request goes into chat, Pilot
 * opens a mission, the specialists work it, and the Workbench fills with
 * reviewed results.
 *
 * The two panes are one story, not two screenshots side by side. Chat is the
 * conversation; the Workbench is what that conversation produced. Every chat
 * message that lands has a corresponding change in the Workbench on the same
 * scroll step, which is the relationship the section exists to explain.
 *
 * SCROLL. The section keeps the shared pin from `scrollSystem` — same frame,
 * same scrub, same nav offset as the other demos — and drives four states off
 * ScrollTrigger progress. There is no new scroll mechanism here.
 *
 * MOBILE. The pin and the state machine are desktop-only. Below the lg
 * breakpoint the panes stack and render at their final state, so the story is
 * still readable without holding a pinned frame on a small screen.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check, Loader2 } from 'lucide-react';
import { EMPLOYEE_BY_ID, type Employee } from './employees';
import { EmployeeChip } from './EmployeePortrait';
import { AgentPortrait } from './agentSystem';
import { pinEnd, SCRUB } from './scrollSystem';

gsap.registerPlugin(ScrollTrigger);

const PILOT = EMPLOYEE_BY_ID.pilot;
const ATLAS = EMPLOYEE_BY_ID.atlas;
const LYRA = EMPLOYEE_BY_ID.lyra;
const ORION = EMPLOYEE_BY_ID.orion;

/** This story needs four beats rather than the single scene the demos use. */
const STORY_SCENES = 3.4;

interface ChatTurn {
  /** null renders the founder's own message. */
  from: Employee | null;
  text: string;
  /** The scroll state this turn appears on. */
  at: 0 | 1 | 2 | 3;
}

const CHAT: ChatTurn[] = [
  {
    from: null,
    at: 0,
    text: 'Find me 5 B2B SaaS companies in the UK with 20–200 employees that are actively hiring SDRs, BDRs or Account Executives.',
  },
  {
    from: PILOT,
    at: 0,
    text: 'Mission opened. Atlas will source and qualify, Lyra checks hiring signals, Orion reviews before it reaches you.',
  },
  {
    from: LYRA,
    at: 1,
    text: '48 sources checked. 31 UK SaaS companies posted sales roles in the last 14 days.',
  },
  {
    from: ATLAS,
    at: 1,
    text: 'Matching those against your ICP — headcount, funding stage and who owns revenue.',
  },
  {
    from: ATLAS,
    at: 2,
    text: '12 companies fit. Enriching decision makers and the evidence behind each match.',
  },
  {
    from: ORION,
    at: 3,
    text: '5 ready for you, ranked by fit. Each one has the signal and the contact attached.',
  },
];

/** What the Workbench shows at each state. */
const WORKBENCH_STATE = [
  { label: 'Waiting for the mission to start', scanned: 0, qualified: 0, ready: 0 },
  { label: 'Sourcing and checking signals', scanned: 31, qualified: 0, ready: 0 },
  { label: 'Qualifying against your ICP', scanned: 214, qualified: 12, ready: 0 },
  { label: 'Shortlist ready for review', scanned: 214, qualified: 12, ready: 5 },
];

interface Row {
  company: string;
  meta: string;
  contact: string;
  fit: number;
  /** The state this row reaches its final, reviewed form on. */
  readyAt: 2 | 3;
}

const ROWS: Row[] = [
  { company: 'Northwind Cloud', meta: 'Series A · 84 staff · 3 AE roles open', contact: 'Ellie Hart · VP Sales', fit: 94, readyAt: 2 },
  { company: 'Ledgerly', meta: 'Seed · 46 staff · hiring 2 SDRs', contact: 'Tom Byrne · Head of Growth', fit: 91, readyAt: 2 },
  { company: 'Harbour Analytics', meta: 'Series A · 120 staff · BDR team forming', contact: 'Priya Raman · CRO', fit: 88, readyAt: 3 },
  { company: 'Runpath', meta: 'Bootstrapped · 32 staff · first AE hire', contact: 'Daniel Weiss · Founder', fit: 85, readyAt: 3 },
  { company: 'Bramble', meta: 'Series A · 67 staff · 2 sales roles', contact: 'Sara Okonkwo · VP Revenue', fit: 82, readyAt: 3 },
];

const ProductLookalike = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    // Desktop only: below lg the section renders stacked at its final state.
    if (!window.matchMedia('(min-width: 1024px)').matches) { setState(3); return; }

    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        end: pinEnd(STORY_SCENES),
        pin: true,
        scrub: SCRUB,
        anticipatePin: 1,
        fastScrollEnd: true,
        onUpdate: (self) => {
          // Four states across the pin, with the last held a little longer so
          // the finished shortlist is readable before the pin releases.
          const p = self.progress;
          const next = p < 0.22 ? 0 : p < 0.46 ? 1 : p < 0.7 ? 2 : 3;
          setState((prev) => (prev === next ? prev : next));
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const wb = WORKBENCH_STATE[state];

  return (
    <section
      ref={sectionRef}
      id="demo-recruiting"
      className="relative w-full scroll-frame overflow-hidden font-display"
    >
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 h-full flex items-center">
        <div className="grid lg:grid-cols-[0.78fr_1.22fr] gap-8 lg:gap-12 w-full items-center">
          {/* ── Left: the message ─────────────────────────────────────────── */}
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/40 bg-transparent mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="font-mono text-[11px] uppercase tracking-[2px] text-emerald-400 font-semibold mt-px">
                One job you can hand over · Recruiting
              </span>
            </div>

            <h2 className="font-display font-black text-[clamp(1.9rem,3.4vw,3rem)] leading-[1.04] tracking-[-0.04em] text-white mb-4">
              From open role to<br />ranked shortlist.
            </h2>

            <p className="text-white/55 text-[15px] leading-[1.65] max-w-[440px]">
              Tell Agentory who you need. Your AI employees turn the request into a live workflow —
              researching, reviewing and updating the work in chat while the Workbench organises the
              results. You stay in control and decide who moves forward.
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-6">
              <EmployeeChip employee={PILOT} label="Workflow coordinator" />
              <EmployeeChip employee={LYRA} label="Research signals" />
              <EmployeeChip employee={ATLAS} label="Candidate intelligence" />
              <EmployeeChip employee={ORION} label="Review & decisions" />
            </div>

            {/* Where the reader is in the story. */}
            <div className="hidden lg:flex items-center gap-2 mt-8" aria-hidden="true">
              {WORKBENCH_STATE.map((_, i) => (
                <span
                  key={i}
                  className="h-[2px] rounded-full transition-all duration-500"
                  style={{
                    width: i === state ? 28 : 14,
                    background: i <= state ? 'rgba(52,211,153,0.8)' : 'rgba(255,255,255,0.12)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* ── Right: chat and Workbench, one story ──────────────────────── */}
          <div className="min-w-0">
            <div
              className="rounded-xl border border-white/[0.08] overflow-hidden"
              style={{ background: 'rgba(9,11,14,0.9)' }}
            >
              {/* Window chrome */}
              <div className="px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                </div>
                <span className="font-mono text-[11px] text-white/35">Agentory · Recruiting mission</span>
              </div>

              <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
                {/* Chat */}
                <div className="border-b lg:border-b-0 lg:border-r border-white/[0.06] p-4 flex flex-col lg:h-[580px]">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/30 mb-3 shrink-0">
                    Chat
                  </p>
                  <div className="flex-1 min-h-0 space-y-2.5 overflow-hidden">
                    {CHAT.map((m, i) => {
                      const shown = state >= m.at;
                      return (
                        <div
                          key={i}
                          className="transition-all duration-500"
                          style={{
                            opacity: shown ? 1 : 0,
                            transform: shown ? 'translateY(0)' : 'translateY(8px)',
                          }}
                        >
                          {m.from === null ? (
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
                              <p className="text-[10.5px] font-mono uppercase tracking-[0.1em] text-emerald-300/70 mb-1">You</p>
                              <p className="text-[12.5px] text-white/85 leading-snug">{m.text}</p>
                            </div>
                          ) : (
                            <div className="flex gap-2.5">
                              <AgentPortrait employee={m.from} size={24} className="mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-[11.5px] font-semibold leading-tight" style={{ color: m.from.accent }}>
                                  {m.from.name}
                                </p>
                                <p className="text-[12.5px] text-white/65 leading-snug mt-0.5">{m.text}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Workbench */}
                <div className="p-4 flex flex-col lg:h-[580px]">
                  <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/30">Workbench</p>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/45">
                      {state === 3 ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Loader2 className="w-3 h-3 text-white/35 animate-spin" />
                      )}
                      {wb.label}
                    </span>
                  </div>

                  {/* Counters move with the conversation. */}
                  <div className="grid grid-cols-3 gap-2 mb-3 shrink-0">
                    {[
                      ['Scanned', wb.scanned],
                      ['Qualified', wb.qualified],
                      ['Ready', wb.ready],
                    ].map(([label, value], i) => (
                      <div key={label as string} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
                        <div
                          className="text-[17px] font-display font-black tabular-nums transition-colors duration-500"
                          style={{ color: i === 2 && wb.ready > 0 ? '#34d399' : 'rgba(255,255,255,0.9)' }}
                        >
                          {value as number}
                        </div>
                        <div className="text-[10.5px] text-white/35 mt-0.5">{label as string}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex-1 min-h-0 space-y-2 overflow-hidden">
                    {state === 0 && (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-[12px] text-white/25">No results yet — the mission just opened.</p>
                      </div>
                    )}

                    {state === 1 &&
                      [0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 animate-pulse"
                          style={{ animationDelay: `${i * 120}ms` }}
                        >
                          <div className="h-2 w-1/2 rounded bg-white/[0.07]" />
                          <div className="h-2 w-2/3 rounded bg-white/[0.05] mt-1.5" />
                        </div>
                      ))}

                    {state >= 2 &&
                      ROWS.map((r) => {
                        const ready = state >= r.readyAt;
                        return (
                          <div
                            key={r.company}
                            className="rounded-lg border px-3 py-2 transition-all duration-500"
                            style={{
                              borderColor: ready ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.06)',
                              background: ready ? 'rgba(52,211,153,0.05)' : 'rgba(255,255,255,0.02)',
                              opacity: ready ? 1 : 0.5,
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[12.5px] text-white/90 truncate">{r.company}</span>
                              <span
                                className="text-[11px] font-mono tabular-nums shrink-0"
                                style={{ color: ready ? '#34d399' : 'rgba(255,255,255,0.3)' }}
                              >
                                {ready ? `${r.fit}%` : 'reviewing'}
                              </span>
                            </div>
                            <p className="text-[11px] text-white/35 truncate mt-0.5">{r.meta}</p>
                            {ready && <p className="text-[11px] text-white/50 truncate mt-0.5">{r.contact}</p>}
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProductLookalike;
export { ProductLookalike };

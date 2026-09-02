/**
 * HOW AGENTORY WORKS — one job, followed all the way through.
 *
 * The scrolling line is the memorable part of this section and is kept. What
 * changed is what it connects.
 *
 * It used to carry eleven timestamped entries of a working day, which bounced
 * between employees — Lisa, You, Lyra, You, Atlas, Atlas, Lisa, Lyra, You,
 * Lyra, Lisa. Every card was true, but nothing carried from one to the next,
 * so it read as an activity log rather than a story.
 *
 * It now follows a single job through the team and back:
 *
 *     YOU -> LISA -> ATLAS -> LYRA -> ORION -> YOU
 *
 * Each card names what that employee added and who they hand to, so the
 * handoff — not the job description — is the thing on screen. The line itself
 * fills as you scroll and each milestone lights as the light reaches it.
 */

import { useRef } from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { EMPLOYEE_BY_ID, type Employee } from './employees';
import { AgentPortrait } from './agentSystem';
import { SECTION_VIEWPORT } from './scrollSystem';

const LISA = EMPLOYEE_BY_ID.mira;
const ATLAS = EMPLOYEE_BY_ID.atlas;
const LYRA = EMPLOYEE_BY_ID.lyra;
const ORION = EMPLOYEE_BY_ID.orion;

interface Milestone {
  /** null for the founder's own steps at either end of the loop. */
  employee: Employee | null;
  who: string;
  role: string;
  /** What this step contributes, in one line. */
  did: string;
  /** The concrete thing that came out of it. */
  detail: string;
  /** Who picks the work up next. Absent on the final step. */
  passesTo?: string;
}

/**
 * Roles here follow the product roster rather than the brief's shorthand:
 * Atlas is Leads (he qualifies companies, which is the "research" step in the
 * story) and Orion is Executive Intelligence (the review and synthesis step).
 */
const MILESTONES: Milestone[] = [
  {
    employee: null,
    who: 'You',
    role: 'The job',
    did: 'Find companies worth talking to this week.',
    detail: 'One instruction. You do not pick the tools, the order, or who does what.',
    passesTo: 'Lisa',
  },
  {
    employee: LISA,
    who: LISA.name,
    role: 'Signals',
    did: 'Finds what changed.',
    detail: 'A competitor cut pricing 20%, and three companies on your list started hiring revenue roles.',
    passesTo: 'Atlas',
  },
  {
    employee: ATLAS,
    who: ATLAS.name,
    role: 'Leads',
    did: 'Turns the signal into opportunities.',
    detail: '1,842 companies checked against your ICP. Twelve are worth your time, ranked, with the evidence attached.',
    passesTo: 'Lyra',
  },
  {
    employee: LYRA,
    who: LYRA.name,
    role: 'Content',
    did: 'Turns what the team learned into something to send.',
    detail: 'Outreach drafted for the top three, each one referencing the signal that made them relevant.',
    passesTo: 'Orion',
  },
  {
    employee: ORION,
    who: ORION.name,
    role: 'Executive',
    did: 'Pulls the work together.',
    detail: 'One brief: what happened, why it matters, and the three things that actually need you.',
    passesTo: 'You',
  },
  {
    employee: null,
    who: 'You',
    role: 'The decision',
    did: 'Review. Approve. Move on.',
    detail: 'Forty-seven minutes of your day. Nothing leaves the building without your say-so.',
  },
];

const DayTimelineSection = () => {
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);

  // The travelling light. Starts filling once the track is well into view and
  // completes a little before it leaves, so the last milestone lights while it
  // is still comfortably on screen rather than at the very bottom edge.
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start 72%', 'end 62%'],
  });
  const fill = useSpring(scrollYProgress, { stiffness: 55, damping: 22, mass: 0.4 });

  return (
    <section id="day-timeline" className="relative z-10 py-24 md:py-32">
      <div className="max-w-[900px] mx-auto px-6">
        <div className="text-center mb-20">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">
            How Agentory works
          </span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            One job. Your AI team<br />takes it from there.
          </h2>
          <p className="text-white/45 text-lg max-w-[580px] mx-auto leading-relaxed">
            Agentory's employees share context, hand work to each other, and bring you back the
            result — without you moving between five different tools.
          </p>
        </div>

        <div ref={trackRef} className="relative">
          {/* The line, and the light that travels down it. */}
          <div className="absolute left-4 md:left-1/2 md:-translate-x-px top-2 bottom-2 w-px bg-white/[0.12]" aria-hidden="true">
            <motion.div
              className="absolute inset-x-0 top-0 h-full origin-top"
              style={{
                scaleY: fill,
                background: 'linear-gradient(180deg, rgba(52,211,153,0.45), rgba(52,211,153,0.9))',
                boxShadow: '0 0 10px rgba(52,211,153,0.35)',
              }}
            />
          </div>

          {MILESTONES.map((m, i) => {
            // Spacer renders first, so flex-row puts the card on the right.
            const cardRight = i % 2 === 1;
            const accent = m.employee?.accent ?? '#8ba3b8';
            return (
              <motion.div
                key={`${m.who}-${i}`}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                // Fires as the travelling light reaches this point, rather than
                // when the card merely enters the viewport.
                viewport={{ once: true, margin: '0px 0px -28% 0px' }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={`relative flex items-start mb-10 last:mb-0 md:gap-8 ${
                  cardRight ? 'md:flex-row' : 'md:flex-row-reverse'
                }`}
              >
                {/* Node on the line. */}
                <div className="absolute left-4 md:left-1/2 -translate-x-1/2 mt-6 z-10" aria-hidden="true">
                  <span
                    className="block w-2.5 h-2.5 rounded-full"
                    style={{ background: accent, boxShadow: `0 0 0 4px rgba(8,10,13,1), 0 0 14px ${accent}80` }}
                  />
                </div>

                {/* The empty half, so cards alternate around the line. */}
                <div className="hidden md:block md:w-[calc(50%-16px)]" />

                <div className="ml-12 md:ml-0 md:w-[calc(50%-16px)]">
                  <div
                    className="rounded-xl border border-white/[0.07] p-5"
                    style={{ background: 'rgba(255,255,255,0.022)' }}
                  >
                    <div className="flex items-center gap-2.5 mb-3">
                      {m.employee ? (
                        <AgentPortrait employee={m.employee} size={30} />
                      ) : (
                        <span className="w-[30px] h-[30px] rounded-full border border-white/15 bg-white/[0.05] flex items-center justify-center text-[11px] font-mono text-white/50">
                          You
                        </span>
                      )}
                      <span className="text-[15px] font-display font-black" style={{ color: accent }}>
                        {m.who}
                      </span>
                      <span className="text-[11px] font-mono uppercase tracking-[0.08em] text-white/35 px-2 py-0.5 rounded bg-white/[0.05]">
                        {m.role}
                      </span>
                    </div>

                    <p className="text-[15px] text-white/90 leading-snug">{m.did}</p>
                    <p className="text-[13px] text-white/45 leading-relaxed mt-2">{m.detail}</p>

                    {m.passesTo && (
                      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                        <ArrowRight className="w-3.5 h-3.5 text-white/25" />
                        <span className="text-[12.5px] text-white/40">
                          Hands to <span className="text-white/70">{m.passesTo}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* The loop closes on the founder, so the close is one line and a CTA
            rather than another panel of numbers. */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={SECTION_VIEWPORT}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mt-20"
        >
          <p className="text-white/45 text-base mb-7">
            You gave it one job. Four employees coordinated the rest.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]"
          >
            Give Agentory a job <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>
      </div>
    </section>
  );
};

export default DayTimelineSection;
export { DayTimelineSection };

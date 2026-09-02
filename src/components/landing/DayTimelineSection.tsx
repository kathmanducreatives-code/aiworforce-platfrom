/**
 * HOW AGENTORY WORKS — one company, one context, four employees.
 *
 * The section answers the objection that Agentory is four tools in a trench
 * coat. Four surfaces shown side by side would confirm that objection; one
 * record that four surfaces write into cannot.
 *
 * So the left column is a ledger for a single account that only ever grows —
 * signal, then why-now and fit, then the buyer, then the angle, then the
 * decision. It never resets. The right column is the product surface that
 * produced each new row, cross-fading as the reader descends. Every row is
 * stamped with the employee who added it, so the team appears as authorship
 * rather than as a cast lined up for a portrait.
 *
 * The travelling light is kept. It now runs down the ledger's own rail and is
 * what lights each row as it passes, so the interaction does structural work
 * instead of decorating.
 *
 * SURFACE COLOUR follows the real product rather than the landing page's
 * per-employee accents: signals is blue, leads green, content purple. The
 * final state goes neutral white because that step belongs to the founder.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useSpring, useMotionValueEvent } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { EMPLOYEE_BY_ID, type Employee } from './employees';
import { AgentPortrait } from './agentSystem';

const LISA = EMPLOYEE_BY_ID.mira;
const ATLAS = EMPLOYEE_BY_ID.atlas;
const LYRA = EMPLOYEE_BY_ID.lyra;
const ORION = EMPLOYEE_BY_ID.orion;

/** The account that travels the whole way through. */
const ACCOUNT = { name: 'Metaview', domain: 'metaview.ai', initial: 'M' };

type SurfaceKey = 'signals' | 'leads' | 'content' | 'review';

const SURFACE_ACCENT: Record<SurfaceKey, string> = {
  signals: '#3B82F6',
  leads: '#10B981',
  content: '#A855F7',
  review: '#E2E8F0',
};

interface LedgerRow {
  key: string;
  /** Column name, in the product's own vocabulary. */
  field: string;
  value: string;
  /** Who wrote this row. */
  by: Employee;
  surface: SurfaceKey;
}

const LEDGER: LedgerRow[] = [
  { key: 'signal', field: 'Signal', value: 'Posted 4 revenue roles in 14 days', by: LISA, surface: 'signals' },
  { key: 'whynow', field: 'Why now', value: 'Hiring velocity up three weeks running', by: ATLAS, surface: 'leads' },
  { key: 'fit', field: 'Fit', value: 'Strong · 91% against your ICP', by: ATLAS, surface: 'leads' },
  { key: 'buyer', field: 'Buyer', value: 'Priya Raman · Head of Talent', by: ATLAS, surface: 'leads' },
  { key: 'angle', field: 'Angle', value: '"Founder POV grounded in this signal"', by: LYRA, surface: 'content' },
  { key: 'action', field: 'Action', value: 'Draft ready — needs your call', by: ORION, surface: 'review' },
];

/* ────────────────────────────────────────────────────── product surfaces ── */

function SurfaceChrome({
  eyebrow, title, agent, accent, children,
}: {
  eyebrow: string; title: string; agent: Employee; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] mb-1.5" style={{ color: accent }}>
            {eyebrow}
          </p>
          <h4 className="font-display font-black text-[22px] text-white leading-none">{title}</h4>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] pl-1.5 pr-2.5 py-1.5 shrink-0">
          <AgentPortrait employee={agent} size={22} />
          <div className="leading-tight">
            <p className="text-[11.5px] font-semibold" style={{ color: agent.accent }}>{agent.name}</p>
            <p className="text-[10px] text-white/35">On duty</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The product's signature inline `N label` strip. */
function StatStrip({ stats, accent }: { stats: [string, string][]; accent: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 mb-3">
      {stats.map(([n, label], i) => (
        <span key={label} className="inline-flex items-baseline gap-1.5">
          <span
            className="font-display font-black text-[17px] tabular-nums"
            style={{ color: i === 0 ? accent : 'rgba(255,255,255,0.9)' }}
          >
            {n}
          </span>
          <span className="text-[11px] text-white/40">{label}</span>
        </span>
      ))}
    </div>
  );
}

function TabRow({ tabs, accent }: { tabs: string[]; accent: string }) {
  return (
    <div className="flex items-center gap-5 border-b border-white/[0.07] mb-3">
      {tabs.map((t, i) => (
        <span
          key={t}
          className="text-[12px] pb-2 -mb-px"
          style={
            i === 0
              ? { color: accent, borderBottom: `1px solid ${accent}` }
              : { color: 'rgba(255,255,255,0.35)' }
          }
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function SignalsSurface() {
  const a = SURFACE_ACCENT.signals;
  return (
    <SurfaceChrome eyebrow="Growth · Signals" title="Company Brain Radar" agent={LISA} accent={a}>
      <StatStrip stats={[['1', 'verified signals'], ['4', 'hiring'], ['5', 'competitor'], ['0', 'reviewed']]} accent={a} />
      <TabRow tabs={['Today', 'Hiring', 'Competitors', 'Other']} accent={a} />
      <div className="rounded-lg border px-3.5 py-3" style={{ borderColor: `${a}33`, background: `${a}0d` }}>
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]" style={{ color: a }}>
            Today's signal brief
          </span>
          <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded" style={{ color: a, background: `${a}1f` }}>
            Verified
          </span>
        </div>
        <p className="text-[14px] text-white/90 leading-snug">
          {ACCOUNT.name} posted 4 revenue roles
        </p>
        <p className="text-[12px] text-white/40 mt-1">Job boards · detected 06:12 · matches your ICP</p>
      </div>
      <div className="mt-2 space-y-2">
        {[['Ashby', 'Cut starter pricing 20%'], ['Personio', 'Opened 14 sales roles']].map(([who, what]) => (
          <div key={who} className="flex items-baseline justify-between gap-3 px-3.5 py-2 rounded-lg border border-white/[0.06] bg-white/[0.015]">
            <span className="text-[12px] text-white/45 shrink-0">{who}</span>
            <span className="text-[12.5px] text-white/60 truncate">{what}</span>
          </div>
        ))}
      </div>
    </SurfaceChrome>
  );
}

function LeadsSurface({ step }: { step: number }) {
  const a = SURFACE_ACCENT.leads;
  // The row fills in as Atlas works it: fit resolves, then the buyer lands.
  const hasFit = step >= 2;
  const hasBuyer = step >= 3;
  return (
    <SurfaceChrome eyebrow="Lead operations" title="Lead Library" agent={ATLAS} accent={a}>
      <StatStrip
        stats={[[hasFit ? '1' : '0', 'qualified'], ['39', 'all leads'], [hasBuyer ? '1' : '0', 'buyer found'], ['0', 'contacted']]}
        accent={a}
      />
      <div className="grid grid-cols-[1.3fr_1fr_0.9fr] gap-3 px-1 pb-2 border-b border-white/[0.07]">
        {['Account', 'Why now', 'Fit'].map((h) => (
          <span key={h} className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">{h}</span>
        ))}
      </div>
      <div className="grid grid-cols-[1.3fr_1fr_0.9fr] gap-3 items-center px-1 py-3 border-b border-white/[0.05]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-md bg-white/[0.06] flex items-center justify-center text-[11px] text-white/60 shrink-0">
            {ACCOUNT.initial}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] text-white/90 truncate">{ACCOUNT.name}</p>
            <p className="text-[11px] text-white/30 truncate">{ACCOUNT.domain}</p>
          </div>
        </div>
        <span className="text-[12px] text-white/60 leading-snug">
          {hasFit ? 'Hiring velocity ↑' : 'Checking…'}
        </span>
        <span className="text-[12.5px] font-semibold" style={{ color: hasFit ? a : 'rgba(255,255,255,0.28)' }}>
          {hasFit ? 'Strong · 91%' : 'Unknown'}
        </span>
      </div>
      {/* The rest of the book, so the surface reads as a list. */}
      {[['Northwind Cloud', 'northwind.io'], ['Ledgerly', 'ledgerly.com']].map(([n, d]) => (
        <div key={n} className="grid grid-cols-[1.3fr_1fr_0.9fr] gap-3 items-center px-1 py-2.5 border-b border-white/[0.04] opacity-40">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded-md bg-white/[0.05] flex items-center justify-center text-[11px] text-white/40 shrink-0">{n[0]}</span>
            <div className="min-w-0">
              <p className="text-[13px] text-white/70 truncate">{n}</p>
              <p className="text-[11px] text-white/25 truncate">{d}</p>
            </div>
          </div>
          <span className="text-[12px] text-white/35">In review</span>
          <span className="text-[12.5px] text-white/25">—</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 pt-3">
        <span
          className="text-[11px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded"
          style={
            hasFit
              ? { color: a, background: `${a}1f` }
              : { color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)' }
          }
        >
          {hasFit ? 'Qualified' : 'Needs review'}
        </span>
        <span className="text-[12px] text-white/50">
          {hasBuyer ? 'Priya Raman · Head of Talent' : 'Finding decision-maker…'}
        </span>
      </div>
    </SurfaceChrome>
  );
}

function ContentSurface() {
  const a = SURFACE_ACCENT.content;
  return (
    <SurfaceChrome eyebrow="LinkedIn growth desk" title="Content" agent={LYRA} accent={a}>
      <StatStrip stats={[['1', 'drafts ready'], ['10', 'trends ranked'], ['1', 'awaiting review']]} accent={a} />
      <TabRow tabs={['For you', 'Top 10 trends', 'Plan & drafts']} accent={a} />
      <div className="rounded-lg border px-3.5 py-3" style={{ borderColor: `${a}33`, background: `${a}0d` }}>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: a }}>
          Founder insight · text post
        </p>
        <p className="text-[14px] text-white/90 leading-snug mb-2">"Founder POV grounded in this signal"</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2.5">
          {[['ICP match', 'Strong'], ['Pain relevance', 'High']].map(([k, v]) => (
            <span key={k} className="text-[11.5px] text-white/40">
              {k}: <span style={{ color: a }}>{v}</span>
            </span>
          ))}
        </div>
        {/* The product already ships the handoff as one line. It is the whole
            argument of this section, so it is quoted rather than invented. */}
        <p className="text-[11.5px] text-white/35 leading-snug border-t border-white/[0.07] pt-2.5">
          {LISA.name} found the signal · {ATLAS.name} ranked its relevance · {LYRA.name} created the angle
        </p>
      </div>
    </SurfaceChrome>
  );
}

function ReviewSurface() {
  const a = SURFACE_ACCENT.review;
  return (
    <SurfaceChrome eyebrow="Executive · review" title="Needs your call" agent={ORION} accent={a}>
      <StatStrip stats={[['1', 'needs you'], ['48', 'signals read'], ['0', 'research hours']]} accent={a} />
      <div className="rounded-lg border border-white/[0.09] bg-white/[0.03] px-3.5 py-3 mb-2.5">
        <p className="text-[14px] text-white/90 leading-snug mb-1">
          {ACCOUNT.name} is hiring, qualified, and has a draft waiting.
        </p>
        <p className="text-[12px] text-white/40 leading-snug">
          One account moved from signal to shortlist without you opening a second tool.
        </p>
      </div>
      <div className="space-y-1.5">
        {['Approve the draft and send from your inbox', 'Or change the angle and Lyra redrafts', 'Everything else stays in the queue until you look'].map((t) => (
          <div key={t} className="flex items-start gap-2">
            <span className="text-[12.5px] text-white/30 mt-px shrink-0">→</span>
            <span className="text-[13px] text-white/70 leading-snug">{t}</span>
          </div>
        ))}
      </div>
    </SurfaceChrome>
  );
}

/* ─────────────────────────────────────────────────────────────── section ── */

const DayTimelineSection = () => {
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  // Below lg the track collapses, so scroll progress would rush all six rows
  // in a few hundred pixels. There the record simply shows complete.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => { setIsDesktop(mq.matches); if (!mq.matches) setStep(LEDGER.length - 1); };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const fill = useSpring(scrollYProgress, { stiffness: 60, damping: 24, mass: 0.4 });

  // One ledger row per band of the track.
  useMotionValueEvent(fill, 'change', (v) => {
    if (!isDesktop) return;
    const next = Math.min(LEDGER.length - 1, Math.floor(v * LEDGER.length));
    setStep((prev) => (prev === next ? prev : next));
  });

  const surface = LEDGER[step].surface;

  return (
    <section id="day-timeline" className="relative z-10">
      <div className="max-w-[1100px] mx-auto px-6 pt-20 md:pt-24">
        <div className="text-center mb-8">
          <span className="font-mono text-xs uppercase tracking-[0.15em] text-emerald-400 mb-4 block">
            How Agentory works
          </span>
          <h2 className="font-display font-black text-3xl md:text-5xl text-white leading-[1.1] mb-6">
            One company. One context.<br />Four employees.
          </h2>
          <p className="text-white/45 text-lg max-w-[600px] mx-auto leading-relaxed">
            A signal makes a company worth looking at. The same context qualifies it, finds the buyer,
            gives you the angle — and lands on your desk as one decision.
          </p>
        </div>
      </div>

      {/* Tall track: both columns stick while the light descends. */}
      <div ref={trackRef} className="relative h-auto lg:h-[var(--track)]" style={{ ["--track" as string]: `${LEDGER.length * 62}vh` }}>
        <div className="lg:sticky lg:top-0 lg:scroll-frame flex items-center py-10 lg:py-0">
          <div className="max-w-[1100px] mx-auto px-6 w-full">
            <div className="grid lg:grid-cols-[0.86fr_1.14fr] gap-6 lg:gap-10 items-stretch">
              {/* ── The ledger: grows, never resets ────────────────────── */}
              <div
                className="rounded-xl border border-white/[0.08] p-5"
                style={{ background: 'rgba(9,11,14,0.72)' }}
              >
                <div className="flex items-center gap-2.5 pb-4 mb-1 border-b border-white/[0.07]">
                  <span className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-[13px] text-white/70">
                    {ACCOUNT.initial}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-display font-black text-white leading-none">{ACCOUNT.name}</p>
                    <p className="text-[11.5px] text-white/35 mt-1">{ACCOUNT.domain}</p>
                  </div>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-white/25">
                    Company record
                  </span>
                </div>

                {/* The rail, and the light that runs down it. */}
                <div className="relative pl-6 pt-3">
                  <div className="absolute left-[5px] top-4 bottom-2 w-px bg-white/[0.1]" aria-hidden="true">
                    <motion.div
                      className="absolute inset-x-0 top-0 h-full origin-top"
                      style={{
                        scaleY: fill,
                        background: 'linear-gradient(180deg, rgba(52,211,153,0.5), rgba(52,211,153,0.95))',
                        boxShadow: '0 0 12px rgba(52,211,153,0.5)',
                      }}
                    />
                  </div>

                  {LEDGER.map((row, i) => {
                    const on = i <= step;
                    return (
                      <div
                        key={row.key}
                        className="relative py-2.5 transition-all duration-500"
                        style={{ opacity: on ? 1 : 0.22, transform: on ? 'none' : 'translateY(4px)' }}
                      >
                        <span
                          className="absolute -left-6 top-[15px] w-[11px] h-[11px] rounded-full transition-all duration-500"
                          style={{
                            background: on ? SURFACE_ACCENT[row.surface] : 'rgba(255,255,255,0.16)',
                            boxShadow: on ? `0 0 0 3px rgba(9,11,14,1), 0 0 12px ${SURFACE_ACCENT[row.surface]}99` : '0 0 0 3px rgba(9,11,14,1)',
                          }}
                          aria-hidden="true"
                        />
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/35">
                            {row.field}
                          </span>
                          {on && (
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                              <AgentPortrait employee={row.by} size={16} />
                              <span className="text-[11px]" style={{ color: row.by.accent }}>{row.by.name}</span>
                            </span>
                          )}
                        </div>
                        {on ? (
                          <p className="text-[14px] text-white/90 leading-snug mt-1">{row.value}</p>
                        ) : (
                          <div className="h-[7px] rounded-full bg-white/[0.06] mt-2.5" style={{ width: `${58 + ((i * 13) % 30)}%` }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── The surface that wrote the newest row ───────────────── */}
              <div
                className="rounded-xl border border-white/[0.08] p-5 min-h-[380px]"
                style={{ background: 'rgba(9,11,14,0.72)' }}
              >
                <motion.div
                  key={surface}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full"
                >
                  {surface === 'signals' && <SignalsSurface />}
                  {surface === 'leads' && <LeadsSurface step={step} />}
                  {surface === 'content' && <ContentSurface />}
                  {surface === 'review' && <ReviewSurface />}
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 pb-24 md:pb-32 text-center">
        <p className="text-white/45 text-base mb-7">
          One record. Four employees wrote it. You made one decision.
        </p>
        <button
          onClick={() => navigate('/auth')}
          className="conic-border group h-[44px] inline-flex items-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[15px] px-8 rounded-full transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_8px_40px_rgba(5,150,105,0.4)]"
        >
          Give Agentory a job <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </section>
  );
};

export default DayTimelineSection;
export { DayTimelineSection };

/**
 * THE AI WORKFORCE SEQUENCE.
 *
 * The scroll mechanic is unchanged: a tall track, a sticky 100vh viewport, and
 * a scrubbed GSAP timeline fading and scaling each `.sequence-stage` through a
 * glass `.sequence-card`.
 *
 *   1  LISA    watches the outside world          monitoring network
 *   2  ATLAS   finds who is worth talking to      prospect radar
 *   3  LYRA    turns intelligence into content    content engine
 *   4  ORION   says what deserves attention       executive brief
 *   5  the workforce, as one hierarchy
 *
 * The dedicated shared-memory stage is gone. Collaboration is already carried
 * by Orion's brief (which cites each agent) and by the final hierarchy, so a
 * whole stage restating it only slowed the sequence down. Shared context now
 * lives in one line of copy rather than as a standalone architectural concept.
 *
 * Every right panel uses the same `AgentPanel` frame — status bar, main
 * visualisation, four metrics — so only the middle differs between agents.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EMPLOYEE_BY_ID, SPECIALISTS, ORION, type Employee } from './employees';
import {
  AGENT_SYSTEM_STYLES,
  AgentPanel,
  AgentPortrait,
  AgentIdentity,
  AgentStatus,
  DepartmentBadge,
  CapabilityChip,
  DataSource,
  DataFlow,
  IntelligenceEvent,
  MetricCard,
  OutputCard,
  ActionRecommendation,
} from './agentSystem';

gsap.registerPlugin(ScrollTrigger);

const LISA = EMPLOYEE_BY_ID.mira;
const ATLAS = EMPLOYEE_BY_ID.atlas;
const LYRA = EMPLOYEE_BY_ID.lyra;

const STAGES = 5;

const STYLES = `
#hero-to-expert-sequence {
  position: relative;
  height: ${STAGES * 100 + 100}vh;
  background: transparent;
}
#hero-to-expert-sequence .sequence-viewport {
  position: sticky; top: 0; height: 100vh; perspective: 1500px; overflow: hidden;
}
#hero-to-expert-sequence .blueprint-grid {
  position: absolute; inset: 0; z-index: 0; opacity: 0.2;
  background:
    radial-gradient(circle at 20% 18%, rgba(0,255,150,0.2), transparent 44%),
    radial-gradient(circle at 82% 22%, rgba(0,255,150,0.15), transparent 42%),
    linear-gradient(rgba(0,255,150,0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,255,150,0.18) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 68px 68px, 68px 68px;
}
#hero-to-expert-sequence .sequence-stage {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: scale(0.9); z-index: 2; will-change: transform, opacity; transform-style: preserve-3d;
}
#hero-to-expert-sequence .sequence-card {
  width: min(1160px, 94vw); height: min(80vh, 704px); border-radius: 24px;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(0,255,150,0.2);
  box-shadow: 0 0 40px rgba(0,255,150,0.15); overflow: hidden;
  display: grid; grid-template-columns: 0.82fr 1.18fr;
  transform-style: preserve-3d; will-change: transform, opacity;
}
/* One vertical rhythm for every left column, so the cards feel machined. */
#hero-to-expert-sequence .sequence-content {
  padding: 34px 30px; border-right: 1px solid rgba(0,255,150,0.14);
  display: flex; flex-direction: column; justify-content: center; gap: 0;
  min-width: 0; min-height: 0; overflow: hidden;
}
#hero-to-expert-sequence .seq-ident { display: flex; align-items: center; gap: 14px; }
#hero-to-expert-sequence .seq-label {
  font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #4ade80;
}
#hero-to-expert-sequence .seq-chips { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
#hero-to-expert-sequence .seq-title {
  margin-top: 22px; font-size: clamp(1.55rem, 2.5vw, 2.3rem); line-height: 1.06;
  letter-spacing: -0.035em; color: #fff; font-weight: 900;
}
#hero-to-expert-sequence .seq-copy {
  margin-top: 16px; color: rgba(255,255,255,0.68); line-height: 1.62; font-size: 14.5px;
}
#hero-to-expert-sequence .seq-caps { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 8px; }
#hero-to-expert-sequence .sequence-ui {
  padding: 24px; display: flex; align-items: stretch; min-width: 0; min-height: 0; overflow: hidden;
}
@media (max-width: 1024px) {
  #hero-to-expert-sequence .sequence-card { grid-template-columns: 1fr; height: min(86vh, 780px); }
  #hero-to-expert-sequence .sequence-content { border-right: 0; border-bottom: 1px solid rgba(0,255,150,0.14); padding: 22px; }
  #hero-to-expert-sequence .sequence-ui { padding: 16px; }
  /* Diagrams drop rather than shrink into illegibility. */
  #hero-to-expert-sequence .hide-sm { display: none !important; }
}
`;

/* ────────────────────────────────────────────────────── stage 1 · LISA ── */

const WATCHED = ['Ashby', 'Greenhouse', 'Lever', 'Workable', 'Personio', 'G2'];

function LisaPanel() {
  return (
    <AgentPanel
      title="Monitoring network"
      status={<AgentStatus employee={LISA} label="Scanning 48 sources" />}
      metrics={
        <>
          <MetricCard value="48" label="Sources" accent={LISA.accent} />
          <MetricCard value="327" label="Companies" accent={LISA.accent} />
          <MetricCard value="18" label="Changes" accent={LISA.accent} />
          <MetricCard value="4" label="Worth knowing" accent={LISA.accent} primary />
        </>
      }
    >
      <div className="flex-1 min-h-0 flex items-center gap-3">
        {/* What she watches */}
        <div className="w-[124px] shrink-0 h-full flex flex-col">
          <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mb-2.5 shrink-0">Sources</p>
          <div className="flex-1 flex flex-col justify-center gap-2.5">
            {WATCHED.map((label) => (
              <div key={label} className="rounded-md border border-white/[0.1] bg-white/[0.05] px-2.5 py-2">
                <span className="text-[13px] text-white/80 truncate block">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <svg className="w-[58px] h-full shrink-0 hide-sm" viewBox="0 0 58 260" preserveAspectRatio="none" aria-hidden="true">
          {[22, 65, 108, 151, 194, 237].map((y, i) => (
            <DataFlow key={y} x1={0} y1={y} x2={54} y2={130} accent={LISA.accent} delay={i * 0.34} />
          ))}
        </svg>

        <AgentPortrait employee={LISA} size={88} className="shrink-0" />

        <svg className="w-[34px] h-full shrink-0 hide-sm" viewBox="0 0 34 260" preserveAspectRatio="none" aria-hidden="true">
          {[62, 130, 198].map((y, i) => (
            <DataFlow key={y} x1={2} y1={130} x2={34} y2={y} accent={LISA.accent} delay={0.4 + i * 0.4} />
          ))}
        </svg>

        {/* What survives the filter */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mb-2.5 shrink-0">Worth knowing</p>
          <div className="flex-1 flex flex-col justify-center gap-3">
            <IntelligenceEvent source="Ashby" headline="Pricing dropped 20%" tag="Urgent" tone="urgent" />
            <IntelligenceEvent source="Greenhouse" headline="+6 engineering hires" tag="Hiring" tone="opportunity" />
            <IntelligenceEvent source="Personio" headline="Opened 14 sales roles" tag="Growth" tone="opportunity" />
          </div>
        </div>
      </div>
    </AgentPanel>
  );
}

/* ───────────────────────────────────────────────────── stage 2 · ATLAS ── */

/**
 * Deterministic phyllotaxis scatter. Fewer, larger dots than before — the
 * earlier 84-node field read as noise rather than as a market.
 */
const FIELD = Array.from({ length: 54 }, (_, i) => {
  const a = i * 2.399963;
  const r = Math.sqrt(i / 54);
  return { x: 50 + Math.cos(a) * r * 43, y: 50 + Math.sin(a) * r * 43, keep: i % 5 === 0, hot: i % 17 === 0 };
});

function AtlasPanel() {
  return (
    <AgentPanel
      title="Prospect radar"
      status={<AgentStatus employee={ATLAS} label="Analysing 842 / 1,842" />}
      metrics={
        <>
          <MetricCard value="1,842" label="Scanned" accent={ATLAS.accent} />
          <MetricCard value="327" label="Match ICP" accent={ATLAS.accent} />
          <MetricCard value="84" label="Enriched" accent={ATLAS.accent} />
          <MetricCard value="12" label="High priority" accent={ATLAS.accent} primary />
        </>
      }
    >
      <div className="flex-1 min-h-0 flex gap-5 items-center">
        {/* The radar is the hero. The funnel that used to sit here duplicated
            the metric row exactly, so it is gone. */}
        <div className="relative flex-1 min-w-0 h-full flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="h-full max-h-[330px] aspect-square" aria-hidden="true">
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" />
            <circle cx="50" cy="50" r="29" fill="none" stroke="rgba(255,255,255,0.07)" />
            <circle cx="50" cy="50" r="14" fill="none" stroke={`${ATLAS.accent}45`} />
            {FIELD.map((d, i) => (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={d.hot ? 2.6 : d.keep ? 1.7 : 1.05}
                fill={d.hot ? ATLAS.accent : d.keep ? `${ATLAS.accent}99` : 'rgba(255,255,255,0.22)'}
              />
            ))}
            <g className="atlas-sweep" style={{ transformOrigin: '50px 50px' }}>
              <path d="M50 50 L50 6 A44 44 0 0 1 81 19 Z" fill={`${ATLAS.accent}16`} />
              <line x1="50" y1="50" x2="50" y2="6" stroke={ATLAS.accent} strokeWidth="0.7" strokeOpacity="0.7" />
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-display font-black text-[30px] leading-none text-white/95 tabular-nums">1,842</span>
            <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mt-1.5">companies</span>
          </div>
        </div>

        {/* The account that survives the scan, large enough to actually read. */}
        <div className="w-[236px] shrink-0 h-full flex flex-col justify-center">
          <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mb-2.5 shrink-0">Top opportunity</p>
          <div
            className="rounded-xl border p-3.5"
            style={{ borderColor: `${ATLAS.accent}40`, background: `linear-gradient(180deg, ${ATLAS.accent}16, rgba(255,255,255,0.02))` }}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[16px] font-display font-black text-white">Acme AI</span>
              <span
                className="text-[11px] font-mono px-2 py-[3px] rounded shrink-0"
                style={{ color: ATLAS.accent, background: `${ATLAS.accent}24` }}
              >
                94% MATCH
              </span>
            </div>
            <div className="space-y-1.5">
              {[
                ['Funding', 'Series A'],
                ['Hiring', '+14 employees'],
                ['Signal', 'New Head of Sales'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-[12px] text-white/45">{k}</span>
                  <span className="text-[13px] text-white/85 truncate">{v}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-white/[0.1] mt-3 pt-2.5">
              <p className="text-[13.5px] text-white/90">Sarah Chen</p>
              <p className="text-[12px] text-white/45 mt-0.5">VP Growth · decision maker</p>
            </div>
          </div>
        </div>
      </div>
    </AgentPanel>
  );
}

/* ────────────────────────────────────────────────────── stage 3 · LYRA ── */

const LYRA_INPUTS = [
  { kind: 'Signal', label: 'Competitor cut pricing 20%' },
  { kind: 'Customer', label: 'Screening forms take too long' },
  { kind: 'Founder', label: 'AI should reduce admin' },
  { kind: 'Library', label: '38 previous posts' },
];

const LYRA_OUTPUTS = [
  { k: 'LinkedIn', t: 'Recruiters do not need more AI tools' },
  { k: 'Carousel', t: '5 recruiting tasks AI should own' },
  { k: 'Blog', t: 'The new AI recruiting stack' },
  { k: 'Newsletter', t: '3 changes in recruiting this week' },
];

function LyraPanel() {
  return (
    <AgentPanel
      title="Content engine"
      status={<AgentStatus employee={LYRA} label="Draft 3 of 4 generating" />}
      metrics={
        <>
          <MetricCard value="12" label="Ideas found" accent={LYRA.accent} />
          <MetricCard value="3" label="Formats" accent={LYRA.accent} />
          <MetricCard value="1h" label="Time saved" accent={LYRA.accent} />
          <MetricCard value="4" label="Drafts ready" accent={LYRA.accent} primary />
        </>
      }
    >
      <div className="flex-1 min-h-0 flex items-center gap-2">
        <div className="w-[168px] shrink-0 h-full flex flex-col">
          <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mb-2.5 shrink-0">Knows</p>
          <div className="flex-1 flex flex-col justify-center gap-2.5">
            {LYRA_INPUTS.map((s) => <DataSource key={s.kind} kind={s.kind} label={s.label} accent={LYRA.accent} />)}
          </div>
        </div>

        <svg className="w-[42px] h-full shrink-0 hide-sm" viewBox="0 0 42 260" preserveAspectRatio="none" aria-hidden="true">
          {[32, 97, 162, 227].map((y, i) => (
            <DataFlow key={y} x1={0} y1={y} x2={38} y2={130} accent={LYRA.accent} delay={i * 0.4} />
          ))}
        </svg>

        <AgentPortrait employee={LYRA} size={80} className="shrink-0" />

        <svg className="w-[42px] h-full shrink-0 hide-sm" viewBox="0 0 42 260" preserveAspectRatio="none" aria-hidden="true">
          {[32, 97, 162, 227].map((y, i) => (
            <DataFlow key={y} x1={4} y1={130} x2={42} y2={y} accent={LYRA.accent} delay={0.2 + i * 0.4} />
          ))}
        </svg>

        <div className="flex-1 min-w-0 h-full flex flex-col">
          <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mb-2.5 shrink-0">Publishes</p>
          <div className="flex-1 flex flex-col justify-center gap-2.5">
            {LYRA_OUTPUTS.map((o) => <OutputCard key={o.k} kind={o.k} title={o.t} accent={LYRA.accent} />)}
          </div>
        </div>
      </div>
    </AgentPanel>
  );
}

/* ───────────────────────────────────────────────────── stage 4 · ORION ── */

const FEEDS: Record<string, string> = { signals: '4 signals', leads: '7 leads', content: '3 drafts' };

function OrionPanel() {
  return (
    <AgentPanel
      title="Executive brief · 07:00"
      status={<AgentStatus employee={ORION} label="Ready" />}
      metrics={
        <>
          <MetricCard value="48" label="Signals read" accent={ORION.accent} />
          <MetricCard value="3min" label="Reading time" accent={ORION.accent} />
          <MetricCard value="0" label="Research hours" accent={ORION.accent} />
          <MetricCard value="3" label="Need you" accent={ORION.accent} primary />
        </>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {/* The specialists feed the brief from above so they support it rather
            than compete with it for the panel's width. */}
        <div className="flex items-center gap-4 shrink-0">
          {SPECIALISTS.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <AgentPortrait employee={e} size={30} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight" style={{ color: e.accent }}>{e.name}</p>
                <p className="text-[11.5px] text-white/45 leading-tight">{FEEDS[e.discipline]}</p>
              </div>
            </div>
          ))}
          <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent hide-sm" />
        </div>

        {/* The brief itself, taking the space it deserves. */}
        <div className="flex-1 min-h-0 rounded-xl border border-white/[0.1] bg-white/[0.025] p-4 flex flex-col">
          <div className="flex items-baseline justify-between gap-3 mb-3 shrink-0">
            <span className="text-[15px] font-display font-black text-white">Good morning</span>
            <span className="text-[12px] text-white/45">3 things deserve your attention</span>
          </div>

          <div className="space-y-2 flex-1 min-h-0">
            <IntelligenceEvent
              source="01 · Lisa · Signals" tag="Competitor" tone="urgent"
              headline="Ashby cut pricing 20%."
              detail="Pressure may increase across SMB accounts."
            />
            <IntelligenceEvent
              source="02 · Atlas · Leads" tag="Pipeline" tone="opportunity"
              headline="7 high-fit accounts became active."
              detail="3 are currently hiring recruiting leaders."
            />
            <IntelligenceEvent
              source="03 · Lyra · Content" tag="Content"
              headline="Your pricing POV is ready."
              detail="Drafted from today's competitor signal."
            />
          </div>

          <div className="border-t border-white/[0.1] mt-3 pt-3 shrink-0">
            <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/45 mb-2">Today</p>
            <div className="space-y-1.5">
              <ActionRecommendation text="Contact 3 priority accounts" />
              <ActionRecommendation text="Publish the pricing POV" />
              <ActionRecommendation text="Review competitive positioning" />
            </div>
          </div>
        </div>
      </div>
    </AgentPanel>
  );
}

/* ────────────────────────────────────────────── stage 5 · ARCHITECTURE ── */

function WorkforceDiagram() {
  return (
    <AgentPanel title="Your AI workforce" status={<span className="text-[12px] text-white/45">Reporting to you</span>}>
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-1">
        <span className="text-[12px] font-mono uppercase tracking-[0.16em] text-white/45">You</span>
        <div className="w-px h-6 bg-gradient-to-b from-white/10 to-white/30" />

        <div className="flex flex-col items-center gap-2">
          <AgentPortrait employee={ORION} size={84} />
          <AgentIdentity employee={ORION} size="md" />
          <AgentStatus employee={ORION} />
        </div>

        <svg className="w-full max-w-[560px] h-[54px] hide-sm" viewBox="0 0 560 54" aria-hidden="true">
          {[95, 280, 465].map((x, i) => (
            <DataFlow key={x} x1={280} y1={2} x2={x} y2={52} accent={SPECIALISTS[i].accent} delay={i * 0.45} />
          ))}
        </svg>

        <div className="grid grid-cols-3 gap-4 sm:gap-10 w-full max-w-[560px]">
          {SPECIALISTS.map((e) => (
            <div key={e.id} className="flex flex-col items-center gap-2 text-center">
              <AgentPortrait employee={e} size={68} />
              <AgentIdentity employee={e} size="sm" />
              <AgentStatus employee={e} />
            </div>
          ))}
        </div>

        {/* Shared context, stated rather than diagrammed. */}
        <p className="text-[12px] font-mono uppercase tracking-[0.16em] text-white/40 mt-6">
          One company context · four specialists
        </p>
      </div>
    </AgentPanel>
  );
}

/* ────────────────────────────────────────────────────────────── SECTION ── */

interface StageDef {
  key: string;
  employee: Employee | null;
  label: string;
  title: ReactNode;
  copy: string;
  capabilities?: readonly string[];
  panel: ReactNode;
}

export const ExpertJourney = () => {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const ctx = gsap.context(() => {
      const stages = gsap.utils.toArray<HTMLElement>('#hero-to-expert-sequence .sequence-stage');
      gsap.set(stages, { opacity: 0, scale: 0.9, y: 80, rotateX: 0, transformOrigin: 'center center' });
      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section, start: 'top top', end: `+=${STAGES * 100}%`, scrub: 1.2, pin: true, anticipatePin: 1,
        },
      });
      for (let i = 1; i <= STAGES; i++) {
        tl.to(`.stage-${i}`, { opacity: 1, scale: 1, y: 0, duration: 0.75 });
        if (i < STAGES) {
          tl.to(`.stage-${i}`, { rotateX: -15, scale: 0.85, y: -100, opacity: 0, duration: 0.7 });
        } else {
          tl.to(`.stage-${i}`, { boxShadow: '0 0 60px rgba(0,255,150,0.22)', duration: 0.6 });
        }
      }
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const stages: StageDef[] = [
    {
      key: 'lisa',
      employee: LISA,
      label: `${LISA.name} · Signal Intelligence`,
      title: <>Know what changed<br />before anyone tells you.</>,
      copy: 'Lisa watches the companies and markets that matter to you, and finds the meaningful changes before anyone has time to research them by hand.',
      capabilities: LISA.capabilities.slice(0, 6),
      panel: <LisaPanel />,
    },
    {
      key: 'atlas',
      employee: ATLAS,
      label: `${ATLAS.name} · Lead Intelligence`,
      title: <>Find the companies worth<br />talking to first.</>,
      copy: 'Atlas searches the market continuously, matches companies against your ICP, enriches them, and surfaces the accounts most likely to matter.',
      capabilities: ATLAS.capabilities.slice(0, 6),
      panel: <AtlasPanel />,
    },
    {
      key: 'lyra',
      employee: LYRA,
      label: `${LYRA.name} · Content Intelligence`,
      title: <>Turn what your company knows<br />into content worth publishing.</>,
      copy: 'Lyra takes company knowledge, market intelligence and customer insight, and turns it into content your audience actually cares about.',
      capabilities: LYRA.capabilities.slice(0, 6),
      panel: <LyraPanel />,
    },
    {
      key: 'orion',
      employee: ORION,
      label: `${ORION.name} · Executive Intelligence`,
      title: <>Your company,<br />summarised before breakfast.</>,
      copy: 'While the others work in the background, Orion combines what they found into one short briefing: what happened, why it matters, and what to do next.',
      capabilities: ORION.capabilities.slice(0, 6),
      panel: <OrionPanel />,
    },
    {
      key: 'system',
      employee: null,
      label: 'Your AI workforce',
      title: <>Four specialists.<br />One coordinated team.</>,
      copy: 'Not four AI tools sitting side by side. Each one knows what the others found, and all of it reaches you through Orion.',
      panel: <WorkforceDiagram />,
    },
  ];

  return (
    <>
      <style>{STYLES}</style>
      <style>{AGENT_SYSTEM_STYLES}</style>
      <style>{`
        .atlas-sweep { animation: atlasSweep 7s linear infinite; }
        @keyframes atlasSweep { to { transform: rotate(360deg); } }
      `}</style>
      <section id="hero-to-expert-sequence" ref={sectionRef}>
        <div className="sequence-viewport">
          <div className="blueprint-grid" />

          {stages.map((s, i) => (
            <div key={s.key} className={`sequence-stage stage-${i + 1}`}>
              <div className="sequence-card">
                <div className="sequence-content">
                  {s.employee ? (
                    <>
                      <div className="seq-ident">
                        <AgentPortrait employee={s.employee} size={54} />
                        <div className="min-w-0">
                          <div className="seq-label">{s.label}</div>
                          <div className="seq-chips">
                            <DepartmentBadge employee={s.employee} />
                            <AgentStatus employee={s.employee} />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="seq-label">{s.label}</div>
                  )}

                  <h3 className="seq-title">{s.title}</h3>
                  <p className="seq-copy">{s.copy}</p>

                  {s.capabilities && (
                    <div className="seq-caps">
                      {s.capabilities.map((c) => <CapabilityChip key={c} label={c} />)}
                    </div>
                  )}
                </div>
                <div className="sequence-ui">{s.panel}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default ExpertJourney;

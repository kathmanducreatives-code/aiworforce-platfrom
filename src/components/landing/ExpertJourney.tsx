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
import { LisaGraphic, AtlasGraphic, LyraGraphic, OrionGraphic } from './AbilityGraphics';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EMPLOYEE_BY_ID, SPECIALISTS, ORION, type Employee } from './employees';
import { SCRUB } from './scrollSystem';
import {
  AGENT_SYSTEM_STYLES,
  AgentPanel,
  AgentPortrait,
  AgentIdentity,
  AgentStatus,
  DepartmentBadge,
  CapabilityChip,
  MetricCard,
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
  height: 100svh;
  background: transparent;
}
#hero-to-expert-sequence .sequence-viewport {
  position: sticky; top: 0; height: 100svh; perspective: 1500px; overflow: hidden;
}
#hero-to-expert-sequence .blueprint-grid {
  position: absolute; inset: 0; z-index: 0; opacity: 0.1;
  background:
    radial-gradient(circle at 20% 18%, rgba(0,255,150,0.1), transparent 46%),
    radial-gradient(circle at 82% 22%, rgba(0,255,150,0.08), transparent 44%),
    linear-gradient(rgba(0,255,150,0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,255,150,0.18) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 68px 68px, 68px 68px;
}
#hero-to-expert-sequence .sequence-stage {
  /* Centre in the usable viewport, not behind the fixed navbar. */
  position: absolute; top: var(--nav-offset); left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transform: scale(0.9); z-index: 2; will-change: transform, opacity; transform-style: preserve-3d;
}
#hero-to-expert-sequence .sequence-card {
  width: min(1160px, 94vw); height: min(calc(100svh - var(--nav-offset) - 64px), 704px); border-radius: 24px;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  background: rgba(9,11,14,0.82); border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 24px 70px -30px rgba(0,0,0,0.9); overflow: hidden;
  display: grid; grid-template-columns: 0.82fr 1.18fr;
  transform-style: preserve-3d; will-change: transform, opacity;
}
/* One vertical rhythm for every left column, so the cards feel machined. */
#hero-to-expert-sequence .sequence-content {
  padding: 34px 30px; border-right: 1px solid rgba(255,255,255,0.07);
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
  #hero-to-expert-sequence .sequence-content { border-right: 0; border-bottom: 1px solid rgba(255,255,255,0.07); padding: 22px; }
  #hero-to-expert-sequence .sequence-ui { padding: 16px; }
  /* Diagrams drop rather than shrink into illegibility. */
  #hero-to-expert-sequence .hide-sm { display: none !important; }
}
`;

/* ──────────────────────────────────────────────────────────────── SCENES ── */

function LisaPanel() {
  return (
    <AgentPanel
      title="Signal filter"
      status={<AgentStatus employee={LISA} label="48 sources" />}
      metrics={
        <>
          <MetricCard value="48" label="Sources" accent={LISA.accent} />
          <MetricCard value="18" label="Changes" accent={LISA.accent} />
          <MetricCard value="4" label="Important" accent={LISA.accent} primary />
        </>
      }
    >
      <LisaGraphic />
    </AgentPanel>
  );
}

/* ─────────────────────────────────────────────── stage 2 · ATLAS · SCAN ── */

function AtlasPanel() {
  return (
    <AgentPanel
      title="Market scan"
      status={<AgentStatus employee={ATLAS} label="Scanning" />}
      metrics={
        <>
          <MetricCard value="1,842" label="Scanned" accent={ATLAS.accent} />
          <MetricCard value="327" label="Matched" accent={ATLAS.accent} />
          <MetricCard value="12" label="Priority" accent={ATLAS.accent} primary />
        </>
      }
    >
      <AtlasGraphic />
    </AgentPanel>
  );
}

/* ───────────────────────────────────────── stage 3 · LYRA · TRANSFORM ── */

function LyraPanel() {
  return (
    <AgentPanel
      title="Content engine"
      status={<AgentStatus employee={LYRA} label="Drafting" />}
      metrics={
        <>
          <MetricCard value="12" label="Ideas" accent={LYRA.accent} />
          <MetricCard value="1h" label="Saved" accent={LYRA.accent} />
          <MetricCard value="4" label="Drafts" accent={LYRA.accent} primary />
        </>
      }
    >
      <LyraGraphic />
    </AgentPanel>
  );
}

/* ──────────────────────────────────── stage 4 · ORION · COMPRESS ── */

function OrionPanel() {
  return (
    <AgentPanel
      title="Executive brief · 07:00"
      status={<AgentStatus employee={ORION} label="Ready" />}
      metrics={
        <>
          <MetricCard value="48" label="Inputs" accent={ORION.accent} />
          <MetricCard value="3min" label="Read" accent={ORION.accent} />
          <MetricCard value="3" label="Priorities" accent={ORION.accent} primary />
        </>
      }
    >
      <OrionGraphic />
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

        <svg className="w-full max-w-[560px] h-[46px] hide-sm" viewBox="0 0 560 46" fill="none" aria-hidden="true">
          <path
            d="M280 0 V16 M95 46 V30 H465 V46 M280 30 V16 M95 30 H465"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
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
      gsap.set(stages, { opacity: 0, scale: 0.985, y: 26, rotateX: 0, transformOrigin: 'center center' });
      const tl = gsap.timeline({
        defaults: { ease: 'power2.out' },
        scrollTrigger: {
          trigger: section, start: 'top top', end: `+=${STAGES * 100}%`, scrub: SCRUB, pin: true, anticipatePin: 1,
        },
      });
      for (let i = 1; i <= STAGES; i++) {
        tl.to(`.stage-${i}`, { opacity: 1, scale: 1, y: 0, duration: 0.75 });
        if (i < STAGES) {
          tl.to(`.stage-${i}`, { scale: 0.985, y: -26, opacity: 0, duration: 0.7 });
        } else {
          tl.to(`.stage-${i}`, { duration: 0.6 });
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

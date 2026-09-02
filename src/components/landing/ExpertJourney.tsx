/**
 * THE AI WORKFORCE SEQUENCE.
 *
 * The scroll mechanic is deliberately unchanged: a tall track, a sticky 100vh
 * viewport, and a scrubbed GSAP timeline that fades/scales each
 * `.sequence-stage` through a glass `.sequence-card`. That system works and is
 * not touched. What changed is everything inside the stages.
 *
 * The sequence now tells the product story in the order work actually flows:
 *
 *   1  LISA    watches the outside world
 *   2  ATLAS   finds the companies worth talking to
 *   3  LYRA    turns intelligence into content
 *   4  ORION   synthesises it and says what deserves attention
 *   5  the cross-agent moment — one signal moving through all four
 *   6  the whole architecture, with shared memory underneath
 *
 * Each agent gets its own visual metaphor rather than another dashboard panel:
 * a monitoring network, a narrowing prospect field, a production engine, and a
 * briefing that assembles. They share typography, glass, line weight, status
 * language and motion, so it reads as one system.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EMPLOYEE_BY_ID, SPECIALISTS, ORION, type Employee } from './employees';
import {
  AGENT_SYSTEM_STYLES,
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
  SharedMemoryNode,
  LiveCounter,
} from './agentSystem';

gsap.registerPlugin(ScrollTrigger);

const LISA = EMPLOYEE_BY_ID.mira;
const ATLAS = EMPLOYEE_BY_ID.atlas;
const LYRA = EMPLOYEE_BY_ID.lyra;

const STAGES = 6;

const STYLES = `
#hero-to-expert-sequence {
  position: relative;
  height: ${STAGES * 100 + 20}vh;
  background: transparent;
}
#hero-to-expert-sequence .sequence-viewport {
  position: sticky;
  top: 0;
  height: 100vh;
  perspective: 1500px;
  overflow: hidden;
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
  width: min(1080px, 93vw); height: min(74vh, 660px); border-radius: 24px;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(0,255,150,0.2);
  box-shadow: 0 0 40px rgba(0,255,150,0.15); overflow: hidden;
  display: grid; grid-template-columns: 0.9fr 1.1fr; transform-style: preserve-3d; will-change: transform, opacity;
}
#hero-to-expert-sequence .sequence-content {
  padding: 30px 28px; border-right: 1px solid rgba(0,255,150,0.14);
  display: flex; flex-direction: column; justify-content: center; min-width: 0;
}
#hero-to-expert-sequence .sequence-ui { padding: 20px; display: flex; align-items: stretch; min-width: 0; }
#hero-to-expert-sequence .seq-label { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #4ade80; }
#hero-to-expert-sequence .seq-title { margin-top: 14px; font-size: clamp(1.5rem,2.6vw,2.4rem); line-height: 1.05; letter-spacing: -0.04em; color: #fff; font-weight: 900; }
#hero-to-expert-sequence .seq-copy { margin-top: 13px; color: rgba(255,255,255,0.62); line-height: 1.6; font-size: 13px; }
#hero-to-expert-sequence .ui-panel {
  width: 100%; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.42); padding: 15px; transform-style: preserve-3d; min-width: 0;
  display: flex; flex-direction: column;
}
#hero-to-expert-sequence .panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 9px; margin-bottom: 11px; border-bottom: 1px solid rgba(255,255,255,0.07);
}
#hero-to-expert-sequence .panel-title {
  font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.16em;
  text-transform: uppercase; color: rgba(255,255,255,0.28);
}
#hero-to-expert-sequence .metric-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  margin-top: auto; padding-top: 11px; border-top: 1px solid rgba(255,255,255,0.07);
}
@media (max-width: 1024px) {
  #hero-to-expert-sequence .sequence-card { grid-template-columns: 1fr; height: min(84vh, 760px); }
  #hero-to-expert-sequence .sequence-content { border-right: 0; border-bottom: 1px solid rgba(0,255,150,0.14); padding: 20px; }
  #hero-to-expert-sequence .sequence-ui { padding: 14px; }
  /* Diagrams drop rather than shrink into illegibility. */
  #hero-to-expert-sequence .hide-sm { display: none !important; }
  #hero-to-expert-sequence .metric-row { grid-template-columns: repeat(2, 1fr); }
}
`;

/* ────────────────────────────────────────────────────── stage 1 · LISA ── */

const WATCHED = ['Ashby', 'Greenhouse', 'Lever', 'Workable', 'Personio', 'G2'];

function LisaPanel() {
  return (
    <div className="ui-panel">
      <div className="panel-head">
        <span className="panel-title">Monitoring network</span>
        <AgentStatus employee={LISA} label="Scanning 48 sources" />
      </div>

      <div className="relative flex-1 min-h-0 flex items-center gap-2.5">
        <div className="w-[96px] shrink-0 space-y-[6px]">
          {WATCHED.map((label) => (
            <div key={label} className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-[5px]">
              <span className="text-[9.5px] text-white/45 truncate block">{label}</span>
            </div>
          ))}
        </div>

        <svg className="w-[54px] h-full shrink-0 hide-sm" viewBox="0 0 54 200" preserveAspectRatio="none" aria-hidden="true">
          {[18, 50, 82, 114, 146, 178].map((y, i) => (
            <DataFlow key={y} x1={0} y1={y} x2={50} y2={100} accent={LISA.accent} delay={i * 0.34} />
          ))}
        </svg>

        <AgentPortrait employee={LISA} size={84} className="shrink-0" />

        <div className="flex-1 min-w-0 space-y-[7px] pl-1">
          <IntelligenceEvent source="Ashby" headline="Pricing dropped 20%" tag="Urgent" tone="urgent" />
          <IntelligenceEvent source="Greenhouse" headline="+6 engineering hires" tag="Hiring" tone="opportunity" />
          <IntelligenceEvent source="Personio" headline="Opened 14 sales roles" tag="Growth" tone="opportunity" />
          <p className="text-[9.5px] text-white/20 pt-0.5">14 further changes reviewed and set aside.</p>
        </div>
      </div>

      <div className="metric-row">
        <MetricCard value="48" label="Sources watched" accent={LISA.accent} />
        <MetricCard value="327" label="Companies" accent={LISA.accent} />
        <MetricCard value="18" label="Changes seen" accent={LISA.accent} />
        <MetricCard value="4" label="Worth knowing" accent={LISA.accent} />
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── stage 2 · ATLAS ── */

/** Deterministic phyllotaxis scatter — no RNG, identical on every render. */
const FIELD = Array.from({ length: 84 }, (_, i) => {
  const a = i * 2.399963;
  const r = Math.sqrt(i / 84);
  return {
    x: 50 + Math.cos(a) * r * 45,
    y: 50 + Math.sin(a) * r * 43,
    keep: i % 7 === 0,
    hot: i % 23 === 0,
  };
});

const FUNNEL = [
  { n: '1,842', l: 'scanned', w: '100%', o: 0.3 },
  { n: '327', l: 'ICP matches', w: '60%', o: 0.5 },
  { n: '84', l: 'enriched', w: '33%', o: 0.72 },
  { n: '12', l: 'high priority', w: '17%', o: 1 },
];

function AtlasPanel() {
  return (
    <div className="ui-panel">
      <div className="panel-head">
        <span className="panel-title">Prospect field</span>
        <AgentStatus employee={ATLAS} label="Analysing 842 / 1,842" />
      </div>

      <div className="flex-1 min-h-0 flex gap-3 items-stretch">
        <div className="relative flex-1 min-w-0 flex items-center">
          <svg viewBox="0 0 100 100" className="w-full max-h-full aspect-square" aria-hidden="true">
            <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.05)" />
            <circle cx="50" cy="50" r="29" fill="none" stroke="rgba(255,255,255,0.05)" />
            <circle cx="50" cy="50" r="14" fill="none" stroke={`${ATLAS.accent}30`} />
            {FIELD.map((d, i) => (
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={d.hot ? 1.9 : d.keep ? 1.2 : 0.75}
                fill={d.hot ? ATLAS.accent : d.keep ? `${ATLAS.accent}88` : 'rgba(255,255,255,0.15)'}
              />
            ))}
            <g className="atlas-sweep" style={{ transformOrigin: '50px 50px' }}>
              <path d="M50 50 L50 5 A45 45 0 0 1 81 18 Z" fill={`${ATLAS.accent}12`} />
              <line x1="50" y1="50" x2="50" y2="5" stroke={ATLAS.accent} strokeWidth="0.5" strokeOpacity="0.55" />
            </g>
          </svg>
        </div>

        <div className="w-[180px] shrink-0 flex flex-col justify-between">
          <div className="space-y-[5px]">
            {FUNNEL.map((s) => (
              <div key={s.l}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: ATLAS.accent, opacity: s.o }}>{s.n}</span>
                  <span className="text-[9px] text-white/30">{s.l}</span>
                </div>
                <div className="h-[3px] rounded-full bg-white/[0.06] mt-[3px] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: s.w, background: ATLAS.accent, opacity: s.o }} />
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-2.5 mt-2" style={{ borderColor: `${ATLAS.accent}2e`, background: `${ATLAS.accent}0d` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-white/85">Acme AI</span>
              <span className="text-[9px] font-mono px-1.5 py-[2px] rounded" style={{ color: ATLAS.accent, background: `${ATLAS.accent}1a` }}>94% ICP</span>
            </div>
            {[
              ['Hiring', '+14 employees'],
              ['Funding', 'Series A'],
              ['Signal', 'New Head of Sales'],
              ['Contact', 'Sarah Chen'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 py-[1.5px]">
                <span className="text-[9px] text-white/25">{k}</span>
                <span className="text-[9px] text-white/60 truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="metric-row">
        <MetricCard value="1,842" label="Analysed" accent={ATLAS.accent} />
        <MetricCard value="327" label="Fit your ICP" accent={ATLAS.accent} />
        <MetricCard value="84" label="Enriched" accent={ATLAS.accent} />
        <MetricCard value="12" label="Priority" accent={ATLAS.accent} />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────── stage 3 · LYRA ── */

const LYRA_INPUTS = [
  { l: 'Lisa signal', d: 'Ashby pricing down 20%' },
  { l: 'Customer calls', d: 'Screening forms too long' },
  { l: 'Founder note', d: 'AI should cut admin' },
  { l: 'Existing content', d: '38 posts indexed' },
];

const LYRA_OUTPUTS = [
  { k: 'LinkedIn', t: 'Recruiters do not need more AI tools' },
  { k: 'Carousel', t: '5 recruiting tasks AI should own' },
  { k: 'Blog', t: 'The new AI recruiting stack' },
  { k: 'Newsletter', t: '3 changes in recruiting this week' },
];

function LyraPanel() {
  return (
    <div className="ui-panel">
      <div className="panel-head">
        <span className="panel-title">Content engine</span>
        <AgentStatus employee={LYRA} label="Draft 3 of 4 generating" />
      </div>

      <div className="flex-1 min-h-0 flex items-center gap-1.5">
        <div className="w-[116px] shrink-0 space-y-[6px]">
          <p className="text-[8.5px] font-mono uppercase tracking-[0.14em] text-white/20 mb-1">Knows</p>
          {LYRA_INPUTS.map((s) => <DataSource key={s.l} label={s.l} detail={s.d} accent={LYRA.accent} />)}
        </div>

        <svg className="w-[40px] h-full shrink-0 hide-sm" viewBox="0 0 40 200" preserveAspectRatio="none" aria-hidden="true">
          {[30, 72, 114, 156].map((y, i) => (
            <DataFlow key={y} x1={0} y1={y} x2={36} y2={100} accent={LYRA.accent} delay={i * 0.4} />
          ))}
        </svg>

        <AgentPortrait employee={LYRA} size={80} className="shrink-0" />

        <svg className="w-[40px] h-full shrink-0 hide-sm" viewBox="0 0 40 200" preserveAspectRatio="none" aria-hidden="true">
          {[30, 72, 114, 156].map((y, i) => (
            <DataFlow key={y} x1={4} y1={100} x2={40} y2={y} accent={LYRA.accent} delay={0.2 + i * 0.4} />
          ))}
        </svg>

        <div className="flex-1 min-w-0 space-y-[6px]">
          <p className="text-[8.5px] font-mono uppercase tracking-[0.14em] text-white/20 mb-1">Publishes</p>
          {LYRA_OUTPUTS.map((o) => <OutputCard key={o.k} kind={o.k} title={o.t} accent={LYRA.accent} />)}
        </div>
      </div>

      <div className="metric-row">
        <MetricCard value="12" label="Ideas found" accent={LYRA.accent} />
        <MetricCard value="4" label="Drafts created" accent={LYRA.accent} />
        <MetricCard value="3" label="Formats" accent={LYRA.accent} />
        <MetricCard value="1h" label="Time saved" accent={LYRA.accent} />
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── stage 4 · ORION ── */

const FEEDS: Record<string, string> = { signals: '4 signals', leads: '7 leads', content: '3 drafts' };

function OrionPanel() {
  return (
    <div className="ui-panel">
      <div className="panel-head">
        <span className="panel-title">Executive brief · 07:00</span>
        <AgentStatus employee={ORION} label="Synthesizing" />
      </div>

      <div className="flex-1 min-h-0 flex gap-3">
        <div className="w-[124px] shrink-0 flex flex-col justify-center gap-2.5">
          {SPECIALISTS.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <AgentPortrait employee={e} size={30} />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold truncate" style={{ color: e.accent }}>{e.name}</p>
                <p className="text-[8.5px] text-white/30 truncate">{FEEDS[e.discipline]}</p>
              </div>
            </div>
          ))}
          <svg className="h-[44px] w-full hide-sm" viewBox="0 0 120 44" aria-hidden="true">
            {[8, 22, 36].map((y, i) => (
              <DataFlow key={y} x1={0} y1={y} x2={116} y2={22} accent={SPECIALISTS[i].accent} delay={i * 0.5} />
            ))}
          </svg>
        </div>

        <div className="flex-1 min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 flex flex-col">
          <p className="text-[10px] text-white/35 mb-2">Wednesday · 3 things deserve your attention</p>
          <div className="space-y-1.5 flex-1">
            <IntelligenceEvent source="01 · Lisa" headline="Ashby cut pricing 20%. Pressure on SMB accounts." tag="Competitor" tone="urgent" />
            <IntelligenceEvent source="02 · Atlas" headline="7 high-fit accounts active. 3 hiring recruiting leads." tag="Pipeline" tone="opportunity" />
            <IntelligenceEvent source="03 · Lyra" headline="Draft ready: why cheaper software is not cheaper." tag="Content" />
          </div>
          <div className="border-t border-white/[0.07] mt-2 pt-2 space-y-1">
            <p className="text-[8.5px] font-mono uppercase tracking-[0.14em] text-white/20 mb-1">Today</p>
            <ActionRecommendation n="→" text="Contact 3 priority accounts" />
            <ActionRecommendation n="→" text="Publish the pricing POV" />
          </div>
        </div>
      </div>

      <div className="metric-row">
        <MetricCard value="48" label="Signals compiled" accent={ORION.accent} />
        <MetricCard value="3" label="Need you" accent={ORION.accent} />
        <MetricCard value="3min" label="Reading time" accent={ORION.accent} />
        <MetricCard value="0" label="Research hours" accent={ORION.accent} />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────── stage 5 · CROSS-AGENT ── */

/** A short descending connector, so the four beats read as one flow. */
function FlowTick() {
  return (
    <div className="flex justify-center" aria-hidden="true">
      <span className="w-px h-3 bg-gradient-to-b from-emerald-400/50 to-emerald-400/5" />
    </div>
  );
}

function CrossAgentPanel() {
  return (
    <div className="ui-panel">
      <div className="panel-head">
        <span className="panel-title">One signal, four employees</span>
        <span className="text-[10px] text-white/30">09:14 today</span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-center gap-2">
        <div className="flex items-center gap-3">
          <AgentPortrait employee={LISA} size={54} />
          <div className="flex-1 min-w-0">
            <IntelligenceEvent source="Lisa detects" headline="Ashby raised prices 20%" tag="Urgent" tone="urgent" />
          </div>
        </div>

        <FlowTick />
        <SharedMemoryNode />
        <FlowTick />

        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex items-center gap-2">
            <AgentPortrait employee={ATLAS} size={44} />
            <p className="text-[10.5px] text-white/70 leading-snug">
              <span style={{ color: ATLAS.accent }}>Atlas</span> — 12 prospects may now be receptive
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AgentPortrait employee={LYRA} size={44} />
            <p className="text-[10.5px] text-white/70 leading-snug">
              <span style={{ color: LYRA.accent }}>Lyra</span> — strong content angle on pricing
            </p>
          </div>
        </div>

        <FlowTick />
        <div
          className="flex items-center gap-3 rounded-lg border p-3"
          style={{ borderColor: `${ORION.accent}30`, background: `${ORION.accent}0d` }}
        >
          <AgentPortrait employee={ORION} size={54} />
          <p className="text-[11.5px] text-white/80 leading-snug">
            <span style={{ color: ORION.accent }}>Orion</span> — contact these accounts and publish this POV.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── stage 6 · ARCHITECTURE ── */

function WorkforceDiagram() {
  return (
    <div className="ui-panel">
      <div className="panel-head">
        <span className="panel-title">One business · one memory · four employees</span>
        <span className="text-[10px] text-white/30">
          <LiveCounter from={1780} to={1842} /> accounts in context
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/35">You</span>
        <div className="w-px h-5 bg-white/15" />

        <div className="flex flex-col items-center gap-1">
          <AgentPortrait employee={ORION} size={76} />
          <AgentIdentity employee={ORION} size="sm" />
        </div>

        <svg className="w-full max-w-[520px] h-[46px] hide-sm" viewBox="0 0 520 46" aria-hidden="true">
          {[88, 260, 432].map((x, i) => (
            <DataFlow key={x} x1={260} y1={0} x2={x} y2={44} accent={SPECIALISTS[i].accent} delay={i * 0.45} />
          ))}
        </svg>

        <div className="grid grid-cols-3 gap-3 sm:gap-8 w-full max-w-[520px]">
          {SPECIALISTS.map((e) => (
            <div key={e.id} className="flex flex-col items-center gap-1 text-center">
              <AgentPortrait employee={e} size={64} />
              <AgentIdentity employee={e} size="sm" />
              <AgentStatus employee={e} />
            </div>
          ))}
        </div>

        <svg className="w-full max-w-[520px] h-[38px] hide-sm" viewBox="0 0 520 38" aria-hidden="true">
          {[88, 260, 432].map((x, i) => (
            <DataFlow key={x} x1={x} y1={0} x2={260} y2={36} accent={SPECIALISTS[i].accent} delay={0.25 + i * 0.45} dashed />
          ))}
        </svg>

        <div className="w-full max-w-[520px]">
          <SharedMemoryNode compact />
        </div>
      </div>
    </div>
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
  accent: string;
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
      // Same in/out grammar as before, now across six stages.
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
      accent: LISA.accent,
      panel: <LisaPanel />,
    },
    {
      key: 'atlas',
      employee: ATLAS,
      label: `${ATLAS.name} · Lead Intelligence`,
      title: <>Find the companies worth<br />talking to first.</>,
      copy: 'Atlas searches the market continuously, matches companies against your ICP, enriches them, and surfaces the accounts most likely to matter.',
      capabilities: ATLAS.capabilities.slice(0, 6),
      accent: ATLAS.accent,
      panel: <AtlasPanel />,
    },
    {
      key: 'lyra',
      employee: LYRA,
      label: `${LYRA.name} · Content Intelligence`,
      title: <>Turn what your company knows<br />into content worth publishing.</>,
      copy: 'Lyra takes company knowledge, market intelligence and customer insight, and turns it into content your audience actually cares about.',
      capabilities: LYRA.capabilities.slice(0, 6),
      accent: LYRA.accent,
      panel: <LyraPanel />,
    },
    {
      key: 'orion',
      employee: ORION,
      label: `${ORION.name} · Executive Intelligence`,
      title: <>Your company,<br />summarised before breakfast.</>,
      copy: 'While the others work in the background, Orion combines what they found into one short briefing: what happened, why it matters, and what to do next.',
      capabilities: ORION.capabilities.slice(0, 6),
      accent: ORION.accent,
      panel: <OrionPanel />,
    },
    {
      key: 'cross',
      employee: null,
      label: 'Shared memory',
      title: <>One signal.<br />Four employees who act on it.</>,
      copy: 'Everything an employee learns lands in the same company memory, so the others can use it without being told, and without you relaying it.',
      accent: '#10b981',
      panel: <CrossAgentPanel />,
    },
    {
      key: 'system',
      employee: null,
      label: 'Your AI workforce',
      title: <>Four specialists.<br />One company memory.</>,
      copy: 'Not four AI tools sitting side by side — one connected team that shares what it knows and reports to you through Orion.',
      accent: '#10b981',
      panel: <WorkforceDiagram />,
    },
  ];

  return (
    <>
      <style>{STYLES}</style>
      <style>{AGENT_SYSTEM_STYLES}</style>
      <style>{`
        .atlas-sweep { animation: atlasSweep 6s linear infinite; }
        @keyframes atlasSweep { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .atlas-sweep { animation: none; } }
      `}</style>
      <section id="hero-to-expert-sequence" ref={sectionRef}>
        <div className="sequence-viewport">
          <div className="blueprint-grid" />

          {stages.map((s, i) => (
            <div key={s.key} className={`sequence-stage stage-${i + 1}`}>
              <div className="sequence-card">
                <div className="sequence-content">
                  {s.employee ? (
                    <div className="flex items-center gap-3 mb-1">
                      <AgentPortrait employee={s.employee} size={50} />
                      <div className="min-w-0">
                        <div className="seq-label">{s.label}</div>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <DepartmentBadge employee={s.employee} />
                          <AgentStatus employee={s.employee} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="seq-label">{s.label}</div>
                  )}

                  <h3 className="seq-title">{s.title}</h3>
                  <p className="seq-copy">{s.copy}</p>

                  {s.capabilities && (
                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {s.capabilities.map((c) => <CapabilityChip key={c} label={c} accent={s.accent} />)}
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

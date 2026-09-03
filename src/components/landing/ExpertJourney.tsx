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

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import gsap from 'gsap';
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

/**
 * Every agent panel holds one scene, and every scene argues one verb: Lisa
 * filters, Atlas scans, Lyra transforms, Orion compresses. Anything that does
 * not serve that verb is left out, which is why the scenes are mostly dark.
 *
 * Built from planes rather than objects — a lens, a field, a prism, a stack —
 * so the depth costs four transforms rather than a 3D library.
 */
function Scene({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Cursor tilts the depth tiers against each other. A few pixels only.
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--hx', String((e.clientX - r.left) / r.width - 0.5));
    el.style.setProperty('--hy', String((e.clientY - r.top) / r.height - 0.5));
  }, []);
  const onLeave = useCallback(() => {
    ref.current?.style.setProperty('--hx', '0');
    ref.current?.style.setProperty('--hy', '0');
  }, []);
  return <div ref={ref} className="scene" onPointerMove={onMove} onPointerLeave={onLeave}>{children}</div>;
}

/* ────────────────────────────────────────────── stage 1 · LISA · FILTER ── */

const NOISE = ['Pricing', 'Hiring', 'Funding', 'Reviews', 'Product', 'Website'];
const KEPT = [
  { who: 'Ashby', what: 'Pricing ↓ 20%' },
  { who: 'Greenhouse', what: '+6 engineering hires' },
  { who: 'Personio', what: '14 sales roles opened' },
];

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
      <Scene>
        {/* Noise entering, most of it dying at the lens. */}
        <div className="scene__layer tier-back flex flex-col justify-center gap-2 pr-[72%]">
          {NOISE.map((n, i) => (
            <span key={n} className="lisa-noise text-[12px] text-white/35 pane--ghost pane px-2.5 py-1.5" style={{ animationDelay: `${i * 0.5}s` }}>
              {n}
            </span>
          ))}
        </div>

        {/* The lens. */}
        <div className="scene__layer tier-mid flex items-center justify-center pr-[26%]">
          <span className="lisa-lens" aria-hidden="true" />
        </div>

        {/* What survives. */}
        <div className="scene__layer tier-front flex flex-col justify-center gap-2.5 pl-[50%]">
          {KEPT.map((k, i) => (
            <div key={k.who} className="lisa-kept pane px-3.5 py-2.5" style={{ animationDelay: `${0.8 + i * 0.22}s` }}>
              <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-white/40">{k.who}</p>
              <p className="text-[14px] text-white/90 leading-snug mt-0.5">{k.what}</p>
            </div>
          ))}
        </div>
      </Scene>
    </AgentPanel>
  );
}

/* ─────────────────────────────────────────────── stage 2 · ATLAS · SCAN ── */

/** Deterministic field, so the market looks the same on every render. */
const FIELD = Array.from({ length: 46 }, (_, i) => {
  const a = i * 2.399963;
  const r = Math.sqrt(i / 46);
  return { x: 50 + Math.cos(a) * r * 44, y: 50 + Math.sin(a) * r * 40, hot: i % 15 === 0 };
});

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
      <Scene>
        {/* The market, laid flat and seen at an angle. */}
        <div className="scene__layer tier-back flex items-center justify-center">
          <div className="atlas-plane" aria-hidden="true">
            {FIELD.map((d, i) => (
              <span
                key={i}
                className="atlas-dot"
                style={{
                  left: `${d.x}%`, top: `${d.y}%`,
                  background: d.hot ? ATLAS.accent : 'rgba(255,255,255,0.24)',
                  width: d.hot ? 5 : 3, height: d.hot ? 5 : 3,
                  boxShadow: d.hot ? `0 0 10px ${ATLAS.accent}` : 'none',
                }}
              />
            ))}
            <span className="atlas-sweep" />
          </div>
        </div>

        {/* The one that rose out of it. */}
        <div className="scene__layer tier-front flex items-center justify-end pl-[38%] pr-1">
          <div className="atlas-card pane p-4 w-full max-w-[220px]">
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <span className="text-[16px] font-display font-black text-white">Acme AI</span>
              <span className="text-[11px] font-mono px-2 py-[3px] rounded" style={{ color: ATLAS.accent, background: `${ATLAS.accent}22` }}>94%</span>
            </div>
            <p className="text-[12.5px] text-white/55 leading-snug">Series A · hiring a Head of Sales</p>
            <p className="text-[12.5px] text-white/80 mt-2.5 pt-2.5 border-t border-white/[0.09]">Sarah Chen · VP Growth</p>
          </div>
        </div>
      </Scene>
    </AgentPanel>
  );
}

/* ───────────────────────────────────────── stage 3 · LYRA · TRANSFORM ── */

const KNOWS = ['Competitor pricing changed', 'Screening takes too long', 'AI should reduce admin'];
const MADE = ['LinkedIn', 'Carousel', 'Blog', 'Newsletter'];

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
      <Scene>
        <div className="scene__layer tier-back flex flex-col justify-center gap-2 pr-[68%]">
          {KNOWS.map((k, i) => (
            <div key={k} className="lyra-in pane--ghost pane px-2.5 py-2" style={{ animationDelay: `${i * 0.4}s` }}>
              <p className="text-[12px] text-white/60 leading-snug">{k}</p>
            </div>
          ))}
        </div>

        {/* The prism the knowledge passes through. */}
        <div className="scene__layer tier-mid flex items-center justify-center pr-[24%]">
          <span className="lyra-prism" aria-hidden="true" />
        </div>

        {/* Content, stacked like physical tiles. */}
        <div className="scene__layer tier-front flex flex-col justify-center items-end gap-2 pl-[54%]">
          {MADE.map((m, i) => (
            <div
              key={m}
              className="lyra-out pane px-3.5 py-2 w-full"
              style={{ animationDelay: `${0.7 + i * 0.16}s`, marginRight: `${i * 7}px` }}
            >
              <span className="text-[12.5px] font-mono uppercase tracking-[0.1em]" style={{ color: LYRA.accent }}>{m}</span>
            </div>
          ))}
        </div>
      </Scene>
    </AgentPanel>
  );
}

/* ──────────────────────────────────── stage 4 · ORION · COMPRESS ── */

const BRIEF = [
  ['01', 'Competitor pricing changed'],
  ['02', '7 priority accounts active'],
  ['03', 'Pricing POV ready'],
];

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
      <Scene>
        {/* The noise, compressing away behind the brief. */}
        <div className="scene__layer tier-back flex items-center justify-center">
          {[0, 1, 2].map((i) => (
            <span key={i} className="orion-sheet pane--ghost pane" style={{ animationDelay: `${i * 0.3}s`, ['--d' as string]: `${-40 - i * 34}px` }} />
          ))}
        </div>

        {/* What is left. */}
        <div className="scene__layer tier-front flex items-center justify-center px-1">
          <div className="orion-brief pane p-5 w-full">
            <p className="text-[15px] font-display font-black text-white">Good morning</p>
            <p className="text-[12.5px] text-white/45 mt-1 mb-3.5">3 things need your attention</p>
            <div className="space-y-2">
              {BRIEF.map(([n, t]) => (
                <div key={n} className="flex items-baseline gap-2.5">
                  <span className="text-[11px] font-mono" style={{ color: ORION.accent }}>{n}</span>
                  <span className="text-[13.5px] text-white/85 leading-snug">{t}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-white/[0.09] space-y-1.5">
              {['Contact 3 priority accounts', 'Publish the pricing POV'].map((t) => (
                <p key={t} className="text-[12.5px] text-white/55">→ {t}</p>
              ))}
            </div>
          </div>
        </div>
      </Scene>
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
      <style>{`
        /* ── LISA · FILTER ────────────────────────────────────────────────
           Noise drifts toward the lens and dies there; three signals emerge
           on the far side and stay. The verb is the animation. */
        .lisa-noise {
          align-self: flex-start; animation: lisaNoise 7s ease-in-out infinite;
        }
        @keyframes lisaNoise {
          0%   { opacity: 0; transform: translateX(-14px); }
          22%  { opacity: 0.85; transform: translateX(0); }
          52%  { opacity: 0; transform: translateX(34px); }
          100% { opacity: 0; transform: translateX(34px); }
        }
        .lisa-lens {
          width: 74px; height: 132px; border-radius: 999px;
          border: 1px solid rgba(52,211,153,0.4);
          background: linear-gradient(150deg, rgba(52,211,153,0.2), rgba(52,211,153,0.03) 60%, transparent);
          box-shadow: 0 0 44px rgba(16,185,129,0.28), inset 0 1px 0 rgba(255,255,255,0.3);
          backdrop-filter: blur(6px); animation: lisaLens 7s ease-in-out infinite;
        }
        @keyframes lisaLens { 0%, 100% { opacity: 0.75; } 40% { opacity: 1; box-shadow: 0 0 62px rgba(16,185,129,0.42), inset 0 1px 0 rgba(255,255,255,0.4); } }
        .lisa-kept { animation: sceneRise 7s ease-in-out infinite; }

        /* ── ATLAS · SCAN ─────────────────────────────────────────────────
           The market as a plane seen at an angle; one account leaves it. */
        .atlas-plane {
          position: relative; width: 78%; aspect-ratio: 1.5;
          transform: rotateX(58deg) rotateZ(-8deg); transform-style: preserve-3d;
          border-radius: 14px; border: 1px solid rgba(255,255,255,0.07);
          background:
            linear-gradient(rgba(245,158,11,0.05) 1px, transparent 1px) 0 0 / 100% 22px,
            linear-gradient(90deg, rgba(245,158,11,0.05) 1px, transparent 1px) 0 0 / 22px 100%,
            radial-gradient(60% 60% at 50% 50%, rgba(245,158,11,0.07), transparent 70%);
          overflow: hidden;
        }
        .atlas-dot { position: absolute; border-radius: 999px; transform: translate(-50%,-50%); }
        .atlas-sweep {
          position: absolute; inset: 0 auto 0 0; width: 42%;
          background: linear-gradient(90deg, transparent, rgba(245,158,11,0.16), transparent);
          animation: atlasSweep 6.5s cubic-bezier(0.4,0,0.2,1) infinite;
        }
        @keyframes atlasSweep { 0% { transform: translateX(-110%); } 70%, 100% { transform: translateX(280%); } }
        .atlas-card { animation: sceneRise 6.5s ease-in-out infinite; animation-delay: 1.1s; }

        /* ── LYRA · TRANSFORM ─────────────────────────────────────────────
           Knowledge in, one prism, content out. */
        .lyra-in { align-self: flex-start; animation: lyraIn 7s ease-in-out infinite; }
        @keyframes lyraIn {
          0%   { opacity: 0; transform: translateX(-12px); }
          20%  { opacity: 1; transform: translateX(0); }
          48%  { opacity: 0.15; transform: translateX(26px); }
          100% { opacity: 0.15; transform: translateX(26px); }
        }
        .lyra-prism {
          width: 78px; height: 78px; border-radius: 16px;
          border: 1px solid rgba(96,165,250,0.42);
          background: linear-gradient(140deg, rgba(96,165,250,0.28), rgba(96,165,250,0.04) 62%, transparent);
          box-shadow: 0 0 48px rgba(59,130,246,0.3), inset 0 1px 0 rgba(255,255,255,0.35);
          backdrop-filter: blur(6px);
          transform: rotate(45deg); animation: lyraPrism 7s ease-in-out infinite;
        }
        @keyframes lyraPrism {
          0%, 100% { transform: rotate(45deg) scale(1); opacity: 0.8; }
          42% { transform: rotate(52deg) scale(1.06); opacity: 1; }
        }
        .lyra-out { animation: sceneRise 7s ease-in-out infinite; }

        /* ── ORION · COMPRESS ─────────────────────────────────────────────
           Sheets of everything collapse inward; one brief is left in front. */
        .orion-sheet {
          position: absolute; width: 82%; height: 76%; border-radius: 14px;
          transform: translateZ(var(--d)) scale(0.94);
          animation: orionCompress 8s ease-in-out infinite;
        }
        @keyframes orionCompress {
          0%   { opacity: 0.5; transform: translateZ(var(--d)) translateY(-10px) scale(0.94); }
          46%  { opacity: 0.06; transform: translateZ(calc(var(--d) * 0.2)) translateY(0) scale(0.99); }
          100% { opacity: 0.06; transform: translateZ(calc(var(--d) * 0.2)) translateY(0) scale(0.99); }
        }
        .orion-brief { animation: sceneRise 8s ease-in-out infinite; animation-delay: 0.9s; }

        /* One rise shared by every scene's result, so the four resolve alike. */
        @keyframes sceneRise {
          0%   { opacity: 0; transform: translateY(10px); }
          26%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .lisa-noise, .lisa-lens, .lisa-kept, .atlas-sweep, .atlas-card,
          .lyra-in, .lyra-prism, .lyra-out, .orion-sheet, .orion-brief { animation: none; }
          .lisa-noise, .lyra-in { opacity: 0.55; }
          .orion-sheet { opacity: 0.08; }
        }
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

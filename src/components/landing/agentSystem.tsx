/**
 * AGENT DESIGN SYSTEM — the shared visual language for the AI workforce
 * sequence.
 *
 * The four agent stages must feel like one system while each one's MAIN
 * visualisation stays distinct (a monitoring network, a prospect radar, a
 * content engine, a briefing assembly). Everything that repeats between them
 * lives here so the typography, glass, line weight, status language and motion
 * stay identical; only the big graphic differs.
 *
 * PERFORMANCE. Everything animates on transform/opacity only. There are no
 * canvases, no particle systems and no per-frame layout reads — node positions
 * are computed once from simple trigonometry and the rest is CSS. Node counts
 * drop on small screens rather than being scaled down until illegible.
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Employee } from './employees';

/* ─────────────────────────────────────────────────────────── AGENT PORTRAIT ── */

/**
 * The agent, rendered as a presence rather than a headshot: a bloom in the
 * agent's accent, a soft rim, and a slow scan pass over the portrait.
 *
 * The scan and bloom are the only "AI" signals used — no HUD furniture, no
 * reticles. If real holographic renders land later they drop straight into the
 * same container and the treatment still reads.
 */
export const AgentPortrait = memo(function AgentPortrait({
  employee,
  size = 108,
  active = true,
  className,
}: {
  employee: Employee;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('agent-portrait relative shrink-0', className)}
      style={{ width: size, height: size, ['--a' as string]: employee.accent }}
      data-active={active ? 'true' : 'false'}
    >
      <span className="agent-portrait__bloom" aria-hidden="true" />
      <span className="agent-portrait__disc">
        {employee.portrait ? (
          <img
            src={employee.portrait}
            alt={`${employee.name} — ${employee.function}`}
            width={size * 2}
            height={size * 2}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span
            className="w-full h-full flex items-center justify-center font-display font-black"
            style={{ color: employee.accent, fontSize: size * 0.4 }}
          >
            {employee.initial}
          </span>
        )}
        <span className="agent-portrait__scan" aria-hidden="true" />
        <span className="agent-portrait__rim" aria-hidden="true" />
      </span>
    </div>
  );
});

/* ────────────────────────────────────────────────────────── AGENT IDENTITY ── */

export function AgentIdentity({
  employee,
  size = 'md',
}: {
  employee: Employee;
  size?: 'sm' | 'md';
}) {
  const big = size === 'md';
  return (
    <div className="min-w-0">
      <p
        className={cn('font-display font-black tracking-tight leading-none', big ? 'text-[19px]' : 'text-[13px]')}
        style={{ color: employee.accent }}
      >
        {employee.name}
      </p>
      <p className={cn('text-white/40 leading-tight mt-1', big ? 'text-[11.5px]' : 'text-[9.5px]')}>
        {employee.function}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── AGENT STATUS ── */

/** Live status. The dot pulses; the label is the agent's present-tense job. */
export function AgentStatus({ employee, label }: { employee: Employee; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="agent-status-dot" style={{ ['--a' as string]: employee.accent }} aria-hidden="true" />
      <span className="text-[10px] text-white/45">{label ?? employee.status}</span>
    </span>
  );
}

/**
 * A counter that ticks, so the workforce reads as working rather than posed.
 * Deliberately slow and small — this is a heartbeat, not a slot machine.
 */
export function LiveCounter({ from, to, suffix = '', period = 2600 }: { from: number; to: number; suffix?: string; period?: number }) {
  const [n, setN] = useState(from);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setN(to); return; }
    const id = setInterval(() => setN((v) => (v >= to ? from : v + Math.max(1, Math.round((to - from) / 24)))), period / 24);
    return () => clearInterval(id);
  }, [from, to, period]);
  return <span className="tabular-nums">{Math.min(n, to).toLocaleString()}{suffix}</span>;
}

/* ──────────────────────────────────────────────────────────── SMALL PIECES ── */

export function DepartmentBadge({ employee }: { employee: Employee }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[9.5px] font-mono uppercase tracking-[0.15em]"
      style={{ borderColor: `${employee.accent}33`, background: `${employee.accent}12`, color: employee.accent }}
    >
      {employee.tag}
    </span>
  );
}

export function CapabilityChip({ label, accent }: { label: string; accent: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md border px-2 py-[3px] text-[9px] font-mono uppercase tracking-[0.12em] text-white/55"
      style={{ borderColor: 'rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)', boxShadow: `inset 0 0 0 1px ${accent}0d` }}
    >
      {label}
    </span>
  );
}

/** A watched source or an input feeding an agent. */
export function DataSource({ label, detail, accent, dim }: { label: string; detail?: string; accent?: string; dim?: boolean }) {
  return (
    <div
      className="rounded-lg border px-2.5 py-1.5 transition-all duration-500"
      style={{
        borderColor: dim ? 'rgba(255,255,255,0.05)' : `${accent ?? '#10b981'}2e`,
        background: dim ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.04)',
        opacity: dim ? 0.32 : 1,
      }}
    >
      <p className="text-[10px] text-white/70 leading-tight truncate">{label}</p>
      {detail && <p className="text-[9px] text-white/30 leading-tight truncate mt-0.5">{detail}</p>}
    </div>
  );
}

/** A classified event produced by an agent. */
export function IntelligenceEvent({
  source,
  headline,
  tag,
  tone = 'default',
}: {
  source: string;
  headline: string;
  tag: string;
  tone?: 'urgent' | 'opportunity' | 'default';
}) {
  const toneColor = tone === 'urgent' ? '#f87171' : tone === 'opportunity' ? '#34d399' : 'rgba(255,255,255,0.4)';
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-white/25 truncate">{source}</span>
        <span
          className="text-[8.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-[2px] rounded shrink-0"
          style={{ color: toneColor, background: `${toneColor}14` }}
        >
          {tag}
        </span>
      </div>
      <p className="text-[11px] text-white/75 leading-snug">{headline}</p>
    </div>
  );
}

export function MetricCard({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="text-center">
      <div className="font-display font-black text-[20px] leading-none tabular-nums" style={{ color: accent ?? '#34d399' }}>
        {value}
      </div>
      <div className="text-[8.5px] font-mono uppercase tracking-[0.14em] text-white/25 mt-1.5">{label}</div>
    </div>
  );
}

/** A produced asset — a draft, a brief, a qualified account. */
export function OutputCard({ kind, title, accent }: { kind: string; title: string; accent: string }) {
  return (
    <div
      className="rounded-lg border px-3 py-2 text-left"
      style={{ borderColor: `${accent}26`, background: `linear-gradient(180deg, ${accent}0f, rgba(255,255,255,0.02))` }}
    >
      <p className="text-[8.5px] font-mono uppercase tracking-[0.14em] mb-1" style={{ color: accent }}>{kind}</p>
      <p className="text-[11px] text-white/80 leading-snug">{title}</p>
    </div>
  );
}

/** The recommendation Orion hands the founder. */
export function ActionRecommendation({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-[9px] font-mono text-emerald-400/70 mt-[3px] shrink-0">{n}</span>
      <span className="text-[11.5px] text-white/70 leading-snug">{text}</span>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── DATA FLOW ── */

/**
 * A luminous connection between two points in an SVG, with a packet running
 * along it. `delay` staggers packets so a group of lines reads as traffic
 * rather than a metronome.
 */
export function DataFlow({
  x1, y1, x2, y2, accent = '#10b981', delay = 0, dim = false, dashed = false,
}: {
  x1: number; y1: number; x2: number; y2: number;
  accent?: string; delay?: number; dim?: boolean; dashed?: boolean;
}) {
  return (
    <g opacity={dim ? 0.18 : 1}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={accent}
        strokeWidth={1}
        strokeOpacity={dim ? 0.2 : 0.3}
        strokeDasharray={dashed ? '3 6' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {!dim && (
        <circle r={2.1} fill={accent} className="flow-packet">
          <animateMotion dur="2.6s" repeatCount="indefinite" begin={`${delay}s`} path={`M${x1},${y1} L${x2},${y2}`} />
        </circle>
      )}
    </g>
  );
}

/** The shared context layer every agent reads from and writes to. */
export function SharedMemoryNode({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'relative rounded-xl border overflow-hidden',
        compact ? 'px-4 py-2.5' : 'px-5 py-3.5',
      )}
      style={{
        borderColor: 'rgba(16,185,129,0.28)',
        background: 'linear-gradient(180deg, rgba(16,185,129,0.14), rgba(16,185,129,0.03))',
        boxShadow: '0 0 30px rgba(16,185,129,0.12), inset 0 1px 0 rgba(255,255,255,0.07)',
      }}
    >
      <span className="memory-sweep" aria-hidden="true" />
      <p className="relative font-mono text-[9.5px] uppercase tracking-[0.2em] text-emerald-300/80">Shared memory</p>
      {!compact && (
        <p className="relative text-[10px] text-white/40 mt-1 leading-snug">
          Company context · ICP · Brand voice · Competitors · Past decisions
        </p>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── STYLES ── */

/**
 * Injected once by the sequence. Kept out of `src/index.css` — these are
 * component styles, not design tokens.
 */
export const AGENT_SYSTEM_STYLES = `
.agent-portrait { position: relative; }
.agent-portrait__bloom {
  position: absolute; inset: -22%; border-radius: 9999px; pointer-events: none;
  background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--a) 45%, transparent), transparent 66%);
  filter: blur(14px); opacity: 0.5; transition: opacity 700ms ease;
}
.agent-portrait[data-active="true"] .agent-portrait__bloom { opacity: 0.95; }
.agent-portrait__disc {
  position: absolute; inset: 0; border-radius: 9999px; overflow: hidden; display: block;
  border: 1px solid color-mix(in srgb, var(--a) 40%, transparent);
  box-shadow: 0 14px 40px -12px rgba(0,0,0,0.8);
  background: #07090c;
}
.agent-portrait__rim {
  position: absolute; inset: 0; border-radius: 9999px; pointer-events: none;
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.16), inset 0 -16px 26px -16px rgba(0,0,0,0.9);
}
/* A single slow pass. Enough to read as "scanning", not enough to distract. */
.agent-portrait__scan {
  position: absolute; left: 0; right: 0; height: 34%; pointer-events: none;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--a) 26%, transparent), transparent);
  animation: agentScan 4.5s ease-in-out infinite;
}
@keyframes agentScan { 0% { top: -34%; opacity: 0; } 18% { opacity: 1; } 82% { opacity: 1; } 100% { top: 100%; opacity: 0; } }

.agent-status-dot {
  width: 6px; height: 6px; border-radius: 9999px; background: var(--a);
  animation: agentStatusPulse 2.2s ease-in-out infinite;
}
@keyframes agentStatusPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--a) 45%, transparent); }
  70% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--a) 0%, transparent); }
}

.memory-sweep {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(52,211,153,0.16), transparent);
  transform: translateX(-100%); animation: memorySweep 5s ease-in-out infinite;
}
@keyframes memorySweep { 0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(100%); } }

@media (prefers-reduced-motion: reduce) {
  .agent-portrait__scan, .agent-status-dot, .memory-sweep, .flow-packet { animation: none !important; }
  .memory-sweep { opacity: 0; }
}
`;

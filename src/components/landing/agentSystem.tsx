/**
 * AGENT DESIGN SYSTEM — the shared visual language for the AI workforce
 * sequence.
 *
 * The four agents keep distinct main visualisations (a monitoring network, a
 * prospect radar, a content engine, a briefing). Everything structural is
 * shared so they read as four apps inside one operating system rather than
 * four different products.
 *
 * TYPE SCALE. Fixed here, in CSS, so no panel can drift:
 *
 *   panel title / status      12px      uppercase, 0.1em
 *   primary content           14–15px   what the visitor must actually read
 *   secondary                 12.5px    supporting detail
 *   micro                     11px      truly secondary only — never smaller
 *   metric value              26px      (30px when it is the point of the card)
 *   metric label              11px      light tracking; readability over style
 *
 * Nothing renders below 11px. Earlier passes used 8.5–10px, which looked
 * sophisticated at desk distance and was unreadable at normal viewing
 * distance.
 *
 * COLOUR. An agent's accent is allowed on exactly six things: portrait rim,
 * department chip, key visualisation lines, important nodes, the primary
 * metric, and the live status dot. Everything else stays neutral, which is
 * what keeps four accent colours from turning the page into confetti.
 *
 * PERFORMANCE. Transform and opacity only; no canvas, no particles, no
 * per-frame layout reads.
 */

import { memo, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Employee } from './employees';

/* ──────────────────────────────────────────────────────────── PANEL FRAME ── */

/**
 * The common right-panel frame: status bar, main visualisation, metric row.
 * All four agents use it, so bar height, padding, rules and metric alignment
 * are identical by construction rather than by discipline.
 */
export function AgentPanel({
  title,
  status,
  metrics,
  children,
}: {
  title: string;
  status?: ReactNode;
  metrics?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="agent-panel">
      <div className="agent-panel__bar">
        <span className="agent-panel__title">{title}</span>
        {status}
      </div>
      <div className="agent-panel__main">{children}</div>
      {metrics && <div className="agent-panel__metrics">{metrics}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── AGENT PORTRAIT ── */

/**
 * The agent as a presence: an accent bloom, a soft rim, a slow scan pass.
 * Every instance uses the same crop (`object-cover` on a circle with a fixed
 * focal point), the same rim weight and the same bloom radius, so no agent
 * reads as more prominent than another at equal size.
 */
export const AgentPortrait = memo(function AgentPortrait({
  employee,
  size = 96,
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
            className="agent-portrait__img"
          />
        ) : (
          <span
            className="w-full h-full flex items-center justify-center font-display font-black"
            style={{ color: employee.accent, fontSize: size * 0.4 }}
          >
            {employee.initial}
          </span>
        )}
        <span className="agent-portrait__rim" aria-hidden="true" />
      </span>
    </div>
  );
});

/* ────────────────────────────────────────────────────────── AGENT IDENTITY ── */

export function AgentIdentity({ employee, size = 'md' }: { employee: Employee; size?: 'sm' | 'md' }) {
  const big = size === 'md';
  return (
    <div className="min-w-0">
      <p
        className={cn('font-display font-black tracking-tight leading-none', big ? 'text-[21px]' : 'text-[16px]')}
        style={{ color: employee.accent }}
      >
        {employee.name}
      </p>
      <p className={cn('text-white/55 leading-tight mt-1.5', big ? 'text-[13px]' : 'text-[12px]')}>
        {employee.function}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── AGENT STATUS ── */

export function AgentStatus({ employee, label }: { employee: Employee; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="agent-status-dot" style={{ ['--a' as string]: employee.accent }} aria-hidden="true" />
      <span className="text-[12px] text-white/60">{label ?? employee.status}</span>
    </span>
  );
}

/** A slow tick, so the workforce reads as working. A heartbeat, not a counter. */
export function LiveCounter({ from, to, suffix = '', period = 2600 }: { from: number; to: number; suffix?: string; period?: number }) {
  const [n, setN] = useState(from);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(to); return; }
    const id = setInterval(() => setN((v) => (v >= to ? from : v + Math.max(1, Math.round((to - from) / 24)))), period / 24);
    return () => clearInterval(id);
  }, [from, to, period]);
  return <span className="tabular-nums">{Math.min(n, to).toLocaleString()}{suffix}</span>;
}

/* ──────────────────────────────────────────────────────────── SMALL PIECES ── */

export function DepartmentBadge({ employee }: { employee: Employee }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-3 py-[5px] text-[11px] font-mono uppercase tracking-[0.1em]"
      style={{ borderColor: `${employee.accent}42`, background: `${employee.accent}18`, color: employee.accent }}
    >
      {employee.tag}
    </span>
  );
}

export function CapabilityChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-[26px] rounded-md border border-white/[0.14] bg-white/[0.05] px-2.5 text-[11px] font-mono uppercase tracking-[0.06em] text-white/70">
      {label}
    </span>
  );
}

/** A watched source, or an input feeding an agent. */
export function DataSource({ kind, label, accent }: { kind?: string; label: string; accent?: string }) {
  return (
    <div
      className="rounded-lg border border-white/[0.1] px-3 py-2"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))' }}
    >
      {kind && (
        <p className="text-[11px] font-mono uppercase tracking-[0.1em] mb-1" style={{ color: accent ?? 'rgba(255,255,255,0.4)' }}>
          {kind}
        </p>
      )}
      <p className="text-[13px] text-white/85 leading-snug">{label}</p>
    </div>
  );
}

/** A classified event: who it came from, what changed, how it was graded. */
export function IntelligenceEvent({
  source,
  headline,
  tag,
  tone = 'default',
  detail,
}: {
  source: string;
  headline: string;
  tag: string;
  tone?: 'urgent' | 'opportunity' | 'default';
  detail?: string;
}) {
  const toneColor = tone === 'urgent' ? '#fb7185' : tone === 'opportunity' ? '#34d399' : 'rgba(255,255,255,0.55)';
  return (
    <div
      className="rounded-lg border border-white/[0.1] px-3.5 py-2.5"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))' }}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[11.5px] font-mono uppercase tracking-[0.1em] text-white/50 truncate">{source}</span>
        <span
          className="text-[11px] font-mono uppercase tracking-[0.08em] px-2 py-[3px] rounded shrink-0"
          style={{ color: toneColor, background: `${toneColor}1f` }}
        >
          {tag}
        </span>
      </div>
      <p className="text-[14px] text-white/90 leading-snug">{headline}</p>
      {detail && <p className="text-[12.5px] text-white/45 leading-snug mt-1">{detail}</p>}
    </div>
  );
}

/**
 * One number in the standard metric row. `primary` marks the number that is
 * the actual point of the card — for Lisa that is "4 worth knowing", not
 * "48 sources watched", because the value is the filtering.
 */
export function MetricCard({
  value,
  label,
  accent,
  primary = false,
}: {
  value: string;
  label: string;
  accent?: string;
  primary?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={cn('metric__value', primary && 'metric__value--primary')}
        style={{ color: primary ? accent ?? '#34d399' : 'rgba(255,255,255,0.92)', ['--a' as string]: accent ?? '#34d399' }}
      >
        {value}
      </div>
      <div className="metric__label">{label}</div>
    </div>
  );
}

/** A produced asset, styled to hint at the medium it will be published in. */
export function OutputCard({ kind, title, accent }: { kind: string; title: string; accent: string }) {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: `${accent}33`, background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))' }}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: accent }} />
        <span className="text-[11px] font-mono uppercase tracking-[0.1em]" style={{ color: accent }}>{kind}</span>
      </div>
      <p className="text-[13.5px] text-white/90 leading-snug px-3 pb-2.5">{title}</p>
    </div>
  );
}

export function ActionRecommendation({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-[13px] text-emerald-400/80 leading-snug shrink-0">→</span>
      <span className="text-[13.5px] text-white/75 leading-snug">{text}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── FEED ROW ── */

/**
 * The workhorse of every agent panel. Each agent's main area is now a list of
 * these rather than a diagram: a leading source or format, the thing that
 * happened, and how it was graded.
 *
 * Lists are what this class of software actually looks like, they are readable
 * in one pass, and using the same row everywhere makes the four panels
 * consistent by construction rather than by hand.
 */
export function FeedRow({
  lead,
  primary,
  meta,
  tag,
  tone = 'default',
  accent,
}: {
  lead: string;
  primary: string;
  meta?: string;
  tag?: string;
  tone?: 'urgent' | 'positive' | 'default';
  accent?: string;
}) {
  const toneColor =
    tone === 'urgent' ? '#fb7185' : tone === 'positive' ? '#34d399' : 'rgba(255,255,255,0.42)';
  return (
    <div className="feed-row">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[11.5px] font-mono uppercase tracking-[0.08em] text-white/40 truncate">{lead}</span>
        {tag && (
          <span className="text-[11px] font-mono uppercase tracking-[0.06em] shrink-0" style={{ color: tone === 'default' && accent ? accent : toneColor }}>
            {tag}
          </span>
        )}
      </div>
      <p className="text-[14.5px] text-white/90 leading-snug mt-1.5">{primary}</p>
      {meta && <p className="text-[12.5px] text-white/40 leading-snug mt-1">{meta}</p>}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── STYLES ── */

export const AGENT_SYSTEM_STYLES = `
.agent-panel {
  position: relative; width: 100%; min-width: 0; display: flex; flex-direction: column;
  border-radius: 18px; padding: 22px; overflow: hidden; isolation: isolate;
  border: 1px solid rgba(255,255,255,0.075);
  background:
    linear-gradient(168deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.012) 34%, rgba(4,7,9,0.5) 100%),
    rgba(6,9,11,0.52);
  backdrop-filter: blur(22px) saturate(125%);
  -webkit-backdrop-filter: blur(22px) saturate(125%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.12),
    inset 0 -1px 0 rgba(0,0,0,0.4),
    0 26px 60px -30px rgba(0,0,0,0.95);
}
/* A slow reflection travelling the surface, so the glass reads as material. */
.agent-panel::before {
  content: ''; position: absolute; inset: -40% -10%; z-index: -1; pointer-events: none;
  background: linear-gradient(102deg, transparent 40%, rgba(255,255,255,0.05) 50%, transparent 60%);
  transform: translateX(-60%); animation: panelSheen 18s ease-in-out infinite;
}
@keyframes panelSheen { 0%, 70% { transform: translateX(-60%); } 96%, 100% { transform: translateX(60%); } }
.agent-panel__bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.09);
}
.agent-panel__title {
  font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 0.1em;
  text-transform: uppercase; color: rgba(255,255,255,0.5);
}
.agent-panel__main { flex: 1; min-height: 0; display: flex; perspective: 1200px; }

/* ── 3D SCENES ─────────────────────────────────────────────────────────────
   One metaphor per agent, built from planes rather than objects: a filter, a
   scanned field, a prism, a compressing stack. Transform and opacity only. */
.scene {
  position: relative; flex: 1; min-width: 0;
  transform-style: preserve-3d; --hx: 0; --hy: 0;
}
.scene__layer { position: absolute; inset: 0; transform-style: preserve-3d; }
/* Depth tiers. Foreground lifts more under the cursor than background. */
.tier-back  { transform: translate3d(calc(var(--hx) * 2px),  calc(var(--hy) * 2px),  -60px); transition: transform 600ms cubic-bezier(0.22,1,0.36,1); }
.tier-mid   { transform: translate3d(calc(var(--hx) * 4px),  calc(var(--hy) * 4px),   0);    transition: transform 600ms cubic-bezier(0.22,1,0.36,1); }
.tier-front { transform: translate3d(calc(var(--hx) * 7px),  calc(var(--hy) * 7px),  46px);  transition: transform 600ms cubic-bezier(0.22,1,0.36,1); }

/* A pane of the same smoked glass, used for every surface inside a scene. */
.pane {
  border-radius: 12px; border: 1px solid rgba(255,255,255,0.09);
  background: linear-gradient(170deg, rgba(255,255,255,0.07), rgba(255,255,255,0.015) 60%, rgba(0,0,0,0.25));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.13), 0 14px 30px -20px rgba(0,0,0,0.9);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.pane--ghost { border-color: rgba(255,255,255,0.05); background: rgba(255,255,255,0.022); box-shadow: none; backdrop-filter: none; }

@media (prefers-reduced-motion: reduce) {
  .agent-panel::before { animation: none; opacity: 0; }
  .tier-back, .tier-mid, .tier-front { transition: none; }
}
.feed-list { display: flex; flex-direction: column; width: 100%; }
.feed-row { padding: 13px 0; border-bottom: 1px solid rgba(255,255,255,0.055); }
.feed-row:first-child { padding-top: 0; }
.feed-row:last-child { border-bottom: 0; padding-bottom: 0; }
.agent-panel__metrics {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.09);
}
.metric__value {
  font-family: var(--font-display, inherit); font-weight: 900; font-size: 26px;
  line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums;
}
/* The number the card actually exists to show. */
.metric__value--primary { font-size: 30px; text-shadow: 0 0 22px color-mix(in srgb, var(--a) 45%, transparent); }
.metric__label {
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin-top: 6px; line-height: 1.2;
}

.agent-portrait { position: relative; }
.agent-portrait__bloom {
  position: absolute; inset: -20%; border-radius: 9999px; pointer-events: none;
  background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--a) 26%, transparent), transparent 68%);
  filter: blur(16px); opacity: 0.35; transition: opacity 700ms ease;
}
.agent-portrait[data-active="true"] .agent-portrait__bloom { opacity: 0.5; }
.agent-portrait__disc {
  position: absolute; inset: 0; border-radius: 9999px; overflow: hidden; display: block;
  border: 1px solid color-mix(in srgb, var(--a) 42%, transparent);
  box-shadow: 0 12px 34px -12px rgba(0,0,0,0.85);
  background: #07090c;
}
/* One crop for every agent: same scale, same focal point, so none reads larger. */
.agent-portrait__img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 22%; }
.agent-portrait__rim {
  position: absolute; inset: 0; border-radius: 9999px; pointer-events: none;
  box-shadow: inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -14px 24px -14px rgba(0,0,0,0.9);
}

.agent-status-dot {
  width: 7px; height: 7px; border-radius: 9999px; background: var(--a); flex-shrink: 0;
  animation: agentStatusPulse 2.2s ease-in-out infinite;
}
@keyframes agentStatusPulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--a) 50%, transparent); }
  70% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--a) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .agent-status-dot { animation: none !important; }
}
`;

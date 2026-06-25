import { memo } from 'react';
import { AGENT_ACCENT, getThumbnailVariant, type ThumbnailVariant } from '@/lib/workflows/visualMeta';
import type { WorkflowDefinition } from '@/lib/workflows/registry';

interface Props {
  workflow: WorkflowDefinition;
  height?: number;
  className?: string;
}

/**
 * Symbolic SVG thumbnail for a workflow. Pure presentational.
 * Each variant communicates what the workflow produces.
 */
function WorkflowThumbnailImpl({ workflow, height = 112, className }: Props) {
  const variant = getThumbnailVariant(workflow);
  const accent = AGENT_ACCENT[workflow.primaryAgent];
  return (
    <div
      className={`relative w-full overflow-hidden rounded-t-card border-b border-white/[0.06] ${className || ''}`}
      style={{
        height,
        background: `radial-gradient(120% 80% at 50% 0%, ${accent.glow} 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0))`,
      }}
    >
      {/* Faint grid underlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.06]" aria-hidden>
        <defs>
          <pattern id={`wf-grid-${workflow.id}`} width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M 22 0 L 0 0 0 22" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#wf-grid-${workflow.id})`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200 opacity-90 group-hover:opacity-100">
        <Glyph variant={variant} color={accent.hex} />
      </div>
      {/* top sheen */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}

export default memo(WorkflowThumbnailImpl);

function Glyph({ variant, color }: { variant: ThumbnailVariant; color: string }) {
  const stroke = color;
  const soft = `${color}55`;
  const softer = `${color}22`;
  switch (variant) {
    case 'radar':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <circle cx="100" cy="60" r="12" stroke={stroke} strokeOpacity="0.8" />
          <circle cx="100" cy="60" r="26" stroke={stroke} strokeOpacity="0.45" />
          <circle cx="100" cy="60" r="40" stroke={stroke} strokeOpacity="0.22" />
          <line x1="100" y1="60" x2="140" y2="30" stroke={stroke} strokeOpacity="0.7" strokeWidth="1.2" />
          {[
            [62, 38], [148, 24], [156, 64], [70, 70],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.4" fill={stroke} />
          ))}
        </svg>
      );
    case 'target':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <circle cx="100" cy="44" r="32" stroke={stroke} strokeOpacity="0.35" />
          <circle cx="100" cy="44" r="20" stroke={stroke} strokeOpacity="0.6" />
          <circle cx="100" cy="44" r="8" fill={soft} stroke={stroke} />
          <line x1="60" y1="44" x2="140" y2="44" stroke={stroke} strokeOpacity="0.25" />
          <line x1="100" y1="8" x2="100" y2="80" stroke={stroke} strokeOpacity="0.25" />
          {[[44, 20], [156, 22], [50, 70], [150, 68]].map(([x, y], i) => (
            <rect key={i} x={x - 8} y={y - 4} width="16" height="8" rx="2" fill={softer} stroke={stroke} strokeOpacity="0.55" />
          ))}
        </svg>
      );
    case 'org':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="86" y="10" width="28" height="14" rx="3" fill={soft} stroke={stroke} />
          <line x1="100" y1="24" x2="100" y2="38" stroke={stroke} strokeOpacity="0.5" />
          <line x1="50" y1="38" x2="150" y2="38" stroke={stroke} strokeOpacity="0.5" />
          {[40, 92, 144].map((x, i) => (
            <g key={i}>
              <line x1={x + 14} y1="38" x2={x + 14} y2="52" stroke={stroke} strokeOpacity="0.5" />
              <rect x={x} y={52} width="28" height="14" rx="3" fill={softer} stroke={stroke} strokeOpacity="0.7" />
              <circle cx={x + 6} cy={59} r="2.2" fill={stroke} />
            </g>
          ))}
        </svg>
      );
    case 'stack':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          {[0, 1, 2].map((i) => (
            <rect key={i} x={60 + i * 6} y={14 + i * 10} width="92" height="44" rx="6" fill={softer} stroke={stroke} strokeOpacity={0.4 + i * 0.18} />
          ))}
          <line x1="76" y1="44" x2="130" y2="44" stroke={stroke} strokeOpacity="0.7" />
          <line x1="76" y1="52" x2="116" y2="52" stroke={stroke} strokeOpacity="0.45" />
        </svg>
      );
    case 'lens':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="46" y="20" width="80" height="50" rx="6" fill={softer} stroke={stroke} strokeOpacity="0.5" />
          <line x1="58" y1="36" x2="112" y2="36" stroke={stroke} strokeOpacity="0.5" />
          <line x1="58" y1="46" x2="100" y2="46" stroke={stroke} strokeOpacity="0.35" />
          <circle cx="140" cy="50" r="18" stroke={stroke} strokeWidth="1.5" />
          <line x1="153" y1="63" x2="166" y2="76" stroke={stroke} strokeWidth="2" />
        </svg>
      );
    case 'browser':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="38" y="14" width="124" height="60" rx="6" fill={softer} stroke={stroke} strokeOpacity="0.5" />
          <line x1="38" y1="28" x2="162" y2="28" stroke={stroke} strokeOpacity="0.5" />
          <circle cx="46" cy="21" r="1.6" fill={stroke} />
          <circle cx="52" cy="21" r="1.6" fill={stroke} opacity="0.6" />
          <circle cx="58" cy="21" r="1.6" fill={stroke} opacity="0.3" />
          <rect x="46" y="36" width="60" height="6" rx="2" fill={soft} />
          <rect x="46" y="48" width="100" height="4" rx="2" fill={stroke} opacity="0.35" />
          <rect x="46" y="56" width="80" height="4" rx="2" fill={stroke} opacity="0.25" />
        </svg>
      );
    case 'message':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="46" y="14" width="108" height="56" rx="8" fill={softer} stroke={stroke} strokeOpacity="0.5" />
          <line x1="58" y1="30" x2="120" y2="30" stroke={stroke} strokeOpacity="0.6" />
          <line x1="58" y1="40" x2="138" y2="40" stroke={stroke} strokeOpacity="0.4" />
          <line x1="58" y1="50" x2="110" y2="50" stroke={stroke} strokeOpacity="0.4" />
          <rect x="118" y="56" width="28" height="10" rx="3" fill={soft} stroke={stroke} />
        </svg>
      );
    case 'wave':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="40" y="22" width="20" height="44" rx="4" fill={softer} stroke={stroke} strokeOpacity="0.5" />
          <circle cx="50" cy="30" r="2" fill={stroke} />
          {Array.from({ length: 14 }).map((_, i) => {
            const x = 72 + i * 8;
            const h = 8 + Math.abs(Math.sin(i * 0.9)) * 30;
            return <rect key={i} x={x} y={44 - h / 2} width="3" height={h} rx="1.5" fill={stroke} opacity={0.45 + (i % 3) * 0.18} />;
          })}
        </svg>
      );
    case 'feed':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="46" y="12" width="108" height="64" rx="8" fill={softer} stroke={stroke} strokeOpacity="0.5" />
          <circle cx="60" cy="26" r="6" fill={soft} stroke={stroke} strokeOpacity="0.6" />
          <rect x="72" y="22" width="60" height="4" rx="2" fill={stroke} opacity="0.5" />
          <rect x="72" y="30" width="40" height="3" rx="1.5" fill={stroke} opacity="0.3" />
          <line x1="56" y1="44" x2="144" y2="44" stroke={stroke} strokeOpacity="0.35" />
          <line x1="56" y1="52" x2="138" y2="52" stroke={stroke} strokeOpacity="0.3" />
          <line x1="56" y1="60" x2="120" y2="60" stroke={stroke} strokeOpacity="0.25" />
        </svg>
      );
    case 'briefing':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="56" y="10" width="88" height="68" rx="6" fill={softer} stroke={stroke} strokeOpacity="0.5" />
          <rect x="64" y="20" width="40" height="6" rx="2" fill={soft} />
          <line x1="64" y1="34" x2="136" y2="34" stroke={stroke} strokeOpacity="0.4" />
          <line x1="64" y1="42" x2="124" y2="42" stroke={stroke} strokeOpacity="0.3" />
          <line x1="64" y1="50" x2="130" y2="50" stroke={stroke} strokeOpacity="0.3" />
          <circle cx="68" cy="64" r="2" fill={stroke} />
          <line x1="74" y1="64" x2="136" y2="64" stroke={stroke} strokeOpacity="0.3" />
        </svg>
      );
    case 'versus':
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <rect x="40" y="18" width="60" height="22" rx="4" fill={softer} stroke={stroke} strokeOpacity="0.55" />
          <rect x="100" y="48" width="60" height="22" rx="4" fill={softer} stroke={stroke} strokeOpacity="0.55" />
          <line x1="50" y1="29" x2="92" y2="29" stroke={stroke} strokeOpacity="0.5" />
          <line x1="110" y1="59" x2="152" y2="59" stroke={stroke} strokeOpacity="0.5" />
          <text x="100" y="46" textAnchor="middle" fontSize="11" fontFamily="monospace" fill={stroke} opacity="0.7">vs</text>
        </svg>
      );
    case 'gear':
    default:
      return (
        <svg width="200" height="88" viewBox="0 0 200 88" fill="none">
          <circle cx="100" cy="44" r="22" stroke={stroke} strokeOpacity="0.55" />
          <circle cx="100" cy="44" r="8" fill={soft} stroke={stroke} />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const x1 = 100 + Math.cos(a) * 26;
            const y1 = 44 + Math.sin(a) * 26;
            const x2 = 100 + Math.cos(a) * 32;
            const y2 = 44 + Math.sin(a) * 32;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeOpacity="0.6" strokeWidth="2" />;
          })}
        </svg>
      );
  }
}

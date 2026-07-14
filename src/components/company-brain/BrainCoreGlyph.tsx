// Custom "Company Brain" intelligence-core glyph.
//
// Replaces the generic lucide Brain icon with a distinctive Agentory symbol:
// nested cortex-arc layers + a glowing central node + synaptic endpoints.
// Abstract, modern, unique — not a stock brain or chip icon.
//
// Accepts className/style like a standard icon component so it drops into the
// existing orb and hero icon slots without changes.

import type { CSSProperties } from 'react';

export function BrainCoreGlyph({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* outer cortex arc — open C shape suggesting a receiving layer */}
      <path
        d="M17.2 7.8a7 7 0 1 0 0 8.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.32"
      />
      {/* middle cortex arc */}
      <path
        d="M14.6 9.8a4.6 4.6 0 1 0 0 4.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* inner synaptic arc */}
      <path
        d="M12.6 11a1.6 1.6 0 1 0 0 2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* central intelligence node */}
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      {/* synaptic endpoints */}
      <circle cx="18.5" cy="6.2" r="1.05" fill="currentColor" opacity="0.5" />
      <circle cx="18.5" cy="17.8" r="1.05" fill="currentColor" opacity="0.5" />
      {/* faint connecting filaments */}
      <path
        d="M17.8 7L14.5 9.5M17.8 17L14.5 14.5"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}

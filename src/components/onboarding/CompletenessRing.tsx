// Animated circular completeness ring for the Company Brain preview + Activate step.
// SVG only, uses semantic tokens (primary + muted) so it themes correctly.

import { motion } from 'framer-motion';

interface Props {
  /** 0-100 */
  value: number;
  size?: number;
  stroke?: number;
  /** Small caption under the percentage. */
  caption?: string;
}

export function CompletenessRing({ value, size = 140, stroke = 10, caption }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="hsl(var(--border))"
          strokeWidth={stroke}
          fill="none"
          strokeOpacity={0.5}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="hsl(var(--primary))"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
          style={{ filter: 'drop-shadow(0 0 10px hsl(var(--primary) / 0.35))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{clamped}%</span>
        {caption && <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}

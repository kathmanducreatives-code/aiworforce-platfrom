import { motion } from 'framer-motion';

interface Props {
  /** 0..1 */
  value: number;
  size?: number;
  label?: string;
}

export default function ReadinessRing({ value, size = 96, label = 'Agent Readiness' }: Props) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const offset = c * (1 - v);
  const pct = Math.round(v * 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="hsl(var(--border))"
            strokeWidth={stroke}
            fill="none"
            opacity={0.4}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="rgb(16,185,129)"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={false}
            animate={{ strokeDashoffset: offset }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            style={{ filter: 'drop-shadow(0 0 8px rgba(16,185,129,0.55))' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-foreground tabular-nums">{pct}%</span>
        </div>
      </div>
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
        {label}
      </span>
    </div>
  );
}

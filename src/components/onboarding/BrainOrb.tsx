import { motion } from 'framer-motion';

const AGENTS = [
  { name: 'Pilot',  color: 'rgb(16,185,129)' },
  { name: 'Scout',  color: 'rgb(45,212,191)' },
  { name: 'Aria',   color: 'rgb(167,139,250)' },
  { name: 'Hawk',   color: 'rgb(244,180,0)' },
  { name: 'Penn',   color: 'rgb(96,165,250)' },
  { name: 'Scribe', color: 'rgb(251,113,133)' },
];

interface Props {
  size?: number;
  active?: boolean;
}

export default function BrainOrb({ size = 260, active = false }: Props) {
  const radius = size * 0.42;
  const center = size / 2;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      {/* outer halo */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(16,185,129,0.35), rgba(16,185,129,0.06) 55%, transparent 75%)',
          filter: 'blur(12px)',
        }}
        animate={{ opacity: active ? [0.6, 1, 0.6] : [0.4, 0.7, 0.4] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* connecting lines */}
      <svg width={size} height={size} className="absolute inset-0 pointer-events-none">
        {AGENTS.map((a, i) => {
          const angle = (i / AGENTS.length) * Math.PI * 2 - Math.PI / 2;
          const x = center + Math.cos(angle) * radius;
          const y = center + Math.sin(angle) * radius;
          return (
            <line
              key={a.name}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke={a.color}
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          );
        })}
      </svg>
      {/* central brain */}
      <div
        className="absolute rounded-full border border-primary/50 bg-gradient-to-br from-emerald-400/20 to-emerald-700/10 backdrop-blur-xl shadow-[0_0_60px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.12)]"
        style={{
          left: center - size * 0.18,
          top: center - size * 0.18,
          width: size * 0.36,
          height: size * 0.36,
        }}
      >
        <div className="absolute inset-0 rounded-full flex items-center justify-center">
          <div className="text-[10px] tracking-[0.25em] uppercase text-primary/90 font-semibold">Brain</div>
        </div>
      </div>
      {/* agent nodes */}
      {AGENTS.map((a, i) => {
        const angle = (i / AGENTS.length) * Math.PI * 2 - Math.PI / 2;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        return (
          <motion.div
            key={a.name}
            className="absolute flex flex-col items-center"
            style={{ left: x - 28, top: y - 28, width: 56 }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.4, ease: 'easeOut' }}
          >
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-[11px] font-semibold text-white border border-white/15 shadow-[0_0_18px_rgba(0,0,0,0.4)]"
              style={{
                background: `radial-gradient(circle at 30% 25%, ${a.color}, rgba(20,20,28,0.8))`,
              }}
            >
              {a.name[0]}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground tracking-wide">{a.name}</div>
          </motion.div>
        );
      })}
    </div>
  );
}

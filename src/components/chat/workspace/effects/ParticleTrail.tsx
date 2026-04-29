import { motion } from 'framer-motion';

interface Props {
  /** number of dots */
  count?: number;
  className?: string;
}

export default function ParticleTrail({ count = 4, className }: Props) {
  return (
    <div className={`relative h-6 w-32 ${className ?? ''}`} aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 128 24">
        <path d="M4 12 Q 64 -8 124 12" stroke="hsl(var(--primary)/0.3)" strokeWidth="1" fill="none" strokeDasharray="2 3" />
        {Array.from({ length: count }).map((_, i) => (
          <motion.circle
            key={i}
            r="2"
            fill="hsl(var(--primary))"
            initial={{ offsetDistance: '0%', opacity: 0 }}
            animate={{ offsetDistance: '100%', opacity: [0, 1, 1, 0] }}
            transition={{ duration: 0.8, delay: i * 0.08, repeat: Infinity, repeatDelay: 1.4 }}
            style={{ offsetPath: 'path("M4 12 Q 64 -8 124 12")' } as any}
          />
        ))}
      </svg>
    </div>
  );
}

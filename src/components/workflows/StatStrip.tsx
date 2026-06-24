import { Sparkles, CheckCircle2, Wrench, History } from 'lucide-react';

interface StatStripProps {
  recommended: number;
  ready: number;
  setupNeeded: number;
  runs: number;
}

const TILES = [
  { key: 'recommended', label: 'Recommended', icon: Sparkles, tint: 'text-emerald-300', glow: 'rgba(16,185,129,0.18)' },
  { key: 'ready', label: 'Ready to run', icon: CheckCircle2, tint: 'text-teal-300', glow: 'rgba(45,212,191,0.16)' },
  { key: 'setup', label: 'Setup needed', icon: Wrench, tint: 'text-amber-300', glow: 'rgba(251,191,36,0.14)' },
  { key: 'runs', label: 'Recent runs', icon: History, tint: 'text-sky-300', glow: 'rgba(56,189,248,0.16)' },
] as const;

export default function StatStrip({ recommended, ready, setupNeeded, runs }: StatStripProps) {
  const values: Record<string, number> = { recommended, ready, setup: setupNeeded, runs };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {TILES.map((t) => {
        const Icon = t.icon;
        return (
          <div
            key={t.key}
            className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] backdrop-blur-xl p-4"
            style={{ background: `radial-gradient(120% 80% at 0% 0%, ${t.glow} 0%, rgba(0,0,0,0) 60%), rgba(255,255,255,0.025)` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-mono uppercase tracking-[0.14em] text-neutral-400">{t.label}</span>
              <Icon className={`w-3.5 h-3.5 ${t.tint}`} />
            </div>
            <div className="mt-2 text-[26px] font-semibold tracking-tight text-foreground tabular-nums">{values[t.key]}</div>
          </div>
        );
      })}
    </div>
  );
}

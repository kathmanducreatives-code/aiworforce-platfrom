import { resolveEnvironmentGate } from '@/lib/env/environmentGate';

/**
 * A persistent badge naming the Supabase project this build is talking to.
 *
 * Null in production, so the production bundle is visually unchanged. Everywhere
 * else it is deliberately hard to miss: the 2026-07-26 run was believed to be on
 * TEST while it was writing to the live project.
 */
export default function EnvironmentBadge() {
  const gate = resolveEnvironmentGate({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    DEV: !!import.meta.env.DEV,
  });
  if (!gate.badge) return null;

  const isProd = gate.environment === 'production';
  return (
    <div
      className={`fixed bottom-2 left-2 z-[9999] pointer-events-none select-none rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider shadow-lg ${
        isProd
          ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
          : 'border-amber-500/40 bg-amber-500/15 text-amber-200'
      }`}
    >
      {gate.badge}
    </div>
  );
}

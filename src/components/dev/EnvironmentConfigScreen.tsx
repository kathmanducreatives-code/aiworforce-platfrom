import type { EnvironmentGate } from '@/lib/env/environmentGate';

/**
 * The blocking screen shown INSTEAD of the app when local development has no
 * explicit Supabase target.
 *
 * Previously this state rendered a blank page (the client threw during module
 * import) — or, worse, silently connected to production. Nothing here reads or
 * renders a key; only the resolved project ref and the remediation steps.
 */
export default function EnvironmentConfigScreen({ gate }: { gate: EnvironmentGate }) {
  return (
    <div className="min-h-screen w-full bg-[#0d1117] text-[#C9D1D9] flex items-center justify-center p-6">
      <div className="max-w-[560px] w-full rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-amber-400/90">
          Configuration required
        </div>
        <h1 className="mt-1.5 text-[19px] font-bold text-white tracking-tight">{gate.title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#C9D1D9]">{gate.message}</p>

        <ol className="mt-4 space-y-1.5">
          {gate.instructions.map((line, i) => (
            <li key={line} className="flex gap-2 text-[13px] text-[#C9D1D9]">
              <span className="text-amber-400/80 tabular-nums shrink-0">{i + 1}.</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>

        <pre className="mt-4 rounded-lg border border-white/[0.08] bg-black/40 p-3 text-[12px] text-[#8B949E] overflow-x-auto">
{`# .env.local  (gitignored — never commit it)
VITE_SUPABASE_URL=https://zbwsbnqqpkvdhqwavjke.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<the TEST project's publishable key>`}
        </pre>

        <p className="mt-3 text-[12px] text-[#7D8590]">
          Keys are never displayed here. Copy the publishable key from the Supabase
          dashboard for the project you intend to use.
        </p>
      </div>
    </div>
  );
}

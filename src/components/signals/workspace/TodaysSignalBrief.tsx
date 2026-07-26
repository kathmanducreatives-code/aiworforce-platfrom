// TodaysSignalBrief — single featured card summarising today's radar output.
// Empty state shows one Run-radar-scan CTA; populated state shows one Review CTA.

import { Radar, ChevronRight, Loader2 } from 'lucide-react';
import type { RadarBrief } from '@/lib/radarBrief';

interface Props {
  brief: RadarBrief;
  scanning: boolean;
  onRunScan: () => void;
  onReview: () => void;
  accentHex: string;
}

export default function TodaysSignalBrief({ brief, scanning, onRunScan, onReview, accentHex }: Props) {
  return (
    <section
      aria-label="Today's signal brief"
      className="mb-5 overflow-hidden rounded-xl border bg-gradient-to-br from-white/[0.03] to-transparent p-4 backdrop-blur-md"
      style={{ borderColor: `${accentHex}26` }}
    >
      <header className="mb-2 flex items-center justify-between">
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: `${accentHex}CC` }}
        >
          Today's signal brief
        </p>
        <Radar className="h-3.5 w-3.5" style={{ color: `${accentHex}99` }} />
      </header>

      {brief.isEmpty ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-foreground">No verified signals yet</h3>
            <p className="mt-1 max-w-[64ch] text-[13.5px] text-muted-foreground/85">
              Scout has not confirmed new signals for your ICP. Run a radar scan or ask Scout what to monitor.
            </p>
            {brief.missingSources.length > 0 && (
              <p className="mt-2 text-[12px] text-amber-300/80">
                Missing sources: {brief.missingSources.join(', ')}
              </p>
            )}
          </div>
          <button
            onClick={onRunScan}
            disabled={scanning}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-all hover:brightness-110 disabled:opacity-60 active:scale-[0.97]"
            style={{ background: `${accentHex}1F`, borderColor: `${accentHex}55`, color: accentHex }}
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            {scanning ? 'Scanning…' : 'Run radar scan'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold text-foreground">
              {brief.strongestType
                ? `${brief.strongestType.count} ${brief.strongestType.label.toLowerCase()} ${brief.strongestType.count === 1 ? 'signal' : 'signals'} lead the day`
                : `${brief.usefulCount} verified ${brief.usefulCount === 1 ? 'signal' : 'signals'} available`}
            </h3>
            {brief.topAction && (
              <p className="mt-1 text-[13.5px] text-muted-foreground/85">
                <span className="text-foreground/90">{brief.topAction.company ?? 'Top opportunity'}:</span>{' '}
                {brief.topAction.action}
              </p>
            )}
            <p className="mt-1 text-[12.5px] text-muted-foreground/60">
              {brief.usefulCount} verified · Scout is monitoring your radar.
            </p>
          </div>
          <button
            onClick={onReview}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-all hover:brightness-110 active:scale-[0.97]"
            style={{ background: `${accentHex}1F`, borderColor: `${accentHex}55`, color: accentHex }}
          >
            Review signals
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}

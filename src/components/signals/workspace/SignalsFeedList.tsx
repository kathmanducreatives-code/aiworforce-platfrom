// SignalsFeedList — compact list of recommended signals reusing the existing
// SignalCardRouter for per-type presentation. Data comes from useSignalFeed.

import type { FeedSignal } from '@/lib/signalFeedModel';
import SignalCardRouter from '@/components/signals/SignalCardRouter';
import { Inbox } from 'lucide-react';
import { GLASS_PANEL } from '@/components/layout/workspaceStyles';

interface Props {
  signals: FeedSignal[];
  loading: boolean;
  emptyLabel?: string;
  accentHex: string;
}

export default function SignalsFeedList({ signals, loading, emptyLabel, accentHex }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-24 animate-pulse rounded-xl ${GLASS_PANEL}`} />
        ))}
      </div>
    );
  }

  if (!signals.length) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.09] bg-[rgba(10,13,12,0.45)] py-12 text-center backdrop-blur-xl"
      >
        <span
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border"
          style={{ borderColor: `${accentHex}40`, background: `${accentHex}14`, boxShadow: `0 10px 30px -12px ${accentHex}80` }}
        >
          <Inbox className="h-[18px] w-[18px]" style={{ color: accentHex }} />
        </span>
        <p className="text-[13.5px] text-foreground/85">{emptyLabel ?? 'No signals in this view yet.'}</p>
        <p className="mt-1 text-[12px] text-muted-foreground/65">
          Run a scan or adjust the filter to widen the results.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p
        className="text-[10.5px] font-semibold uppercase tracking-[0.22em]"
        style={{ color: `${accentHex}CC` }}
      >
        Recommended signals
      </p>
      {signals.map((s) => (
        <SignalCardRouter
          key={s.id}
          signal={{
            signal_type: s.signal_type,
            title: s.title,
            source_url: s.source_url,
            raw: s.raw,
          }}
        />
      ))}
    </div>
  );
}

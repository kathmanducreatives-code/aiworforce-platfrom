// SignalsFeedList — compact list of recommended signals reusing the existing
// SignalCardRouter for per-type presentation. Data comes from useSignalFeed.

import type { FeedSignal } from '@/lib/signalFeedModel';
import SignalCardRouter from '@/components/signals/SignalCardRouter';
import { Inbox } from 'lucide-react';

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
          <div key={i} className="h-24 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.02]" />
        ))}
      </div>
    );
  }

  if (!signals.length) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center"
        style={{ borderColor: `${accentHex}22` }}
      >
        <Inbox className="mb-2 h-6 w-6" style={{ color: `${accentHex}99` }} />
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

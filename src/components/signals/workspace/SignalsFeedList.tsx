// SignalsFeedList — compact list of recommended signals reusing the existing
// SignalCardRouter for per-type presentation. Data comes from useSignalFeed.

import DepartmentEmptyState from '@/components/layout/department/DepartmentEmptyState';
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
      <DepartmentEmptyState
        framed
        icon={Inbox}
        title={emptyLabel ?? 'No signals in this view yet.'}
        description="Run a scan or adjust the filter to widen the results."
      />
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

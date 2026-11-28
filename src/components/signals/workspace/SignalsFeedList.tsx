// SignalsFeedList — every signal row, canonical or legacy, on ONE card (CanonicalSignalCard) with
// its provenance and the user's review actions (Signals recovery). LISA's types are no longer
// counted-but-invisible. Data comes from useSignalFeed; reviews from useSignalReviews.

import DepartmentEmptyState from '@/components/layout/department/DepartmentEmptyState';
import type { FeedSignal } from '@/lib/signalFeedModel';
import CanonicalSignalCard, { type CardReview } from '@/components/signals/workspace/CanonicalSignalCard';
import { Inbox } from 'lucide-react';
import { GLASS_PANEL } from '@/components/layout/workspaceStyles';

interface Props {
  signals: FeedSignal[];
  loading: boolean;
  emptyLabel?: string;
  emptyDescription?: string;
  accentHex: string;
  reviewStatusOf?: (id: string) => string | null | undefined;
  onReview?: (id: string, status: CardReview) => void | Promise<void>;
}

export default function SignalsFeedList({ signals, loading, emptyLabel, emptyDescription, accentHex, reviewStatusOf, onReview }: Props) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading signals">
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
        description={emptyDescription ?? 'Run a scan, activate a monitoring plan, or widen the filters.'}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="signals-feed">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em]" style={{ color: `${accentHex}CC` }}>
        Signals ({signals.length})
      </p>
      {signals.map((s) => (
        <CanonicalSignalCard
          key={s.id}
          signal={s}
          accentHex={accentHex}
          reviewStatus={reviewStatusOf?.(s.id) ?? null}
          onReview={onReview ? (st) => onReview(s.id, st) : undefined}
        />
      ))}
    </div>
  );
}

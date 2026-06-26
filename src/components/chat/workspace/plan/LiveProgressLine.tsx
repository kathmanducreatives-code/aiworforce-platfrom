import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { pickProgressLine, type WorkflowStageKey } from '@/lib/chat/progressCopy';

interface Props {
  stage: WorkflowStageKey;
  /** When true, also surface the long-running fallback line periodically. */
  longRunning?: boolean;
  intervalMs?: number;
}

/**
 * Rotating, workforce-flavoured live progress text shown beneath an
 * active execution step. The rotation is purely presentational — it
 * does not fake progress; it just keeps the UI alive while the backend
 * is still working.
 */
export default function LiveProgressLine({ stage, longRunning = false, intervalMs = 3200 }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  const effectiveStage: WorkflowStageKey = longRunning && tick % 4 === 3 ? 'long_running' : stage;
  const line = pickProgressLine(effectiveStage, tick);

  return (
    <div
      className="mt-2 flex items-center gap-2 text-[12px] text-[#9aa4af]"
      aria-live="polite"
      role="status"
    >
      <Loader2 className="h-3 w-3 animate-spin text-emerald-300" />
      <span className="truncate">{line}</span>
    </div>
  );
}

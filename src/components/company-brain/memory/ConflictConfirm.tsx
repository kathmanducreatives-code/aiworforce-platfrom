// Company Brain V2 · B2.3 — a memory item that disagrees with the business profile.
// Shown wherever something is about to be remembered (Teach Agentory, the review
// queue, ORION's chat offer). Nothing is saved until the person chooses.
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ConflictConfirm({ conflict, busy, onConfirm, onCancel, confirmLabel = 'Remember anyway' }: {
  conflict: string; busy?: boolean; onConfirm: () => void; onCancel: () => void; confirmLabel?: string;
}) {
  return (
    <div role="alert" data-memory-conflict className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <div>
          <div className="font-medium text-amber-700 dark:text-amber-300">This disagrees with your Company Brain</div>
          <p className="mt-0.5 text-muted-foreground">{conflict}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

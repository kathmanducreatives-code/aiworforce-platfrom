// Onboarding progress, saved to the server as you go (roadmap Phase 2).
//
// On load it resumes from whichever copy is newer — the server's (any device)
// or this tab's offline buffer. Afterwards every change to the step or the
// typed answers is saved ~800 ms later with the version it builds on. A stale
// save (another tab or device saved first) is merged field by field and saved
// again; a field both sides changed keeps the other device's value and is
// reported, so nothing typed is lost silently.
//
// Never runs for an activated Brain: a draft save there would mark the stored
// Brain "in progress". Re-running setup keeps the explicit Save draft.

import { useEffect, useRef, useState } from 'react';
import {
  applyProgressSaveResult, readServerProgress, resumeFrom, sameProgress,
  type Answers, type FieldConflict, type ProgressCopy,
} from '@/lib/onboardingAutosave';
import { saveOnboardingProgress } from '@/lib/onboardingProgressSave';

export type AutosaveStatus = 'off' | 'idle' | 'saving' | 'saved' | 'offline';

const DEBOUNCE_MS = 800;

export function useOnboardingAutosave(opts: {
  enabled: boolean;
  workspaceId: string | null;
  /** The loaded company_brain row; undefined while loading. */
  row: { profile?: unknown; updated_at?: string | null; onboarding_completed?: boolean | null } | null | undefined;
  step: number;
  answers: Answers;
  /** This tab's offline buffer, if any. */
  localCopy: ProgressCopy | null;
  /** Apply a restored or merged copy to the forms. */
  onRestore: (copy: ProgressCopy) => void;
  onConflicts: (conflicts: FieldConflict[]) => void;
}): AutosaveStatus {
  const { enabled, workspaceId, row, step, answers, localCopy, onRestore, onConflicts } = opts;
  const active = enabled && !!workspaceId && row !== undefined && row?.onboarding_completed !== true;
  const [status, setStatus] = useState<AutosaveStatus>('off');
  const version = useRef<string | null>(null);
  const base = useRef<ProgressCopy | null>(null);
  const resumed = useRef<string | null>(null);
  const saving = useRef(false);
  const latest = useRef<ProgressCopy>({ step, answers, updated_at: '' });
  latest.current = { step, answers, updated_at: '' };
  // Bumped when a change arrived during a save, so it is saved afterwards.
  const [retry, setRetry] = useState(0);
  const callbacks = useRef({ onRestore, onConflicts });
  callbacks.current = { onRestore, onConflicts };

  // Resume once per workspace, when the row arrives.
  useEffect(() => {
    if (!active || resumed.current === workspaceId) return;
    resumed.current = workspaceId;
    const server = readServerProgress(row?.profile);
    const pick = resumeFrom(server, localCopy);
    if (pick.source === 'server' && pick.copy) callbacks.current.onRestore(pick.copy);
    base.current = server ?? { step: 0, answers: {}, updated_at: '' };
    version.current = row?.updated_at ?? null;
    setStatus('idle');
  }, [active, workspaceId, row, localCopy]);

  // Save changes, debounced.
  useEffect(() => {
    if (!active || resumed.current !== workspaceId || !base.current) return;
    const mine: ProgressCopy = { step, answers, updated_at: new Date().toISOString() };
    if (sameProgress(mine, base.current)) return;
    const timer = window.setTimeout(async () => {
      if (saving.current || !workspaceId) { setRetry((n) => n + 1); return; }
      saving.current = true;
      setStatus('saving');
      try {
        const r = await saveOnboardingProgress({ workspaceId, step: mine.step, answers: mine.answers, expectedUpdatedAt: version.current });
        // A stale save is merged into the server's copy, never overwritten (applyProgressSaveResult).
        const next = applyProgressSaveResult({ version: version.current, base: base.current! }, mine, r);
        version.current = next.version;
        base.current = next.base;
        if (next.restore) callbacks.current.onRestore(next.restore); // the forms change → the next save sends the merge
        if (next.conflicts.length) callbacks.current.onConflicts(next.conflicts);
        setStatus(next.status);                       // 'offline': the tab's buffer still holds everything
      } finally {
        saving.current = false;
        if (base.current && !sameProgress(latest.current, base.current)) setRetry((n) => n + 1);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, workspaceId, step, answers, retry]);

  return active ? status : 'off';
}

// WORKFORCE PULSE — the few live counts the global command bar may react to.
//
// The dashboard already reads the signal feed; rather than the command bar
// reading it a second time on every page, the dashboard publishes the counts it
// has here. Keyed by workspace: another workspace's numbers are never shown.

import { useSyncExternalStore } from 'react';

export interface WorkforcePulse { workspaceId: string; signals24h: number }

let current: WorkforcePulse | null = null;
const listeners = new Set<() => void>();

export function publishWorkforcePulse(next: WorkforcePulse): void {
  if (current && current.workspaceId === next.workspaceId && current.signals24h === next.signals24h) return;
  current = next;
  listeners.forEach((l) => l());
}

export function useWorkforcePulse(workspaceId: string | null): WorkforcePulse | null {
  const pulse = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => current,
    () => null,
  );
  return pulse && pulse.workspaceId === workspaceId ? pulse : null;
}

export interface DockChip { label: string; prompt?: string; route?: string }

/**
 * Three chips at most, chosen from what is happening: decisions waiting first,
 * then fresh signals, then a briefing — topped up from the page's own context.
 */
export function dockChips(input: { approvals: number; signals24h: number; pathname: string }): DockChip[] {
  const chips: DockChip[] = [];
  const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (input.approvals > 0) chips.push({ label: `Review ${s(input.approvals, 'approval', 'approvals')}`, route: '/awaiting-you' });
  if (input.signals24h > 0) chips.push({ label: input.signals24h === 1 ? 'Investigate new signal' : `Investigate ${input.signals24h} new signals`, prompt: 'Which of today’s new signals should I act on first, and why?' });
  const byPage: Record<string, DockChip[]> = {
    '/leads': [{ label: 'Find accounts like my best fit', prompt: 'Find more accounts like my best-fit leads.' }],
    '/content': [{ label: 'Draft a post from this week', prompt: 'Draft a LinkedIn post from this week’s strongest signal.' }],
    '/signals': [{ label: 'Summarize this week’s signals', prompt: 'Summarize this week’s signals and what they mean for us.' }],
  };
  const page = Object.keys(byPage).find((p) => input.pathname.startsWith(p));
  const fill: DockChip[] = [
    ...(page ? byPage[page] : []),
    { label: 'Brief me on today', prompt: 'Brief me on today.' },
    { label: 'Find new buying signals', prompt: 'Find new buying signals for my ICP.' },
    { label: 'Draft a LinkedIn post', prompt: 'Draft a LinkedIn post in our voice.' },
  ];
  for (const c of fill) {
    if (chips.length >= 3) break;
    if (!chips.some((x) => x.label === c.label)) chips.push(c);
  }
  return chips.slice(0, 3);
}

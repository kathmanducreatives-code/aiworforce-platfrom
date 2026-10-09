// CONVERSATION HISTORY, GROUPED BY DAY — Today / Yesterday / Earlier.
//
// Pure. Groups by the viewer's LOCAL calendar day of `updated_at`, keeps the
// order it was given, and drops empty groups. A row with no usable date is
// "Earlier".

export type ConversationGroupLabel = 'Today' | 'Yesterday' | 'Earlier';

export interface ConversationGroup<T> {
  label: ConversationGroupLabel;
  items: T[];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function groupConversationsByDay<T extends { updated_at?: string | null }>(
  rows: readonly T[],
  now: Date = new Date(),
): ConversationGroup<T>[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: Record<ConversationGroupLabel, T[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const row of rows) {
    const t = row.updated_at ? Date.parse(row.updated_at) : NaN;
    const day = Number.isFinite(t) ? startOfDay(new Date(t)) : -Infinity;
    groups[day >= today ? 'Today' : day >= yesterday ? 'Yesterday' : 'Earlier'].push(row);
  }
  return (['Today', 'Yesterday', 'Earlier'] as const)
    .map((label) => ({ label, items: groups[label] }))
    .filter((g) => g.items.length > 0);
}

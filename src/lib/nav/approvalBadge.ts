/**
 * The Awaiting You count in the navigation — pending approvals, as stored.
 *
 * No number while loading and none at zero: a badge only ever states work that
 * is really waiting. (It used to be a hard-coded "4" from the landing design.)
 */
export function approvalBadge(count: number, loading: boolean): string | undefined {
  if (loading || !Number.isFinite(count) || count <= 0) return undefined;
  return count > 99 ? '99+' : String(Math.floor(count));
}

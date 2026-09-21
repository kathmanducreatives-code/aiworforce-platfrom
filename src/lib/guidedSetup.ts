/** Retain explicit edits (including deletions), while accepting new AI values elsewhere. */
export function preserveSetupEdits<T>(previous: T, edited: T, incoming: T): T {
  if (JSON.stringify(previous) === JSON.stringify(edited)) return incoming;
  if (Array.isArray(edited) || edited === null || typeof edited !== 'object') return edited;
  const result = { ...incoming };
  for (const key of Object.keys(edited) as Array<keyof T>) {
    result[key] = preserveSetupEdits(previous?.[key], edited[key], incoming?.[key]);
  }
  return result;
}

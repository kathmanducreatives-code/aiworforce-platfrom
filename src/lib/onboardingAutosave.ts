// Onboarding autosave: resume and stale-save merge (roadmap Phase 2).
//
// Progress is server state (`onboarding_meta.setup`, written by save_draft
// with `expected_updated_at`). sessionStorage stays only as an offline buffer.
// Two pure decisions live here:
//
//   resumeFrom      which copy to resume — the server's or this tab's buffer
//   mergeStale      after a 409, fold this tab's unsaved answers into the
//                   server's newer copy field by field, losing nothing typed
//
// Pure. No React, no network.

export type Answers = Record<string, Record<string, string>>;

export interface ProgressCopy {
  step: number;
  answers: Answers;
  /** ISO time the copy was written. */
  updated_at: string;
}

/**
 * The newer copy wins; a tie goes to the server, which every device shares.
 * A buffer without a readable time never beats a server copy.
 */
export function resumeFrom(server: ProgressCopy | null, local: ProgressCopy | null): { source: 'server' | 'local' | 'none'; copy: ProgressCopy | null } {
  if (!server && !local) return { source: 'none', copy: null };
  if (!local) return { source: 'server', copy: server };
  if (!server) return { source: 'local', copy: local };
  const s = Date.parse(server.updated_at);
  const l = Date.parse(local.updated_at);
  if (Number.isFinite(l) && (!Number.isFinite(s) || l > s)) return { source: 'local', copy: local };
  return { source: 'server', copy: server };
}

export interface FieldConflict {
  form: string;
  field: string;
  /** What this tab typed — offered back to the user, never silently dropped. */
  mine: string;
  /** What the other device saved — kept in the merged copy. */
  theirs: string;
}

/**
 * Three-way merge after a stale save.
 *   base   — the answers this tab last loaded or saved successfully
 *   mine   — this tab's answers now (unsaved edits on top of base)
 *   server — the newer copy the 409 returned
 *
 * Per field: a change on one side only is taken; the same change on both is
 * kept once; a different change on both keeps the server's value and reports
 * the conflict with this tab's value. The step is the furthest either side
 * reached.
 */
export function mergeStale(base: ProgressCopy, mine: ProgressCopy, server: ProgressCopy): { merged: ProgressCopy; conflicts: FieldConflict[] } {
  const answers: Answers = {};
  const conflicts: FieldConflict[] = [];
  const forms = new Set([...Object.keys(base.answers), ...Object.keys(mine.answers), ...Object.keys(server.answers)]);
  for (const form of forms) {
    const b = base.answers[form] ?? {};
    const m = mine.answers[form] ?? {};
    const s = server.answers[form] ?? {};
    const out: Record<string, string> = {};
    for (const field of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(s)])) {
      const bv = b[field] ?? '';
      const mv = m[field] ?? '';
      const sv = s[field] ?? '';
      let v: string;
      if (mv === bv) v = sv;            // only the server changed it (or nobody did)
      else if (sv === bv || sv === mv) v = mv; // only this tab changed it, or both agree
      else {
        v = sv;
        conflicts.push({ form, field, mine: mv, theirs: sv });
      }
      if (v) out[field] = v;
    }
    if (Object.keys(out).length) answers[form] = out;
  }
  return {
    merged: { step: Math.max(mine.step, server.step), answers, updated_at: server.updated_at },
    conflicts,
  };
}

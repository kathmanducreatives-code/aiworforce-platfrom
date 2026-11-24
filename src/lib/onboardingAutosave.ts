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

// ── Mapping between the wizard's forms and stored answers ────────────────────

/** Mirrors SETUP_ANSWER_FIELDS on the server. Consent is never part of progress. */
export const ANSWER_FIELDS = {
  company: ['name', 'website_url', 'linkedin_url', 'description', 'stage', 'team_size'],
  founder: ['name', 'role', 'linkedin_url', 'timezone', 'first_help_goal'],
} as const;

/** The forms' typed values as answers (empty fields omitted). */
export function answersFromForms(forms: { company: object; founder: object }): Answers {
  const out: Answers = {};
  for (const form of ['company', 'founder'] as const) {
    const kept: Record<string, string> = {};
    for (const f of ANSWER_FIELDS[form]) {
      const v = (forms[form] as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.trim()) kept[f] = v.trim();
    }
    if (Object.keys(kept).length) out[form] = kept;
  }
  return out;
}

/** Progress the server stored at `onboarding_meta.setup`, or null. */
export function readServerProgress(profile: unknown): ProgressCopy | null {
  const meta = (profile as { onboarding_meta?: { setup?: unknown } } | null)?.onboarding_meta;
  const s = meta?.setup as { version?: unknown; step?: unknown; answers?: unknown; updated_at?: unknown } | undefined;
  if (!s || s.version !== 1 || typeof s.step !== 'number' || !Number.isInteger(s.step) || s.step < 0) return null;
  const raw = (s.answers && typeof s.answers === 'object') ? s.answers as Record<string, Record<string, unknown>> : {};
  return {
    step: s.step,
    answers: answersFromForms({ company: raw.company ?? {}, founder: raw.founder ?? {} }),
    updated_at: typeof s.updated_at === 'string' ? s.updated_at : '',
  };
}

/** Same answers and step — nothing to save. */
export function sameProgress(a: Pick<ProgressCopy, 'step' | 'answers'>, b: Pick<ProgressCopy, 'step' | 'answers'>): boolean {
  return a.step === b.step && JSON.stringify(a.answers) === JSON.stringify(b.answers);
}

// ── What a save's result does to the autosave state ─────────────────────────

/** The server's answer to one progress save (onboardingProgressSave). */
export type ProgressSaveOutcome =
  | { kind: 'saved'; updatedAt: string | null }
  | { kind: 'stale'; serverProfile: unknown; currentUpdatedAt: string | null }
  | { kind: 'failed'; message: string };

/**
 * After one save of `mine` built on (`version`, `base`):
 *   saved   the new version; `mine` is the new base;
 *   stale   the server's copy is the new base and `restore` is the merge of
 *           this tab's unsaved answers into it (nothing typed is dropped; a
 *           field both changed is reported in `conflicts` with this tab's
 *           value), saved on the next pass against the server's version;
 *           (stale without the server's copy: nothing changes but the
 *           version, so the next save fetches the copy to merge against);
 *   failed  nothing changes: the version, the base and the unsaved answers
 *           all stay, so the next pass retries the same edit.
 * `version` is opaque: updated_at for the agency Brain, the integer version
 * (as a string) for a client Brain.
 */
export function applyProgressSaveResult(
  state: { version: string | null; base: ProgressCopy },
  mine: ProgressCopy,
  r: ProgressSaveOutcome,
): { version: string | null; base: ProgressCopy; restore: ProgressCopy | null; conflicts: FieldConflict[]; status: 'saved' | 'idle' | 'offline' } {
  if (r.kind === 'saved') return { version: r.updatedAt ?? state.version, base: mine, restore: null, conflicts: [], status: 'saved' };
  if (r.kind === 'stale' && (r.serverProfile === null || r.serverProfile === undefined)) {
    // Stale, but the server did not say what won (a race lost at the write).
    // Merging against "nothing" would blank the forms and turn every typed
    // field into a conflict. Keep everything; clear the version so the next
    // save is answered with the current copy, and merge then.
    return { version: null, base: state.base, restore: null, conflicts: [], status: 'idle' };
  }
  if (r.kind === 'stale') {
    const server = readServerProgress(r.serverProfile) ?? { step: 0, answers: {}, updated_at: '' };
    const { merged, conflicts } = mergeStale(state.base, mine, server);
    return { version: r.currentUpdatedAt, base: server, restore: merged, conflicts, status: 'idle' };
  }
  return { version: state.version, base: state.base, restore: null, conflicts: [], status: 'offline' };
}

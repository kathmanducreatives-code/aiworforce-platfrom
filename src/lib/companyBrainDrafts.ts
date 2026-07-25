// Unsaved Company Brain section edits, persisted for the browser session.
//
// WHY
//   A tab switch triggers a Supabase TOKEN_REFRESHED, which produces a new
//   `user` object, which re-runs the workspace effect, which re-fetches the
//   Brain, which hands the editor a NEW `brain` object — and the editor's
//   init effect then overwrote whatever the user had typed.
//
//   Keeping the draft outside React state means an unlucky re-render, a route
//   change or a same-tab reload can no longer destroy work in progress.
//
// SCOPING
//   Keys carry the authenticated USER as well as the workspace. A draft must
//   never surface for a different person on a shared machine, and switching
//   workspaces must not show the previous workspace's edits.
//
// STORAGE
//   sessionStorage: survives route changes, re-renders and same-tab reloads,
//   and disappears when the tab closes — which matches "work in progress".
//   Never localStorage: an abandoned draft should not outlive the session.
//
// This module stores ONLY form values and editor position. No tokens, no
// session data, no provider payloads.

export const DRAFT_SCHEMA_VERSION = 1;
const KEY_PREFIX = 'agentory.company-brain-draft.v1';

/** Section form values. Shape varies per section, so this stays deliberately open. */
export type SectionDraftValues = Record<string, unknown>;

export interface CompanyBrainDraft {
  schemaVersion: number;
  userId: string;
  workspaceId: string;
  sectionId: string;
  /** Server version the edit started from, for background-update detection. */
  brainVersion: string | null;
  values: SectionDraftValues;
  dirty: boolean;
  drawerOpen: boolean;
  activeSection: string;
  expandedGroups: string[];
  scrollPosition: number;
  draftUpdatedAt: string;
  baseServerUpdatedAt: string | null;
}

export interface DraftScope {
  userId: string | null | undefined;
  workspaceId: string | null | undefined;
  sectionId: string | null | undefined;
}

/**
 * A draft key is only valid when every scope part is present. A missing user or
 * workspace must NOT collapse into a shared key — that is how one person's
 * draft would appear for another.
 */
export function draftKey(scope: DraftScope): string | null {
  const { userId, workspaceId, sectionId } = scope;
  if (!userId || !workspaceId || !sectionId) return null;
  return `${KEY_PREFIX}:${userId}:${workspaceId}:${sectionId}`;
}

/** sessionStorage is absent in SSR and can throw in private modes. */
function storage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate a parsed envelope. Anything unrecognised is ignored rather than
 * repaired — a half-understood draft is more dangerous than no draft.
 */
function validate(raw: unknown, scope: DraftScope): CompanyBrainDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;

  // Unsupported schema versions are ignored, never migrated silently.
  if (d.schemaVersion !== DRAFT_SCHEMA_VERSION) return null;

  if (typeof d.userId !== 'string' || typeof d.workspaceId !== 'string' || typeof d.sectionId !== 'string') {
    return null;
  }
  // Defence in depth: even if a key were somehow mismatched, the envelope's own
  // identity must agree with the scope being asked for.
  if (d.userId !== scope.userId || d.workspaceId !== scope.workspaceId || d.sectionId !== scope.sectionId) {
    return null;
  }
  if (!d.values || typeof d.values !== 'object' || Array.isArray(d.values)) return null;

  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    userId: d.userId,
    workspaceId: d.workspaceId,
    sectionId: d.sectionId,
    brainVersion: typeof d.brainVersion === 'string' ? d.brainVersion : null,
    values: d.values as SectionDraftValues,
    dirty: d.dirty === true,
    drawerOpen: d.drawerOpen === true,
    activeSection: typeof d.activeSection === 'string' ? d.activeSection : d.sectionId,
    expandedGroups: isStringArray(d.expandedGroups) ? d.expandedGroups : [],
    scrollPosition: typeof d.scrollPosition === 'number' && Number.isFinite(d.scrollPosition) ? d.scrollPosition : 0,
    draftUpdatedAt: typeof d.draftUpdatedAt === 'string' ? d.draftUpdatedAt : new Date(0).toISOString(),
    baseServerUpdatedAt: typeof d.baseServerUpdatedAt === 'string' ? d.baseServerUpdatedAt : null,
  };
}

/** Read a draft. Malformed JSON, wrong schema or wrong scope all yield null. */
export function loadDraft(scope: DraftScope): CompanyBrainDraft | null {
  const key = draftKey(scope);
  const s = storage();
  if (!key || !s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    return validate(JSON.parse(raw) as unknown, scope);
  } catch {
    return null;
  }
}

/**
 * Persist a draft. A CLEAN draft is never written — opening and closing a form
 * without editing must not leave a phantom "unsaved changes" state behind.
 */
export function saveDraft(draft: CompanyBrainDraft): boolean {
  const key = draftKey(draft);
  const s = storage();
  if (!key || !s) return false;
  if (!draft.dirty) {
    // Not an error: a form that returned to its saved values clears itself.
    try { s.removeItem(key); } catch { /* storage unavailable */ }
    return false;
  }
  try {
    s.setItem(key, JSON.stringify({ ...draft, schemaVersion: DRAFT_SCHEMA_VERSION }));
    return true;
  } catch {
    // Quota or private mode — losing a draft is bad, but throwing mid-keystroke
    // would be worse.
    return false;
  }
}

export function clearDraft(scope: DraftScope): void {
  const key = draftKey(scope);
  const s = storage();
  if (!key || !s) return;
  try { s.removeItem(key); } catch { /* storage unavailable */ }
}

/**
 * Drop every draft matching a prefix — used on sign-out and on workspace
 * change so one identity's work in progress cannot surface under another.
 */
function clearMatching(predicate: (key: string) => boolean): number {
  const s = storage();
  if (!s) return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(KEY_PREFIX) && predicate(k)) keys.push(k);
    }
    for (const k of keys) {
      s.removeItem(k);
      removed += 1;
    }
  } catch {
    return removed;
  }
  return removed;
}

/** Clear every Company Brain draft belonging to one user. Call on sign-out. */
export function clearDraftsForUser(userId: string): number {
  if (!userId) return 0;
  return clearMatching((k) => k.startsWith(`${KEY_PREFIX}:${userId}:`));
}

/** Clear every draft for one workspace of one user. */
export function clearDraftsForWorkspace(userId: string, workspaceId: string): number {
  if (!userId || !workspaceId) return 0;
  return clearMatching((k) => k.startsWith(`${KEY_PREFIX}:${userId}:${workspaceId}:`));
}

// ------------------------------------------------------------ dirty checking --

/**
 * Structural comparison of form values against the saved base.
 *
 * Deliberately order-sensitive for arrays: reordering chips IS an edit the user
 * expects to keep. Deliberately strict about types: `[]` and `null` are not the
 * same starting point.
 */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  if (a === b) return false;
  if (a === null || b === null || a === undefined || b === undefined) return a !== b;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return true;
    if (a.length !== b.length) return true;
    return a.some((item, i) => valuesDiffer(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return true;
    return ka.some((k) =>
      !Object.prototype.hasOwnProperty.call(b, k) ||
      valuesDiffer((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }

  return a !== b;
}

/** True when the form has moved away from the values it was initialised with. */
export function isDirty(current: SectionDraftValues, base: SectionDraftValues): boolean {
  return valuesDiffer(current, base);
}

/**
 * Did the server change underneath an in-progress edit?
 *
 * Used to show the non-destructive "updated in the background" notice. We never
 * merge — silently combining two versions of a long-text field or a chip list
 * would produce something neither side wrote.
 */
export function serverChangedUnderDraft(
  draft: Pick<CompanyBrainDraft, 'baseServerUpdatedAt'>,
  serverUpdatedAt: string | null,
): boolean {
  if (!serverUpdatedAt || !draft.baseServerUpdatedAt) return false;
  return serverUpdatedAt !== draft.baseServerUpdatedAt;
}

export const BACKGROUND_UPDATE_NOTICE =
  'Company Brain was updated in the background. Your unsaved changes are still preserved.';

export const UNSAVED_RESTORED_NOTICE = 'Unsaved changes restored';

export const REFRESH_FAILED_NOTICE =
  "Couldn't refresh Company Brain. Your current view and unsaved changes are safe.";

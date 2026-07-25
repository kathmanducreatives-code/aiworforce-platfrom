// Company Brain draft persistence.
//
// These cover the layer that actually decides whether unsaved work survives:
// key scoping, envelope validation, dirty comparison and background-update
// detection. All fixtures are SYNTHETIC — no real workspace, user or Brain
// content appears here.
//
// No network, no database, no provider, no model.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  draftKey,
  loadDraft,
  saveDraft,
  clearDraft,
  clearDraftsForUser,
  clearDraftsForWorkspace,
  isDirty,
  valuesDiffer,
  serverChangedUnderDraft,
  DRAFT_SCHEMA_VERSION,
  type CompanyBrainDraft,
} from './companyBrainDrafts';

/** Minimal in-memory sessionStorage — the module reads it off globalThis. */
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const USER_A = 'user-a';
const USER_B = 'user-b';
const WS_A = 'ws-a';
const WS_B = 'ws-b';
const SECTION = 'messaging';

function draft(over: Partial<CompanyBrainDraft> = {}): CompanyBrainDraft {
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    userId: USER_A,
    workspaceId: WS_A,
    sectionId: SECTION,
    brainVersion: '2026-07-20T00:00:00.000Z',
    values: { tone: 'direct', chips: ['a', 'b'] },
    dirty: true,
    drawerOpen: true,
    activeSection: SECTION,
    expandedGroups: ['group-1'],
    scrollPosition: 420,
    draftUpdatedAt: '2026-07-20T10:00:00.000Z',
    baseServerUpdatedAt: '2026-07-20T00:00:00.000Z',
    ...over,
  };
}

let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = store;
});

describe('key scoping', () => {
  it('22/23. a key carries user, workspace and section', () => {
    const k = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    expect(k).toContain(USER_A);
    expect(k).toContain(WS_A);
    expect(k).toContain(SECTION);
  });

  it('an incomplete scope produces NO key rather than a shared one', () => {
    // Collapsing to a partial key is how one person's draft would surface for
    // another; refusing to build the key is the safe failure.
    expect(draftKey({ userId: null, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
    expect(draftKey({ userId: USER_A, workspaceId: null, sectionId: SECTION })).toBeNull();
    expect(draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: null })).toBeNull();
  });
});

describe('save / load round trip', () => {
  it('15/16/17. a dirty draft round-trips with its editor state', () => {
    expect(saveDraft(draft())).toBe(true);
    const got = loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    expect(got.values).toEqual({ tone: 'direct', chips: ['a', 'b'] });
    expect(got.scrollPosition).toBe(420);
    expect(got.expandedGroups).toEqual(['group-1']);
    expect(got.activeSection).toBe(SECTION);
    expect(got.drawerOpen).toBe(true);
  });

  it('13. a CLEAN draft is never written', () => {
    // Opening and closing a form without editing must leave no trace.
    expect(saveDraft(draft({ dirty: false }))).toBe(false);
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it('saving clean over an existing draft removes it', () => {
    saveDraft(draft());
    saveDraft(draft({ dirty: false }));
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it('18/19. clearDraft removes it (Save and Discard both use this)', () => {
    saveDraft(draft());
    clearDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION });
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });
});

describe('isolation', () => {
  it("24. workspace B cannot read workspace A's draft", () => {
    saveDraft(draft({ workspaceId: WS_A }));
    expect(loadDraft({ userId: USER_A, workspaceId: WS_B, sectionId: SECTION })).toBeNull();
  });

  it("25. user B cannot read user A's draft", () => {
    saveDraft(draft({ userId: USER_A }));
    expect(loadDraft({ userId: USER_B, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it("a section cannot read another section's draft", () => {
    saveDraft(draft({ sectionId: 'messaging' }));
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: 'targeting' })).toBeNull();
  });

  it('an envelope whose identity disagrees with the key is rejected', () => {
    // Defence in depth: even a hand-tampered entry cannot cross identities.
    const key = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    store.setItem(key, JSON.stringify(draft({ userId: USER_B })));
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it('26. sign-out clears every draft for that user only', () => {
    saveDraft(draft({ userId: USER_A, sectionId: 'messaging' }));
    saveDraft(draft({ userId: USER_A, sectionId: 'targeting' }));
    saveDraft(draft({ userId: USER_B, sectionId: 'messaging' }));

    expect(clearDraftsForUser(USER_A)).toBe(2);
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: 'messaging' })).toBeNull();
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: 'targeting' })).toBeNull();
    // The other user is untouched.
    expect(loadDraft({ userId: USER_B, workspaceId: WS_A, sectionId: 'messaging' })).not.toBeNull();
  });

  it('clearing one workspace leaves the other workspace intact', () => {
    saveDraft(draft({ workspaceId: WS_A }));
    saveDraft(draft({ workspaceId: WS_B }));
    expect(clearDraftsForWorkspace(USER_A, WS_A)).toBe(1);
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
    expect(loadDraft({ userId: USER_A, workspaceId: WS_B, sectionId: SECTION })).not.toBeNull();
  });
});

describe('malformed input is ignored, never repaired', () => {
  it('20. malformed JSON yields null', () => {
    const key = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    store.setItem(key, '{not json at all');
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it('21. an unsupported schema version yields null', () => {
    const key = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    store.setItem(key, JSON.stringify(draft({ schemaVersion: 99 })));
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it('a missing values object yields null', () => {
    const key = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    store.setItem(key, JSON.stringify({ ...draft(), values: 'nope' }));
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
  });

  it('an array or primitive payload yields null', () => {
    const key = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    for (const bad of ['[]', '"a string"', 'null', '42']) {
      store.setItem(key, bad);
      expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
    }
  });

  it('absent sessionStorage degrades safely', () => {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = undefined;
    expect(() => saveDraft(draft())).not.toThrow();
    expect(loadDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).toBeNull();
    expect(() => clearDraft({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })).not.toThrow();
  });
});

describe('dirty comparison', () => {
  it('identical values are clean', () => {
    expect(isDirty({ a: 'x', list: ['1', '2'] }, { a: 'x', list: ['1', '2'] })).toBe(false);
  });

  it('a changed scalar is dirty', () => {
    expect(isDirty({ a: 'x' }, { a: 'y' })).toBe(true);
  });

  it('array REORDERING counts as an edit', () => {
    // Reordering chips is a deliberate user action, not noise.
    expect(isDirty({ list: ['a', 'b'] }, { list: ['b', 'a'] })).toBe(true);
  });

  it('added and removed keys are both dirty', () => {
    expect(isDirty({ a: 'x', b: 'y' }, { a: 'x' })).toBe(true);
    expect(isDirty({ a: 'x' }, { a: 'x', b: 'y' })).toBe(true);
  });

  it('null, undefined and empty array are distinct starting points', () => {
    expect(valuesDiffer(null, undefined)).toBe(true);
    expect(valuesDiffer([], null)).toBe(true);
    expect(valuesDiffer('', null)).toBe(true);
  });

  it('nested objects compare structurally', () => {
    expect(isDirty({ o: { n: 1 } }, { o: { n: 1 } })).toBe(false);
    expect(isDirty({ o: { n: 1 } }, { o: { n: 2 } })).toBe(true);
  });
});

describe('background update detection', () => {
  it('35. a changed server version is detected while dirty', () => {
    expect(serverChangedUnderDraft(
      { baseServerUpdatedAt: '2026-07-20T00:00:00.000Z' },
      '2026-07-20T12:00:00.000Z',
    )).toBe(true);
  });

  it('an unchanged server version raises no notice', () => {
    expect(serverChangedUnderDraft(
      { baseServerUpdatedAt: '2026-07-20T00:00:00.000Z' },
      '2026-07-20T00:00:00.000Z',
    )).toBe(false);
  });

  it('unknown timestamps never claim a conflict', () => {
    // A false "updated in the background" notice would be its own bug.
    expect(serverChangedUnderDraft({ baseServerUpdatedAt: null }, '2026-07-20T12:00:00.000Z')).toBe(false);
    expect(serverChangedUnderDraft({ baseServerUpdatedAt: '2026-07-20T00:00:00.000Z' }, null)).toBe(false);
  });
});

describe('safety', () => {
  it('an envelope stores only form values and editor position', () => {
    saveDraft(draft());
    const key = draftKey({ userId: USER_A, workspaceId: WS_A, sectionId: SECTION })!;
    const stored = JSON.parse(store.getItem(key)!) as Record<string, unknown>;
    // No tokens, sessions, provider payloads or unrelated app state.
    expect(Object.keys(stored).sort()).toEqual([
      'activeSection', 'baseServerUpdatedAt', 'brainVersion', 'dirty', 'draftUpdatedAt',
      'drawerOpen', 'expandedGroups', 'schemaVersion', 'scrollPosition', 'sectionId',
      'userId', 'values', 'workspaceId',
    ]);
  });

  it('43. persisting a draft performs no network or database work', () => {
    // sessionStorage only — there is nothing here that could write to a server.
    const before = store.length;
    saveDraft(draft());
    expect(store.length).toBe(before + 1);
  });
});

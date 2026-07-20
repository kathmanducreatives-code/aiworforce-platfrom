# Implementation Spec (Option 1 — read-only, no code changes)

You picked **option 1**. Below are two complete specs your engineer can apply on
branch `company-brain-tab-state-draft-persistence-v1` (and a second branch for
Workbench). Frontend-only. No edge functions, no migrations, no schema, no
secrets, no provider calls.

---

## SPEC A — Company Brain: tab-switch loading + unsaved-draft loss

### Root causes (verified in current source)

1. **`useCompanyBrain` refetches on every mount and has no cache.**
   `src/hooks/useCompanyBrain.ts` runs a `supabase.from('company_brain')…maybeSingle()`
   inside a `useEffect` keyed on `[workspaceId, wsLoading, tick]` with local
   `useState` only. Any route/tab switch that unmounts `CompanyBrainDashboard`
   loses `data` and re-triggers the network round-trip, which the user
   experiences as "full page reload".

2. **Drawer draft state is component-local and reset on every open.**
   `CompanyBrainEditDrawer.tsx` line 43-47:
   ```ts
   useEffect(() => {
     if (!open || !section) return;
     setState(initialFor(section, brain));  // clobbers user edits
     setSaved(false);
   }, [open, section, brain]);
   ```
   - Closing the drawer (or the parent re-rendering with a new `brain` object
     reference — which happens on every refetch) discards edits.
   - There is no dirty-state tracking and no "unsaved changes" guard.

3. **No cross-tab / cross-navigation persistence.** Drafts live only in React
   state; navigating to another route or hard-refreshing loses them.

### Fix (frontend-only)

#### A1. Cache Company Brain reads with React Query

Replace the ad-hoc `useEffect + useState` in `src/hooks/useCompanyBrain.ts`
with a `useQuery` keyed by workspace. React Query is already in the project.

```ts
// src/hooks/useCompanyBrain.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export interface CompanyBrainRow {
  profile: Record<string, any>;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
}

export const companyBrainKey = (workspaceId: string | null) =>
  ['company_brain', workspaceId] as const;

export function useCompanyBrain() {
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: companyBrainKey(workspaceId),
    enabled: !wsLoading && !!workspaceId,
    staleTime: 5 * 60_000,          // 5 min — no reload on tab switch
    gcTime:   30 * 60_000,          // keep in cache across route unmounts
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    queryFn: async (): Promise<CompanyBrainRow> => {
      const { data: row, error } = await supabase
        .from('company_brain')
        .select('profile, onboarding_completed, onboarding_completed_at')
        .eq('workspace_id', workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return {
        profile: (row?.profile as any) ?? {},
        onboarding_completed: !!row?.onboarding_completed,
        onboarding_completed_at: row?.onboarding_completed_at ?? null,
      };
    },
  });

  return {
    workspaceId,
    data: query.data ?? null,
    loading: query.isPending || wsLoading,
    refresh: () => qc.invalidateQueries({ queryKey: companyBrainKey(workspaceId) }),
  };
}
```

Consumers keep the same `{ data, loading, refresh }` contract, so
`CompanyBrainDashboard.tsx` and `CompanyBrainStatusCard.tsx` need no change.

**Effect:** switching tabs (Dashboard ↔ Company Brain ↔ any other route) hits
the cache instantly. No spinner, no re-fetch until `refresh()` (called after
`saveSection`) or 5-minute stale.

#### A2. Persist drawer drafts per workspace + section

New helper `src/lib/companyBrainDrafts.ts`:

```ts
const KEY = (workspaceId: string, section: string) =>
  `agentory.brain-draft.v1.${workspaceId}.${section}`;

export function loadDraft(workspaceId: string, section: string): any | null {
  try {
    const raw = sessionStorage.getItem(KEY(workspaceId, section));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveDraft(workspaceId: string, section: string, state: any) {
  try { sessionStorage.setItem(KEY(workspaceId, section), JSON.stringify(state)); } catch {}
}

export function clearDraft(workspaceId: string, section: string) {
  try { sessionStorage.removeItem(KEY(workspaceId, section)); } catch {}
}
```

Rationale for `sessionStorage`: survives route changes and tab switches
inside the SPA and normal reloads within the tab, but auto-clears when the
browser tab closes — matches the mental model of an "in-progress edit" and
avoids stale drafts leaking into future logins on shared machines.

#### A3. Wire drafts + dirty guard into `CompanyBrainEditDrawer.tsx`

Changes only inside this file (props already carry `section` and `brain`;
add `workspaceId` from `useWorkspace` at the top):

```ts
import { loadDraft, saveDraft, clearDraft } from '@/lib/companyBrainDrafts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
```

Replace the current init effect:

```ts
const { workspaceId } = useWorkspace();
const [initial, setInitial] = useState<any>(null);

useEffect(() => {
  if (!open || !section || !workspaceId) return;
  const base = initialFor(section, brain);
  const draft = loadDraft(workspaceId, section);
  setInitial(base);
  setState(draft ?? base);
  setSaved(false);
}, [open, section, workspaceId]);   // NOTE: `brain` removed from deps
```

Add draft autosave:

```ts
useEffect(() => {
  if (!open || !section || !workspaceId || !state) return;
  saveDraft(workspaceId, section, state);
}, [state, open, section, workspaceId]);
```

Dirty check + guard:

```ts
const isDirty = useMemo(
  () => initial != null && JSON.stringify(state) !== JSON.stringify(initial),
  [initial, state],
);

function requestClose(next: boolean) {
  if (busy) return;
  if (!next && isDirty) {
    const ok = window.confirm('Discard unsaved changes to this section?');
    if (!ok) return;
    if (workspaceId && section) clearDraft(workspaceId, section);
  }
  onOpenChange(next);
}
```

Then `<Sheet onOpenChange={requestClose}>` and the Cancel button calls
`requestClose(false)`.

On successful save, clear the draft:

```ts
async function handleSave() {
  setBusy(true);
  try {
    await onSave(buildPatch(section!, state, brain));
    if (workspaceId && section) clearDraft(workspaceId, section);
    setSaved(true);
    setTimeout(() => onOpenChange(false), reduce ? 0 : 600);
  } finally { setBusy(false); }
}
```

#### A4. Optional: unsaved-changes badge on the section card

`CompanyBrainDashboard.tsx` can read drafts to show a small "Draft" chip
next to sections with pending edits (query `loadDraft(workspaceId, key)` in
a `useMemo` re-run on drawer close). Non-blocking — nice-to-have.

### Test matrix (manual)

| # | Steps | Expected |
|---|-------|----------|
| 1 | Open `/company-brain`, wait for load, switch to Dashboard, switch back | No spinner, instant render, no network call |
| 2 | Open drawer → edit → close (X) | Confirm modal appears; Cancel keeps drawer open |
| 3 | Open drawer → edit → click Save | Draft cleared, toast, section reflects new values |
| 4 | Open drawer → edit → confirm discard | Draft cleared, edits gone |
| 5 | Open drawer → edit → navigate to `/dashboard` (drawer force-closes) → return → open same section | Edits still present (draft restored) |
| 6 | Two workspaces: edit section A in ws1 → switch workspace → open same section | Fresh values, no leaked draft |
| 7 | Reload tab mid-edit | Draft still present after reload |
| 8 | Close tab, reopen | Draft gone (sessionStorage cleared) — matches expectation |

### Files touched (A)

- `src/hooks/useCompanyBrain.ts` (rewrite with React Query, same public API)
- `src/lib/companyBrainDrafts.ts` (new)
- `src/components/company-brain/CompanyBrainEditDrawer.tsx` (draft wiring + dirty guard)

### Guardrails
- No backend, RLS, edge function, migration, secret or provider changes.
- No new dependencies (React Query already installed).
- Contract of `useCompanyBrain` and drawer props unchanged.

---

## SPEC B — Workbench & Lead Detail: consistent, per-lead display

### Root cause summary

`WorkbenchPanel.tsx` resets `tab` on `selectedOutput` change (good), but
downstream views (`LeadResultsView`, `AgentOutputViewer`, `LeadTable`, etc.)
cache lead detail state locally and can display previous-lead content when
a new `selectedOutput` targets a different lead but the same `taskId`.

### Fix outline (frontend-only)

1. **Add `selectedLeadId` to `ChatWorkspaceContext`** and thread it through
   `LeadResultsView` and `LeadDetailDrawer`. Reset on `selectedOutput` change.
2. **Key detail components by `selectedLeadId`** so React remounts them.
3. **Extend `useWorkbenchData`** to expose `leadResults` scoped by `taskId`,
   and make `LeadTable` derive `rows` from that memo. Do not query per-row.
4. **Normalize row shape** in one place — `normalize.ts` — so
   `LeadTable.tsx` never touches `r.company` / `r.company_name` inconsistently
   (this recurred in the recent TS fix and points to schema drift).
5. **Loading/empty/failed states** should be rendered from a single
   `renderState(status)` helper in `WorkbenchPanel` so tabs stay in sync.

### Test matrix (manual)

| # | Steps | Expected |
|---|-------|----------|
| 1 | Run workflow, open lead A, open lead B | Detail shows B; no A residue |
| 2 | Switch tabs (Table→Insights→Activity) with a lead open | Selected lead persists on return |
| 3 | Refresh workbench | Same lead re-selected, same tab |
| 4 | Failed task | Failure card visible in Table tab, amber dot on Insights |
| 5 | People-mode output | People columns render; no jobs columns leak |

### Files (B)

- `src/contexts/ChatWorkspaceContext.tsx` — add `selectedLeadId`
- `src/components/chat/workspace/workbench/WorkbenchPanel.tsx`
- `src/components/chat/workspace/workbench/LeadResultsView.tsx`
- `src/components/chat/workspace/workbench/leadTable/LeadTable.tsx`
- `src/components/chat/workspace/workbench/useWorkbenchData.ts`
- `src/components/chat/workspace/workbench/normalize.ts`

### Guardrails (B)

Frontend-only. No changes to `run-agent`, no persistence, no schema.

---

## Guardrails (both specs)

I will not (in this task): deploy edge functions, publish the frontend,
apply migrations, change schema/secrets/provider flags, or call providers
or models.

Apply Spec A on branch `company-brain-tab-state-draft-persistence-v1` and
open one PR into `main`. Do not merge until QA passes the test matrix.

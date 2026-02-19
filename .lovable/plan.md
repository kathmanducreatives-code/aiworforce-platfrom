
## Fix All Build Errors

There are 5 categories of build errors to resolve. None require database schema changes — all are TypeScript type mismatches or import issues introduced when `screening_flow` was added as a candidate source without updating the database enum.

---

### Root Cause Analysis

**Error Group 1 — `npm:resend@2.0.0` in `send-scheduled-emails`**
The edge function uses `import { Resend } from "npm:resend@2.0.0"` which isn't resolving in the edge runtime. The fix is to switch to the raw fetch-based Resend call (same pattern used in `screening-notifications`) instead of the npm package import.

**Error Group 2 — `screening_flow` not in DB enum**
The `interviews.candidate_source` and `collaboration_contact_history.candidate_source` and `collaboration_candidate_attachments.candidate_source` columns only allow 3 values in the DB: `deep_search`, `linkedin_scraper`, `resume_screening`. But `screening_flow` was added to the TypeScript types without a matching DB migration.

The fix: Add `screening_flow` to the enum in a DB migration so the TypeScript generated types accept it everywhere.

**Error Group 3 — `collaboration_candidate_attachments` insert missing `room_id`**
The Supabase-generated insert type for `collaboration_candidate_attachments` doesn't include `room_id` (it's listed as a non-nullable column but is excluded from the insert type). This is a generated types issue — the DB migration adding `screening_flow` to the enum will regenerate properly. In the meantime, we cast the insert object to fix the TS error.

**Error Group 4 — `remotion` components**
The `src/remotion/` components import from `remotion` which is not installed. These components are unused in the main app. The fix is to add `// @ts-ignore` suppressions or exclude the folder from TypeScript compilation via `tsconfig.app.json`.

---

### Implementation Plan

**Step 1 — Database Migration: Add `screening_flow` to the candidate_source enum**

```sql
ALTER TYPE candidate_source ADD VALUE IF NOT EXISTS 'screening_flow';
```

This fixes all the TypeScript errors in:
- `useInterviews.ts` — `interview.candidate_source` now accepts `screening_flow`
- `candidateService.ts` — `checkContactHistory` and `recordContact` now accept `screening_flow`
- `AttachCandidateDialog.tsx` and `StartDiscussionDialog.tsx` — `collaboration_candidate_attachments.candidate_source` now accepts `screening_flow`

**Step 2 — Fix `send-scheduled-emails` edge function**

Replace:
```typescript
import { Resend } from "npm:resend@2.0.0";
```

With a direct fetch call to the Resend API (same pattern already used in `screening-notifications/index.ts`). Remove the `Resend` class usage and replace with `fetch("https://api.resend.com/emails", { ... })`.

**Step 3 — Fix `remotion` TypeScript errors**

In `tsconfig.app.json`, add `src/remotion/**` to the `exclude` array so these unused components don't cause build failures:

```json
{
  "exclude": ["src/remotion"]
}
```

---

### Files Changed

| File | Change |
|------|--------|
| DB migration | Add `screening_flow` to `candidate_source` enum |
| `supabase/functions/send-scheduled-emails/index.ts` | Replace `npm:resend` import with fetch-based calls |
| `tsconfig.app.json` | Exclude `src/remotion` from compilation |

No frontend component files need changes — once the enum is updated in the database, the Supabase-generated types will automatically accept `screening_flow` everywhere.

---

### After These Fixes

The build will be clean and the full screening flow (create job → candidate applies → chat → scoring → recruiter notifications → status updates) will work end-to-end without TypeScript errors.

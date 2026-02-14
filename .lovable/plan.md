
## Add "Generate Session Link" (No Candidate Required) to Step 4

### Problem
Step 4 currently requires selecting a candidate before generating a screening link. Recruiters need the ability to create a generic session link they can share with anyone -- even candidates not yet in the system.

### Solution
Add a standalone "Generate Session Link" section at the top of Step 4, visually separated from the existing candidate-specific flow. Both the frontend and edge function need updates to support candidateless sessions.

### Changes

#### 1. `supabase/functions/generate-screening-invite/index.ts`

Make `candidate_id` optional:

- Remove the early `400` return when `candidate_id` is missing (lines 165-170)
- When `candidate_id` is absent, skip candidate lookup, existing-session check, status update, and email sending
- Set `candidate_id: null` in the session insert and populate `role_briefing` with a `"generic_session": true` flag instead of candidate metadata
- The n8n webhook payload uses placeholder candidate info (`name: "Generic Session"`, `email: null`)
- Everything else (template creation, question insertion, token generation) works unchanged

#### 2. `src/components/screening/ShareScreening.tsx`

Add a new section **above** the candidate selector:

- A card titled "Generate Generic Session Link" with a subtitle: "Create a screening link you can share with anyone -- no candidate selection needed."
- A link-expiry dropdown (reuse the existing 3/7/14 days selector)
- A "Generate Session Link" button that calls `generate-screening-invite` with **no `candidate_id`** and `send_email: false`
- Once generated, show the URL in a `<code>` block with a Copy button (same pattern as the existing link display)
- A visual divider ("or send to a specific candidate") separates this from the existing candidate-selection flow below
- If a generic link has been generated, disable the candidate-specific generate button (only one link per dialog session)

### UI Layout (Step 4 after changes)

```text
+---------------------------------------------+
| Generate Generic Session Link               |
| Create a link to share with anyone.         |
| [Expiry: 7 days v]  [Generate Session Link] |
|                                             |
| [generated-url-here]            [Copy]      |
| Valid for 7 days.                           |
+---------------------------------------------+
|                                             |
|         -- or send to a candidate --        |
|                                             |
+---------------------------------------------+
| Select Candidate                            |
| [Search candidates...]                      |
| [candidate list...]                         |
|                                             |
| [Selected candidate card]                   |
| [Generate Screening Link] / [Copy] / [Send] |
+---------------------------------------------+
```

### Technical Details

| File | Change |
|------|--------|
| `supabase/functions/generate-screening-invite/index.ts` | Make `candidate_id` optional; skip candidate lookup/email/status-update when absent; insert session with `candidate_id: null` and `generic_session: true` in role_briefing |
| `src/components/screening/ShareScreening.tsx` | Add generic link generation section at top with its own expiry selector, generate button, URL display, and copy button; add visual divider before existing candidate flow |

No database migrations needed -- `candidate_id` on `adaptive_screening_sessions` is already nullable (used for LinkedIn leads).

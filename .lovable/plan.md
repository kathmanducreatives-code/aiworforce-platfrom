# Diagnosis: code is synced, edge functions are stale

## What I verified

**All expected files exist in the active codebase** (branch `lead-sourcing-actions-credits` is present):
- `supabase/functions/_shared/leadIntake.ts` (+ `.test.ts`)
- `supabase/functions/_shared/creditEstimate.ts` (+ `.test.ts`)
- `supabase/functions/_shared/workflowClassifier.ts`
- `supabase/functions/pilot-chat/index.ts`, `orchestrate/index.ts`, `run-agent/index.ts`
- `src/components/chat/workspace/bubbles/LeadSourceCard.tsx`
- `src/components/chat/workspace/bubbles/PostLeadActionsCard.tsx`
- `src/components/chat/workspace/ChatView.tsx`

**Backend routing order in `pilot-chat/index.ts` is correct:**
- Line 789: `isLeadIntakeRequest(message)` block runs BEFORE the old generic `signal_sourcing + needs_clarification` fallback at line 1160.
- Line 842/846: emits `{ ui_form: { kind: "lead_source_selector", ... } }` for vague lead asks.
- `isLeadIntakeRequest` in `_shared/leadIntake.ts` matches "Find me leads" via `LEAD_INTAKE_RE`.

**Frontend (`ChatView.tsx`) is wired:**
- Renders `metadata.ui_form.kind === "lead_source_selector"` via `LeadSourceCard`.
- Renders `lead_intake` via `LeadIntakeCard`.
- Renders `metadata.ui_card.kind === "post_lead_actions"` via `PostLeadActionsCard`.
- `ClarificationCard` is gated to only render when `!leadForm && !leadSelector`, so it can't hide the new card.

## Smoking gun — deployed `pilot-chat` is OLD

Direct curl to deployed `pilot-chat` with `"Find me leads"` returns:

```json
{
  "content": "Which buying signal should I target first: companies hiring GTM roles, ...",
  "metadata": {
    "classifier_source": "regex",
    "possible_actions": ["companies_hiring_gtm","companies_hiring_engineering","founder_profiles","linkedin_engagement","competitor_engagement","specific_niche"],
    "workflow_category": "signal_sourcing",
    "prompt_version": "2026-06-09-v2"
  }
}
```

Neither `classifier_source: "regex"` nor that `possible_actions` array exist anywhere in the current source — they belong to a previous version. The new code never reaches its own `buildLeadSourceSelector` branch because the running container is from before the merge.

## Fix (single action, no code changes)

Redeploy the three edge functions from current source:

1. `pilot-chat` (the critical one)
2. `orchestrate`
3. `run-agent`

Then re-run the smoke tests.

## Validation after redeploy

1. **Direct backend call** — `POST /pilot-chat` with `"Find me leads"` should return `metadata.ui_form.kind === "lead_source_selector"` and the intro copy "Choose the type of leads you want Scout to find…", not the old "Which buying signal…" text.
2. **Browser smoke tests** in the preview:
   - "Find me leads" → Lead Source Selector card
   - "Scrape leads for me" → Lead Source Selector card
   - "Find companies hiring GTM roles" → hiring workflow, no selector
   - "Find people talking about Clay" → competitor flow, no selector
   - "Find 5 B2B SaaS founders in London" → people flow (or honest fallback if `apify_people_search` is disabled)
3. **Post-lead actions card** — after a successful sourcing run, verify `PostLeadActionsCard` renders with the 6 options + credit estimates.
4. **Apify token** — separately, last run showed `apify_unauthorized`. After redeploy, if sourcing still fails with that error, surface it as a token/account issue (not a code issue). I will not rotate the token without your go-ahead.

## Out of scope (per your guardrails)

- No product logic changes.
- No DB writes, no migration `145631`.
- No auto-send / auto-DM / auto-post wiring.
- No Apify token rotation.

## Files to change

None. This is a deploy-only fix.

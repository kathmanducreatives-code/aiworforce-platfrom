# Fix Apify Unauthorized — Token Rotation & Verification

## Why
Lead sourcing fails with `apify_unauthorized`. The Lead Source Selector and Search Brief work; only Apify auth is broken. Need to rotate `APIFY_API_TOKEN` to the new value, confirm actor flags, redeploy the 3 functions that consume it, and smoke-test in the live chat.

## Important — token handling
- Token will be set via the secure secrets manager only (Supabase Edge Function secret).
- Never committed, never logged, never in frontend, never in DB.
- Reports will only say "set / verified", never echo the value.

## Steps

### 1. Update the secret
Use the secrets tool to update `APIFY_API_TOKEN`. This opens a secure form — I will paste the new value there (no token text in chat, code, or logs).

### 2. Verify actor flags (read-only)
Check `secrets--fetch_secrets` and `supabase/functions/_shared/actorRegistry.ts` to confirm these are present and resolve to real actor IDs from the registry (no invented IDs):
- `APIFY_ENABLE_LINKEDIN_POSTS` + `APIFY_ACTOR_LINKEDIN_POSTS` (default `harvestapi/linkedin-post-search`)
- `APIFY_ENABLE_LINKEDIN_PROFILE_POSTS` + `APIFY_ACTOR_LINKEDIN_PROFILE_POSTS` (default `harvestapi/linkedin-profile-posts`)
- Jobs actor (`apify_jobs`, default `curious_coder/linkedin-jobs-scraper`) — enabled-by-default in registry, only needs `APIFY_API_TOKEN`
- People search (`APIFY_ENABLE_PEOPLE_SEARCH`, `APIFY_ACTOR_PEOPLE_SEARCH`) — already set per secrets list

If any optional flag is missing, I will report it but NOT invent values. The honest fallback message for unconfigured people search stays in place.

### 3. Redeploy edge functions
Deploy exactly these three so they pick up the new token env:
- `pilot-chat`
- `orchestrate`
- `run-agent`

No DB writes, no migration `145631`, no other services touched.

### 4. Smoke test A — LinkedIn posts (capped)
Curl `pilot-chat` with: *"Find 5 LinkedIn posts where founders talk about outbound problems."*
Expect: no `apify_unauthorized`, `apify_linkedin_posts` runs, `max_results=5`, signals saved, no outreach.

### 5. Smoke test B — Lead Source Selector → Hiring signals
Curl `pilot-chat` with *"Find me leads"* → verify `ui_form.kind = lead_source_selector`. Then submit hiring brief (GTM / B2B SaaS / USA / early-stage / count=5) and verify:
- same chat / no new thread
- execution plan emitted
- Scout sourcing runs against `apify_jobs`
- no `apify_unauthorized`
- leads persisted to Signal Feed if found
- post-lead action card (`ui_card.kind = post_lead_actions`) with 6 options + credit estimates

### 6. Post-lead actions
Only verify the card renders with the 6 options and credit estimates. Will NOT execute paid actions (Enrich / Draft / Enrich+Draft) without explicit approval. If validating actions, use Save only or Rank.

### 7. Report back
- APIFY_API_TOKEN updated securely (yes/no) — value never shown
- Which environment was updated (Lovable Cloud / current project)
- Functions redeployed (the 3 above)
- Actor enable flags present (per-flag yes/no, no invented IDs)
- Smoke test A result
- Smoke test B result
- `apify_unauthorized` gone (yes/no)
- Leads saved to Signal Feed (yes/no/none-found)
- Post-lead action card appeared (yes/no)
- Remaining errors / missing actor config

## Out of scope
No frontend changes, no DB migrations, no production DB writes, no outreach sends/DMs/comments/posts, no rotation of unrelated secrets, no edits to `actorRegistry.ts`.

Approve to proceed — first action will open the secure secret form for the new token.
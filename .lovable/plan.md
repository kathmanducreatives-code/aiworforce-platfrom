# Onboarding & Company Brain Activation — Plan

## What already exists (verified)

- `OnboardingCompanyBrain.tsx` — 4-step wizard (basics → sources → AI analyze → followups → finalize).
- `setup-company-brain` edge function — actions `save_basics | save_sources | analyze | generate_followups | save_followups | finalize`, with Firecrawl-backed enrichment when `scrape_url` is configured and a manual-fallback warning otherwise.
- `company_brain` table with `profile` (jsonb), `onboarding_completed`, `onboarding_completed_at`.
- `useCompanyBrain` hook + Dashboard banner that links to `/onboarding/company-brain` when `onboarding_completed` is false.
- Brain is already loaded into `pilot-chat`, `run-agent`, and `orchestrate` and passed to system prompts.

## Gaps vs the request

1. **Profile shape is flat** (`company_summary`, `target_customer_profile`, …). The request wants nested groups: `icp`, `goals`, `positioning`, `brand_voice`, `competitors`, `approval_rules`. Agents read both, but new groups are missing.
2. **No `approval_rules`** stored (`draft_only`, `email_requires_approval`, `linkedin_manual_only`). Safety defaults are only enforced in code, not surfaced/recorded per workspace.
3. **No structured ICP fields** (buyer_roles, company_size, industries, geography, pain_points).
4. **No structured brand-voice multi-select** (founder-led / technical / casual / premium / direct / educational / no-hype).
5. **No server-side gate**: `pilot-chat` loads the brain but does not block content/GTM intents when `onboarding_completed === false`. Today an empty-brain user gets generic content.
6. **No tests** covering "no brain → ask for onboarding" or "brain present → Scribe runs / Claude preferred / `saved_outputs` `content_draft`".

## Plan

### 1. Extend the profile schema (additive, backward-compatible)
Keep current flat fields. Add the nested groups requested, defaulting to empty/null so existing brains still validate.

```
{
  ...existing flat fields...,
  icp: { buyer_roles: [], company_size: "", industries: [], geography: "", pain_points: [] },
  goals: { gtm: "", content: "", competitor_tracking: "", outreach: "", hiring: "" },
  positioning: { promise: "", differentiators: [], use_cases: [], proof_points: [] },
  brand_voice: { tone: "", tags: [], style_rules: [], avoid: [] },
  competitors: { known: [], adjacent: [], unknown: false },
  approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true },
  onboarding_completed: true
}
```

A small helper `getBrainDefaults()` lives in `src/lib/companyBrainSchema.ts` (also exported for the edge function via a Deno-friendly mirror in `supabase/functions/_shared/companyBrainSchema.ts`) so both sides agree on shape.

### 2. Extend `setup-company-brain` edge function
- New action `save_structured` that accepts any subset of `{ icp, goals, positioning, brand_voice, competitors, approval_rules }` and shallow-merges into `profile`. No invented defaults — empty strings/arrays stay empty.
- `analyze` keeps producing the existing flat fields **and** populates the new nested groups from extracted/user data only when supported by enrichment text; otherwise leaves them empty with a warning ("Confirm or edit these before finishing").
- `finalize` records `approval_rules` (defaulting to safe values when the user did not change them) and `onboarding_completed = true`.

### 3. Improve the wizard UI
Add three short steps (kept inside the existing single-page stepper, no route changes):
- **ICP** — chip multi-selects for buyer roles / industries, free-text for size/geography, textarea for pain points.
- **Goals & Offer** — short textareas for content / GTM / outreach / competitor-tracking goals and positioning fields (`promise`, `differentiators`, `use_cases`, `proof_points`).
- **Brand voice & approval rules** — multi-select chips for voice tags (founder-led, technical, casual, premium, direct, educational, no-hype) + three safety toggles (`draft_only`, `email_requires_approval`, `linkedin_manual_only`), all default ON.

Existing AI-analyze step prefills these where possible; user confirms before "Finish setup". Save uses the new `save_structured` action. Dark premium look reuses existing `Card`, `Input`, `Textarea`, `Button`, chip pattern (`border-primary bg-primary/10` for active) — no new tokens.

### 4. Server-side gating for content/GTM intents
In `pilot-chat/index.ts`, right after the brain is loaded:
- If `onboarding_completed !== true` AND the classified intent is content/GTM-bound (`content_draft`, `source_signals`, `draft_outreach`, `competitor_tracking`, content-engagement-loop triggers), insert an assistant message asking the user to share their website or a one-line description (or open onboarding) instead of running the workflow. No Apify/Firecrawl call is made.
- Quick chat (`smalltalk`, `clarification`, `unclear`) is unaffected.
- Reply includes a `chat:open_onboarding` event hint (existing `chat:prefill` pattern) so the UI can offer a one-click "Complete onboarding" button — handled by adding a listener in `Dashboard.tsx` / chat shell that navigates to `/onboarding/company-brain`.

### 5. Tests
Add Deno tests under `supabase/functions/_shared/`:
- `companyBrainGate.test.ts` — pure function `shouldGateForOnboarding(intent, brain)` returns `true` for content/GTM intents when `onboarding_completed !== true`, `false` otherwise. Covers: missing brain, partial brain (basics only), completed brain.
- Extend `contentEngagementLoop.test.ts` (already exists) with one case asserting an empty brain + content prompt produces no engagement-loop plan from the gating helper.
- Vitest `src/lib/companyBrainSchema.test.ts` — `mergeProfile()` keeps user-entered fields, fills missing groups with empty defaults, never invents content.

### 6. Safety reaffirmed
No code path sends, posts, comments, or DMs. `approval_rules` is persisted but is informational + UI-enforced; the existing draft-only flow in `contentEngagementLoop` and outreach planners is unchanged.

## Files to add / change

**Add**
- `src/lib/companyBrainSchema.ts` (+ test)
- `supabase/functions/_shared/companyBrainSchema.ts`
- `supabase/functions/_shared/companyBrainGate.ts` (+ test)

**Change**
- `src/pages/OnboardingCompanyBrain.tsx` — three extra step panels + `save_structured` calls.
- `supabase/functions/setup-company-brain/index.ts` — `save_structured` action; analyze writes nested groups when supported.
- `supabase/functions/pilot-chat/index.ts` — gate content/GTM intents on `onboarding_completed`.
- `src/pages/Dashboard.tsx` (or chat shell) — listen for `chat:open_onboarding` and navigate.

## Out of scope (explicit)
- No schema migrations (everything lives in existing `company_brain.profile` jsonb).
- No new Apify actors or scrapers; Firecrawl path unchanged.
- No production deploy; no migration `145631`.
- No auto-send / auto-comment / auto-post / auto-DM additions; safety defaults remain on.

## Final report will cover
Files changed, onboarding flow, profile shape, Firecrawl/manual fallback behavior, how each agent (Scribe / Scout / Aria / Hawk / Penn) consumes the brain, test/typecheck/build results, readiness for final Phase 7 live tests, and any residual gaps.


# Saved Company Brain experience

## Problem

Clicking "Company Brain" in the sidebar / mobile header / dashboard cards navigates to `/onboarding/company-brain`, which re-runs the wizard even for users who already have an active Brain. There is no saved-Brain page.

## Goal

`/company-brain` becomes the canonical entry point. It resolves the current workspace's Brain and renders one of three states — empty / draft / active — without ever silently restarting onboarding. The wizard route (`/onboarding/company-brain`) is untouched and remains the setup surface.

## Routing

- Add route `/company-brain` → `CompanyBrainDashboard` (wrapped in `MainLayout` + `OnboardingGate`).
  - `OnboardingGate` already redirects users with `!onboarding_completed` to `/onboarding/company-brain`, so this route naturally covers "empty" (redirect to onboarding) and only renders for draft/active states.
  - Add `/company-brain` to `ALLOWED_PRE_ONBOARDING` is NOT needed — we want incomplete users forced into onboarding.
- Repoint links to `/company-brain`:
  - `src/components/Sidebar.tsx` nav entry
  - `src/components/MobileHeader.tsx` nav entry
  - `src/components/dashboard/CompanyBrainStatusCard.tsx` `open()` — active branch only; keep `Continue setup` in the incomplete branch pointing at `/onboarding/company-brain`.
  - `src/components/dashboard/BrainReadinessCard.tsx` — leave (it only shows when incomplete).
- Keep `/onboarding/company-brain` exactly as-is (wizard). `?restart=1` still routes there.

## Data loading

Reuse `useCompanyBrain()` (already workspace-scoped via `WorkspaceContext` + RLS). Also load the compiled canonical Brain client-side via a new lightweight helper:

- `src/lib/companyBrainView.ts`: given `profile` JSON, run `normalizeCompanyBrain` + `computeCompanyBrainCompleteness` (both already exist in `supabase/functions/_shared`, but there are frontend twins in `src/lib/normalizeCompanyBrain` and `src/lib/brainCompleteness`). Produce a view-model with the sections listed in the spec (company understanding, ICP, personas, signals, disqualifiers, messaging).

No new backend action needed — `company_brain.profile` already contains everything the saved view renders. If a field is missing in the shape, we render a "Not set — add" affordance instead of introducing a new edge-function action.

## Saved-view UI

New files under `src/components/company-brain/`:

- `CompanyBrainDashboard.tsx` (page): header (status pill Active/Draft, last updated, Edit + Run onboarding again buttons), grid of section cards, footer "System usage" strip.
- `CompanyBrainSectionCard.tsx`: glass card with title, subtitle, chip/list body, and an "Edit" button that opens the drawer.
- `CompanyBrainEditDrawer.tsx`: right-side Sheet (reuse `EditDrawer` pattern) with per-section field editors — chip inputs for arrays, textareas for prose. Save patches `company_brain.profile` via `supabase.from('company_brain').update({ profile: merged }).eq('workspace_id', workspaceId)` (RLS enforces workspace membership). Never touches `workspace_id` or `onboarding_completed`.
- `RestartOnboardingModal.tsx`: confirmation dialog. On confirm → `navigate('/onboarding/company-brain?restart=1')`. Does NOT clear the active Brain; wizard already preserves data until re-activate.

Sections rendered (all read/edit against `profile.*`):
1. Company understanding — `company_name`, `category`, `short_description`, `value_prop`, `key_features`, `evidence`.
2. ICP / targeting — `target_customer.{industries, business_models, company_size, geography, categories, segments}`.
3. Buyer personas — `buyer_personas[]` (role, pains, objections, motivations).
4. Buying signals — `triggers`, `jobs_to_watch`.
5. Disqualifiers — `qualification_rules.{reject_if, manual_review_if, required_evidence}`, `negative_examples`.
6. Messaging — `positioning`, `brand_voice`, `content_angles`.
7. System usage — static strip listing Leads / Scout Radar / Content / Agents / Outreach with the required copy.

Design matches onboarding: `ProgressiveBackground`, glass cards, emerald accents, semantic tokens only. No percentage ring in the header (subtle confidence chip only).

## Draft vs active state

Header status derived from `data.onboarding_completed`:
- `true` → "Active" pill, primary CTA "Edit Company Brain", secondary "Run onboarding again".
- `false` (draft in progress) → this branch is actually caught by `OnboardingGate` and redirected to the wizard, so the saved page only renders in the Active state. The empty and draft empty-states in the spec are therefore handled by the wizard's own entry scenes; the CompanyBrainStatusCard on the Dashboard already surfaces "Continue setup" for the draft case.

## Per-workspace isolation

- All reads use `useCompanyBrain()` → filters by `workspace_id` from `WorkspaceContext`.
- All writes use `.eq('workspace_id', workspaceId)` and rely on existing RLS policies on `public.company_brain`.
- No `workspace_id` accepted from route params or form input.
- No changes to RLS, no new migration.

## Files

New:
- `src/pages/CompanyBrainDashboard.tsx`
- `src/components/company-brain/CompanyBrainSectionCard.tsx`
- `src/components/company-brain/CompanyBrainEditDrawer.tsx`
- `src/components/company-brain/RestartOnboardingModal.tsx`
- `src/components/company-brain/SystemUsageStrip.tsx`
- `src/lib/companyBrainView.ts`

Edited:
- `src/App.tsx` — register `/company-brain`.
- `src/components/Sidebar.tsx` — nav path.
- `src/components/MobileHeader.tsx` — nav path.
- `src/components/dashboard/CompanyBrainStatusCard.tsx` — active-state buttons navigate to `/company-brain`.

Not touched: `OnboardingCompanyBrain.tsx`, `generate-company-brain-draft`, migrations, RLS.

## Validation

- `tsc --noEmit` and build.
- Manual: navigate `/company-brain` as (a) incomplete user → redirected to wizard, (b) active user → saved dashboard; edit a section, save, reload, verify persistence; click Run onboarding again → confirm modal → wizard opens with data intact.
- Confirm no other user's Brain is readable (RLS already enforced).

## Out of scope

- No provider runs, no Apify/Firecrawl/Anthropic calls.
- No edge function deploy.
- No schema changes.

# Credits language + Profile billing visibility

Goal: every user-facing surface says **Credits** consistently, and the sidebar profile/avatar opens a real subscription summary backed by `useCreditBalance` (no fake paid plans, no fake history).

## 1. Profile menu (new) — sidebar workspace header

Currently the sidebar header (`src/components/Sidebar.tsx` lines 76–98) shows the avatar + name + a static "PRO" chip. Replace the static chip with a clickable avatar button that opens a `DropdownMenu` (shadcn) anchored to it.

New component: `src/components/account/ProfileMenu.tsx`
- Reads `useAuth()` (name/email) and `useCreditBalance()` (plan, balance, allowance, period end, billing_status).
- Resolves plan via `getPlan(state?.plan_id ?? 'free_trial')`.
- Renders a dropdown with three sections:
  1. **Header**: avatar, full name, email.
  2. **Subscription summary** (live, honest):
     - `Current plan: {plan.name}`
     - `Credits remaining: {balance}`
     - For paid plans: `Monthly credits: {allowance}` + `Renews: {current_period_end formatted}` + `Billing status: Active/Trial/…`
     - For `free_trial`: `Trial credits: 30` + `Upgrade to unlock more workflows`
     - If no `state` or no `plan_id`: `Current plan: Free Trial`, `Credits remaining: {balance ?? 30}`, `Billing setup: Coming soon` (no fake "Active").
  3. **Actions**:
     - `Billing & Credits` → opens existing `CreditDrawer` (lifted into context or via callback to Sidebar state).
     - `Upgrade plan` → `navigate('/settings/billing')`.
     - `Credit history` → `navigate('/settings/billing#history')` (page already lists txns; empty state already honest).
     - `Settings` → `navigate('/settings/integrations')` (closest existing settings route).
     - `Sign out` → existing `signOut()`.

Sidebar change: replace the `PRO` chip with `<ProfileMenu />` trigger (chevron + plan short name) and keep the avatar visible. The standalone "Sign Out" bottom button stays for redundancy but can also be removed — keep it for now to avoid behavior regressions.

## 2. Standardize wording to "Credits"

Renames (UI copy only — no variable / API renames):

| File | Before | After |
| --- | --- | --- |
| `src/components/credits/CreditPill.tsx` | `{n} credits` (keep), tooltip `credits remaining` (keep) | already correct — no change |
| `src/components/credits/CreditDrawer.tsx` | `Credits & usage`, `Balance`, `Recent activity` empty copy | `Credits`, `Credits remaining`, "No credit activity yet. Credits will appear here after workflows run." |
| `src/pages/SettingsBilling.tsx` | `Balance`, `{used} used`, section comment `Plan + usage` | `Credits remaining`, `Credits used this period`, header "Plan & credits". Add labels: `Monthly credits`, `Next reset`. |
| `src/components/credits/InsufficientCreditsCard.tsx` | `…credits and have …` | `Credits remaining: {balance}. You need {needed} to run this workflow.` |
| `src/components/credits/WorkflowEstimateRow.tsx` | `Estimated cost`, `~{n} credits` | `Estimated credits`, `~{n}` (unit shown by label). Keep safety note. |
| `src/components/landing/PricingCard.tsx` | `Approx. usage`, `Approximate usage depends on…` | `Approx. credits`, `Credit usage depends on workflow type and provider availability.` Add a one-line block above the grid: "Every plan includes monthly workflow credits. Credits are used when Agentory runs real work — finding signals, enriching companies, discovering decision-makers, drafting outreach, and creating content." |
| `src/components/workflows/StatStrip.tsx` | any `usage`/`runs` label that is user-facing | swap to `Credits used` / `Workflow runs` only where it literally counts runs (keep "runs" only when it means count of runs, not credit usage). |

Scope of audit: only the `credits/`, `landing/PricingCard.tsx`, `SettingsBilling.tsx`, sidebar, workflow confirmation cards, and post-lead action cards. Leave `tokens` in `email-sequence/TokenPicker.tsx` and `MentionPill.tsx` alone (different meaning: email merge tokens, @mentions).

## 3. Workflow confirmation copy

`WorkflowEstimateRow.tsx` already shows estimate + safety note. Add a one-liner: "Credits are only used after you click Start." After completion, callers that render result rows should display:
- success: `Credits used: {actual} of estimated {estimated}`
- blocked: `Credits used: 0 — setup needed before this workflow can run.`
- partial: `Credits used: {actual} of estimated {estimated} — Scout returned partial results and rejected weak matches.`

Implement these as a new tiny component `src/components/credits/CreditsUsedRow.tsx` so any bubble/card can drop it in. Wire it into `PostLeadActionsCard.tsx` result state if a `creditsCharged` field is present; otherwise leave it for follow-up (do not invent fake numbers).

## 4. Sidebar credit pill

Already exists (`CreditPill.tsx`). Tweaks only:
- Low-credit threshold copy: when `balance < 20` render `Low · {n} credits left` and keep the amber styling.
- Tooltip already says "credits remaining" — keep.

## 5. Billing & Credits page

`src/pages/SettingsBilling.tsx` — re-label sections:
- `Plan & credits`
- `Credits remaining`, `Monthly credits`, `Credits used this period`, `Next reset`
- Activity section header: `Recent credit activity`; empty state: "No credit activity yet. Credits will appear here after workflows run."

No data shape changes; reads from existing `useCreditBalance`.

## 6. Validation

- `bunx tsgo --noEmit`
- `bunx vitest run src/lib/pricing` (existing pricing tests stay green)
- Manual QA per the user's checklist via the running preview.

## Non-goals / safety

- No DB migrations.
- No changes to `src/lib/credits/ledger.ts` storage shape.
- No fake "Active" subscription rendering when `plan_id` is missing — fall back to Free Trial / "Coming soon".
- Do not rename `tokens` in email/mention contexts.
- Keep existing routes; don't add new ones.

## Files touched

- new: `src/components/account/ProfileMenu.tsx`, `src/components/credits/CreditsUsedRow.tsx`
- edit: `src/components/Sidebar.tsx`, `src/components/credits/CreditDrawer.tsx`, `src/components/credits/CreditPill.tsx`, `src/components/credits/InsufficientCreditsCard.tsx`, `src/components/credits/WorkflowEstimateRow.tsx`, `src/pages/SettingsBilling.tsx`, `src/components/landing/PricingCard.tsx`, `src/components/workflows/StatStrip.tsx`, `src/components/chat/workspace/bubbles/PostLeadActionsCard.tsx`

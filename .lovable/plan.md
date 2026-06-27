
# Agentory Credit & Pricing System

A fair, transparent credit system across product + landing. Single source of truth for plans, workflow costs, and a clean reserve → finalize → (partial-refund) lifecycle. No auto-outreach. No risky migrations.

## 1. Source-of-truth config (new)

Create three pure TS modules so nothing is hardcoded twice:

- `src/lib/pricing/plans.ts` — `PRICING_PLANS` (Free Trial, Starter, Founder Pro [highlighted], Growth, Scale) with `priceMonthly`, `credits`, `seats`, `overagePerCredit`, `features[]`, `description`.
- `src/lib/pricing/workflowCosts.ts` — `WORKFLOW_CREDIT_COSTS` map per spec + helper `getWorkflowCost(id)`. Also exports human-readable metadata: `runs`, `output`, `safetyNote`, `category`.
- `src/lib/pricing/budgetCaps.ts` — `WORKFLOW_BUDGET_CAPS_USD` (internal/admin only; never rendered to end users).

Mirror the same constants for Deno edge functions in `supabase/functions/_shared/pricing.ts` (re-declared, not imported across runtimes).

## 2. Credit lifecycle helpers

### Frontend (`src/lib/credits/`)
- `estimate.ts` → `estimateWorkflowCredits(workflowId, params)` (uses cost catalog + per-row math like signal radar / lead count / enrichable count).
- `client.ts` → thin wrappers calling edge functions: `reserveCredits`, `finalizeCharge`, `refundCredits`, `getBalance`.
- `useCreditBalance.ts` hook (React Query, 30s stale).
- `format.ts` → `formatCredits(n)`, `creditsToOverageUsd(n, planId)`.

### Backend (`supabase/functions/`)
New edge functions, all CORS-enabled, JWT-validated:
- `credits-balance` (GET) — returns `{ balance, plan_id, monthly_allowance, period_end, recent_transactions[] }`.
- `credits-reserve` (POST) — `{ workflow_id, estimated_credits, conversation_id?, task_plan_id?, metadata }` → returns `{ transaction_id, reserved, balance_after }`. Rejects with `402 INSUFFICIENT_CREDITS` if balance < estimate (unless `DEV_BYPASS_CREDITS=true`).
- `credits-finalize` (POST) — `{ transaction_id, actual_credits, status: 'charged'|'partial'|'minimum_charge'|'not_charged', result_summary }`. Computes refund delta.
- `credits-refund` (POST) — admin/internal.

Shared helper `supabase/functions/_shared/creditLedger.ts` with: `reserve()`, `finalize()`, `refund()`, `getBalance()`, and the minimum-charge policy (0 / 10–25% / proportional / full, per spec section 4).

## 3. Database approach (no migration 145631)

Audit first: existing tables include `workspaces`, `workspace_members`, `task_plans`, `tool_calls`, `signals`, `conversations` — but no credits table.

**Proposed new migration** (separate file, NOT the forbidden 145631; will be presented for explicit approval before applying):

```sql
CREATE TABLE public.workspace_credits (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id text NOT NULL DEFAULT 'free_trial',
  credit_balance integer NOT NULL DEFAULT 30,
  monthly_credit_allowance integer NOT NULL DEFAULT 30,
  billing_status text NOT NULL DEFAULT 'trial',
  current_period_start timestamptz DEFAULT now(),
  current_period_end timestamptz DEFAULT (now() + interval '30 days'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid, task_plan_id uuid, workflow_id text,
  transaction_type text NOT NULL, status text NOT NULL,
  estimated_credits integer, reserved_credits integer,
  actual_credits integer, refunded_credits integer DEFAULT 0,
  provider_cost_usd numeric, reason text,
  metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now()
);

-- GRANTs + RLS scoped to has_workspace_access(auth.uid(), workspace_id).
-- provider_cost_usd hidden from SELECT for non-owners via view.
```

Provisioning: extend `provision_workspace_for_user` to also seed `workspace_credits` (30 trial credits).

**Fallback if user declines migration:** v1 read-only mode — store balance in `company_brain.profile.credits` JSON, derive transactions from `tool_calls`. All TS interfaces stay identical so swap is mechanical.

## 4. Workflow integration points

Wire estimate → reserve → finalize into existing flows. Logic is unchanged; the credit calls wrap dispatch.

- **Signal Feed radar scan** (`useSignalFeed.runRadarScan`, `run-radar-scan/index.ts`): reserve 6 on Start; finalize based on accepted signal count.
- **Load More signals** (`LoadMoreConfirmDialog`): already has confirm — add explicit `~6 credits` line + reserve on confirm.
- **Lead workflows** (`buildPostLeadActionsCard`): the existing `credits` field already exists; rename consumers to use the unified estimator + show reservation in confirmation card.
- **Workflow Center** (`src/pages/Workflows.tsx` + `WorkflowCard.tsx`): every card surfaces `~N credits` chip from cost catalog + safety note for outbound.
- **Pilot dispatch** (`pilot-chat`, `run-agent`): on plan creation, attach `estimated_credits`; on tool_call completion, finalize.

## 5. UI surfaces

| Surface | Change |
|---|---|
| Sidebar header | New `CreditPill` showing `Credits: 742` → opens drawer |
| `CreditDrawer` (new) | Plan, balance, monthly allowance, next reset, recent 20 transactions, Upgrade CTA, Buy More (disabled "Coming soon" if Stripe not wired) |
| Workflow confirmation cards | Estimated credits, agents that will run, output preview, safety note |
| Workbench post-run banner | "Credits used: 11 of 15 estimated — Scout found 3 strong matches; weak rejected" |
| Awaiting You drafts | Footer line: "Credits already used. Sending is manual and external." |
| Settings → Billing & Credits (new page `src/pages/SettingsBilling.tsx`) | Plan, usage bar, transaction history table, overage pricing, upgrade/downgrade placeholders |
| Insufficient balance | Inline blocker with Upgrade CTA, Start disabled |

All copy: "Nothing will be sent automatically." preserved everywhere outbound is touched.

## 6. Landing page pricing section

Rewrite `src/components/landing/PricingCard.tsx`:
- New headline: *"Pay for workflows, not seats of software you do not use."*
- Replace current 3 plans with 5 from `PRICING_PLANS` (Founder Pro highlighted).
- Add **How credits work** 5-step block.
- Add **Example** block (5 hiring leads ≈ 15 credits).
- Add **Founder Pro value** approx-usage block with "Approximate usage depends on workflow type and provider availability."
- Add safety footnote: "Nothing is sent automatically. All outreach is draft-only and approval-gated."
- No other landing changes.

## 7. Dev/test mode

Read `import.meta.env.VITE_DEV_BYPASS_CREDITS` (client) and `DEV_BYPASS_CREDITS` (edge). When true:
- Still call estimate + show confirmation.
- Skip reserve/finalize DB writes.
- Badge in confirmation: *"Credits estimated locally · not charged in dev"*.

## 8. Tests

- `src/lib/pricing/__tests__/workflowCosts.test.ts` — estimator math, partial/min-charge policy, insufficient-balance guard.
- `supabase/functions/_shared/creditLedger.test.ts` — reserve→finalize→refund flows, minimum-charge edges, dev bypass.
- Component smoke: `CreditDrawer` renders balance; `PricingCard` renders 5 plans; confirmation card shows estimated credits.

## 9. Safety guardrails (hard rules)

- ❌ No migration `145631`.
- ❌ No secrets/env committed.
- ❌ No auto-send / DM / comment / post / email — outreach stays draft-only.
- ❌ No production DB writes during implementation.
- ✅ Provider cost USD never rendered to end users.
- ✅ Setup-needed workflows charge 0 (early return before reserve).

## 10. Files (new / changed)

**New (~14):**
`src/lib/pricing/{plans,workflowCosts,budgetCaps}.ts`,
`src/lib/credits/{estimate,client,format}.ts`, `src/hooks/useCreditBalance.ts`,
`src/components/credits/{CreditPill,CreditDrawer,InsufficientCreditsCard,WorkflowEstimateRow}.tsx`,
`src/pages/SettingsBilling.tsx`,
`supabase/functions/_shared/{pricing,creditLedger}.ts`,
`supabase/functions/credits-balance/index.ts`, `credits-reserve/index.ts`, `credits-finalize/index.ts`.

**Modified (~10):**
`src/components/landing/PricingCard.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx` (route), `src/pages/Workflows.tsx`, `src/components/workflows/WorkflowCard.tsx`, `src/components/signals/{SignalFeed,LoadMoreConfirmDialog}.tsx`, `src/hooks/useSignalFeed.ts`, `supabase/functions/run-radar-scan/index.ts`, `supabase/functions/_shared/creditEstimate.ts` (delegate to new catalog).

## 11. Open questions before I build

1. **Migration approval:** Apply the new `workspace_credits` + `credit_transactions` migration now, or start with the JSON-fallback (v1) and migrate later?
2. **Trial credits on existing workspaces:** backfill 30 credits to all existing workspaces, or only new ones from now on?
3. **Stripe checkout:** wire the existing built-in Stripe payments tool for upgrades now, or ship as "Contact us" first?
4. **Dev bypass:** OK to default `DEV_BYPASS_CREDITS=true` in preview/TEST so QA never burns real credits?

Once these are answered I'll execute the build in one pass.

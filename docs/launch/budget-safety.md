# Budget safety — spend fails closed, credits are a beta grant (Phase: budget safety)

**Status: IMPLEMENTED/TESTED locally. Not deployed.** Decided 2026-09-28: *Enforce + beta grants*.

## What was wrong

- `LEAD_CREDIT_ENFORCEMENT` and `MODEL_SPEND_ENFORCEMENT` defaulted to `observe`: unless an
  environment set the exact word `enforce`, provider calls were never refused for lack of credits.
- Signup (`src/pages/Auth.tsx`) is open to anyone, and a new workspace holds **no** credits.
- So with the variable unset, any new account could start paid missions without limit. Each mission
  is bounded (`DEFAULT_CEILINGS`: $2.00 provider + $0.40 model), but nothing bounded how many.
- `workspaces.daily_run_limit` exists in the schema and is read by nothing.

## What changed

| Piece | Behaviour now |
|---|---|
| `resolveCreditEnforcement` | `enforce` unless the value is exactly `observe`. Unset, empty or a typo enforces. |
| `resolveSpendEnforcement` | Same. An enforced model ceiling that is not configured **refuses** (`ceiling_misconfigured`), unchanged. |
| `creditStartGate` (orchestrate) | A request that buys provider data (a lead mission, or `source_with_apify`) is refused **before** the plan, task or queue row exist when the workspace has < 1 credit, or its balance cannot be read: `402 credits_required`. Model-only plans are not gated. |
| pilot-chat | Answers `credits_required` with the beta-access message, not "the orchestrator failed". |
| `scripts/beta/grant-credits.ts` | Operator-only grant through the service-role-only `credits_grant`; validates, refuses > 1000, idempotent per workspace/amount/day, never prints the key. |

The per-call reservation (`authorizeProviderCall`) remains the enforcement everywhere — continue-workflow,
direct run-agent calls, Radar. The gate only turns a mid-run refusal into a clear one at the door.

Sizing: 1 credit per paid provider call. Canary 11 (a full screened mission) used 4 credits across 5 calls.

## Rollout — in this order, or every paid mission is refused

1. **Model-spend variables on BOTH surfaces** (Supabase function secrets *and* the Railway worker, which
   runs Lead V2 missions in-process): `MODEL_SPEND_CEILING_USD` and `MODEL_SPEND_PERIOD_DAYS`.
   Without them every model call — Pilot chat included — is refused once this deploys.
   (Tests describe production as `$5 / 1 day, enforce`; confirm, don't assume.)
2. **Grant credits to every workspace that should keep working**, dry run first:
   ```
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-net --allow-env \
     scripts/beta/grant-credits.ts --workspace <uuid> --credits 50 --reason "beta: <who>, approved by <you>" --dry-run
   ```
   then again without `--dry-run`.
3. Deploy the functions (stamped: `scripts/deploy/stamp-build.sh`) and the Railway worker.
4. Verify: a workspace with no grant gets the beta message and no plan row
   (`[orchestrate][credit-start-gate]` in the logs); a granted workspace starts.

**Rollback without a code change:** set `LEAD_CREDIT_ENFORCEMENT=observe` (Supabase secrets apply on the
next invocation; the Railway worker needs `railway redeploy`).

## Still open

- Beta access is a grant, not a signup gate: anyone can create an account and use the free parts.
- No per-workspace daily cap (not chosen). A granted workspace is bounded by its credits and by the
  per-mission ceilings.
- The Pilot preview card still shows its credit estimate to a no-credit workspace; the refusal comes on Start.

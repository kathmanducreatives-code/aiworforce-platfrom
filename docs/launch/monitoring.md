# Monitoring — the beta's alarm (Phase: monitoring)

**Status: IMPLEMENTED, verified on a real local stack. Not deployed; the alarm cannot fire until the
function is deployed, the secrets exist, and the workflow is on the default branch (see Rollout).**

The system already heals some failures on its own (cron sweeps stuck runs, resumes stalled leads) and
told nobody about any of them. This adds the alarm, with no new vendor.

## What is watched

`supabase/functions/_shared/opsHealth.ts` reads, per call:

| Signal | Alert |
|---|---|
| Lead V2 mission `running` on a lease expired 5+ min ago | **critical** — the reclaim did not happen |
| Claimable mission waiting 15+ min with no claim | **critical** — is the Railway worker up? |
| Worker `/health` unreachable or not `ok` (incl. `stalled`) | **critical** (checked by the script) |
| ops-health itself unreachable, refusing the token, disabled, or failing to read | **critical** |
| ≥ 3 missions failed in 24h | warn |
| Legacy task `running` with no update for 30 min | warn |
| Paid provider call still `started` after 1h (spend in an unknown state) | warn |
| Provider spend > $10 / model spend > $5 / one workspace > $5 in 24h | warn |
| Beta request pending > 48h | warn |

Thresholds are overridable on the function: `OPS_ALERT_FAILED_24H`, `OPS_ALERT_PROVIDER_USD_24H`,
`OPS_ALERT_MODEL_USD_24H`, `OPS_ALERT_TOP_WORKSPACE_USD_24H`, `OPS_ALERT_BETA_PENDING_HOURS`.

## How it alerts

- **`ops-health` edge function** (class OPS): `GET` with `x-ops-token`. Fails closed — `503` and no
  reads without `OPS_HEALTH_TOKEN` (≥ 32 characters). Returns counts, ages and dollar totals only: no
  workspace id, user, query or result, so the token reveals nothing about a customer.
- **`.github/workflows/ops-health.yml`** runs `scripts/ops/check-health.ts` every 15 minutes (fails on
  critical) and daily at 08:00 UTC (fails on warnings too — a digest). **A failed scheduled run is what
  GitHub emails**; that is the alert channel. It holds only the ops token — never a service key.
  Unconfigured, it skips with a notice instead of failing.

## Verified

- Unit: `opsHealth.test.ts` (11) — thresholds, snapshot arithmetic, fail-closed access, no workspace id
  in any response, a failed read is critical; `opsHealthWorkflow.test.ts` (7) — exit rules, the workflow
  holds only the three ops secrets, skip-when-unconfigured.
- **Live, on the isolation stack (real Postgres + PostgREST):** the real handler and Supabase adapter
  answered all nine reads; seeded rows raised `queue_stuck_running` (critical), `provider_calls_unsettled`
  and `workspace_spend_high` (warn), counted a resumed call once, and returned no workspace id.
- That live run found a bug the unit test could not: the unsettled filter used `running`/`pending`,
  which `lead_execution_calls_status_check` forbids — only `started` is in flight. Fixed and pinned
  against the schema.

## Rollout

1. `supabase secrets set OPS_HEALTH_TOKEN=<32+ random characters>` and deploy `ops-health` (stamped).
2. Add repository secrets `OPS_HEALTH_URL` (`https://<ref>.supabase.co/functions/v1/ops-health`),
   `OPS_HEALTH_TOKEN` (the same value) and `WORKER_HEALTH_URL` (the Railway `/health`).
3. **GitHub runs scheduled workflows only from the default branch**: the alarm starts when this reaches
   `main`. Until then, run it by hand: Actions → Ops health → Run workflow.
4. Check your GitHub notification settings send you failed-workflow emails
   (they go to the user who last changed the schedule).

## Still open

- **Front-end error tracking** (browser exceptions): needs a vendor choice (e.g. Sentry) and an account.
- **Alert destination** beyond email (Slack/pager): the script's exit code is the hook.
- `public.error_log` exists and nothing writes it.

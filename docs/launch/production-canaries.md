# Production canaries — plan (Phase: production canaries)

**Status: PLAN. Nothing here has been deployed or run.** Every step that deploys, changes a secret,
grants credits or spends money needs an explicit go.

## What production is running (read-only probes, 2026-09-29)

| Surface | Running | Note |
|---|---|---|
| Railway worker | **`b2c6fc1f` "wip: preserve Jev benchmark…"**, deployed 2026-09-28 16:56 UTC | auto-deploys from `feat/lead-mission-v2-worker`; healthy, gated (allowlist set), 0 claims in 15 h |
| `orchestrate`, `run-agent` | 2026-09-19 (≈ P6 deploy) | the worker runs newer code in-process → **version skew** |
| `pilot-chat` | 2026-09-26 | |
| `approve-and-continue`, `job-feed`, `send-scheduled-emails`, `email-tracking`, `google-calendar-auth`, `tool-availability` | **2026-08-16 — the vulnerable versions** | fixed on `launch/hardening` (b1c90fa9, 03787c2d), not deployed |
| `firecrawl-scrape` | not deployed at all | |
| Build stamps | none anywhere | every surface predates stamping |
| Database migrations | **unknown** (no read-only credentials in this session) | the lock-down (`20260929120000`), anon-revoke (`…130000`) and beta (`…140000`) migrations are certainly not applied |

Implication: the security fixes should ship **before** any canary and independently of Lead V2 —
they cost no provider spend and close holes that are open now.

## Decisions needed before anything runs

1. **Deploy path.** Railway deploys `feat/lead-mission-v2-worker`, which carries WIP (Jev benchmark,
   dashboard) that `launch/hardening` deliberately excludes — and that WIP is what production runs now.
   *Recommended:* merge `launch/hardening` into `main` (CI gates it), point Railway at `main`, and deploy
   functions from the same SHA. Alternatives: merge into `feat` (keeps the WIP in production), or point
   Railway at `launch/hardening` until `main` catches up.
2. **Canary workspace.** The one V2-allowlisted production workspace seen so far is `e8af257d…`
   (confirm it is internal).
3. **Spend cap for the whole ladder.** Proposed: **≤ $0.25 provider + ≤ $0.05 model**, and a grant of
   10 credits to the canary workspace.
4. **How I watch.** Per-call watching needs read-only SQL on production: authorise the
   `supabase-prod-readonly` connector (or run the queries yourself). Without it, the watch is ops-health,
   Railway logs and the UI — coarser.

## Phase A — security deploy (no provider spend)

1. Read-only: `python3 scripts/deploy/migration-probes.py` against production → which migrations exist
   (docs/launch/migration-reconciliation.md).
2. Apply `20260929120000_lock_down_definer_rpcs` and `20260929130000_revoke_anon_writes_on_workspace_tables`.
3. Deploy, stamped (`scripts/deploy/stamp-build.sh`): `approve-and-continue`, `send-scheduled-emails`,
   `email-tracking`, `google-calendar-auth`, `tool-availability`, `firecrawl-scrape`; retire `job-feed`
   (deploy the 410, then `supabase functions delete job-feed`).
4. Verify: `scripts/security/verify-rls.sh '<prod read-only url>' --strict` passes;
   `production-shas.sh` shows the SHA on each; the endpoint sweep's attacks (no auth / anon / service key /
   forged) fail against production with no side effect.
5. Rollback: redeploy the previous function version from git; the migrations are revoke-only (re-grant
   restores).

## Phase B — prerequisites for the canaries

1. **Budget rollout, in order** (docs/launch/budget-safety.md): `MODEL_SPEND_CEILING_USD` +
   `MODEL_SPEND_PERIOD_DAYS` on **both** Supabase and Railway → grant credits to every workspace that
   must keep working (incl. the canary workspace) → apply `20260929140000_beta_access_requests`.
2. **One SHA everywhere:** deploy `orchestrate`, `run-agent`, `pilot-chat`, `continue-workflow`,
   `resume-stalled-leads`, `enqueue-lead-mission`, `ops-health` stamped from the release SHA; Railway on
   the same SHA; Netlify rebuilt. `production-shas.sh` must print one SHA for all.
3. **Alarm on:** `OPS_HEALTH_TOKEN` on Supabase; repo secrets `OPS_HEALTH_URL`, `OPS_HEALTH_TOKEN`,
   `WORKER_HEALTH_URL`; run *Ops health* by hand until the workflow is on `main`.
4. **Gate:** ops-health `ok`, worker `/health` ok with the release SHA, CI green on that SHA.

## Phase C — the canary ladder (each rung needs its own go)

| Rung | What | Provider cap | Proves | Pass when |
|---|---|---|---|---|
| **C0** smoke | Pilot chat turn; a Start from a **no-credit** workspace; file a beta request → `review-requests.ts approve --credits 1` → card shows approved | $0 (model ≈ $0.01) | budget gate, beta loop, model ceiling, notices | `credits_required` with **no** plan/task/queue row; request approved; ops-health ok |
| **C1** known company | Pilot: one named company, funded in the last 365 days (Salvo-shaped) in the canary workspace | **$0.04** (`run_budget {0.04, 1}`) | known-company route live; details → Atomus → conditional Pvalyou; distinct evidence ids; Workbench = graph; settlement | ≤ 1 call per actor; every ledger row settled at terminal; chat's final message final, checkpoint notice resolved |
| **C2** product path | Pilot, the canary sentence (US, 11–50, B2B SaaS, funded 365 d, hiring) — default screen budget | **$0.14** (default `{0.14, 2}`) | funding screen in prod; multi-slice continuation shows "continuing", ends truthful in Chat, Pilot and Workbench | page cursor + one Atomus read; no discovery after the screen; terminal notice final; plan pill never "Partial" mid-run |
| C3 (optional) | the C2 sentence with `run_budget {0.06, 2}` | $0.06 | an honest budget stop | ends `budget_exhausted`; checkpoint resolved "stopped at its budget" |

Ladder total: **≤ $0.24 provider**.

**Stop immediately (cancel with `cancel_lead_mission`) if:** spend passes the rung's cap; any actor
outside the rung's set runs; a second run of one actor for one company; a queue row stays `running` on an
expired lease; ops-health goes critical; any row for a workspace other than the canary workspace changes.

**Rollback:** `LEAD_CREDIT_ENFORCEMENT=observe` is the no-code budget rollback (Railway needs
`railway redeploy`); Railway → redeploy the previous deployment; functions → redeploy the previous git
SHA (stamped). Migrations in this set are additive or revoke-only.

## After the ladder

Record per rung: IDs, calls and costs, settlement, terminal state, the chat messages as stored, and the
Workbench's view — the same A–T shape as the local canaries — then mark the phases in the launch status
table as production-verified.

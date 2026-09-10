# LeadMission V2 worker — deployment and environment contract

A long-running Deno process. It claims one `lead_mission_queue` row at a time,
replays that row's kickoff body into `run-agent`'s handler **in-process** with a
longer revocable deadline, heartbeats the queue lease (and, once bound, the task
and lineage leases), and releases. All state lives in Supabase; the container is
disposable.

It is **not** an Edge Function. The whole point is escaping the Edge execution
limit, which is what forced deadline reserves, checkpoint timing, continuation
claims, repeated invocations and sweeper-driven recovery.

## Disabled by default

With `LEAD_V2_WORKER_WORKSPACES` unset or empty, `v2Enabled()` is false, the
worker never calls `claim_next_lead_mission`, and V2 is off. It connects, logs
`V2 disabled … will not claim any mission`, and idles. There is no global on
switch — a workspace opts in by id, one at a time.

Deploying the worker is therefore safe on its own. **Enabling the allowlist
before a worker is running is not**: `orchestrate` would route approved missions
to a queue nothing drains, and lead sourcing for that workspace would stop
silently.

## Build

Built from the **repository root**, because the worker imports `run-agent` and
~24 shared modules by relative path out of `supabase/functions/`:

```
docker build -f worker/Dockerfile -t agentory-lead-worker .
```

## Environment contract

Discovered from code, not invented. Nothing here has a default that spends money.

### Required

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL. The worker exits 1 without it. |
| `SUPABASE_SERVICE_ROLE_KEY` | Claim/heartbeat/release RPCs are `service_role`-only, and `run-agent` compares its bearer against this. Use the `sb_secret_…` key — the legacy `service_role` JWT is rejected. |
| `SUPABASE_ANON_KEY` | `run-agent` builds a user-scoped client for its workspace access guard. |

### The V2 gate

| Variable | Default | Purpose |
|---|---|---|
| `LEAD_V2_WORKER_WORKSPACES` | *(unset)* | Comma-separated workspace ids. **Empty ⇒ V2 disabled.** Leave unset until a worker is confirmed healthy. |

### Worker tuning — all optional, all safe at their defaults

| Variable | Default | Notes |
|---|---|---|
| `LEAD_WORKER_MAX_RUNTIME_MS` | `300000` (5 min) | Hard-capped at `1200000` (20 min) in code. The cap exists because `credits_release_stale(interval '30 minutes')` runs every 10 minutes: a run outliving 30 minutes would have reservations refunded underneath it. A run that reaches its ceiling checkpoints and ends resumable — it is never killed. |
| `LEAD_WORKER_LEASE_SECONDS` | `180` | Matches the lineage lease. |
| `LEAD_WORKER_HEARTBEAT_MS` | `60000` | Well inside the 180s lease and inside the 5-minute quiet window `tasks_sweep_stuck_runs` treats as a dead run. |
| `LEAD_WORKER_IDLE_POLL_MS` | `5000` | Poll interval when the queue is empty. |
| `LEAD_WORKER_ID` | random UUID | Pin it for a stable identity across restarts. Must be a UUID or it is ignored. |
| `PORT` | *(unset)* | Set by the platform. When set, the health endpoint listens; when absent, no socket is opened. |

### Providers — needed only to EXECUTE a mission

With the allowlist empty the worker claims nothing and touches none of these.
They are required before the first canary, and are the same values the
`run-agent` Edge Function already holds.

`APIFY_API_TOKEN`, `FIRECRAWL_API_KEY`, `ANTHROPIC_API_KEY`,
`LOVABLE_API_KEY`, `RESEND_API_KEY`, `SOURCE_PLANNER_PROVIDER`,
`EVIDENCE_ENRICHMENT`

### Spend control — inherited, and worth setting deliberately

The worker runs the same engine, so the same two layers apply. Production
currently sets: `MODEL_SPEND_ENFORCEMENT=enforce`,
`MODEL_SPEND_CEILING_USD=10.00`, `MODEL_SPEND_PERIOD_DAYS=1`,
`MODEL_RUN_MAX_CALLS=200`, `MODEL_RUN_MAX_INPUT_TOKENS=1400000`,
`MODEL_RUN_MAX_OUTPUT_TOKENS=200000`, `MODEL_RUN_MAX_TOTAL_TOKENS=1500000`.
Optionally `FIRECRAWL_USD_PER_CREDIT` once a per-credit rate is known from an
invoice.

### Set by the worker itself

`RUN_AGENT_IMPORT_ONLY=1` — set **before** importing `run-agent`, so importing
its module does not start an HTTP server in this process. Do not set it in the
platform config; it is not a knob.

## Health

`GET /health` (also `/` and `/healthz`) returns JSON and is unauthenticated, so
it carries operational counters and nothing else — no secrets, no queue
payloads, no workspace ids.

```json
{ "ok": true, "status": "polling", "gated": false, "uptime_s": 312,
  "polls": 62, "claims": 0, "seconds_since_last_poll": 2 }
```

`ok` is judged on the **loop, not the socket**. A process that is up but has
stopped polling for more than `4 × LEAD_WORKER_IDLE_POLL_MS` reports
`status: "stalled"` and returns **503**, so a platform health check catches a
wedged claim rather than only a dead process. `working` (a mission executing)
and `draining` are healthy states and suspend the stall check.

## Shutdown

`SIGTERM`/`SIGINT` set a stop flag that `runWorkerLoop` reads **between** ticks.
A mission already executing finishes and checkpoints on its own terms; the
worker then closes the health server and exits.

A mission can therefore outlive the platform's kill grace period and be
`SIGKILL`ed mid-run. That is safe — the queue lease lapses, `claim_next_lead_mission`
reclaims the row, and `completed_operations` plus the provider fingerprints stop
any already-purchased work being bought twice — but it wastes work already paid
for. Prefer a grace period at least as long as `LEAD_WORKER_MAX_RUNTIME_MS` if
the platform allows it.

## Replicas

`numReplicas: 1` in `railway.json` is a choice, not a limitation. Claiming is
atomic — `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` inside the RPC's transaction,
verified live with two concurrent claimants — so more replicas are safe. One is
set so the first production proof has exactly one owner to reason about.

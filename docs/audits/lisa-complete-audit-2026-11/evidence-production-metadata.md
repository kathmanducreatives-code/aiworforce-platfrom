# Production evidence (metadata and aggregates only)

These were read on 2026-11-10 from project `ohsdatpvfdjdemstoiuj`, using catalog queries and aggregate counts only. No row contents, company names, secrets or customer data were read.

A follow-up read of the edge-function **logs**, to find out *why* scheduled scans produce nothing, was **denied** by the session's permission policy. It was not attempted again, and the cause is listed as an open question in the report.

## Deployed LISA functions

| Function | Version | Last deployed (UTC) |
|---|---|---|
| `run-radar-scan` | 50 | 2026-08-31 |
| `run-monitoring-scan` | 110 | 2026-10-11 |
| `run-monitoring-tick` | 30 | 2026-08-23 |
| `daily-brief` (ORION) | 47 | 2026-09-11 |
| `company-brain-memory` | — | **not deployed** (Company Brain V1 is unmerged) |

## Scheduler

| cron job | schedule | active |
|---|---|---|
| `monitoring-tick` | `*/15 * * * *` | **true** |

## Write access on LISA tables (P0 check)

- `signal_events`: `authenticated` has **INSERT, UPDATE, DELETE**. The policies are member insert, update, delete and read (any role, including viewer).
- `signal_event_evidence` and `signals`: same member insert, update and delete policies.
- `monitoring_subjects`: `authenticated` has **INSERT, UPDATE, DELETE**, with member policies.
- `signal_reviews.signal_id` FK → **`signals`** (the legacy table), not `signal_events`.

## Aggregates

| Measure | Value |
|---|---|
| Monitoring subjects (all / enabled) | 6 / **1** (competitor 2, tracked_company 2, icp 2) across 2 workspaces |
| Last completed monitoring pass | 2026-11-09 13:15 UTC |
| `monitoring_runs` rows | 5 |
| `monitoring_budgets` rows | 1 |
| `signal_events` by origin, all time | manual_scan 14, lead_mission 21, **scheduled_monitor 5** |
| `signal_events` by origin, last 30 days | lead_mission 5, **scheduled_monitor 0** |
| Monitoring events with a source URL | **0 / 5** |
| `signal_event_evidence` rows | **0** |
| `signal_cluster_relevance` rows | 1 |
| Legacy `signals` rows | 21 |
| `signal_reviews` rows | 0 |
| Monitoring credit charges, last 30 days | 0 |
| Monitoring model calls, last 30 days | 0 (USD 0) |

**What this means.** The scheduler fires and records completed passes. In the last 30 days, those passes have bought nothing, called no model, and stored no signal.

# Approval A — read-only hosted preflight of TEST `tlvnfrxzjhsjgdofwehb` (2026-10-26)

Every statement ran inside `begin transaction read only … rollback` through the
Supabase connector, scoped to `tlvnfrxzjhsjgdofwehb` only (the connector can
also see production `ohsdatpvfdjdemstoiuj`, which was never queried). Nothing
was written, applied, seeded, dispatched or paid for.

## Project
`agentory-discovery-test`, ap-northeast-2, ACTIVE_HEALTHY, Postgres 17.11, created 2026-10-18.
Extensions: pg_cron, pg_net, pgcrypto, uuid-ossp, supabase_vault, pg_stat_statements. No edge functions deployed.
Migration history table: one row (`20261021145108 lead_mission_v2_exhausted_lease_terminal`); the rest was built by psql, so presence was verified object by object.

## Preflight (candidate 6d448610's preflight.sql)
| | Result |
|---|---|
| P01–P04 admission tables/functions/grants, V2 queue | PASS |
| P05 credit re-arm fix (held 20261015130000) | INFO: **installed** on TEST |
| P06 credit reaper fix | INFO: not installed |
| P07 no hosted-calling cron job | PASS (jobs: release-stale-credit-reservations, sweep-stuck-runs) |
| P08 Scout agent | PASS |
| P09 exactly 10 credits, 0 reserved | PASS |
| P10 no Company Brain | PASS (0 rows in the whole project; no-Brain guard trigger present) |
| P11 open provider liability | PASS (0; 37 earlier operations all reconciled) |
| P12 live authorization | PASS (5 earlier authorizations, all stopped) |
| P13 claimable missions | PASS (6 earlier rows: 3 complete, 1 failed, 2 cancelled) |
| P14 model-name constraint | PASS |
| **P15 security triggers** | **FAIL: 0 of 4** (expected: Approval B installs them) |
| **P16 service_role membership writes** | **FAIL: UPDATE/DELETE/TRUNCATE granted** (same) |
| P17 client schema | INFO: not installed |

## Schema verify and commit-boundary preflight
S01 9/9, S02 3/3, S03 owner is a member (one Auth user, v4 UUID), S04 0, S05 0, S08 2/2 PASS; S06 0 / S07 0 INFO.
Commit boundary: 0 missing columns, 0 principal-less tasks (BLOCK none), 0 foreign-plan tasks, 0 live non-member tasks; the three security functions do not exist yet.

## Migration fingerprint (first created object of each file)
Present: baseline, all shipped migrations through 20260929140000, held V2 chain, held admission 20261015140000, test-only no-Brain guard.
Absent: shipped 20261023120000 and 20261024120000 (Company Brain write hardening; used only by Brain edge functions, not in the worker's module graph, none deployed: not needed for this run); held 20261015120000 provider claims (correct); 130000/150000/160000 (Approval B).

## GitHub (read-only)
`discovery-test-worker.yml` active, **never run** (0 runs). Default branch `launch/hardening` (older workflow file). Branch `test/agency-candidate-b-operator` = `6d448610…`, unprotected. Environment settings, secrets and variables are not readable from this session (proxy 403); Codex's 2026-10-18 snapshot: required reviewer, admins cannot bypass, branch policy `launch/hardening` only, five TEST_ secret names.

## OpenAI
Not verifiable from this session (no key, no dashboard access). Public pricing re-confirmed: Luna $0.20 / $0.02 / $1.20, cache write $0.25 (30 min).

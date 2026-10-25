# E: Codex #185 follow-up fixes, and the client pins and descendants (2026-10-25)

Local only: Postgres 17.11, PostgREST 12.2.3, Deno 2.8.2. No hosted system, paid call, merge, deploy or enabled flag.

| Finding / item | PR | Head |
|---|---|---|
| PLAN-PARENT, EXEC-EFFECT | #189 | `e73a6820` (on #179 `08351242`) |
| MEMBER-SURFACE | #190 | `949a2c5e` (on #186 `bbbf3811`) |
| Combined review tree | `review/security-followup-combined` | `c336e01f` (tree `6be3fac3` = tested `9fc3a876`) |
| Task pins §9.1 | #191 | `93309a66` |
| Pin consumption §9.2 + guard reads pin columns | #192 | `8b7a2f23` |
| Same-client descendants §9.5 | #193 | `db430096` |

## Results
**Combined tree**
- Codex's reproductions, unchanged: 5 cases pass (see `combo_c*.summary.txt`).
- DB contract 354/0, edge 9422/0.
- Real workers 4/4 when run alone (`combo_rp3`).
- Mutation proofs 134/134 killed (`mutation-shard*.txt`).

**Per branch**

| PR | DB contract | Infra | Edge | New mutants killed |
|---|---|---|---|---|
| #189 | 250/0 | 187/0 | 8860/2 (#181 clock tests) | 8 |
| #190 | 267/0 | 187/0 | — | 7 |
| #191 | 272/0 | 187/0 | — | 5 |
| #192 | 255/0 | — | 8863/2 | — |
| #193 | 284/0 | 187/0 | — | 4 new, plus #177's 4 |

**Rollbacks:** every new held migration round-trips exactly, privileges included (`held-rollback-roundtrip.sh` in D).

## Findings worth keeping
- A bare-host `--deny-net` does not override a `host:443` allow (D).
- PostgreSQL refuses `ON DELETE SET NULL (col)` on a key with a generated column, so `client_scope` is a plain column.
- Wrapping the smoke admission fetch hides its symbol marks (the planner sizing broke), so the fence carries them.
- `mutation.sh` double restore registration skipped later restores under `set -e`. Fixed in #189.

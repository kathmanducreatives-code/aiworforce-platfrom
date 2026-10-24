# Integration evidence B: Phase 1 + Lead Discovery + new Backend PRs (2026-10-24, evening)

Local scratch trees only. No scratch commit was pushed except inside `combined-b.bundle`. No PR was merged; no hosted, paid or deploy effect.

## Trees

| Name | Commit | Contents |
|---|---|---|
| combined-b | `b57fa5a6` | evidence A's verified `efc95620` (the eight Lead Discovery PRs + #169 `833affce` + #173 tip `70507ba0`, which contains #171 and #172) + #181 `90bd993f` + #175 `dbd73f06` + #177 `6f63d302` + #180 `dd7cba84` (contains #165) + #182 `50928cb4` + #179 `c0199569` |
| combined-b-final | `bed1b480` | `b57fa5a6` + #177 `05e288e1` (the reference list moved from a temporary table to a jsonb array; behaviour unchanged) |

Restore: `git fetch combined-b.bundle 'refs/heads/evidence/*:refs/remotes/evidence/*'`. Exact PR heads: `pr-heads.txt`. Merge sequence: `merge-sequence.txt`.

## Merge resolutions
- Evidence A's: `mutation.sh` has one restore loop naming both `$reaper_sql` and `$brain_writer_sql`, with all proof blocks kept; README rows are kept.
- New: none needed. #179's import was moved on its own branch (`c0199569`) so it no longer collides with #145/#150's import line. Everything else merged cleanly.

## Results (commands as in evidence A's TEST-COMMANDS.md; logs in `logs/`)

| Suite | `b57fa5a6` | `bed1b480` |
|---|---|---|
| DB contract (3 shards) | 72 + 100 + 119 = **291 / 0** (274 + 8 OWN-01 + 9 guard) | OWN-01 file re-run on #177 `05e288e1`: 8 / 0 |
| Mutation (3 shards, 3 worktrees) | **91 / 91 killed**, total = ran = 91 (31 + 30 + 30) | the 4 OWN-01 proofs re-run on `05e288e1`: 4 / 4 killed |
| Edge | **9472 / 0** (green again with #181) | — |
| Infra | 215 / 1: the stricter RLS scanner from the pilot stack flagged #177's temporary table | **216 / 0** |
| deno check (worker, run-agent, orchestrate, enqueue, setup/generate-company-brain) | pass | — |

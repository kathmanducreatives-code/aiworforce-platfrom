# Exact commands used on the final combined tree (efc95620)

Environment: Postgres 17.11 (three local clusters on 127.0.0.1:5432/5434/5435), PostgREST 12.2.3 at `/opt/tools/postgrest`, Deno 2.8.2.
Each mutation shard ran in its **own worktree** at the same commit, because `mutation.sh` edits files in place.

```sh
export POSTGREST_BIN=/opt/tools/postgrest
# DB contract: every tests/db-contract/*.contract.test.ts, split round-robin into 3 shards
PG_ADMIN_URL=postgres://postgres:***@127.0.0.1:5432/postgres tests/db-contract/run.sh <shard 1 files>
PG_ADMIN_URL=postgres://postgres:***@127.0.0.1:5434/postgres tests/db-contract/run.sh <shard 2 files>
PG_ADMIN_URL=postgres://postgres:***@127.0.0.1:5435/postgres tests/db-contract/run.sh <shard 3 files>
# Mutation: 3 shards, 3 worktrees (wt-p1x2, wt-p1x4, wt-p1x5) at efc95620
PG_ADMIN_URL=… MUTATION_SHARDS=3 MUTATION_SHARD=<0|1|2> tests/db-contract/mutation.sh
# Edge / infra / type check
deno test --allow-read --allow-env --no-check tests/edge-functions/
deno test --allow-read --allow-env --allow-run tests/infra/
deno check worker/main.ts supabase/functions/run-agent/index.ts \
  supabase/functions/setup-company-brain/index.ts supabase/functions/generate-company-brain-draft/index.ts
```

## Results

| Suite | Result | Log |
|---|---|---|
| DB contract | 94 + 102 + 78 = 274 passed, 0 failed | `logs-final-efc95620/contract-*.log` |
| Mutation | 80 / 80 killed; tally total = ran = 80 (27 + 27 + 26) | `mutation-*.log` |
| Edge | 9449 passed, 0 failed | `edge.log` |
| Infra | 216 passed, 0 failed | `infra.log` |
| deno check | exit 0 | `check.log` |

Traces (`A7_SCENARIO_TRACE`, `OFFLINE_SMOKE_TRACE`) were stripped from the logs for size. The test outcome lines are unchanged.

## Rebuilding the trees

```sh
git fetch <path>/phase1-integration.bundle 'refs/heads/evidence/*:refs/remotes/evidence/*'
git log --first-parent --oneline origin/launch/hardening..evidence/phase1-final
```

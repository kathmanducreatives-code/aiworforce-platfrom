# Integration evidence: Lead Discovery × Phase 1 security (2026-10-24)

## Isolation
- Every integration merge was made in local detached scratch worktrees (`/home/user/wt-p1x`, `wt-p1x2` to `wt-p1x5`), against local Postgres 17 clusters on 127.0.0.1. The DB-contract runner refuses any non-localhost database.
- **No scratch commit was pushed.** The scratch branches `evidence/phase1-*` exist only in the local repository and in `phase1-integration.bundle`.
- **No PR head was changed.** All eight Lead Discovery heads, #156/#164 and every Phase 1 head are identical before and after (`remote-heads.txt`).
- No hosted database, deployment, paid provider or credential was touched. Nothing was merged.
- Pushed to GitHub this session, all intended: the new branch `fix/s18a-malformed-dataset-visible` (draft #175) and two coordination comments (#169, #153).

## Trees

| Name | Commit | Contents |
|---|---|---|
| Batch 1 + Phase 1 | `51f0284f` | `launch/hardening` 8b0e2b6 + #153 6223dd5 + #144 385173f + #169 833affce + #173 tip 70507ba0 (includes #171 0d7cd077 and #172 2ffc6b5f) |
| Final | `efc95620` | the above + #149 c704f92, #157 005d508, #145 37b3b1a, #150 be625f4, #154 551d84b, #158 84490a2 |
| Batch 1 + old #169 | `caf28046` | superseded: #169 at 60be047, before AUTH-06 |

Restore them with: `git fetch phase1-integration.bundle 'refs/heads/evidence/*:refs/heads/evidence/*'`

## Results on the final tree (`logs-final-efc95620/`)

| Suite | Result |
|---|---|
| DB contract (3 shards) | 94 + 102 + 78 = **274 passed, 0 failed** |
| Mutation (3 shards, separate worktrees) | **80 / 80 killed**, total = ran = 80 |
| Edge | 9449 / 0 |
| Infra | 216 / 0 |
| `deno check` | worker, run-agent, setup-company-brain, generate-company-brain-draft: pass |

Earlier run on `caf28046` (old #169): contract 243/0, mutation 71/71, edge 9434/0, infra 201/0.

## Conflicts and resolutions
- `mutation.sh`: the restore list needs **one** loop naming both `$reaper_sql` and `$brain_writer_sql` (semantic). The proof blocks at the end of the file keep both. Diff: `mutation-resolution-153x169.diff`.
- `README.md`: rows only. Keep all.
- The merge sequence is in `final-tree-merge-sequence.txt`.

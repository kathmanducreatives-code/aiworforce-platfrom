# D: EXEC fixes, real workers in CI, zero-Apify guard, rollbacks, membership writers (2026-10-25)

Local evidence only: disposable Postgres 17.11 + PostgREST 12.2.3, Deno 2.8.2. No hosted system, paid call, merge or deploy.

## Heads
| PR | Head | What |
|---|---|---|
| #179 | `08351242` | EXEC-PLAN / EXEC-REVOKE: guard plan check + HELD `20261025130000_tasks_commit_boundary` + read-only preflight |
| #158 | `99bceba5` | `realprocess` CI job (≥ 4 rehearsals), operator-stop rehearsal, planner triggers |
| #182 | `f0798c88` | TEST worker `providers=openai-only` by default (Deno denies `api.apify.com:443`), dispatch/evidence commands |
| #186 | `bbbf3811` | NEW, held: `workspace_member_remove` / `_set_role` (contract #174 O3 A, §9.4), on #176 `1756b217` |

## Results
**#179 `29824498`**
- DB contract 241/0; guard contract 10/10; guard unit 10/10; commit boundary 5/5.
- Codex `execution-integration-audit.test.ts`, unchanged: 3/3.
- Mutation proofs 12–15 killed; infra 187/0; `deno check` of 5 entry points clean.
- Edge 8852/2. The 2 failures are `fundingRecencyFallback`; they pass 22/22 with #181's `hiringClaimVerifier.ts`.

**#158**
- CI run 40181440793: "Real worker processes" ✅, `ok | 4 passed`, "rehearsals passed: 4". The edge job has the same 2 clock failures.
- Locally: realprocess 4/4 (1m32s), infra 191/0.
- Operator-stop negative control (`stop_discovery_smoke` replaced by a no-op): the worker bought the second actor and made 3 model calls after the "stop", and the rehearsal FAILED as intended.

**#182**
- `testWorkerZeroApify.test.ts` 3/3.
- Negative control: a bare-host `--deny-net=api.apify.com` leaves Apify `granted`, and the test FAILS.
- Infra 193/0.

**Combined tree** (#185 `b91040cd`, which includes #178 `aeeba016` and #177 `05e288e1`, + #179 + #153)
- Full DB contract **314/0** (128 + 91 + 95).
- With Codex's 3 held pilot migrations and #159's SQL also applied (emulated lane, no GoTrue): guard 10/10, commit boundary 5/5, Codex audit 3/3.
- Codex's lifecycle/api/identity suites: the **identical failure set with and without** the commit boundary. Those failures come from the emulation, not the trigger; Codex should confirm on their Docker lane.

**Rollbacks** (`held-rollback-roundtrip.sh`)
- Every held migration with a rollback round-trips exactly, privileges included:
  - 8 on the TEST path;
  - plus #186.
- The OWN-01 and commit-boundary rollbacks equal "never applied" (compared against a bootstrap that omits them).
- Not covered by this harness: #176's client schema (its rollback is in the migration header) and Codex's 3 pilot migrations (rollback-tested in Codex's lane).

**#186**
- 8/8 new tests: §9.4 acceptance, a 16-case policy table with byte-identical state after each refusal, 3 observed-wait races (never zero owners), and the browser surface.
- #176's client suite unchanged: 15/15.
- 8/8 mutants killed; infra 187/0.

**Migration numbering**
- Only two collisions, both already known:
  - #153 held `20261022120000` vs #159 normal `20261022120000`;
  - #107 `20261019120000` vs launch's held file.
- New versions `20261025130000` and `20261025140000` are unique.

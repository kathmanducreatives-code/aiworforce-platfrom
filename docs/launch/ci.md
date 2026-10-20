# CI — launch hardening (Phase: CI / testing)

**Status: IMPLEMENTED, verified by a fresh-checkout dry run. Not yet run on GitHub** (nothing pushed).
Workflow: `.github/workflows/ci.yml`. Runs on every pull request, on pushes to `main`,
`launch/hardening`, `integration/**` and `feat/lead-mission-v2-worker`, and by hand. Read-only token,
**no secrets**, never deploys. What runs when: "Test levels" below.

## What runs

| Job | Step | Gate |
|---|---|---|
| backend | `deno check` every `supabase/functions/*/index.ts` + `worker/main.ts` | zero errors (the generated `mcp` bundle is excepted by name) |
| backend | edge suite (`npm run test:edge`'s command) | all pass |
| backend | deploy-safety (`test:deploy-safety`), after `npm ci` | all pass |
| backend | QA harness tests (lead-quality, model-routing) | all pass |
| replay | Lead V2 readiness, offline Replay Lab (`test:lead-v2-readiness`) | every category passes |
| contract | database contract, real Postgres 17 + PostgREST 12.2.3, 3 shards, as planned | all pass |
| mutation | 64 mutation proofs, 8 shards, as planned | every mutant killed, every proof accounted for |
| gate | `CI gate` — judges every job against the plan | see "Test levels" |
| frontend | UI tests — Deno (`test:ui`) and Node (`test:ui:node`) | all pass |
| frontend | `tsc` ratchet, `eslint` ratchet | no NEW error vs the baseline |
| frontend | `npm run build` | builds |

Measured on a fresh checkout (2026-09-29): edge 8,100, deploy-safety 78, UI 582 + 5, QA 55 + 30 —
all green; type ratchet 23 = baseline, lint ratchet 1,286 = baseline; build ~8 s.

## Test levels

One workflow (`ci.yml`), three levels, one gate. The fast suites run at every
level; the planner (`scripts/ci/planCore.mjs`) decides only the slow,
database-backed work, and every doubt widens the plan.

| | Level 1 — development | Level 2 — integration | Level 3 — release |
|---|---|---|---|
| When | a **draft** PR (every push); a push to `feat/lead-mission-v2-worker` | a PR **ready for review** (and every push after that); manual run with `level: integration` | a push to `main`, `launch/hardening` or `integration/**`; manual run with `level: full` (the default) |
| Fast suites — `backend` (type checks, edge, deploy-safety, QA), `replay` (Replay Lab), `frontend` (UI, `tsc`/`eslint` ratchets, build) | **all**, in parallel | **all** | **all** |
| Database contract (real Postgres + PostgREST, 3 shards) | only the contract files whose **dependency closure** the change touches; **all** of them for migrations, database build inputs, CI/toolchain or unclassified changes | **all** files | **all** files |
| Mutation proofs (64, 8 shards) | none — except a CI/toolchain change, which runs everything | **all**, when the change touches what they run or mutate (their tests' closure, the mutated files, migrations, database build inputs) or an unclassified path | **all** |
| Gate (`CI gate`) | required jobs succeeded | + complete contract | + every mutation proof accounted for |

**Why only the database work is selected.** 374 test files read source as text
(`new URL(…, import.meta.url)`), so path-based selection of the fast suites
would be fragile — and they finish in about 3 minutes in parallel anyway. The
contract files are selected by a dependency closure that follows relative
imports *and* literal file reads; a read the scanner cannot name makes that
file depend on the whole repository unless an audited `EXTRA_DEPS` entry
names what it reads (`tests/infra/ciPlan.test.ts` holds every current contract
file to that).

**What widens the plan** (never narrows it):
- an unknown change set (no base to diff, a manual run) → everything the level allows;
- `.github/**`, `scripts/ci/**`, `deno.json`/`deno.lock`, `package.json`/lockfile,
  `tests/db-contract/{run,bootstrap,mutation}.sh`, `tests/db-contract/mutants/**` → everything, mutation proofs included, even on a draft;
- `supabase/migrations/**`, `supabase/migrations-held/**`, `tests/db-contract/sql/**`, contract shell scripts → the complete contract;
- a path outside every known area → the complete contract, and the mutation proofs from level 2.

**The gate** (`CI gate`, `scripts/ci/gate.mjs`) always runs and is the one
check that says whether a commit is verified, and at which level:
- every job the plan required must have **succeeded** — skipped, cancelled or missing fails the gate;
- a job the plan did not require must have been skipped (a failure still fails the gate);
- level 2–3 must have run the **complete** contract; level 3 must have run the mutation proofs;
- the mutation shards must account for every proof: all 8 tallies present, the same proof list in each, the proofs that ran add up to the total, and the total is at least 64.

Its summary reads `VERIFIED — level N` or `NOT VERIFIED`, with the failing reason.
Superseded pull-request runs are cancelled; release-branch and manual runs never are.

**The merge rule** (by practice — `launch/hardening` has no branch protection,
rulesets or required checks, so GitHub does not enforce it):
1. Develop as **draft** PRs (level 1).
2. Mark the PR ready for review, or push an `integration/<name>` branch. Merge
   only a commit whose `CI gate` is green at **level 2 or higher on that exact SHA**.
3. Every merge to `launch/hardening` runs level 3 on the merge commit.
4. Before A7 authorization, a production deployment or a release: `CI gate`
   green at **level 3 on the exact commit** (a push to the release branch, or
   *Run workflow* with `level: full`), and the A7 package re-validated against it.

Making rule 2 enforced means requiring the single check `CI gate` on
`launch/hardening`; that is a repository-settings change and needs separate approval.

### Run it locally

```
node scripts/ci/plan.mjs --base origin/launch/hardening --head HEAD --event pull_request --draft
tests/db-contract/run.sh <files>                        # the files the plan lists
MUTATION_SHARDS=8 MUTATION_SHARD=3 tests/db-contract/mutation.sh   # one shard of the proofs
```

## The ratchet

Existing debt is held, not ignored: `tsc` (23 errors, all in the unrouted Talent Intelligence scrapers,
`src/lib/scrapers/*`) and `eslint` (1,286 errors) are counted per file and per code/rule against
`scripts/ci/baselines/*.json`. Any count that rises fails CI; one that falls is reported.

```
node scripts/ci/ratchet.mjs tsc            # check
node scripts/ci/ratchet.mjs eslint --update   # after fixing debt: lower the baseline, and commit it
```

A diff that RAISES a baseline is adding debt on purpose and should say why in review.

## Fixed to make CI start green

- `test:ui` picked up `tests/frontend/agentDepthCard.test.cjs`, a `node:test` file, and failed on it.
  It now ignores `*.test.cjs`; `test:ui:node` runs them with `node --test` (5/5).
- `agentVisualState.test.ts` pinned the home card's old `<AgentVisual>` markup, replaced by the portrait
  stage in 873f7edd. Re-anchored on what ships.
- `google-calendar-auth` failed `deno check` (an OAuth form object typed as a union with optional keys).
- `runNotices.ts` used `any` for its Supabase client.

## Hazard found while building this

`vite build` **regenerates `supabase/functions/mcp/index.ts`** (the Lovable MCP plugin). Built without
`VITE_SUPABASE_PROJECT_ID`, it writes `projectRef = … ?? "project-ref-unset"` over the committed
`"ohsdatpvfdjdemstoiuj"`. In CI that is harmless (ephemeral, and the ratchets run first). Locally,
**never commit that file after a build without the variable set** — it would deploy an MCP function
pointing at no project.

## Still open

- **Required checks**: none are configured (no branch protection, no rulesets on `launch/hardening`,
  checked 2026-10-20). Requiring `CI gate` is the one setting that would enforce the merge rule.
- The two-workspace isolation suite (`scripts/security/isolation-stack.sh`) needs Docker and a local
  Supabase; it is not in CI yet (a manual/nightly workflow is the natural next step).
- `denoland/setup-deno@v2`'s cache input and the workflow as a whole are proven only by the local dry
  run until the first push.

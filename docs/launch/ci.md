# CI — launch hardening (Phase: CI / testing)

**Status: IMPLEMENTED, verified by a fresh-checkout dry run. Not yet run on GitHub** (nothing pushed).
Workflow: `.github/workflows/ci.yml`. Runs on every pull request, on pushes to `main`,
`launch/hardening` and `feat/lead-mission-v2-worker`, and by hand. Read-only token, **no secrets**,
never deploys.

## What runs

| Job | Step | Gate |
|---|---|---|
| backend | `deno check` every `supabase/functions/*/index.ts` + `worker/main.ts` | zero errors (the generated `mcp` bundle is excepted by name) |
| backend | edge suite (`npm run test:edge`'s command) | all pass |
| backend | deploy-safety (`test:deploy-safety`), after `npm ci` | all pass |
| backend | QA harness tests (lead-quality, model-routing) | all pass |
| frontend | UI tests — Deno (`test:ui`) and Node (`test:ui:node`) | all pass |
| frontend | `tsc` ratchet, `eslint` ratchet | no NEW error vs the baseline |
| frontend | `npm run build` | builds |

Measured on a fresh checkout (2026-09-29): edge 8,100, deploy-safety 78, UI 582 + 5, QA 55 + 30 —
all green; type ratchet 23 = baseline, lint ratchet 1,286 = baseline; build ~8 s.

## Two-stage testing

Development runs fast checks on draft pull requests; the complete verification
runs on the final commit. Nothing is removed — only *when* the slowest step runs.

| | Stage 1 — draft pull request | Stage 2 — final integration |
|---|---|---|
| When | every push to a draft PR | a PR marked ready for review (and every push after that); a push to `main`, `launch/hardening` or an `integration/**` branch; a manual dispatch |
| `CI` (`ci.yml`) | complete: type checks, edge/unit, deploy-safety and infra tests, QA harness, UI, `tsc`/`eslint` ratchets, build (~5 min) | complete |
| `Database contract` (`db-contract.yml`) | the contract tests against real Postgres + PostgREST (~4 min), including the A7 scenario suites | contract tests **and** the mutation proofs (~25 min) |

**The merge rule** (by practice — `launch/hardening` has no branch protection
or required checks, so this is not enforced by GitHub):
1. Develop as independent **draft** PRs; run the relevant contract files
   locally (`tests/db-contract/run.sh <files>`) while iterating.
2. To integrate, either mark a PR ready for review, or combine approved PRs on
   an `integration/<name>` branch and push it.
3. Merge only a commit whose **complete** `Database contract` run (both steps,
   no skip) and `CI` run are green **on that exact SHA**. A run on an earlier
   head, or a draft run with the mutation proofs skipped, does not count.
4. Before any A7 execution: the same complete runs green on the exact commit
   the worker will dispatch, and the A7 package re-validated against it.

Promoting `Database contract (Postgres + PostgREST)` to a required check on
`launch/hardening` would make rule 3 enforced; that is a repository-settings
change and needs separate approval.

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

- **Required checks** need a GitHub admin: protect `main` (and `launch/hardening`) so `backend` and
  `frontend` must pass before merge. Not done — this session has no GitHub access.
- The two-workspace isolation suite (`scripts/security/isolation-stack.sh`) needs Docker and a local
  Supabase; it is not in CI yet (a manual/nightly workflow is the natural next step).
- `denoland/setup-deno@v2`'s cache input and the workflow as a whole are proven only by the local dry
  run until the first push.

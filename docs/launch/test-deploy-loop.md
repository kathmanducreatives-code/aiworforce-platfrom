# Discovery functions: automated TEST loop, gated production promote

What happens after a merge, what still needs a person, how to roll back, and how
to investigate a failure from GitHub alone.

## The loop

| # | Step | Who / what | Where |
|---|---|---|---|
| 1 | Change code on a feature branch | Claude | branch `claude/…` |
| 2 | Focused tests locally (`deno test … tests/edge-functions/_shared/leadPipeline/`, `tests/infra/testDeployLoop.test.ts`) | Claude | session |
| 3 | Open a pull request into `launch/hardening` | Claude | GitHub |
| 4 | `CI` runs (types, lint, edge, infra, Replay Lab, DB contract, gate) | GitHub | `ci.yml` (unchanged) |
| 5 | Read CI failures (`gh run view <id> --log-failed`), fix, push | Claude | GitHub |
| 6 | **Merge** | **You** (human review) | GitHub |
| 7 | `CI` runs again on `launch/hardening`; when it succeeds, **Deploy discovery functions (TEST)** starts by itself | GitHub | `deploy-test-functions.yml` |
| 8 | Smoke suite on TEST, report + commit status `agentory/test-smoke` | GitHub | run summary, artifact `test-deploy-<sha>` |
| 9 | Readiness: `READY` / `NOT READY` on the commit and in the run summary | GitHub | commit status |

No deploy command, flag value or log needs to be copied by hand. Nothing in the
loop modifies code by itself: every change is a reviewed pull request (step 6).

## What the TEST workflow does (and refuses)

* Starts only after a **successful** `CI` run for a **push** to `launch/hardening`,
  or by hand (`workflow_dispatch`) from `launch/hardening` with an exact sha.
* Deploys only to `tlvnfrxzjhsjgdofwehb`. The production ref appears once, in the
  step that refuses it. Only `lead-pipeline` and `provider-connections`.
* **Stale protection.** A CI run for a commit that is no longer the tip is skipped
  ("superseded"; the newer commit's run deploys). A dispatch must name a commit on
  `launch/hardening` with a successful CI run, and cannot move TEST *backwards*
  unless `rollback: true`. One deploy at a time (`concurrency`).
* **Changed functions only.** `deno info` gives each function's file graph; a
  function is redeployed when a file in its graph changed since the build TEST runs
  now, when that build is unstamped/unknown, or with `force: true`.
* **Provenance.** Each deploy is stamped (`scripts/deploy/stamp-build.sh`); both
  functions answer every request, including an unauthenticated `OPTIONS`, with
  `x-agentory-build: <sha>@<time>`. The run records versions before/after.
* Never writes a secret, flag or migration; never calls a provider; never runs a
  paid action; never retries anything.

### Smoke checks (`scripts/deploy/test-functions-smoke.ts verify`)

| # | Check | How |
|---|---|---|
| 1 | Functions active | Management API: `ACTIVE`, `verify_jwt` on, version bumped when deployed |
| 2 | Correct project | hard-coded TEST ref; management calls outside TEST are refused in code |
| 3 | Correct commit | `x-agentory-build` = the deployed sha (or the unchanged previous build) |
| 4 | JWT enforced | no auth → 401 (gateway); publishable key only → 401 (function). A 404 means flags are off |
| 5 | Allowlist enforced | signed in: a real non-allowlisted TEST workspace → 403 from both functions; both `*_WORKSPACES` secrets equal the TEST workspace (digest comparison, value never read into the report) |
| 6 | Unauthorized workspace denied | signed in: unknown workspace → 403 |
| 7 | Disabled capabilities stay disabled | forbidden flags absent (Apollo, phones, paid signals, evidence cache); registry at this commit; Apollo `list` view not enabled/connected |
| 8 | Spending ledger unchanged | row counts before/after: `provider_usage_ledger`, `lead_execution_calls`; and no lead/ATLAS writes |
| 9 | No phones / outreach | `call_attempts`, `scheduled_emails`, `outreach_*` unchanged |
| 10 | No production mutation | production `OPTIONS` status + build header of both functions unchanged |
| P0–P6 | GPT `strategy_plan` | ONE call with the query below: answered; hard = US HQ + hiring signal (size NOT hard); 20–500 soft preference; sales title (the planner's own `discoveryJobTitles`, e.g. "Founding Account Executive", "Account Executive"); strategy `apify_only`/`apify_plus_leadocean` with no disabled step; 8-hex plan hash; worst case within $0.25 Apify / 50 LeadOcean records |

Query: *"Find 5 US B2B companies actively hiring salespeople. Prefer 20–500
employees, but include strong opportunities outside that range."*

**Model spend ceiling.** One `strategy_plan` per smoke run = at most 3 OpenAI
calls (mission compiler ≤ 2 attempts + 1 strategy advisor, the function's own
ceilings), roughly one to two US cents per deploy. The isolation calls are refused
before any model runs. A skipped planning smoke costs nothing.

The same checks run offline in CI on a real planner response (mocked actors):
`multiProvider.test.ts` ("strategy_plan explains hard vs soft…") and
`tests/infra/testDeployLoop.test.ts`.

## Failures

* The run summary shows a table: check, result, detail, **likely cause**; each
  failure is also an `::error` annotation on the run.
* Artifact `test-deploy-<sha>` (90 days): `before.json` (versions, builds, counts
  before the deploy — the recovery point), `smoke-report.json`, `smoke-summary.md`,
  `plan.json`. Sanitized: no token, password, email or secret value (public repo).
* The commit status `agentory/test-smoke` is `failure` → **production promote
  refuses that commit**.
* Claude investigates from GitHub: `gh run list --workflow deploy-test-functions.yml`,
  `gh run view <id> --log-failed`, `gh run download <id> -n test-deploy-<sha>`.
* No automatic retry or rollback. A paid operation is never part of this workflow.

## Rollback (TEST)

1. Find the previous good sha: the failed run's `before.json` (`functions.*.build`)
   or the last `agentory/test-smoke = success` commit.
2. Actions → **Deploy discovery functions (TEST)** → Run workflow (branch
   `launch/hardening`) → `sha` = that commit, `rollback` = true, `force` = true.
3. The smoke suite runs against it as usual.

## Production (separate, manual)

**Promote discovery functions (production)** (`deploy-production-discovery.yml`):
`workflow_dispatch` only, `production` Environment (its required reviewers), the
same lock as `deploy-held-back-functions.yml`. It refuses unless: sha typed twice
and on `launch/hardening`; CI passed; `agentory/test-smoke` = success for that sha;
the held migrations' tables already exist in production (read-only check — it never
applies one); Apollo / phone / paid-signal flags absent; the four reviews affirmed
(migrations, rollback, flags, budget). It backs up any live function encrypted
(`ROLLBACK_ARCHIVE_KEY`), deploys through `scripts/supabase-target.mjs production`,
and verifies build, `verify_jwt`, and 401 without auth. It never sets a flag or
secret: production discovery stays off (404) until flags are set separately.

Production rollback: re-promote the previous sha, or decrypt
`pre-deploy-discovery-<run_id>` and redeploy that source; for a function that did
not exist before, turn its flags off (404) or delete it.

## One-time setup (GitHub → Settings)

1. **Environment `supabase-test`** (Settings → Environments → New environment):
   * Deployment branches and tags → *Selected branches* → `launch/hardening`.
   * No required reviewer (so merges deploy without a click) — or add one if you
     want every TEST deploy approved.
   * Environment secrets:
     * `SUPABASE_ACCESS_TOKEN` — a Supabase access token (supabase.com → Account →
       Access Tokens). Supabase tokens are account-wide, and TEST and production
       share one organization, so prefer a token of a **separate Supabase account
       that is a member only of an organization holding the TEST project**. Until
       that exists, the workflow's own guards (hard-coded ref, refusal, tests) are
       the boundary.
     * `SMOKE_USER_EMAIL`, `SMOKE_USER_PASSWORD` — optional; a dedicated TEST auth
       user (TEST dashboard → Authentication → Add user) that is a plain **member**
       (not owner/admin) of the TEST workspace only. Without them checks 5, 6 and
       the planning smoke are reported *skipped* and the verdict is NOT READY.
2. **Environment `production`** already exists (used by
   `deploy-held-back-functions.yml`) with `SUPABASE_ACCESS_TOKEN` and
   `ROLLBACK_ARCHIVE_KEY`. Keep its required reviewers.
3. **Branch protection for `launch/hardening`** (Settings → Rules → Rulesets, or
   Branches): require a pull request, require the status check **CI gate**, block
   force pushes and deletion. Done: ruleset `launch/hardening` is Active with no
   bypass actors.

## Auto-merge policy (approved 2026-11-02)

Claude Code may enable **GitHub's native auto-merge** on a pull request into
`launch/hardening`. GitHub then merges it only when the ruleset is satisfied: the
**CI gate** has passed on the current head with the branch up to date, and any
required reviews are in place. Nothing merges immediately, nothing uses `--admin`,
and the ruleset is never changed. Requires *Settings → General → Allow auto-merge*,
which the owner enables.

**Before enabling auto-merge, Claude checks every one of these:**

1. The PR targets `launch/hardening`.
2. The local and CI results are for the PR's current head sha: no commit was
   pushed after testing.
3. The changed files have been reviewed, and **none** is security-sensitive (list below).
4. It is not a recovery change for a failed deploy.

**Always the owner's explicit decision (never auto-merged).** A PR touching any of:

- `.github/workflows/**`, rulesets or branch protection, repository settings
- `supabase/migrations*/**`, `supabase/config.toml` (database schema, project config)
- `scripts/deploy/**`, `scripts/supabase-target.mjs`, `scripts/verify-deploy-target.mjs`
- authentication: `supabase/functions/_shared/requestAuth.ts`, JWT or session handling
- feature flags and secrets: `discoveryProviders/flags.ts`, any `*_ENABLED` default
- provider spending: provider adapters, `apifyInvoker.ts`, budget and ledger code,
  actor allowlists, prices and spending ceilings
- production project references or deployment
- `package.json`, lockfiles, `deno.lock`

**After each auto-merge** Claude monitors the automatic TEST deploy and its smoke
checks, and reports the PR, CI results, deployment status and any failure. On a
failed deploy it stops, investigates, and opens a recovery PR for the owner to
merge.

**Never automatic:** production deployment, enabling paid providers, paid
discovery (`strategy_run`), billing, secrets, branch protection, migrations,
new credentials or repository permissions.

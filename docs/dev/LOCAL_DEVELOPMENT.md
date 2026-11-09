# Local development — fast loop for Agentory agents (ATLAS first)

**Goal:** change code → test → inspect → fix → repeat, all locally, with no commit, push, CI run or TEST deploy. GitHub CI and protected merges happen only once the change behaves.

Nothing here calls a paid provider, writes to a shared database or touches production.

## The commands

| Command | Level | What it runs | Measured (M-series Mac, 2026-11-09) |
|---|---|---|---|
| `npm run dev:atlas -- <scenario>` | 1 | One ATLAS lead-discovery scenario through the **real** lead-pipeline service, offline. Prints the full request-to-result report (below) | **0.14–0.2 s** per scenario; all 29 scenarios **0.13 s** |
| `npm run dev:fast` | 1 | Vite with hot reload. Refuses a production `.env.local` and server keys in `VITE_` variables. ATLAS providers are **simulated** by default | Vite ready in **0.44 s** |
| `npm run check:fast` | 1 | Only what you changed: `deno check` of changed Deno files, frontend `tsc` when `src/` changed, ESLint on changed files, and the tests that **explicitly** reach your change (`--near`) | **~25 s** for this whole branch (tsc ≈ 9.6 s of it); one fixture edit ≈ **13 s** |
| `npm run test:changed` | 2 | Every test the CI planner's conservative scanner says may be affected, including the ~200 tests that read paths it cannot name | **~2 min** for a one-file change |
| `npm run test:pre-pr` | 2 | The CI jobs `backend` (incl. Lead V2 quality regressions), `replay` and `frontend`, run locally in CI's order with timings. Lists the CI-only jobs | see *Benchmark* |
| `npm run test:pre-pr -- --quick` | 2 | The same, without the production build | — |

Useful flags for `test:changed` (also available directly as `node scripts/dev/affected-tests.mjs`):
- `--near`: only the tests that explicitly reach the change. The conservative remainder is **counted and named**, never silently dropped.
- `--files a.ts,b.ts`: "what does editing these reach?"
- `--only atlasSim,businessModel`: run tests whose path contains these (manual override).
- `--all`: every test in the selector's suites.
- `HEAD` as the base: only your uncommitted work.

Without `--near`/`--only`/`--all`, the selector also prints any changed source file that **no test reaches**, so missing coverage is visible.

## The three levels

1. **Fast iteration (seconds):**
   - `npm run dev:atlas` for the simulator;
   - `npm run dev:fast` for the UI with simulated providers and hot reload;
   - `npm run check:fast`.
2. **Pre-PR confidence (minutes):**
   - `npm run test:changed`, the conservative selection;
   - `npm run test:pre-pr`, the local CI gates.
3. **Final integration (GitHub):**
   - the required **CI gate**;
   - the Docker-backed database contract, mutation proofs and real worker processes;
   - protected-branch review and merge;
   - the automatic TEST deploy and smoke check.

Nothing in levels 1–2 replaces level 3. CI and branch protection are unchanged.

## ATLAS: request → result, offline

```bash
npm run dev:atlas                                  # list scenarios
npm run dev:atlas -- happy-path-b2b-hiring         # full report
npm run dev:atlas -- wrong-headquarters --preview  # …and show it in the Workbench (dev:fast)
npm run dev:atlas -- happy-path-b2b-hiring --json  # …and write dev-sim/<scenario>.json (redacted)
npm run dev:atlas -- --all                         # one line per scenario
npm run dev:atlas -- --query "Find 5 US companies that must be B2B and are actively hiring Account Executives."
```

**What is real and what is mocked.** Built on `scripts/dev/atlas-sim/harness.ts`; the Replay Lab and `mrleFixtures.ts` already used the same approach.

| Real application code | Mocked (the external boundary only) |
|---|---|
| Mission Contract (`contractFromProposal`, `compileContract`, contract hash) | The interpreter **model's** answer (the scenario's `interpretation`) |
| Requirement and capability routing, strategy planner, budget estimate | Apify Actor responses: items, failures, charged USD |
| Signed approval token, plan-hash binding, ceilings | The grounding **model's** reading of a page. It may only quote page text the scenario provides; the real validator re-checks every quote |
| Actor input building, idempotency keys, `maxItems` | Billing |
| Company normalisation, merge/dedupe, exclusions and holds | The database (in-memory, with the real unique keys) |
| Grounded business-model validation, eligibility, outcomes | — |
| `persistRows` (the real persistence code), Workbench plan filter (`leadPlanOrFilter`) | — |

`fetch` is disabled in the simulator and in its tests. A code path that would reach a provider fails loudly instead of spending.

**The report shows** each of these, from the service's own response or the mocked boundary's call log:
1. How the request was interpreted.
2. Which requirements are mandatory.
3. Which are preferences.
4. Which capability verifies each requirement.
5. Which Actors were selected.
6. The **exact Actor input JSON**.
7. The **estimated** worst case and the **actual reported** spend, labelled separately.
8. The companies returned.
9. How each was verified, quoting the evidence, its URL and the actor behind it.
10. Which companies qualify.
11. Which need verification, and the excluded count.
12. The reason behind every check.
13. The merge/dedupe decisions.
14. Which rows were persisted, with inserted/updated/**failed** counts.
15. What the Workbench shows for each plan.

The correlation id is `sim-<scenario>`; it also prefixes every Actor idempotency key.

**Scenarios** live in `tests/fixtures/atlas-sim/*.json`, 29 in total, and **every one is a regression test** (`tests/edge-functions/_shared/leadPipeline/atlasSimScenarios.test.ts`, 0.1 s). Each has a reviewed `expect` block. The test also checks invariants for every scenario:
- every Actor key is bound to the plan hash;
- `maxItems` is honoured;
- no lead is saved without an approved run;
- reported spend stays within the approved worst case;
- spend always states its basis;
- no rejected company is saved.

| Area | Scenarios |
|---|---|
| Discovery | `happy-path-b2b-hiring`, `discovery-empty`, `discovery-partial`, `duplicate-delivery`, `same-company-two-linkedin-pages`, `result-limit` |
| Verification | happy path (verified / likely / mixed / consumer / silent page), `wrong-headquarters`, `stale-or-missing-hiring`, `employee-count-required`, `employee-count-preferred`, `grounding-unavailable` |
| Interpretation | `b2b-preference-only`, `negative-requirement-sdr-only`, `unsupported-requirement`, `review-only-plan`, `approval-rejected`, `approval-missing`, `contract-hash-mismatch` |
| Provider failures | `provider-timeout`, `invalid-actor-input`, `website-http-error`, `discovery-empty` (empty dataset), `duplicate-delivery`, `approval-under-estimate` (budget limit), `unknown-actual-spend` |
| Persistence | `existing-company`, `existing-hold` (customer, do-not-contact), `repeated-run`, `workspace-isolation`, `database-write-failure`, `plan-link-failure` |

**Add a scenario.** Copy a JSON file and change one thing:
- `companies[]`: page text, model reading, HQ, head count, job;
- `providers`: `ok | empty | timeout | http_502 | invalid_input`, `duplicateDelivery`, `unknownSpend`;
- `approval`: `approve | none | tampered_hash | under_estimate | reject`;
- `persistence`: `fail`, `planRecordFails`, existing accounts or holds;
- `runs`, `workspace`, `allowReviewOnly`.

Then:
1. Run `npm run dev:atlas -- <name>` and read the report.
2. **Decide whether the behaviour is right per policy** before writing `expect`.
3. Run `deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/leadPipeline/atlasSimScenarios.test.ts`.

**Not covered:** contact-level (person) leads. This pipeline produces company leads, so "existing contact" is represented by the company-level CRM relationship and hold in `existing-hold`.

## Workbench preview (simulated)

```bash
npm run dev:atlas -- <scenario> --preview   # writes dev-sim/preview.json (git-ignored)
npm run dev:fast                            # open http://localhost:8080
```

The **real** `StrategyDiscoveryPanel` is mounted by the existing dev-only `LeadDiscoveryPreview`, bottom left, on every page with no sign-in needed. It answers from `dev-sim/preview.json` when present, otherwise from the committed simulation. You can exercise:
- the plan, requirement coverage and Actor steps;
- the "Count likely B2B" option and the "Approve up to $X" gate (**Run** stays disabled until approved);
- qualified, needs-verification and rejected companies;
- evidence quotes and sources;
- shortfalls, saved leads, and spend labelled as an estimate.

The preview is headed **SIMULATED DATA — NO EXTERNAL PROVIDERS CALLED** and names the scenario. It exists only in a Vite development build with `VITE_STRATEGY_DISCOVERY_MOCK=true`; a production build never enables it. Authentication and workspace authorization are unchanged.

**A simulated preview is not a live integration test.** The signed-in Workbench against real data is level 3 (TEST).

`.env.local` for `dev:fast`: point it at **TEST** (`https://tlvnfrxzjhsjgdofwehb.supabase.co`) with TEST's **publishable** key (`sb_publishable_…`). Never use a `sb_secret_` or `service_role` key: Vite ships every `VITE_` value to the browser, and `dev:fast` refuses one. On TEST, add `VITE_TEST_DASHBOARD_WITHOUT_BRAIN=true` to reach the dashboard; TEST forbids a Company Brain.

## Local backend (Supabase)

| Option | Needs | Status here |
|---|---|---|
| **Offline simulator and unit/replay tests** | Deno only | ✅ works, the default |
| **Local Supabase stack** (`supabase start` + `scripts/local-supabase/rebuild-local-db.sh`, `start-local-api.sh`, `start-local-worker.sh`, `watch-mission.ts`) | **Docker** + Supabase CLI | ⚠ Docker is not installed on this machine. The scripts already refuse any non-loopback target |
| **Database contract tests** (every literal query against the migrated schema) | Docker Postgres 17 + pinned PostgREST | CI-only (`contract`, `mutation`, `realprocess` jobs) |

With Docker installed:
1. `supabase start`
2. `./scripts/local-supabase/rebuild-local-db.sh`
3. `bash scripts/local-supabase/start-local-api.sh`

Use `scripts/local-supabase/model-stub.ts` to avoid paid model calls. **Never** point local or destructive tests at TEST or production, and apply no remote migrations.

## Debugging an ATLAS problem

1. **Reproduce:** write the request as a scenario and run `npm run dev:atlas -- <scenario>`.
2. **Find where it diverges:** `--json` writes the full, redacted result (plan body, run body, every Actor call with its input/outcome/charge, grounding readings, DB rows, plan records). Read it next to the report.
3. **Narrow:** `node scripts/dev/affected-tests.mjs --files <the file you suspect>` lists the tests that reach it.
4. **Fix and re-run** the scenario, then `npm run check:fast`.
5. **Freeze it:** set the scenario's `expect`, which turns the bug into a permanent regression test.

Production replays (the Replay Lab, `npm run test:lead-v2-readiness`) and the labelled qualification corpus (`deno run --allow-read --allow-env scripts/dev/atlas-eval.ts`) remain the tools for problems seen on real data.

Secrets are redacted (`redact()` in `scripts/dev/atlas-sim/report.ts`): keys named token/secret/password/authorization/api_key, and values that look like `sb_secret_…`, `sk-…`, `apify_api_…`.

## ORION, LYRA, LISA: same commands, their own fixtures

The commands (`check:fast`, `test:changed --near`, `test:pre-pr`, `dev:fast`) are agent-agnostic. Each agent keeps its fixtures next to its tests:

| Agent | Offline tests today | How to iterate |
|---|---|---|
| **ORION** (executive brief) | `executiveBrief.test.ts`, `executiveBriefContext.test.ts` (fake DB, workspace isolation), `dailyBriefOrion.test.ts`, `tests/frontend/orionBrief*.test.*` (server-rendered panel) | Add a context fixture to `executiveBriefContext.test.ts`. `node scripts/dev/affected-tests.mjs --files supabase/functions/_shared/executiveBrief.ts --near --run` runs the right ones in seconds |
| **LYRA** (content, legacy slug `scribe`) | `scribeFillsTheDraft.test.ts`, `scribeRevision.test.ts`, `tests/frontend/contentGeneration.test.ts` | Same pattern. A `dev:lyra` replay, like `dev:atlas` over recorded model answers, is the natural next step |
| **LISA** (signals and monitoring) | `monitoringEndToEnd.test.ts`, `monitoringRunner.test.ts`, `monitoringSchedule.test.ts`, the tick and endpoint boundaries | Same pattern, with recorded Actor items for monitoring subjects |

To give another agent a `dev:<agent>` simulator: reuse `scripts/dev/atlas-sim/` as the template. Mock only the model and provider boundary, run the real service, and print a report.

## Benchmark (measured, this branch, 2026-11-09)

| Loop step | Before (GitHub path) | Now (local) |
|---|---|---|
| See what ATLAS does with a request | Commit → PR → CI (~10–15 min) → merge → TEST deploy → **paid** run | `dev:atlas` **0.14–0.2 s**, free |
| See it in the Workbench UI | Merge, deploy, sign in on TEST, paid run | `dev:atlas --preview` + `dev:fast` (Vite **0.44 s**, hot reload) |
| Focused tests for one file | Whole CI | `--near`: **~12.5 s** (selection ≈ 5 s of it); one test file directly **0.18 s** |
| Test selection for a one-file change | CI planner on GitHub | **141 s → 5.8 s** (closures computed once instead of per changed file) |
| Conservative selected run | — | `test:changed` ≈ **2 min** |
| Fast checks before a commit | — | `check:fast` ≈ **25 s** for this branch |
| Pre-PR gate | Only on GitHub | `test:pre-pr` **185 s**: deno check 4.1 s · edge tests 68.6 s · infra 22.7 s · QA harness 1.5 s · Replay Lab 58.0 s · UI (Deno) 4.8 s · UI (Node) 0.3 s · type ratchet 8.8 s · lint ratchet 12.5 s · build 4.0 s. 9/10 steps pass; the infra step's only failures are the 3 macOS-only cases below |

## Known local-only differences

- **`tests/infra/testWorkerZeroApify.test.ts`:** 3 cases fail on macOS + Deno 2.8.2 on a clean `launch/hardening` too, but pass in CI (Linux). They compare Deno permission states of a spawned worker.
- **`tests/lead-v2-quality`** (now in CI): T07 was a harness mismatch, not a production bug. Production compiles a hard "US" as headquarters (Q3), but the golden replay judged it under the recorded pre-Q3 *presence* reading. It now runs with `strictScope` and a US-headquartered control. RC02 L03 (New York **or** California) is fixed too: it compiles as one any-of group. No case is marked `knownUnfixed` today; `knownUnfixed.test.ts` pins that.

## Company Brain V1 (memory): cloud container

The Claude Code cloud container has Docker, Postgres 17 and Chromium. The "CI-only" rows above can run there, so the full Brain stack is testable without a hosted project.

| Level | Command | What is real |
|---|---|---|
| 1 | `deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/companyBrainMemory*.test.ts tests/frontend/companyBrainMemoryView.test.ts` | Pure model, loader fold, agent views, request parsing |
| 2 | `tests/db-contract/run.sh tests/db-contract/companyBrainMemory.contract.test.ts tests/db-contract/companyBrainAcceptance.contract.test.ts` | Postgres 17 + PostgREST: RLS, the SECURITY DEFINER writers, races, idempotency, and scenarios A–H through the real loader, ORION and LISA modules |
| 2 | `tests/db-contract/run-with-gotrue.sh tests/db-contract/companyBrainMemoryEndToEnd.contract.test.ts` | Real GoTrue sessions and logout, through the real `company-brain-memory` and `daily-brief` handlers |
| 2 | `BRAIN_E2E_DENO_FLAGS="--allow-run --allow-write" tests/db-contract/run-with-gotrue.sh tests/browser/brainMemory.browser.test.ts` | The real Company Brain page, signed in, in headless Chrome |

Before the GoTrue lanes, start the daemon if needed: `dockerd >/tmp/dockerd.log 2>&1 &`.

Set `POSTGREST_BIN` to the pinned v12.2.3 binary (checksum in `ci.yml`). Set `CHROME_BIN` to `/opt/pw-browsers/chromium-*/chrome-linux64/chrome`.

`check:fast` type-checks changed `tests/db-contract/` and `tests/browser/` files with `--node-modules-dir=none`, as CI's contract lane does.

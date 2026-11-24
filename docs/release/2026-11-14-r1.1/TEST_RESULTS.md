# R1.1 test results

All runs were made in the cloud session's container on 2026-11-14, with no production access.

## Before and after on the regression suites

The regression suites were written first. For the "before" run, the routing suite ran against a no-op stub of `orionRoute`, which reproduces R1's routing; the digest suite ran against R1's own `orionEvidenceContext.ts`.

| Suite | Before (R1) | After (R1.1) |
|---|---|---|
| `orionR11Routing.test.ts`: the 20 live prompts through the real Chat Brain parser, `orionRoute`, router and binder, plus simple-list, sub-question, drafting and safety cases | **14 failed** / 18 passed. The 9 live misroutes reproduced exactly: tests 4, 7, 9, 11, 12 and 17 went to the list template; 14, 15 and 16 never reached drafting. Also failing: test 19 under a paid reading, and the sub-question and draft-kind cases. | **32 / 32** |
| `orionR11Digest.test.ts`: totals, accounts versus leads, sample versus total, named accounts, contacts 0, dated signals, historical hiring, fact versus inference, Brain separation, failed versus 0, isolation, Brain data check | **11 failed** / 1 passed (only the "non-member gets nothing" case) | **13 / 13** |

## Full suites

| Suite | Result |
|---|---|
| All edge-function tests (`deno test tests/edge-functions/`, as CI runs them) | **10,070 passed, 0 failed** |
| New R1.1 files, plus the compose and converse surface tests | 81 / 81 |
| Deploy-safety (`tests/infra/`), including the new `releaseR11Scope.test.ts` | 329 / 329, plus 6 / 6 |
| UI tests (Deno) | 798 / 798 |
| Frontend draft-chip tests (`tests/frontend/orionDraft.test.ts`) | 5 / 5 |
| Type ratchet (`scripts/ci/ratchet.mjs tsc`) | 23 findings, matching the baseline (no new errors) |
| Lint ratchet (`scripts/ci/ratchet.mjs eslint`) | 1,265 findings, matching the baseline (no new errors) |
| `deno check` of every edge function and the worker | pass |
| Production bundle of `pilot-chat` | 1,399,327 bytes (cap 4,000,000); contains the three R1.1 markers |

## Real database (contract lane: Postgres 17 + PostgREST v12.2.3 + supabase-js, fictional data)

| Test | Result |
|---|---|
| `orionWorkspaceFacts.contract.test.ts`: every totals and lookup query is valid on the real schema; counts cover this workspace only; Laminar, Epsilon3 and Civilgrid are found as accounts and not leads; another workspace's qualified "Laminar", its contact and its lead never appear | **2 / 2**; totals plus named lookup took 74 ms |
| …the digest for a member: totals come before `[E#]`, plus dated, historical and Brain checks; for a member of another workspace, and for a stranger: `null` (nothing read) | pass |
| `orionEvidence.contract.test.ts` (R1, unchanged) | 3 / 3 |

## Not verified here, and why

- **Live model answers** (GPT-5.6 Luna on the new prompts) and a **TEST deploy**: this container has no Supabase CLI login and no OpenAI key. They run in your shell (`PRODUCTION_TEST_PLAN.md` §TEST):
  - the TEST seed (`orion-r11-seed.sql`, validated on TEST's schema inside a rolled-back transaction);
  - the deploy (`orion-pilot-deploy.sh`);
  - the 20-prompt acceptance run (`scripts/orion-pilot/run-r11.ts`), which checks routing, the list-template, copy and date regressions, the draft marker and cross-workspace isolation automatically.
- **Draft quality on TEST:** TEST has no Company Brain by design, so drafts there stop at the onboarding gate. The run checks that they route to ORION's draft path and create nothing. Draft quality is checked on production after approval.

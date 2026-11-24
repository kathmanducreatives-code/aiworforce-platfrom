# Agentory TEST UX audit (2026-11-12)

## Method and limits

- **Evidence used:**
  - the owner's observations, signed in to TEST as `orion-owner@agentory.space`;
  - the live database rows behind them (read-only);
  - static code review of the pages involved;
  - unit, handler and source-shape tests.
- **Not done:** this session holds no pilot password, so I did **not** click through the signed-in UI. Pages not named below were not audited, and their state is **Unknown**. The manual playbook covers them.

## Findings

| # | Page / area | Symptom | Root cause | Kind | Status |
|---|---|---|---|---|---|
| U-1 | Every page: environment badge | "NON-PRODUCTION — tlvnfrxzjhsjgdofwehb" rather than TEST; the setup screen tells developers to use the **production** URL for TEST | `CANONICAL_PROJECT_REFS.test` held the production ref; the instruction string hard-coded it | **Confirmed defect** | **Fixed locally:** TEST badge "TEST — tlvnfrxzjhsjgdofwehb"; instructions name the TEST URL. Tests: `src/lib/env/environmentGate.test.ts`, `projectEnvironment.test.ts` |
| U-2 | Lead Library metric strip | Qualified = 0 with two CONTACT leads | Counter read only the lifecycle stage; qualified leads without a source sit in `research_needed` | **Confirmed defect** | **Fixed locally:** counts accounts that passed qualification; nothing else inflated. Test added |
| U-3 | Lead Library ATLAS strip | "Blocked" with no reason | Reason ("Needs your Company Brain") was computed but not shown | UX gap | **Fixed locally:** reason shown beside the badge |
| U-4 | Lead Library credits | 0 credits | Fictional workspaces have no credit grant | **Intended** | Explained in the playbook (T14) |
| U-5 | Company Brain page | Editable fields; save shows "changed elsewhere — still loading" | Editing gated on role only; "no version" reported as a conflict | **Confirmed defect** (misleading) | **Fixed locally:** read-only on TEST with an explanatory banner; guided setup, restart and memory writes hidden; save refuses before any network call; "no version" is no longer a conflict |
| U-6 | ORION chat: "companies and signals" | Four names, no signals, no evidence | Read surface served one of two parts (D-1) | **Confirmed defect** | **Fixed locally** (needs the `pilot-chat` redeploy) |
| U-7 | ORION chat: backend errors | 503/429 bodies showed raw codes | Client preferred `error` over `message` | Defect | **Fixed earlier** (`src/lib/pilotChat.ts` prefers the readable message) |
| U-8 | ORION chat: Start / delegate actions | On TEST, any request that delegates (sourcing, content) has no backend | `orchestrate` and `run-agent` not deployed on TEST | **Environment gap** | Documented as Disabled; roadmap P3 |
| U-9 | Workspace selection | The app opens the first membership; there is no switcher | `getCurrentWorkspaceId` takes `limit 1` unordered | Known limitation (PR #170 draft makes it deterministic) | Use single-membership pilot accounts (already so) |
| U-10 | Agent names | Tests still expect "Pilot" and "Mira"; the UI says ORION and LYRA | Stale tests, not UI | Test debt | See "Tests not in CI" |

## Tests not in CI (found this pass)

- **`src/**/*.test.ts` and `__tests__`:** not run by any npm script or CI job.
  - About 38 of these files are Deno tests, which vitest cannot load.
  - Under vitest, 13 assertions fail. 11 are stale agent-name expectations in `src/config/agentRegistry.test.ts` ("Pilot" and "Mira" versus ORION and LYRA). The other 2: the lead-cascade invariant, and a draft-ready check.
  - All of these predate this pass. `projectEnvironment.test.ts` had 3 failing tests, which this pass fixed (8 of 8 now pass).
- **Recommendation (P4-1):** pick one runner per directory. Move the Deno-style `src/**/*.test.ts` under `npm run test:ui`, add a `vitest` script for the vitest files, wire both into CI, then fix the stale expectations.
- **`tests/infra/testWorkerZeroApify.test.ts`:** 3 failures, identical on the unchanged branch head (pre-existing).

## Test results for this pass

| Suite | Result |
|---|---|
| `test:edge` (Deno, all edge-function tests) | **10,013 / 10,013** |
| `test:ui` (Deno frontend) | **789 / 789** |
| `test:ui:node` | 13 / 13 |
| `test:deploy-safety` | 314 pass, **3 pre-existing failures** (`testWorkerZeroApify`) |
| New ORION handler tests (OpenAI-only, compound read, ledger) | 19 / 19, plus a mutation check that the ledger test fails without the fix |
| `leadDecisionState` (vitest, run ad hoc) | new test passes; 1 pre-existing cascade failure |
| `tsc` (app) | 23 errors, all pre-existing in `src/lib/scrapers/**`; none in changed files |

## Not yet verified in a signed-in browser (do these with the playbook)

Dashboard, Workbench, Signals, Content, Agents, Integrations, Settings / Usage.

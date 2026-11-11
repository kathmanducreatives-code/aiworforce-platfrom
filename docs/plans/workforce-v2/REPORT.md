# Agentory AI Workforce V2: implementation report

Branch `claude/agentory-audit-roadmap-64uq8n`. Nothing is merged, deployed, migrated or activated. Every new capability is off by default behind a flag or a held migration. No paid model or provider call was made.

## 1. Implemented

| Phase | What now exists | Commit |
|---|---|---|
| 1 Company Brain | `loadChatBrain` gives chat (ORION) the shared loader. A loader refusal is final, with no raw-profile fallback. The ATLAS lead plan loads the Brain with the authenticated user and records `brain_fingerprint`. LISA→ORION matches exclusions against the event text. LYRA briefs carry the Brain exclusions. Pending proposals never influence agents. | f7c2c5c7 |
| 5 Identity and routing | ORION / ATLAS / LISA / LYRA are the public names everywhere (UI registry, prompts, activity feed, landing). Priority questions go to ORION. "Why did we reject this company?" resolves the pronoun from what was last shown, and asks when that is ambiguous. Signal answers show verification · date · source. The model label is the model that actually ran (`AsyncLocalStorage`), not a hard-coded "gemini". Legacy history reads the newest 20 messages, not the oldest. | 6a29d840 |
| 2 GPT-6.1 Terra | `terraPolicy` gates. Priced from config, so the spend ceiling counts every call. GPT-5/6 request body. A Terra attempt is made only with a spend collector and a per-run limiter (default 8 calls). A failure falls back to the task model and is recorded (`terraDecision`). An additive router opt-in covers ATLAS qualification and LISA interpretation. Offline benchmark harness. | b434e4ce |
| 3 Evidence | `evidence/model` defines one `EvidenceItem` and six verification classes, with freshness windows. `evidence/retrieve` reads Brain, leads, LISA signals and cached pages behind membership; it costs $0 and is workspace-isolated. | 20150be3 |
| 5 Answers | `evidence/answer` produces the six sections, deterministic and grounded. Chat serves verification and priority questions from it behind `AGENTORY_EVIDENCE_ANSWERS_ENABLED`. | 20150be3 |
| 4 Collaboration | `atlas_launch`: an approved handoff becomes the message sent through ORION's Leads flow. `atlas_sync`: ATLAS's result is read from the saved lead row written after approval. | 20150be3 |
| 6 Dashboard | `workforce-dashboard` endpoint (read only, members only) and the `/workforce` page behind `VITE_WORKFORCE_DASHBOARD_ENABLED`. An unreadable table shows as "unavailable". | 91fd1813 |
| 7 Security | Held migration: signal tables and approvals become read-only for browser roles. Paid endpoints now require owner/admin/editor. | (security commit) |

## 2. Already present (reused, not rebuilt)

- Shared Brain loader and agent views (Brain V1).
- LISA V2 engine.
- Phase 5 handoff ledger and RPCs, with the service-key `atlas_report` hook.
- `modelSpendCeiling` and `ModelCallCollector`.
- `gptModelRouter`.
- `approve-and-continue` role check.
- Firecrawl credit authorization.
- The `/dev/collaboration` simulator.

## 3. Incomplete (honest)

- **Terra is not verified.** This repository's own record says OpenAI offers no GPT-6 Terra. No availability check has been run (`scripts/model-bench/run.ts --check-model` needs an approved key use), and no price is configured. Terra is inert until an operator sets all of the gates.
- **The benchmark was not executed.** The paid spending scope has not been approved. The harness, tasks and scorers exist and the dry run works. There are no results.
- **Live acceptance scenario (§9).** It is demonstrated only with recorded fictional fixtures (`evidence.test.ts`). Live LISA collection and ATLAS sourcing need paid providers. Live validation is pending.
- **No automatic ATLAS mission completion hook.** `atlas_sync` is user-triggered (edit role). Wiring it into the mission finaliser is still the ATLAS track's change. The launch packet is returned to the client; the Leads UI button that sends it has not been built.
- **Evidence answers are deterministic text.** No model rewording; that is deliberate for now. Live Firecrawl/Apify fetches are not part of retrieval; they stay on their own approved paths.
- **The dashboard is not browser-tested against real auth.** It is covered by a handler test and a build. A Playwright pass on a TEST project is still to do.
- **Cross-session continuity** relies on the approved Brain and saved artifacts (already true). No new memory writes were added, by design.

## 4. Models per task (as configured; defaults unchanged)

| Task | Model | Fallback |
|---|---|---|
| ORION chat, orchestration plan, agent execution, Company Brain analysis/follow-ups | `claude-haiku-4-5-20251001` | none (fails loudly) |
| Tool-input planning, helper (daily brief) | `claude-haiku-4-5-20251001` | `gpt-4.1-mini` |
| Lead / LISA pipeline stages (understanding, compilation, discovery, plans, qualification, evaluation, signal relevance, evidence) | `gpt-5.6-luna` | `gpt-5.6-terra` on validator rejection, for the stages that escalate |
| Pool ranking | code (deterministic) | none |
| Permission decisions | server and database (RLS, RPCs, role checks) | none |
| Images | `gpt-image-1` | none |
| **Terra opt-in when every gate is on** | `gpt-6.1-terra` for `orion_reasoning` (daily brief), `multi_agent_planning` (orchestrate), `complex_company_qa` (chat converse), `lyra_content` (run-agent LYRA), `atlas_qualification` and `lisa_interpretation` (router stages) | the task model above |

## 5. Terra benchmark results

**Not executed. Budget approval is pending.**

- Dry-run upper bound for one pass over the 6 fictional tasks:

  | Model | Upper bound per pass |
  |---|---|
  | haiku | $0.0352 |
  | gpt-5.6-luna | $0.0084 |
  | gpt-6.1-sol | $0.0704 |
  | gpt-5.6-terra | $0.084 |
  | gpt-6.1-terra | unpriced |

- To run it:
  1. `--check-model gpt-6.1-terra`.
  2. Set `AGENTORY_TERRA_PRICE_USD_PER_1M`.
  3. Run `--live --budget-usd N` with `AGENTORY_MODEL_BENCH_APPROVED="I approve paid model benchmark spend up to $N.00"`.

## 6. Architecture

```
            browser (reads only: signals, approvals; paid actions need editor+)
                │
    pilot-chat ─┼─ auth → membership → spend ceiling → loadChatBrain (shared loader)
                │      ├─ workspace questions (canonical state)
                │      ├─ evidence answers [flag] → retrieveEvidence → composeStructuredAnswer
                │      └─ Chat Brain (Luna) → route → read / converse (Haiku|Terra*) / lead mission
                │
  agent-collaboration [flags] ── LISA signal → ORION assess → handoff (approval)
                │                    ├─ atlas_launch → ORION Leads flow (mission approval + credits)
                │                    ├─ atlas_sync / atlas_report → result → ORION + Brain proposal (pending)
                │                    └─ lyra_draft → unpublished draft
  workforce-dashboard [flag] ── tasks · approvals · lead_model_calls · handoffs · signals · proposals
  model layer ── aiProvider (Haiku; Terra* first when gated) · gptModelRouter (Luna/Terra-5.6; Terra* opt-in)
               └─ priceModelCall (Terra priced from config) → spend ceiling / run budget
  * Terra = gpt-6.1-terra, only when ENABLED + VERIFIED + PRICED + task opted in
```

## 7. Company Brain status

- Every department reads the same loader output: chat, ATLAS mission context, LISA, ORION and LYRA.
- Exclusions are respected by all four; acceptance test `brainConsistency.test.ts` covers US manufacturing 20–200 with software excluded.
- Unapproved proposals are ignored.
- The fingerprint is recorded per chat reply and per ATLAS plan.
- Approval re-checks the current Brain.
- With no Brain, behaviour is unchanged.

## 8. Collaboration matrix

| Path | Status |
|---|---|
| LISA → ORION | done (assessment, exclusions, trust) |
| ORION → ATLAS | handoff, approval, then launch packet through the Leads flow (new). Spend stays behind mission approval. |
| ATLAS → ORION | `atlas_report` (service key) and `atlas_sync` from saved rows (new) |
| LISA → ATLAS | through ORION's handoff, approval before paid work |
| LISA → LYRA | brief with Brain exclusions, then an unpublished draft |
| Agents → Brain | pending proposals only |

## 9. Dashboard

Live and flag-gated. It shows:

- ORION brief and the four departments.
- Current and completed tasks, failures with retry status.
- Approvals and handoffs.
- LISA findings.
- 7-day actual / estimated / unpriced spend.
- Brain status and pending proposals.

It contains no fictional data; the simulator stays dev-only.

## 10. Test results

Test kinds:
- **Unit:** pure modules.
- **Mocked DB:** in-memory tables.
- **Real DB:** Postgres 17 + PostgREST 12.2.3 with minted JWTs.
- **Real model and real provider:** no test ran against either.

| Suite | Kind | Result |
|---|---|---|
| Edge functions | unit + mocked DB | 9935 passed, 0 failed |
| Workforce V2 tests (brain, routing, terra, evidence, dashboard, paidRole) | unit + mocked DB | all passed |
| Frontend | unit | 784 passed, 0 failed |
| `workforceV2Security.contract.test.ts` | real DB | 3/3 passed; with the migration omitted, 3/3 fail (mutation proof) |
| Full DB contract lane | real DB | see the final run in the commit notes |
| tsc ratchet | static | 23 = baseline |
| eslint ratchet | static | 1265 = baseline |
| Vite build | build | ok |

## 11. Security findings and fixes

| Finding | Fix | State |
|---|---|---|
| Signal tables writable from the browser: a member could forge a "verified" signal | Held migration revokes the writes | held, proven in the DB lane |
| `approvals` FOR ALL member policy: a viewer could approve through PostgREST | Held migration: member read only | held, proven |
| A viewer could start paid scrape, radar, unlock or image | `canRunPaidOperation` (editor+) | code |
| Chat fell back to a raw Brain read after a membership refusal | A refusal is final | code (M1) |
| An unpriced premium model would count $0 against the ceiling | Terra requires a configured price | code |
| An unbounded loop could buy premium calls | Per-run Terra limiter, plus a required spend collector | code |
| Evidence retrieval across workspaces | Membership first, plus an output filter | code |
| ATLAS result fabrication | Results come only from the service key or saved rows | code |

## 12. Changed files and commits

- f7c2c5c7: Brain everywhere.
- 6a29d840: identity and routing.
- b434e4ce: Terra and benchmark harness.
- 20150be3: evidence, answers, collaboration.
- 91fd1813: dashboard.
- Security commit: held migration, paid-role checks, contract test, mutation proof, this report.

## 13. PR / deploy readiness

The branch is ready for review as a PR. It is **not** ready to deploy until:

1. The held security migration is reviewed and applied to TEST.
2. Viewer-facing UI is checked for buttons that now return 403.
3. Flags stay off in production.

Terra must not be enabled until it is verified and priced.

## 14. TEST pilot next steps

1. Apply `20261113120000_workforce_v2_security.sql` to the TEST project only, using `npm run supabase:test`, and rerun the contract test against TEST.
2. Deploy `pilot-chat`, `agent-collaboration`, `workforce-dashboard` and the four paid endpoints to TEST.
3. On TEST, set `WORKFORCE_DASHBOARD_ENABLED=true`, `VITE_WORKFORCE_DASHBOARD_ENABLED=true` and `AGENTORY_EVIDENCE_ANSWERS_ENABLED=true`, and browser-test `/workforce` and chat with real auth: owner, editor, viewer.
4. With an approved budget:
   1. `--check-model gpt-6.1-terra`.
   2. Configure its price.
   3. Run the benchmark live with a small cap.
   4. Enable Terra for one task (`orion_reasoning`) on TEST.
5. With approved provider spend: run the §9 scenario live on TEST, then record results against the fixture expectations.
6. Wire `atlas_sync` into the ATLAS mission finaliser and add the Leads "Launch" button for approved handoffs.

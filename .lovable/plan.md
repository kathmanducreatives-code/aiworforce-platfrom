
# Complete the GPT-controlled qualified-lead workflow (base: main @ 49212a22, includes PR #131)

No deploys, no paid runs, no migrations. `supabase/functions/mcp/index.ts` stays untouched. PR #130's company-evidence/Workbench work is not modified. No new planner, controller, runtime, qualification pipeline, persistence or quota system is created.

## What the code actually shows today (verified by reading the files)

- Production company-first path is: `run-agent/index.ts` → `applySequentialSourceExecution` (sequentialSourceBridge) → `executeRunAgentCompanyFirstSourcing` → `runCompanyFirstQuotaController`, with `invokeJobs: sequentialSources.invokeJobs`.
- `sequentialSourceBridge.ts:345` already passes `queryPacks: activePacks.map(...)` into `sequentialJobsInvoker`, and `sequentialSourceRuntime.ts:611-615` selects `prepareStepPackCalls` only when that array is non-empty. So the pack path exists but is reached only if `activePacks` is non-empty (line 281: `strategyOutcome.packs`). In the live run it was empty because the GPT strategy was rejected (`rejected:query_packs_not_separated`) and the deterministic fallback carries no packs. That is the actual reason production still emitted one merged call — not a missing caller.
- `run-agent` builds the sequential profile with `approvedAliases: keyword_queries` (a flattened list) — GPT's packs are lost before the bridge sees them.
- Indeed recency in `actorInputPlanner.ts` / `actorSchemaFixtures.ts` compiles to `"last 24 hours" | "3 days" | "7 days" | "14 days"`. The live Actor rejected these; it accepts only `"" | "1" | "3" | "7" | "14"`. This is a real, confirmed defect.
- `companyFirstQuotaController.ts:90` hard-codes `maxRounds: 3, maxJobsCalls: 3` — the observed stop reason.
- A resume path does exist (`run-agent` `resume_task_id`/`continuation_token` → `decideResume` → `claim_sourcing_continuation`), and the frontend has `src/lib/qualifiedLead/continueSourcing.ts`. The second paid task in the last audit came from a manual `run-agent` invocation that omitted `resume_task_id`; whether the `next_action: start_round` checkpoint actually surfaces `continuation.required` to the UI is **unverified** and is the first thing this work checks.
- The canonical strategist policy/envelope (`_shared/leadStrategy/policy.ts`) is built but currently only feeds `promptHash` — the audit's finding stands.

## Priority Zero — execution and resume

1. **Trace + regression harness first.** Add a runtime-level test that drives the exact production composition (`applySequentialSourceExecution` → `executeRunAgentCompanyFirstSourcing`) with mocked providers, reproducing tasks `4851efb0…` and `b59b422b…`. It asserts: one task only, same task resumes, separate pack calls, valid recency enums, no merged universal OR query.
2. **Resume.** Verify the `next_action: start_round` checkpoint sets `continuation.required` and a token, and that the continuation surface calls `run-agent` with `resume_task_id`. Fix whichever link drops it so continuation resumes the same task/plan and can never insert a second company-first task. Guard: a company-first request that carries a live checkpoint for the same workspace+plan must refuse fresh insertion.
3. **Pack propagation into the real invoker.** Carry validated GPT `query_packs` from `leadStrategyBridge` into `applySequentialSourceExecution` (via the strategy binding, not via `keyword_queries`), so `activePacks` is non-empty on the production path. Add an assertion-style test proving `prepareStepCall` is NOT selected when validated packs exist.
4. **Preserve identity end-to-end**: pack ID, that pack's titles only, batch allocation, `compiled_input_hash`, `idempotency_key` through the final `source_with_apify` call.
5. **Indeed recency.** Change the verified enum in `actorSchemaFixtures.ts` + compiler in `actorInputPlanner.ts` to `"" | "1" | "3" | "7" | "14"` (days-as-string), clamping >14 to `"14"`, and update the fixture/schema tests that encode the old strings.
6. **LinkedIn `timePostedRange`.** Read the supported values from the existing Actor capability contract and test the final payload against that schema; keep on-site/remote/hybrid unrestricted when nothing was requested.

## Then — the GPT workflow itself

7. **Send the real context.** Wire `buildStrategistContextEnvelope` / `strategistSystemPrompt` into both `createInitialStrategy` and `chooseNextAction`, carrying the verbatim request, workflow kind, execution mode, quota, Company Brain, saved ICP, industries/exclusions/size/geography/stage/business-model, hiring-role families, pack taxonomy, decision-maker roles, recency + workplace, Actor capability cards and limitations, completed/unused packs and sources, source-quality history, measured funnel, bottleneck, budgets, allowed actions and the output schema. Prompt hash is computed from the exact payload sent. No workspace's Brain is hardcoded.
8. **One canonical policy/prompt builder** for initial strategy and next-action feedback (retires the `leadStrategyContract` / `sourceFeedbackRuntime` split), called only through the existing provider-independent strategist facade. No direct Lovable/OpenAI/Gemini/Claude calls in the runtime; unrelated workflow routing untouched.
9. **Full plan reaches the runtime.** `leadStrategyBridge` forwards query packs, negative patterns, source assignments, ordered source plan, batch hints, recency, workplace intent, stop conditions and next valid actions — not a flat keyword list. `hiringSourcePlan` may not re-derive the order unless deterministic fallback was explicitly selected.
10. **Startup-aware order.** The validated plan may select YC → LinkedIn → Indeed → Glassdoor for the startup fixture; this is not hardcoded. Persist per-source reason: selected / skipped / unavailable / exhausted / rejected / budget-excluded. ATS stays excluded.
11. **Deterministic repair before rejection** (duplicate packs, duplicate titles, title normalization, unsupported source IDs/fields, verified default recency, unsupported action) recording original errors, repairs applied, repaired strategy and remaining fatal errors. Authority: GPT primary → repair → GPT escalation once → repair → deterministic fallback.
12. **Same strategist owns adaptation** across the ten allowed actions, with the real numeric source observation (raw/unique/title-qualified rows, irrelevant-title rate, companies resolved, evidence-pending, Brain rejections, qualified companies, people searched, CONTACT-ready, cost, duplicate rate, remaining quota/budget).
13. **Plan-aware action budget** replacing `maxRounds/maxJobsCalls = 3`, scoped strictly to `qualified_lead_sourcing` + `company_first`, with a hard safety ceiling and a persisted stop reason plus the inputs used.
14. **Truthful observability** per resolution (task, purpose, provider, model, tier, policy/prompt-schema version, prompt hash, Brain/ICP/Actor-catalog versions, sanitized input, canonical output, validation errors, repairs, escalation, fallback reason, selected action, latency, token/cost) with no secrets, credentials, chain-of-thought or personal contact data. Observability failure never fails the run.

## Tests

Baseline measured on main @ 49212a22 first; only failures reproduced there are called pre-existing. Then the 27 offline proofs listed in the request (mocked models and providers only), plus the mocked end-to-end canonical fixture "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads." to `stop_success`, and an honest Partial run with only three CONTACT-ready leads. Suites: strategist policy, prompt builder, provider adapters, validator/repair, strategy bridge, query-pack runtime, source order, provider compilers, feedback/action, action budget, company evidence, Company Brain, people search, CONTACT quota, Workbench projection, full backend suite, affected frontend suite, `deno check`, TypeScript check, production build.

## Delivery

One focused PR against main. Not merged, not deployed. Report: old/new GPT call graphs, exact context sent, canonical system prompt and builder path, sanitized input example, canonical output example, validation+repair example, pack-propagation proof, source-order proof, execution-limit proof, observability example, full test/build results, files changed, commit SHA, PR number/URL, remaining gaps, and confirmations that no paid/live calls ran, production and TEST data were untouched, and `mcp/index.ts` stayed unstaged.

## Note on one of your premises

Point 1 ("`prepareStepPackCalls()` is still bypassed") is accurate in effect but not in cause: the caller is wired; it goes unused because no validated packs survive to it. The fix therefore targets pack survival through the bridge plus a test that fails if the single-call path is ever chosen while packs exist.

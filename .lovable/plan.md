
# Wire bounded source feedback into sequential sourcing

## Confirmed defect (pre-work)

- `origin/main` tip: `3dd53ff8` — contains PR #104–#111.
- Modules present: `sourceFeedbackRuntime.ts`, `sourceFeedbackContract.ts`, `sourceFeedbackValidation.ts`, `sequentialSourceRuntime.ts`, `sequentialSourceBridge.ts`, `hiringEvidenceFusion.ts`, `hiringSourcePlan.ts`.
- Production call graph (verified with `rg` excluding `*.test.ts`):
  - `sourceFeedbackRuntime.ts` — **no production caller** (only its own test imports the runtime symbols).
  - `applyObservation` — **no production caller** (only tests).
  - `applyObservationWithFeedback` / `decideNextActionWithFeedback` — **no production caller**.
- The `sequentialSourceBridge` restores/passes through a `SourceFeedbackLedger` and reports ledger diagnostics, but never runs the runtime, never advances the ledger, and never calls `applyObservation`. `CLAUDE_SOURCE_FEEDBACK=true` therefore has zero effect today. Confirmed orphaned.

## The correct seam (identified, not invented)

Tracing the real lifecycle:

```text
run-agent
 └── executeRunAgentCompanyFirstSourcing
      └── runCompanyFirstQuotaController  ← loops rounds
           └── invokeJobs (already wrapped by sequentialJobsInvoker)
                └── provider → dedupe → fuseSourceResults
           └── verify / people-search / brain gate / CONTACT-classify / persist
           └── round record produced (has totalContactReady + incrementalContactReady + stepId + sourceExhausted)
```

The post-funnel checkpoint the feedback runtime needs is exactly the **end of each quota-controller round**. That is where:
- fusion has completed (invoker fused before returning),
- Company Brain + contact funnel finished (round persisted),
- CONTACT-ready totals are authoritative,
- deterministic stop/exhaustion signals are already computed,
- the next round has not yet been chosen.

No such seam is currently exposed to the bridge. This plan adds exactly one hook — a callback the controller invokes once per completed round — and wires the existing feedback runtime through it. No second executor, no second decision engine, no second ledger.

## Files edited

1. **`supabase/functions/_shared/sequentialSourceBridge.ts`**
   - Add `onObservation(observation): Promise<void>` to `SequentialSourceBridgeResult` (a no-op when disabled — the caller invokes it unconditionally).
   - When enabled, `onObservation` inside the bridge:
     1. Runs mandatory deterministic short-circuits first (quota reached / valid exhaustion / single executable action) via `decideNextAction` + `runtimeStateFor(state)` — if only one safe action exists it uses it directly, no model call.
     2. Otherwise calls the existing `decideNextActionWithFeedback` from `sourceFeedbackRuntime.ts` with the shared plan/state/fusion/feedback + a `generate` closure that uses the existing `plannerWrapper` model gateway (repair disabled).
     3. Feeds the returned action into `applyObservation(plan, state, observation, action)` — **once per observation**.
     4. Persists the updated ledger back into `result.feedback` (mutated in place; the caller reads it from the bridge result on checkpoint).
   - Preserve function-object identity for `invokeJobs` when disabled (unchanged).
   - Diagnostics from `sequentialSourceDiagnostics` gain per-checkpoint entries taken from `ledger.checkpoints[]` — no raw prompt, no raw response, no keys.

2. **`supabase/functions/_shared/companyFirstQuotaController.ts`**
   - Accept a new optional dependency `onRoundComplete?: (obs: SourceStepObservation) => Promise<void>`.
   - After each round is finalized (right before deciding the next round), if provided, build a `SourceStepObservation` from the round record + running `eligible_leads` and `await` the hook.
   - No change to the controller's own decision logic (quota controller remains the sole quota authority). Continuation semantics unchanged.

3. **`supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts`**
   - Add optional `onRoundComplete` on `CompanyFirstRuntimeDeps` and pass it straight into `runCompanyFirstQuotaController`.

4. **`supabase/functions/run-agent/index.ts`**
   - At the existing `executeRunAgentCompanyFirstSourcing({...})` call site, pass `onRoundComplete: sequentialSources.onObservation` so the sequential bridge and the quota controller share the same one-hook path.
   - After the run, the ledger checkpoint captured on `sequentialSources.feedback` is already carried into `company_first_state` (the bridge slot is already persisted); no new persistence surface required.
   - Idempotency: because `sourceFeedbackContract` computes request keys from `(observationHash, stepId, availableActions)` and the ledger is restored via `restoredFeedback`, a resumed task with the same round observation yields the same key and the runtime short-circuits without a model call — this is the existing contract, we just make it reachable.

## Files not touched

- `supabase/functions/mcp/index.ts` — never staged, never restored, never committed (explicit exclusion).
- `sourceFeedbackRuntime.ts`, `sourceFeedbackContract.ts`, `sourceFeedbackValidation.ts` — reused as-is; no logic changes. Only imported from new production callers.
- `hiringSourcePlan.ts`, `sequentialSourceRuntime.ts`, `hiringEvidenceFusion.ts` — unchanged.
- Company Brain compiler / policy — unchanged.
- Quota / persistence / decision-maker workflow — unchanged.

## Feature-gate behavior

- All flags stay OFF in this branch. No `.env` edit, no secret write, no deploy.
- When `DYNAMIC_HIRING_SOURCE_PLANNING` is off → bridge returns inert result → `onObservation` is a no-op → identical to today.
- When dynamic sequential sourcing is on but `CLAUDE_SOURCE_FEEDBACK` is off (or workspace not allow-listed) → deterministic-only path, still no model call. `applyObservation` runs exactly once per round with the deterministic decision.
- Every mandatory deterministic case skips Claude: quota reached, valid exhaustion, budget exhausted, one executable action.

## Tests added

New file: **`supabase/functions/_shared/sequentialSourceBridge.feedback.test.ts`**

- `runtime import-graph guard`: assert that `sourceFeedbackRuntime.ts` is imported by `sequentialSourceBridge.ts` at build time (static import graph read from the file, not from the test file).
- `feature OFF → no model call, no ledger change`.
- `workspace not allow-listed → no model call`.
- `dynamic sequential sourcing OFF → onObservation is a no-op`.
- `quota reached → skip feedback, ledger records skipped_reason`.
- `valid exhaustion → skip feedback`.
- `budget exhausted → skip feedback`.
- `one executable action → skip feedback, action applied directly`.
- `two+ safe alternatives → model.fn called at most once, recommendation validated, applied`.
- `invalid model output → deterministic fallback used, action still applied once`.
- `applyObservation runs exactly once per observation` (spy through `applyObservationWithFeedback` fake plumbing).
- `ledger.checkpoints[] persisted on bridge result; second observation with the same key does not re-invoke model` (continuation idempotency).
- `feedback receives fused unique counts, not raw duplicates` (observation built from fusion outcome, not raw row count).
- `no live provider/model call anywhere` — mocked `generate` throws on unexpected input.

New file: **`supabase/functions/_shared/companyFirstQuotaController.onRoundComplete.test.ts`**

- `onRoundComplete invoked once per round with post-funnel counts`.
- `omitting the hook keeps behavior byte-for-byte identical to today` (round records identical to baseline).
- `hook does not influence quota decisions` (controller remains sole authority).
- `jobs/signals/companies never counted toward quota — only CONTACT persists a bump`.

## Verification (all offline)

1. Record baseline first: `deno test --allow-env --allow-read supabase/functions/_shared/` on `main` (SHA `3dd53ff8`) — capture exact pass/fail counts.
2. On branch, run focused suites:
   - `sourceFeedback.test.ts`, `sourceFeedbackValidation.test.ts`, `plannerWrapper.test.ts`
   - `sequentialSource*.test.ts`, `hiringSourcePlan*.test.ts`, `hiringEvidenceFusion.test.ts`
   - `sourceBroadeningCompatibility.test.ts`, `companyFirstQuotaController*.test.ts`
   - `runAgent*.test.ts`, continuation tests, Company Brain compiler tests
3. Then the full backend `_shared` suite.
4. Only baseline-known failures may remain.
5. `deno check` on every modified module + `run-agent`.
6. `./node_modules/.bin/tsc --noEmit`.
7. `npm run build`.
8. Diff scan for `sk-ant`, `ANTHROPIC_API_KEY=`, bearer tokens, hardcoded authorization headers.
9. Confirm `git status` shows `supabase/functions/mcp/index.ts` unmodified / unstaged.

## Commits

- `fix(intelligence): invoke bounded source feedback` — bridge + tests
- `fix(leads): persist accepted feedback actions` — quota controller hook + executor wiring
- `test(intelligence): cover runtime feedback wiring` — import-graph guard + edge-case tests

## Push & PR

- Branch: `fix/wire-bounded-source-feedback-runtime`
- `git push -u remix fix/wire-bounded-source-feedback-runtime`
- Open PR against `remix/main`. Title: `fix(leads): wire bounded source feedback into sequential sourcing`.
- Do not merge. Do not deploy. Do not apply migrations. All flags OFF.

## Final report contents

Base SHA · branch · orphaned-state proof · production caller added · post-fix call graph · stable checkpoint used (round-complete) · fusion-before-feedback proof · funnel-metrics availability · eligibility behavior · mandatory-skip cases · available-action projection · one-request-per-observation proof · validation path · deterministic fallback · applyObservation-runs-once proof · ledger persistence · continuation reuse · feature-OFF compatibility · diagnostics fields · tests added · baseline vs branch results · deno / tsc / build results · files changed · commits · remote SHA · PR # + URL · negative confirmations (no second runtime, gateway, decision engine, executor, quota or brain change; no deploy; no migration; no live model / Actor / Firecrawl call; flags OFF; no secrets in diff; MCP file untouched).

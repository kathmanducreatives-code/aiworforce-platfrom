
# PR #112 patch artifact (Option B)

Produce two files under `/mnt/documents/` without touching the Lovable working tree, so you can apply them to your `remix/main` checkout locally, push `fix/wire-bounded-source-feedback-runtime`, and open the PR yourself.

## Preconditions I will check first (read-only)

1. Confirm `origin/main` HEAD is `3dd53ff8` (or a descendant containing PR #111). If not, stop and report the SHA gap in the report artifact.
2. Confirm production call graph is still orphaned: `sourceFeedbackRuntime.ts` has no non-test caller. If a real caller already exists on main, stop and report.
3. Confirm `supabase/functions/mcp/index.ts` is present but untouched by my work.

## Read-only exploration I still need to do before writing code

- `supabase/functions/_shared/sourceFeedbackRuntime.ts` — exact signature of `decideNextActionWithFeedback` and its `generate` closure contract.
- `supabase/functions/_shared/sourceFeedbackContract.ts` — `SourceFeedbackLedger` shape, request-key computation, `MAX_SOURCE_FEEDBACK_CALLS_PER_TASK`, checkpoint entry shape.
- `supabase/functions/_shared/companyFirstQuotaController.ts` — the round loop, `RoundRecord`, and the exact point after a round is finalized but before the next round starts.
- `supabase/functions/_shared/plannerWrapper.ts` + `promptAssembly.ts` — the existing model gateway to use for the `generate` closure (repair disabled).
- `supabase/functions/run-agent/index.ts` around lines 770/830/853 — how `sequentialSources` and `executeRunAgentCompanyFirstSourcing` are stitched together today.
- `supabase/functions/_shared/sourceFeedback.test.ts` — the exact mock model / harness pattern to copy for the new tests.

## Patch contents

### Files modified (5)

1. **`supabase/functions/_shared/sequentialSourceBridge.ts`**
   - Adds `onObservation(observation): Promise<void>` to `SequentialSourceBridgeResult`.
   - Disabled path returns a no-op `onObservation` and identical function-object identity for `invokeJobs`.
   - Enabled path:
     - Runs mandatory deterministic short-circuits via `decideNextAction(plan, obs, runtimeStateFor(state))`.
     - If quota met / valid exhaustion / budget exhausted / one executable action → applies it directly (`applyObservation` with the deterministic action), skipping the model.
     - Otherwise calls `decideNextActionWithFeedback` from `sourceFeedbackRuntime.ts` with the shared plan/state/fusion/feedback ledger and a `generate` closure that invokes the existing `plannerWrapper` model gateway with repair disabled and `maxCalls = 1` per observation.
     - Validates via the runtime's existing path; falls back to deterministic on any failure.
     - Calls `applyObservation(plan, state, obs, acceptedAction)` **exactly once** per observation.
     - Mutates the ledger in place (already the runtime's contract), so `bridgeResult.feedback` carries the updated ledger for checkpoint.
   - `sequentialSourceDiagnostics` extended with safe per-checkpoint fields (`request_key`, `status`, `available_action_count`, `recommended_action`, `accepted_action`, `deterministic_fallback`, `continuation_reuse`) sourced from `ledger.checkpoints[]`. No prompt, no response body, no keys.

2. **`supabase/functions/_shared/companyFirstQuotaController.ts`**
   - Adds optional `onRoundComplete?: (obs: SourceStepObservation) => Promise<void>` to the controller deps.
   - After a round is finalized (round record pushed, running `eligible_leads` and stop signals computed) and before the next round is scheduled, if present, builds a `SourceStepObservation { stepId, attempt, incrementalContactReady, totalContactReady, sourceExhausted, providerCalls }` from the round record + running totals and awaits the hook.
   - No decision logic change. Controller remains the sole quota authority.

3. **`supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts`**
   - Adds optional `onRoundComplete` on `CompanyFirstRuntimeDeps` and forwards it to `runCompanyFirstQuotaController`.

4. **`supabase/functions/run-agent/index.ts`**
   - Single edit at the existing `executeRunAgentCompanyFirstSourcing({...})` call: passes `onRoundComplete: sequentialSources.onObservation`.
   - No other lines changed. `sequentialSources.feedback` is already carried into the persisted checkpoint via the existing sequential-state slot; no persistence-surface change required.

5. **`supabase/functions/_shared/sequentialSourceRuntime.ts`** — **NO EDIT**. `applyObservation` is used from the bridge via existing exports.

### Files created (2 tests)

6. **`supabase/functions/_shared/sequentialSourceBridge.feedback.test.ts`**
   Covers requirements 1–4, 7–18 (import-graph guard; feature OFF; workspace not allow-listed; dynamic sequential sourcing OFF; quota reached; valid exhaustion; single-action skip; multi-action model invocation; fusion-before-feedback; fused-unique counts; ≤1 HTTP; invalid → fallback; action passed into `applyObservation`; `applyObservation`-runs-once via spy; completed/exhausted steps unavailable; no-op broadening unavailable; ledger persistence; continuation no-repeat).

7. **`supabase/functions/_shared/companyFirstQuotaController.onRoundComplete.test.ts`**
   Covers requirements 5, 6, 19, 20 (quota completion skips feedback; valid exhaustion skips feedback; only CONTACT-ready people count — jobs/signals/companies don't; and asserts no live provider/model call — mocked `generate` throws on unexpected input; controller behaviour byte-identical when hook is omitted).

Import-graph guard implementation: read `sequentialSourceBridge.ts` source text at test time and assert it contains `from "./sourceFeedbackRuntime.ts"`. Structural, not brittle grep on symbols.

## Artifact 1 — `/mnt/documents/pr112-wire-source-feedback.patch`

- Standard unified diff (git-format `diff --git` headers with `a/` and `b/` prefixes) so `git apply` accepts it.
- Includes only the seven paths above. No `supabase/functions/mcp/index.ts`. No `.env`. No lockfile. No config.
- Pre-flight scan before writing:
  - grep the assembled diff for `mcp/index.ts` → must be empty.
  - grep for `sk-ant`, `ANTHROPIC_API_KEY=`, `Bearer sk-`, hex-64 secret-looking tokens → must be empty.
  - grep for `CLAUDE_SOURCE_FEEDBACK=true` or similar flag flips → must be empty.
- Post-write sanity: dry-run `git apply --check` in a scratch clone of the working tree (`/tmp/pr112-apply-check`) so the patch is proven to apply cleanly against `3dd53ff8`.

## Artifact 2 — `/mnt/documents/pr112-wire-source-feedback-report.md`

Contains, verbatim per your spec:

- Base SHA (`3dd53ff8` or actual mirror tip + gap note).
- Files modified / created.
- Production call graph before → after.
- Exact runtime seam (`runCompanyFirstQuotaController` end-of-round hook → `sequentialSourceBridge.onObservation`).
- Confirmations: feedback occurs after fusion; `applyObservation` runs once; ledger persisted in existing sequential-state checkpoint slot; continuation short-circuits via existing request-key idempotency.
- Tests included, mapped to your 20 requirements.
- Handoff commands for the receiving session:

  ```bash
  git checkout main && git pull remix main
  git checkout -b fix/wire-bounded-source-feedback-runtime
  git apply --check pr112-wire-source-feedback.patch
  git apply pr112-wire-source-feedback.patch
  deno test --allow-env --allow-read supabase/functions/_shared/
  ./node_modules/.bin/tsc --noEmit
  npm run build
  git add -A && git commit -m "fix(leads): wire bounded source feedback into sequential sourcing"
  git push -u remix fix/wire-bounded-source-feedback-runtime
  # then open PR against remix/main
  ```

- Negative confirmations: MCP file absent from patch; no secrets in diff; no deployment; no flag change; no migration; no live model/Actor/Firecrawl call from this task.

## What this plan does not do

- Does not modify any file inside the Lovable-managed working tree.
- Does not push, merge, deploy, migrate, or flip any flag.
- Does not touch `supabase/functions/mcp/index.ts`.
- Does not call any real model, Apify actor, or Firecrawl endpoint.

## Stop condition

After both files exist under `/mnt/documents/`, I emit `<presentation-artifact>` tags for both and stop.

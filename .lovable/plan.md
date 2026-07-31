## Confirmed so far (read-only queries already run)

- **Task ID**: `3f71ae08-faa1-45a7-b9b2-70484bf38910`, workspace `e510c1a6-2bb8-4aa4-95f7-0beb786ed995`, plan `197bb584-2e9e-4406-9358-46ac95e37b04`, agent `scout`, `created_at 2026-07-31 16:32:00.192Z`, `status = complete`, `completed_at = null`.
- Stored user input matches the audited query ("Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.").
- **Three `source_with_apify` tool calls**, all `succeeded`:
  1. `5704a419-…` 16:32:01.8 → 16:32:16.5 (output 582 KB)
  2. `5bb5b70c-…` 16:32:23.6 → 16:32:37.4 (output 697 KB)
  3. `7a4f16fa-…` 16:32:46.2 → 16:32:59.8 (output 554 KB)
- `tasks.result` carries the keys needed for Steps 4–6: `company_first`, `company_first_state`, `sequential_source_execution`, `claude_first_planning`, `executed_sourcing_mode`, `qualified_lead_run_context`, `company_brain_policy`, `routing`, `terminal_status`, `output`.

Nothing about the 75 / 39 counts or the Claude-vs-fallback question is asserted yet — those come out of the extraction below.

## Audit execution (read-only, no provider calls, no writes)

1. **Task record** — dump `tasks.payload`, `result.routing`, `result.qualified_lead_run_context`, `result.executed_sourcing_mode`, `result.terminal_status`, `result.output` for the task; resolve plan/conversation linkage via `task_plans`.
2. **Apify calls** — dump `tool_calls.input_json` verbatim for all three calls (redacting only token-like fields), plus per-call step ID, round, capability key, actor key, run/dataset IDs and row counts as persisted in `output_json` metadata.
3. **Provider rows** — extract every stored row from each `output_json` into `provider-rows-all.json/.csv` with per-call and combined totals; locate the exact field the execution card's **75** is read from (`sequential_source_execution` / per-call `raw` counters) and state it.
4. **Reviewed = 39** — trace the code path that emits the sentence (`companyFirstQuotaController` / `sourcingBottleneck.FunnelSummary.unique_jobs` and the run-agent summary writer), name the exact function + field, then recover the 39 rows and join each to its persisted disposition from `company_first_state` (per-job gate outcomes, dedupe keys, pending-decision-maker reasons).
5. **Reconciliation** — build the funnel table (provider rows → stored → normalized → dedup → recency → title family → hiring signal → unique reviewed → companies resolved/evaluated/qualified → people searched → CONTACT-ready), each reduction citing count, reason, responsible file/function, and the persisted counter backing it.
6. **Claude evidence** — from `claude_first_planning`, `company_first_state.strategy`, `sequential_source_execution` observations and any source-feedback records: state plainly whether Claude planning and Claude source feedback actually ran or whether deterministic fallback controlled the run, including plan hash, role families, query-pack IDs, source order, bottleneck per source, chosen action, and the stop reason.
7. **Local files** (untracked, `/tmp/agentory-task-audit/`): `task-summary.md`, `apify-calls.json`, `provider-rows-all.json`, `provider-rows-all.csv`, `reviewed-jobs-39.json`, `reviewed-jobs-39.csv`, `reviewed-jobs-with-disposition.csv` (with the mandated columns), `funnel-reconciliation.json`.

## Technical notes

- Extraction runs via `supabase--read_query` with SQL-side `jsonb` projection and `LIMIT/OFFSET` paging (1000-row cap) so the ~1.8 MB of `output_json` is pulled without truncation; no `psql` writes, no migrations, no deploys, no provider calls.
- Dispositions are assigned only from persisted evidence. Any job whose company was never resolved/evaluated will be labelled `company_unresolved` or `people_search_pending` — never `company_brain_rejected`.
- Anything not persisted (e.g. Apify run/dataset IDs, per-row raw payloads dropped before storage) will be reported explicitly as missing and unrecoverable without a rerun, not reconstructed.

## Out of scope

No code changes, no deployments, no reruns, no production data mutation, no secret values in output.

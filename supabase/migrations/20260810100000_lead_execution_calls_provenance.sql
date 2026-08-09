-- PLANNER PROVENANCE AND STAGE RESULTS ON THE EXECUTION LEDGER.
--
-- Two additions, both driven by questions the first cut could not answer.
--
-- 1. PLANNER PROVENANCE. `planner_owner` alone says which adapter was selected
--    and nothing about whether it worked. The ownership work established a
--    triple — adapter, outcome, fallback reason — precisely because "the
--    deterministic ladder planned by design" and "a model adapter ran and
--    degraded" are different operational states that used to share one label.
--    `planner_outcome` is a column rather than a metadata key because "show me
--    every run that degraded" is a query someone will want on day one.
--
-- 2. RECORD KIND. A provider call and a downstream qualification stage are not
--    the same event. An Actor returning 100 rows does not entitle anyone to
--    record "13 evidence-satisfied" against that Actor — several calls may have
--    contributed to those 13, and attributing them to one row makes the ledger
--    untrustworthy exactly where it needs to be trusted.
--
--    So stage outcomes are their own rows, labelled `stage_result`, carrying the
--    task-level funnel numbers that no single provider call can know. Provider
--    rows keep only counts genuinely attributable to them. One table, two record
--    kinds, no ambiguity about which is which.

ALTER TABLE public.lead_execution_calls
  ADD COLUMN planner_adapter text,
  ADD COLUMN planner_outcome text,
  ADD COLUMN planner_fallback_reason text,
  ADD COLUMN record_kind text NOT NULL DEFAULT 'provider_call';

ALTER TABLE public.lead_execution_calls
  ADD CONSTRAINT lead_execution_calls_record_kind_check
    CHECK (record_kind IN ('provider_call', 'stage_result'));

ALTER TABLE public.lead_execution_calls
  ADD CONSTRAINT lead_execution_calls_planner_adapter_check
    CHECK (planner_adapter IS NULL OR planner_adapter IN ('gpt', 'claude', 'none'));

ALTER TABLE public.lead_execution_calls
  ADD CONSTRAINT lead_execution_calls_planner_outcome_check
    CHECK (planner_outcome IS NULL OR planner_outcome IN
      ('selected_directly', 'model_validated', 'deterministic_fallback'));

-- A degraded run must say what degraded it, in the database as well as in the
-- module. Mirrors `assertPlannerProvenance`.
ALTER TABLE public.lead_execution_calls
  ADD CONSTRAINT lead_execution_calls_fallback_needs_reason
    CHECK (planner_outcome <> 'deterministic_fallback' OR planner_fallback_reason IS NOT NULL);

-- A stage result is not a provider call and must not claim to be one.
ALTER TABLE public.lead_execution_calls
  ADD CONSTRAINT lead_execution_calls_stage_result_has_no_run
    CHECK (record_kind <> 'stage_result' OR (provider_run_id IS NULL AND dataset_id IS NULL));

-- Reading one task's story means reading provider calls and stage results in
-- order, so the task index carries the kind.
CREATE INDEX lead_execution_calls_task_kind_idx
  ON public.lead_execution_calls (task_id, record_kind, started_at);

COMMENT ON COLUMN public.lead_execution_calls.record_kind IS
  'provider_call = one external call. stage_result = a task-level funnel outcome no single call can know. Never merge the two when summing.';
COMMENT ON COLUMN public.lead_execution_calls.planner_outcome IS
  'selected_directly = the deterministic ladder was the intended planner. deterministic_fallback = a model adapter ran and degraded. These are different states and must not share a label.';

-- MODEL CALLS ENTER THE LEDGER.
--
-- ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
--
-- Phase 1 built `buildModelTelemetry` — role, model, effort, token counts,
-- latency, estimated cost, provenance grade — and nothing ever stored it. The
-- record was computed at both transports and dropped on the floor, so a run
-- could be audited for Apify dollars to the cent and still could not answer
-- "what did the models cost?".
--
-- ── WHY THE MIGRATION COMES FIRST ───────────────────────────────────────────
--
-- `record_kind` is CHECK-constrained to ('provider_call','stage_result'). The
-- ledger writer swallows insert failures by design — one bad row must never take
-- a run down — so shipping code that writes 'model_call' before this constraint
-- exists would make every model row fail SILENTLY and leave the table looking
-- exactly as empty as it does now. That is not hypothetical: a stray `version`
-- column did precisely this and the table held nothing for weeks.
--
-- ── SAFE BY CONSTRUCTION ────────────────────────────────────────────────────
--
-- Every change WIDENS. The record_kind CHECK gains a value and loses none, so
-- no existing row can violate it and no data moves. The two new constraints
-- describe rows that do not exist yet.
--
-- ── WHAT IS DELIBERATELY NOT ADDED ──────────────────────────────────────────
--
-- No `model_call → actual_cost_usd IS NULL` constraint, even though OpenAI
-- returns token counts and never a charge, so today every model row must have a
-- null there. The EXISTING general invariant already guarantees it:
--
--     actual_cost_usd IS NULL OR cost_source = 'provider_reported'
--
-- and it does so ADAPTIVELY. A model-call-specific rule would additionally
-- forbid the honest case where a provider does begin reporting a monetary
-- charge — turning "never store a derived price as actual" into "never store an
-- actual", which is a different and wrong rule.
--
-- ── AND NO NEW COLUMNS ──────────────────────────────────────────────────────
--
-- Token counts live in `metadata`, not in `raw_count`/`accepted_count`. Those
-- columns mean funnel rows and are summed across the whole table by existing
-- queries; making `accepted_count` mean "output tokens" for one record kind
-- would corrupt every one of those aggregates. Cost, latency, status and
-- failure DO take their real columns, because those are cross-kind concepts and
-- sharing them is what lets one query price a whole run.
--
-- The view at the bottom is what makes the jsonb genuinely queryable.

-- ── 1. THE NEW RECORD KIND ──────────────────────────────────────────────────

alter table public.lead_execution_calls
  drop constraint if exists lead_execution_calls_record_kind_check;

alter table public.lead_execution_calls
  add constraint lead_execution_calls_record_kind_check
  check (record_kind in ('provider_call', 'stage_result', 'model_call'));

comment on column public.lead_execution_calls.record_kind is
  'What this row records. provider_call: a paid third-party provider run (Apify). stage_result: a task-level funnel observation Agentory itself produced. model_call: one LLM invocation. Kept in one table so a run''s whole cost is one query, and kept distinguishable so summing provider spend never silently includes model spend.';

-- ── 2. A MODEL CALL IS NOT A PROVIDER RUN ───────────────────────────────────
--
-- Same reasoning as the existing stage_result rule. A model call has no Apify
-- run and no dataset, and a row carrying either would be counted as a paid
-- provider run by anything joining on those ids.

alter table public.lead_execution_calls
  drop constraint if exists lead_execution_calls_model_call_has_no_run;

alter table public.lead_execution_calls
  add constraint lead_execution_calls_model_call_has_no_run
  check (
    record_kind <> 'model_call'
    or (provider_run_id is null and dataset_id is null)
  );

-- ── 3. A MODEL CALL MUST SAY WHAT IT RAN ────────────────────────────────────
--
-- The one field without which the row is useless. A model row that cannot name
-- its model cannot be grouped, priced or compared, and the entire reason this
-- record kind exists is to answer "which model, how often, at what cost".
--
-- `role` is deliberately NOT required here: it is required in the type, and a
-- row that reached the database with a model but no role is still worth keeping.

alter table public.lead_execution_calls
  drop constraint if exists lead_execution_calls_model_call_names_model;

alter table public.lead_execution_calls
  add constraint lead_execution_calls_model_call_names_model
  check (
    record_kind <> 'model_call'
    or (metadata ? 'model' and length(coalesce(metadata ->> 'model', '')) > 0)
  );

-- ── 4. QUERYABLE WITHOUT WIDENING THE TABLE ─────────────────────────────────
--
-- Projects the model-only fields out of `metadata` so model spend is ordinary
-- SQL. Cost, latency, status and failure come from the real columns, which is
-- the point: the same figures aggregate across record kinds.

create or replace view public.lead_model_calls as
select
  id,
  workspace_id,
  task_id,
  plan_id,
  logical_call_key,
  attempt_number,
  status,
  metadata ->> 'role'                                as role,
  metadata ->> 'model'                               as model,
  metadata ->> 'reasoning_effort'                    as reasoning_effort,
  (metadata ->> 'input_tokens')::bigint              as input_tokens,
  (metadata ->> 'cached_input_tokens')::bigint       as cached_input_tokens,
  (metadata ->> 'output_tokens')::bigint             as output_tokens,
  duration_ms                                        as latency_ms,
  estimated_cost_usd,
  actual_cost_usd,
  cost_source,
  metadata ->> 'fallback_reason'                     as fallback_reason,
  failure_code,
  failure_message,
  started_at,
  finished_at
from public.lead_execution_calls
where record_kind = 'model_call';

comment on view public.lead_model_calls is
  'One row per LLM invocation. A projection of lead_execution_calls, never a second store — model spend and provider spend are summed from the same estimated_cost_usd column so a run''s total is one query.';

-- ── 5. THE INDEX THE ROLL-UP NEEDS ──────────────────────────────────────────
--
-- Every model-spend query filters by record_kind and groups within a workspace
-- or a task. Partial, so it costs nothing for the provider_call rows that are
-- the overwhelming majority.

create index if not exists lead_execution_calls_model_call_idx
  on public.lead_execution_calls (workspace_id, task_id, started_at desc)
  where record_kind = 'model_call';

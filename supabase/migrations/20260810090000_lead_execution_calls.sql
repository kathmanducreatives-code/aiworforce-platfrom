-- THE EXECUTION LEDGER — one row per external provider call.
--
-- WHY A NEW TABLE RATHER THAN COLUMNS ON `tool_calls`.
--
-- `tool_calls` records every tool invocation across every agent, and
-- `durableIdempotency` reads it to adopt an already-paid Apify run instead of
-- starting a second one. Widening it with lead-sourcing funnel counts, stage and
-- reason would put lead-specific columns on a general-purpose table and put a
-- schema change underneath a mechanism that protects live spend. These two have
-- different jobs and different blast radii, so they stay separate tables.
--
-- `tool_calls` remains untouched by this migration.

CREATE TABLE public.lead_execution_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope. workspace_id is NOT NULL because every isolation rule keys on it.
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id uuid,
  plan_id uuid,

  -- WHO SPENT THIS. Recorded as text, not an enum: the ownership vocabulary is
  -- still consolidating and a Postgres enum would need a migration every time a
  -- phase renames one. Structured enough to GROUP BY, loose enough to evolve.
  execution_owner text,
  planner_owner text,

  -- WHY IT RAN. `stage` and `reason` are the fields that make a row explicable
  -- rather than merely present. Canonical capabilities land in a later phase and
  -- will replace the VALUES here without touching the shape.
  stage text NOT NULL,
  capability text,
  reason text NOT NULL,

  -- WHAT RAN.
  provider_id text NOT NULL,
  actor_id text,
  provider_run_id text,
  dataset_id text,

  -- REPRODUCIBILITY. Redacted before it ever reaches this column; see
  -- `redactProviderInput` in _shared/executionLedger.ts. Many past incidents were
  -- malformed Actor inputs, so the payload has to be recoverable — without ever
  -- carrying the token that authenticated it.
  request_input jsonb,

  -- ATTEMPTS. A retry must never overwrite the attempt before it: two attempts at
  -- one logical call share `logical_call_key` and differ by `attempt_number`. The
  -- unique index below makes that a constraint rather than a convention.
  logical_call_key text NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,

  status text NOT NULL DEFAULT 'started',
  failure_code text,
  failure_message text,

  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,

  -- FUNNEL COUNTS. Every one is nullable and NULL means UNKNOWN. A call site that
  -- cannot know a count must leave it NULL — writing 0 would say "we checked and
  -- found none" when the truth is "we never looked", which is exactly the
  -- confusion this ledger exists to end.
  raw_count integer,
  normalized_count integer,
  unique_count integer,
  accepted_count integer,
  rejected_count integer,

  -- COST. Two columns, never merged. `actual_cost_usd` is written only when the
  -- provider reported a figure; an estimate lives in `estimated_cost_usd` and
  -- says so in `cost_source`. Existing Agentory-credit accounting is untouched
  -- and lives elsewhere.
  actual_cost_usd numeric(12,6),
  estimated_cost_usd numeric(12,6),
  cost_source text NOT NULL DEFAULT 'unknown',

  next_decision text,
  metadata jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_execution_calls_status_check
    CHECK (status IN ('started', 'succeeded', 'failed', 'timed_out', 'reused')),
  CONSTRAINT lead_execution_calls_cost_source_check
    CHECK (cost_source IN ('provider_reported', 'estimated', 'unknown')),
  -- An estimate may never be recorded as an actual figure.
  CONSTRAINT lead_execution_calls_actual_cost_requires_provider
    CHECK (actual_cost_usd IS NULL OR cost_source = 'provider_reported'),
  CONSTRAINT lead_execution_calls_attempt_positive
    CHECK (attempt_number >= 1)
);

-- ONE ROW PER ATTEMPT, ENFORCED. This is what makes "attempt 2 overwrote
-- attempt 1" impossible rather than merely unintended.
CREATE UNIQUE INDEX lead_execution_calls_attempt_uniq
  ON public.lead_execution_calls (workspace_id, logical_call_key, attempt_number);

-- The queries this table exists to serve: one task's story, and a workspace's
-- spend over time. Deliberately few — more indexes can follow real query shapes.
CREATE INDEX lead_execution_calls_task_idx
  ON public.lead_execution_calls (task_id, started_at);
CREATE INDEX lead_execution_calls_workspace_started_idx
  ON public.lead_execution_calls (workspace_id, started_at DESC);
CREATE INDEX lead_execution_calls_provider_idx
  ON public.lead_execution_calls (workspace_id, provider_id, started_at DESC);
-- Partial: unfinished and failed rows are the ones anyone goes looking for.
CREATE INDEX lead_execution_calls_unresolved_idx
  ON public.lead_execution_calls (workspace_id, status)
  WHERE status IN ('started', 'failed', 'timed_out');

GRANT SELECT ON public.lead_execution_calls TO authenticated;
GRANT ALL ON public.lead_execution_calls TO service_role;

ALTER TABLE public.lead_execution_calls ENABLE ROW LEVEL SECURITY;

-- READ-ONLY FOR MEMBERS, exactly like other execution telemetry. Writes come from
-- the Edge runtime under the service role; an authenticated client has no reason
-- to author an audit row, and letting it would make the ledger unreliable as
-- evidence.
CREATE POLICY "Members view lead_execution_calls"
  ON public.lead_execution_calls FOR SELECT TO authenticated
  USING (public.has_workspace_access(auth.uid(), workspace_id));

COMMENT ON TABLE public.lead_execution_calls IS
  'One row per external provider call. Written before the call returns so a failed run is diagnosable from state alone. Observability only: never consulted to decide provider, budget, retry, broadening, quota or qualification.';
COMMENT ON COLUMN public.lead_execution_calls.raw_count IS
  'NULL means unknown/not measured. 0 means measured as zero. The distinction is load-bearing.';
COMMENT ON COLUMN public.lead_execution_calls.actual_cost_usd IS
  'Only ever set when the provider reported a real figure (cost_source = provider_reported). Estimates live in estimated_cost_usd.';

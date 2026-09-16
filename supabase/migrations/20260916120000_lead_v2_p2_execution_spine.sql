-- LEAD V2 P2 — THE EXECUTION SPINE: PLAN VERSIONS, MISSION EVENTS, SPEC COLUMNS.
--
-- Applied to production 2026-09-16 with the P2 release. Additive and idempotent
-- (`if not exists` throughout). The engine still carries RetrievalPlan versions,
-- the spend ledger and the mission trace in
-- `tasks.result.capability_execution_state`, so continuations keep them; these
-- tables mirror them for querying (`_shared/p2SpinePersistence.ts`). The full
-- ProviderCallSpec is persisted in `lead_execution_calls.request_input`.

-- ── RetrievalPlan versions (immutable) ──────────────────────────────────────
create table if not exists public.lead_plan_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lineage_id uuid not null,
  plan_id text not null,
  version integer not null check (version >= 1),
  mission_hash text not null,
  content_hash text not null,
  created_by text not null check (created_by in ('retrieval_planner', 'amendment')),
  amendment_trigger text,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, lineage_id, plan_id, version)
);
alter table public.lead_plan_versions enable row level security;
revoke all on public.lead_plan_versions from anon, authenticated;

-- ── Mission trace (append-only) ─────────────────────────────────────────────
create table if not exists public.lead_mission_events (
  id bigserial primary key,
  workspace_id uuid not null,
  lineage_id uuid not null,
  seq integer not null,
  event_type text not null,
  plan_version integer,
  provider_call_id text,
  idempotency_key text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, lineage_id, seq)
);
alter table public.lead_mission_events enable row level security;
revoke all on public.lead_mission_events from anon, authenticated;

-- ── ProviderCallSpec identity and settlement on the ledger ─────────────────
alter table public.lead_execution_calls
  add column if not exists provider_call_id text,
  add column if not exists idempotency_key text,
  add column if not exists plan_version integer,
  add column if not exists route_id text,
  add column if not exists settled_usd numeric,
  add column if not exists settlement_source text,
  add column if not exists variance_usd numeric;

do $$ begin
  alter table public.lead_execution_calls
    add constraint lead_execution_calls_settlement_source_chk
    check (settlement_source is null or settlement_source in ('provider_receipt', 'derived_floor'));
exception when duplicate_object then null; end $$;

-- NOT UNIQUE, deliberately. The ledger row is written when a call STARTS, so a
-- unique index cannot prevent a purchase — it could only make the ledger drop
-- the row that proves one happened. The engine's spend ledger refuses a second
-- reservation for a key; this index makes checking that a cheap query.
create index if not exists lead_execution_calls_idempotency_idx
  on public.lead_execution_calls (workspace_id, idempotency_key)
  where idempotency_key is not null;

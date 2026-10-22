-- REVIEW ONLY. NOT A RUNNABLE/APPROVED MIGRATION. Do not copy to migrations yet.
-- Intentionally supplies NO application grants, API policies, writer RPC or adapter.
-- Apply nothing until native prerequisites and the separate transaction code are reviewed.
-- Uses existing public.tasks/public.workspaces/auth.users; confirm catalog first.
begin;
create schema outpost_private;
revoke all on schema outpost_private from public, anon, authenticated, service_role;
alter default privileges in schema outpost_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema outpost_private revoke execute on functions from public, anon, authenticated, service_role;

-- One stable client per workspace. Identity replacement is a new enrollment, never an UPDATE.
create table outpost_private.clients (
  workspace_id uuid primary key references public.workspaces(id) on delete restrict,
  client_binding_id uuid not null unique,
  seller_domain text not null check (length(seller_domain) between 1 and 253),
  enrollment_version integer not null check (enrollment_version > 0),
  enabled boolean not null default false check (enabled = false),
  unique (workspace_id, client_binding_id)
);
-- Security MUST additionally prove workspace/actor/status against public.tasks
-- under a shared lock in the future authorized registration transaction. An id-only
-- public.tasks FK does not prove workspace ownership; this scaffold cannot enable work.
create table outpost_private.task_bindings (
  workspace_id uuid not null,
  client_binding_id uuid not null,
  task_id uuid not null unique references public.tasks(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  authorization_epoch bigint not null check (authorization_epoch >= 0),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  primary key (workspace_id, client_binding_id, task_id),
  unique (workspace_id, client_binding_id, task_id, actor_id),
  foreign key (workspace_id, client_binding_id)
    references outpost_private.clients(workspace_id, client_binding_id) on delete restrict
);
-- Canonical bytes use the existing TS canonical() contract, NOT jsonb::text.
-- Hash validation/size bounds must run in the future trusted writer, and a native
-- digest function must first prove equality to TS over Unicode/number fixtures.
create table outpost_private.snapshots (
  workspace_id uuid not null, client_binding_id uuid not null,
  task_id uuid not null, actor_id uuid not null,
  packet_hash text not null check (packet_hash ~ '^[0-9a-f]{64}$'),
  version text not null check (version = 'pilot_context_packet_v2'),
  canonical_packet text not null check (octet_length(canonical_packet) <= 256000),
  packet jsonb not null,
  created_at timestamptz not null default transaction_timestamp(),
  primary key (workspace_id, client_binding_id, task_id),
  unique (workspace_id, client_binding_id, task_id, actor_id, packet_hash),
  check (canonical_packet::jsonb = packet),
  check ((packet->>'workspace_id' = workspace_id::text and packet->>'client_binding_id' = client_binding_id::text
    and packet->>'task_id' = task_id::text and packet->>'actor_id' = actor_id::text
    and packet->>'packet_hash' = packet_hash and packet->>'version' = version) is true),
  check (packet ?& array['workspace_id','client_binding_id','task_id','actor_id','packet_hash','version']),
  foreign key (workspace_id, client_binding_id, task_id, actor_id)
    references outpost_private.task_bindings(workspace_id, client_binding_id, task_id, actor_id) on delete restrict
);
create table outpost_private.briefs (
  workspace_id uuid not null, client_binding_id uuid not null,
  task_id uuid not null, actor_id uuid not null,
  packet_hash text not null, draft_hash text not null check (draft_hash ~ '^[0-9a-f]{64}$'),
  model_attempt_id text not null, -- reconcile to the EXISTING ledger identity; do not invent a parallel ledger
  canonical_draft text not null check (octet_length(canonical_draft) <= 256000),
  created_at timestamptz not null default transaction_timestamp(),
  primary key (workspace_id, client_binding_id, task_id),
  unique (workspace_id, client_binding_id, task_id, actor_id, packet_hash, draft_hash),
  foreign key (workspace_id, client_binding_id, task_id, actor_id, packet_hash)
    references outpost_private.snapshots(workspace_id, client_binding_id, task_id, actor_id, packet_hash) on delete restrict
);
-- Global idempotency header: durable across every task in a multi-row export.
create table outpost_private.operations (
  workspace_id uuid not null, client_binding_id uuid not null, actor_id uuid not null,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null,
  created_at timestamptz not null default transaction_timestamp(),
  primary key (workspace_id, client_binding_id, actor_id, operation_id),
  foreign key (workspace_id, client_binding_id)
    references outpost_private.clients(workspace_id, client_binding_id) on delete restrict
);
create table outpost_private.artifact_events (
  workspace_id uuid not null, client_binding_id uuid not null,
  task_id uuid not null, actor_id uuid not null,
  packet_hash text not null, draft_hash text not null,
  operation_id uuid not null,
  sequence integer not null check (sequence between 1 and 64),
  previous_hash text check (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('edit','approve','reject','export_prepared')),
  canonical_event text not null check (octet_length(canonical_event) <= 256000),
  created_at timestamptz not null default transaction_timestamp(),
  primary key (workspace_id, client_binding_id, task_id, sequence),
  unique (workspace_id, client_binding_id, task_id, event_hash),
  check ((sequence = 1 and previous_hash is null) or (sequence > 1 and previous_hash is not null)),
  foreign key (workspace_id, client_binding_id, task_id, actor_id, packet_hash, draft_hash)
    references outpost_private.briefs(workspace_id, client_binding_id, task_id, actor_id, packet_hash, draft_hash) on delete restrict,
  foreign key (workspace_id, client_binding_id, actor_id, operation_id)
    references outpost_private.operations(workspace_id, client_binding_id, actor_id, operation_id)
    on delete restrict deferrable initially deferred
);
-- No SELECT policy is deliberately created: all app-role access is denied until
-- the separately reviewed session-aware transaction interface exists.
alter table outpost_private.clients enable row level security;
alter table outpost_private.task_bindings enable row level security;
alter table outpost_private.snapshots enable row level security;
alter table outpost_private.briefs enable row level security;
alter table outpost_private.operations enable row level security;
alter table outpost_private.artifact_events enable row level security;
alter table outpost_private.clients force row level security;
alter table outpost_private.task_bindings force row level security;
alter table outpost_private.snapshots force row level security;
alter table outpost_private.briefs force row level security;
alter table outpost_private.operations force row level security;
alter table outpost_private.artifact_events force row level security;
revoke all on all tables in schema outpost_private from public, anon, authenticated, service_role;

-- Even a future writer gets INSERT only. Retention must use separately approved,
-- audited tooling; no silent rollback/truncation of history.
create function outpost_private.deny_mutation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'outpost append-only data' using errcode = '42501';
end;
$$;
revoke all on function outpost_private.deny_mutation() from public, anon, authenticated, service_role;
create trigger clients_immutable before update or delete on outpost_private.clients
  for each row execute function outpost_private.deny_mutation();
create trigger bindings_immutable before update or delete on outpost_private.task_bindings
  for each row execute function outpost_private.deny_mutation();
create trigger snapshots_immutable before update or delete on outpost_private.snapshots
  for each row execute function outpost_private.deny_mutation();
create trigger briefs_immutable before update or delete on outpost_private.briefs
  for each row execute function outpost_private.deny_mutation();
create trigger operations_immutable before update or delete on outpost_private.operations
  for each row execute function outpost_private.deny_mutation();
create trigger events_immutable before update or delete on outpost_private.artifact_events
  for each row execute function outpost_private.deny_mutation();
commit;

-- STOP. This is an inaccessible scaffold, not the native adapter or authorization.
-- No apply/down execution was performed, including against a disposable database.

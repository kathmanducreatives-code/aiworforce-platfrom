# P3 persistence proposal — separate approval required

**INERT DESIGN ONLY. NOT A MIGRATION. NOT INSTALLED. NATIVE TESTS NOT RUN.**
Do not copy this into an enablement runbook. The preview PR intentionally stops
before persistence. This specifies the proposed migration core and native
acceptance suite for a later reviewed PR; it is not a certified complete schema.

## Dependencies before authoring an installable migration

1. Establish actual deployed grants/policies/migration state without customer
   data. Approve a disposable local database bootstrap. Do not bootstrap from
   production or install held migrations in a hosted environment.
2. Fix native membership authority and same-workspace immutable ownership across
   P1/P2 records. The broad baseline `members_self_insert` policy must not grant
   a stranger authority merely because application guards see a membership row.
3. Agree durable operator-owned enrollment, revocation/locking semantics and
   client/workspace immutability. No user-created enrollment or self-reassignment.
4. Prove legacy-executor containment. CSV import must not create legacy tasks,
   qualified leads, sequences, model requests, queue entries or notices.
5. Agree an actual Apollo export contract. Missing source IDs stay provisional;
   no automatic name/domain-only linking or update to existing accounts/contacts.

## Proposed migration core (reviewable SQL, deliberately documentation only)

Use a private, non-exposed schema; a future trusted server adapter performs exact
scoped access. Direct anon/authenticated table access stays revoked, not merely
hidden in UI. RLS remains defense in depth. Do not expose a SECURITY DEFINER
import RPC to PUBLIC/anon/authenticated. Native service-role bypass is not an
end-user permission; the adapter must authenticate and reauthorize the original
user through P1 on every commit/read/retry.

```sql
-- PROPOSAL ONLY: names, bootstrap and policy adoption need separate review.
create schema if not exists pilot_private;
revoke all on schema pilot_private from public, anon, authenticated;
grant usage on schema pilot_private to service_role;

create table pilot_private.client_workspaces (
  workspace_id uuid primary key references public.workspaces(id),
  client_binding_id uuid not null unique,
  policy_version integer not null check (policy_version > 0),
  seller_domain text not null,
  mode text not null default 'draft_only' check (mode = 'draft_only'),
  enabled boolean not null default false,
  unique (workspace_id, client_binding_id, policy_version)
);

create table pilot_private.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_binding_id uuid not null,
  policy_version integer not null,
  initiated_by uuid not null references auth.users(id),
  request_key uuid not null,
  source_kind text not null check (source_kind = 'apollo_export_declared_unverified'),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  normalized_batch_hash text not null check (normalized_batch_hash ~ '^[0-9a-f]{64}$'),
  header_mapping jsonb not null check (jsonb_typeof(header_mapping) = 'object'),
  omitted_headers jsonb not null check (jsonb_typeof(omitted_headers) = 'array'),
  input_rows integer not null check (input_rows between 1 and 25),
  distinct_rows integer not null check (distinct_rows between 1 and input_rows),
  created_at timestamptz not null default now(), -- receipt time, NEVER source time
  foreign key (workspace_id, client_binding_id, policy_version)
    references pilot_private.client_workspaces(workspace_id, client_binding_id, policy_version),
  unique (workspace_id, client_binding_id, id),
  unique (workspace_id, client_binding_id, initiated_by, request_key)
);

create table pilot_private.import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_binding_id uuid not null,
  batch_id uuid not null,
  normalized_hash text not null check (normalized_hash ~ '^[0-9a-f]{64}$'),
  source_rows integer[] not null,
  apollo_contact_id text,
  apollo_account_id text,
  source_list_id text,
  source_updated_at timestamptz, -- supplied source claim; nullable, not upload time
  normalized_input jsonb not null check (jsonb_typeof(normalized_input) = 'object'),
  status text not null default 'unverified' check (status = 'unverified'),
  foreign key (workspace_id, client_binding_id, batch_id)
    references pilot_private.import_batches(workspace_id, client_binding_id, id),
  unique (workspace_id, client_binding_id, id),
  unique (workspace_id, client_binding_id, batch_id, normalized_hash),
  check (cardinality(source_rows) between 1 and 25),
  check (array_position(source_rows, null) is null),
  check (2 <= all(source_rows) and 26 >= all(source_rows))
);

alter table pilot_private.client_workspaces enable row level security;
alter table pilot_private.import_batches enable row level security;
alter table pilot_private.import_rows enable row level security;
-- No policies/grants for browser roles: default deny. No writable public view.
revoke all on all tables in schema pilot_private from public, anon, authenticated;
grant select on pilot_private.client_workspaces to service_role;
grant select, insert on pilot_private.import_batches, pilot_private.import_rows to service_role;
```

No automatic seed/enrollment, actor credentials or output destination is provided.
A separate operator role (not browser/service import adapter) must manage durable
client enrollment. That policy/role is a dependency, not an implicit privilege
in the SQL. Apollo IDs are not globally unique constraints: the same account or
contact may legitimately exist in several client workspaces and import batches.
No account/contact foreign keys are proposed until a separately approved strong
same-workspace identity linkage exists. Do not add global email/domain dedupe.

### Required additions to an installable migration

- Immutable workspace/client/actor/batch scope triggers, including owner/superuser
  writes. Enrollment client identity cannot be repurposed; new policy versions
  need version-history rows or a separately reviewed snapshot model. The core's
  composite policy FK makes referenced policy versions immutable while in use;
  **it is not a complete policy-version history design**.
- Enforce normalized JSON allowlist, field bounds, source ordinal uniqueness /
  disjointness, count/hash/row-set integrity, opaque ID rules and explicit
  admission version. Reject any embedded ownership/model/dispatch authority.
- Implement atomic admission through a narrowly privileged transaction, not
  multiple PostgREST inserts. Recompute validation/hashes from input server-side;
  never trust preview JSON or a preview hash supplied by the browser. Lock trusted
  enrollment and the original membership row through commit (or prove equivalent
  serializable behavior); verify active Brain identity and current original actor.
  Native membership revocation operations must participate in the chosen locks.
- Exactly one batch for `(workspace, client, actor, request_key)`: same canonical
  payload replays the existing batch; changed bytes/mapping/normalized payload
  under that key returns conflict; competing connections cannot produce partial
  duplicate batches. Roll back on any invalid row or authorization change.
- Explicitly define any later additional import of a previously seen source ID:
  report duplicates for human review; never silently overwrite prior snapshots.
  The preview does not certify this persistent replay contract.
- Scoped read adapter and P1 resource-kind extension with immutable snapshots;
  task binding must cover imported row IDs/hashes and original workspace. Existing
  P1 HMAC verification remains the only task scope authority. No pilot execution
  is added until native containment and later model/brief gates pass.

## Native tests to author/run after separate approval

Proposed test file areas: `tests/db-contract/pilotIsolation.contract.test.ts`,
`pilotImport.contract.test.ts`, `pilotImportConcurrency.contract.test.ts` and
`tests/edge-functions/pilotImportCommit.test.ts`. These files are **not created or
claimed passing in this preview PR**: no native schema/admission contract yet
exists. Use disposable local Postgres + local Auth/PostgREST only, synthetic A/B,
A-only, B-only, shared admin and nonmember. Do not use hosted credentials.

| ID | Reproducible test / expected assertion |
| --- | --- |
| N01 | Query `pg_policies`, `information_schema.role_table_grants`, `pg_proc` and `pg_constraint`; compare exact approved policy/grant/definer/FK inventory. Fail on drift, exposed private schema or unauthorized RPC execution. |
| N02 | Under each JWT/SQL role try self-insert membership into B as owner/admin, role escalation, forged enrollment, Brain ownership move and signed-binding-field/task creator writes. Must fail before application guards are consulted. Existing legitimate provisioning remains positive control. |
| N03 | A-only token/role SELECT/INSERT/UPDATE/DELETE B's Brain, memory, drafts, research, contacts, accounts, lead/evidence/lineage, tasks/payload/results and imports via SQL/PostgREST/RPC/views. Zero B content or mutation. Shared user can deliberately authorize A or B, but cannot move an existing object's scope. |
| N04 | Insert A contact with B account, A draft with B contact/lead, A task with B plan/agent and A import row referencing B batch, even as shared user/service. Composite constraint or immutable-scope rejection, no orphan partial write. |
| N05 | Same external contact/account ID/email/domain in A/B remains independent. Missing source IDs remain provisional; duplicate account across two contacts is valid. No cross-client lookup/link/overwrite. |
| N06 | Identical confirm request twice and concurrently on two connections yields one batch/row-set. Changed file bytes/mapping/normalized content under same key conflicts. Same data under another workspace is independent. |
| N07 | Inject failure after batch insert / after one row / before commit; transaction rollback leaves no batch, row, task, lead, queue or provider receipt. Retry creates one complete batch. |
| N08 | Revoke actor / change role / enrollment policy / Brain identity at barriers before reads, after validation and before commit. Prove documented lock/serialization order with two connections and bounded timeouts. A committed transaction must have authorized linearization; an admission observing revocation must fail. |
| N09 | Concurrent parent delete/move, task creator/payload change and competing bind: no accepted stale signed binding; zero partial state. Never represent a mocked final recheck as this proof. |
| N10 | Attempt raw API insert with forged normalized hash, hidden JSON scope, foreign actor, bad row ordinal, false counts, missing identity or status=qualified. Native constraints/trusted transaction reject; direct authenticated private-table access always denied. |
| N11 | Copy preview receipt into commit with another user/workspace/client/file; recomputation/current authorization reject. Source timestamp stays null/actual, created_at is never promoted to event time. |
| N12 | Retry/resume bound task after scope switch/revocation; copied MAC, resource expansion or foreign import snapshot fails P1. No alternate executor trusts preview scope/hash. |
| N13 | Pilot tasks injected through legacy submit, approval/continuation, scheduling, retry/resume, queue/worker and run-agent are rejected or contained by the approved signed adapter. No model/provider/external-send call occurs. |
| N14 | Permissions and direct Data API attacks against the exact bootstrap schema plus active changes; re-run under real PostgREST response/transaction behavior, not in-memory query emulation. |

Example native constraint test pattern (future bootstrap only):

```sql
begin;
-- Test runner seeds synthetic A/B enrollments and a B batch as trusted setup.
-- Savepoint expected_failure; insert import_rows with A workspace/client and B batch_id;
-- Assert SQLSTATE 23503; rollback to savepoint.
-- Repeat under anon/authenticated: schema/table access must fail SQLSTATE 42501.
-- As shared user attempt workspace/client UPDATE: privilege or immutable-scope failure.
rollback;
```

Concurrency tests need **two actual connections**, explicit barriers, bounded
lock timeouts, a lock/commit receipt and inspection after both complete. One
sequential SQL script or `Promise.all` over a mocked fetch is insufficient.
Release admission is blocked until these native tests, P1/P2 isolation gates and
separate enablement approval exist. No sends, AI calls, Apollo API, deployments
or A7 belong to this migration/test proposal.

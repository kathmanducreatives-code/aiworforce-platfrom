# Canonical client, grant and client-Brain contract (Company Brain Phase 3c)

**Status: PROPOSAL for approval. Not implemented, no migration exists.**

- **Agreed:** A1–A6 were agreed by Codex (#166).
- **This document:** delivers the A7 amendment Codex asked for (grant generations, permission-reduction visibility, lock order) and the exact schema/API, so the Codex pilot FK successor and Backend descendant work can be built against one contract.
- **Owner decisions in force:**
  - P3-D1: roles are owner/admin/editor/viewer.
  - P3-D2: dedicated client tables.
  - P3-D3: an explicit client grant for **every** role, owner and admin included.

## 1. Responsibility boundaries

| Area | Owner | Not owned (must not be duplicated) |
|---|---|---|
| `public.client_accounts`, `public.client_access_grants`, `public.client_company_brain`, their RLS, grant/archive writer functions, `client_brain_*` read/write API, the AUTH-06 writer pattern | **Company Brain** | n/a |
| `outpost_private.clients` → `client_accounts` composite FK successor, pilot adapters, same-workspace A/B native tests, one-client uniqueness until then | **Codex** | Brain does not edit pilot schema |
| Descendant parent integrity (OWN-01: `contacts.account_id` → `accounts` across workspaces), `client_id` on descendants, legacy/service pre-effect guards, executable task lifecycle | **Backend** (+ Codex for native acceptance) | Brain does not edit contacts/accounts or executors |

## 2. Schema (exact; one held migration once approved)

```sql
-- A1: the one canonical client parent.
create table public.client_accounts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete restrict,
  name          text not null check (length(btrim(name)) between 1 and 200),
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz,
  archived_by   uuid references auth.users(id),
  unique (workspace_id, id),                                   -- composite parent key for every child
  check ((status = 'archived') = (archived_at is not null))    -- consistent archive timestamp
);
-- Immutable identity: a trigger refuses any UPDATE of id/workspace_id/created_*,
-- and archived → active (archive is terminal; a new client is a new row).

-- A3/A7: grants are append-only generations.
create table public.client_access_grants (
  id            uuid primary key default gen_random_uuid(),    -- stable grant identity
  workspace_id  uuid not null,
  client_id     uuid not null,
  user_id       uuid not null references auth.users(id),
  generation    integer not null check (generation >= 1),      -- 1, 2, 3 … per (client, user)
  granted_by    uuid not null references auth.users(id),       -- the authenticated principal, never request data
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id),
  revoke_reason text check (revoke_reason in ('revoked', 'membership_removed', 'client_archived')),
  foreign key (workspace_id, client_id) references public.client_accounts (workspace_id, id) on delete restrict,
  unique (workspace_id, client_id, user_id, generation),
  check ((revoked_at is null) = (revoked_by is null and revoke_reason is null))
);
create unique index client_access_grants_one_active
  on public.client_access_grants (workspace_id, client_id, user_id) where revoked_at is null;
-- Terminal revocation: a trigger refuses clearing revoked_at, changing it once
-- set, or changing any identity column. Re-grant = INSERT generation max+1;
-- an old generation can never be revived.

-- Permission-reduction visibility (A7): a monotonic revision on the membership.
alter table public.workspace_members add column permission_revision bigint not null default 1;
-- Trigger: any UPDATE that changes role increments permission_revision.
-- DELETE needs no revision: the row's absence is the signal.

-- A5: the client's Company Brain (the agency Brain stays in company_brain).
create table public.client_company_brain (
  workspace_id            uuid not null,
  client_id               uuid not null,
  profile                 jsonb not null default '{}'::jsonb,
  version                 bigint not null default 1,          -- every successful write +1 (incl. approval/activation)
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users(id),
  onboarding_completed    boolean not null default false,
  onboarding_completed_at timestamptz,
  primary key (workspace_id, client_id),
  foreign key (workspace_id, client_id) references public.client_accounts (workspace_id, id) on delete restrict
);
```

**RLS and grants:**
- RLS is on for all three tables.
- **No browser INSERT/UPDATE/DELETE/TRUNCATE**, the same as `company_brain` after #169.
- Browser SELECT:
  - `client_accounts`: members see client ids and names (open question O1);
  - `client_access_grants`: your own rows, plus all rows for owner/admin;
  - `client_company_brain`: only via the role ∧ active-grant rule (§4).
- Every write goes through the SECURITY DEFINER functions in §3 (fixed `search_path`, EXECUTE for `service_role` only).

## 3. Writer functions (all re-authorize in their own transaction, as AUTH-06)

| Function | Who | Effect |
|---|---|---|
| `client_account_create(ws, actor, session, name)` | owner/admin | inserts an active client |
| `client_account_archive(ws, client, actor, session)` | owner/admin | archives the client **and** revokes every active grant (`client_archived`) in the same transaction |
| `client_access_grant(ws, client, target_user, actor, session)` | owner/admin; self-grant allowed and audited (A4) | the target must be a current same-workspace member and the client active; inserts generation max+1; `granted_by = actor` |
| `client_access_revoke(ws, client, target_user, actor, session)` | owner/admin | sets `revoked_at` on the active generation (terminal) |
| `workspace_member_remove(...)` / role change | the existing membership owner path | also revokes that user's active grants (`membership_removed`), in the same transaction; a role change bumps `permission_revision` (trigger) |
| `client_brain_authorized_write(ws, client, actor, session, intent, permission, mode, profile, expected_version, pinned_grant_id?, pinned_generation?, pinned_revision?)` | role ∧ active grant | CAS on `version`; returns `ok` / `session_invalid` / `not_member` / `forbidden_role` / `no_grant` / `client_archived` / `grant_changed` / `permission_changed` / `stale` / `client_context_required` |
| `client_brain_read(ws, client, actor, session, intent)` | role ∧ active grant | the profile and version; no fallback |

## 4. Authorization rule and invariants

**Effective right on client C** = a live session ∧ a current membership with a sufficient role ∧ client C active ∧ an active grant for (C, actor). Read: any role with a grant. Edit: owner/admin/editor with a grant. Activate: owner/admin with a grant.

| # | Invariant |
|---|---|
| I1 | No fallback. `intent = 'client_task'` with a null `client_id` → `client_context_required`; never agency scope, the first or latest client, or membership order. |
| I2 | The agency Brain (`company_brain`) is never returned for a client scope, and a client Brain never for an agency scope. |
| I3 | Owner/admin get **no** implicit client data access (P3-D3); managing clients and grants is separate from reading them. |
| I4 | Revocation is terminal per generation; re-grant creates a new generation; a consumer pinned to `(grant_id, generation)` is refused after revoke even if a newer generation exists (`grant_changed`). |
| I5 | Permission reductions are observable: a consumer pinning `permission_revision` is refused if the revision moved (`permission_changed`); membership deletion → `not_member`. |
| I6 | A pinned Brain `version` is **content**, never authorization (Codex A5); authorization is re-evaluated live at every read and at commit. |
| I7 | Client archive denies all access immediately and revokes all its grants atomically. |
| I8 | Every check runs in the writer's transaction under the lock order in §5; model/external work stays outside and is re-authorized at commit. |
| I9 | Browser roles can neither write these tables nor call the writer functions. |

## 5. Lock order (A7, one global order)

Every consumer that needs a consistent decision takes these locks **in this order**, skipping the levels it doesn't use; every revocation writer locks only levels at or below its own:

1. `auth.sessions` row: consumers FOR SHARE; GoTrue logout deletes.
2. `public.workspace_members` row: consumers FOR SHARE; removal or role change takes the row lock.
3. `public.client_accounts` row: consumers FOR SHARE; archive FOR UPDATE.
4. `public.client_access_grants` active row: consumers FOR SHARE; revoke FOR UPDATE.
5. The target data row, e.g. `client_company_brain`: FOR UPDATE / CAS.

**No deadlock:**
- Membership removal locks 2 then 4.
- Archive locks 3 then 4.
- Revoke locks 4.
- Every chain follows the same direction, and none locks a lower number after a higher one.

This is the pattern AUTH-06 already uses (levels 1, 2, 5) and has proven with held-revocation races.

## 6. Acceptance (red before green, native)

**Two clients A and B in one agency workspace**, with different Brains and overlapping external ids.

**Actors:**
- owner and admin, each with no grant, a grant for A only, and grants for both;
- editor and viewer with a grant for A;
- a revoked user;
- a regranted user;
- a foreign member;
- anon.

**What must hold:**
- each actor gets exactly its effective right;
- `client_context_required` with a null client;
- the agency Brain is never returned for a client;
- a held-revocation race on each of levels 1–4;
- revoke → regrant (the old pin is refused);
- archive (all access is refused);
- CAS with two writers;
- every refusal leaves SQL unchanged and makes zero write requests;
- a mutation proof per lock and per rule.

Codex supplies the pilot-side A/B native tests. Backend supplies descendant-route acceptance (OWN-01 and pre-effect guards).

## 7. Open questions (need an answer before the migration is written)

- **O1:** May members without a grant see client **names** (not data) in `client_accounts`? Proposal: yes, names only, so the switcher can show "no access".
- **O2:** Should a role change revoke grants, or only bump `permission_revision`? Proposal: bump only; grants stay, and the role still gates edit/activate live.
- **O3 (Backend):** confirm `workspace_member_remove` is the single membership writer the grant revoke hooks into. Today there is no browser membership writer at all (#159).

# Canonical client, grant and client-Brain contract (Company Brain Phase 3c)

**Status: v2 PROPOSAL for approval.** A held implementation exists for review (`feat/client-brain-3c`, `supabase/migrations-held/`). It is not in `supabase/migrations/`, not applied anywhere hosted and not called by any deployed handler.

- **Agreed:** A1–A6 by Codex (#166).
- **v1 → v2:** incorporates Codex's independent review of v1 (#174, comment 6385838606):
  - O1 and O2 are resolved with Codex's conservative rules, which Brain accepts;
  - the lock and outcome details the implementation pinned down;
  - the §6 evidence clarification.
- **Still open:**
  - O3 (Backend);
  - O4 (Backend + Codex, new);
  - owner approval of the whole contract.
- **Owner decisions in force:**
  - P3-D1: roles are owner/admin/editor/viewer;
  - P3-D2: dedicated client tables;
  - P3-D3: an explicit client grant for **every** role, owner and admin included.

## 1. Responsibility boundaries (accepted by Codex)

| Area | Owner | Not owned (must not be duplicated) |
|---|---|---|
| `client_accounts`, `client_access_grants`, `client_company_brain`, their RLS, the grant hooks on `workspace_members`, grant/archive writers, the `client_brain_*` API, the AUTH-06 writer pattern | **Company Brain** | n/a |
| `outpost_private.clients` → `client_accounts` composite FK successor, pilot adapters, independent native acceptance | **Codex** | Brain does not edit pilot schema |
| OWN-01 descendant parent integrity, `client_id` on descendants, legacy/service pre-effect guards, the executable task lifecycle and how tasks consume pins, the membership removal/role writer routes | **Backend** (+ Codex for native acceptance) | Brain does not edit contacts/accounts, executors or member routes |

## 2. Schema

The exact DDL is `supabase/migrations-held/20261024160000_client_company_brain.sql`. Its essentials:

**`client_accounts`**
- Columns: `id`, `workspace_id → workspaces (restrict)`, `name` (1–200), `status` (`active` | `archived`), `created_by`, `archived_at`, `archived_by`.
- `unique (workspace_id, id)`: the composite parent key for every child.
- **Immutable identity:** a trigger refuses changes to `id`, `workspace_id`, `created_*`.
- **Terminal archive:** `archived → active` is refused.

**`client_access_grants`**
- Append-only generations: `(workspace_id, client_id, user_id, generation)` unique, plus a unique partial index allowing one active row per (client, user).
- Composite FK to `client_accounts`.
- **No FK to the membership:** the history must outlive a removal.
- A trigger refuses DELETE, any identity change, and any change after revocation; the only permitted update is active → revoked.
- `revoke_reason` is one of `revoked` | `membership_removed` | `client_archived`.
- `revoked_by` is required for `revoked`, and null when a membership removal has no actor (v2 change).

**`workspace_members.permission_revision`** (Codex O2)
- Values come from **one global sequence**. A trigger assigns a fresh value on every INSERT and every role change.
- A trigger also blocks setting it by hand and blocks changing a membership's `id`/`workspace_id`/`user_id`.
- Because the sequence never repeats, a remove → rejoin can never present an old revision, even though the row is new. This is the "durable membership incarnation" Codex asked for, without a second column.

**`client_company_brain`**
- Columns: `(workspace_id, client_id)` PK with a composite FK, `profile`, `version` bigint (+1 on every write), `updated_by`, onboarding columns.
- The agency Brain stays in `company_brain` and no client code touches it.

**RLS and privileges**
- RLS is on for all three tables.
- No INSERT/UPDATE/DELETE/TRUNCATE for `anon`, `authenticated`, **or `service_role`**. Every write is a SECURITY DEFINER function (v2: service code cannot bypass the writers either).
- Browser SELECT (O1, Codex's rule):
  - `client_accounts`: only the active clients the member currently holds an active grant for. **No enumeration of ungranted clients by ordinary members.**
  - `client_access_grants`: your own rows, while you are a member.
  - `client_company_brain`: **none** (v2). Client Brains are read only through `client_brain_read`.

## 3. Functions (all `security definer`, `search_path = ''`, EXECUTE for `service_role` only)

| Function | Who | Effect / outcomes |
|---|---|---|
| `client_brain_authorization(ws, client, actor, session, permission, intent, pins…)` STABLE | n/a | THE rule. Used as a GET pre-check, and re-run by the writer after its locks |
| `client_brain_read(ws, client, actor, session, intent, pins…)` STABLE | read permission ∧ grant | One statement, one snapshot. A granted client with no Brain yet returns `ok` + null profile (never the agency's) |
| `client_brain_pin(ws, client, actor, session, permission)` STABLE | as read | Returns `(grant_id, generation, permission_revision)` for a task to record |
| `client_brain_authorized_write(ws, client, actor, session, permission, intent, mode, profile, expected_version, activate, pins…)` | edit: owner/admin/editor ∧ grant; activate: owner/admin ∧ grant | Locks 1→4, re-applies the rule, then `cas` on `version` or `insert`. No blind upsert. A concurrent edit is `stale` |
| `client_account_create(ws, actor, session, name)` | owner/admin | Does **not** grant the creator (P3-D3) |
| `client_account_archive(ws, client, actor, session)` | owner/admin | Archives and revokes every active grant (`client_archived`) in one transaction |
| `client_access_grant(ws, client, target, actor, session)` | owner/admin. Self-grant is allowed, recorded with `granted_by = actor` (A4) | The target must be a current member, the client active. Inserts generation max+1, or returns `already_granted` |
| `client_access_revoke(ws, client, target, actor, session)` | owner/admin | Terminal revoke of the active generation, or `not_granted` |
| `client_account_manage_list(ws, actor, session)` STABLE | owner/admin | The **management listing** (O1): names, status and active-grant counts. Never a switcher, never data access |
| `client_accounts_for_actor(ws, actor, session)` STABLE | any member | The **switcher**: only the actor's actively granted, active clients |

**Membership hook (O3, see §7):** a trigger `AFTER DELETE ON workspace_members` terminally revokes that user's active grants (`membership_removed`) in the deleting transaction. It fires for **any** writer: a future member-remove route, a service path, direct SQL, a workspace cascade.

**Refusal outcomes:** `session_invalid`, `not_member`, `forbidden_role`, `no_grant`, `client_archived`, `grant_changed`, `permission_changed`, `client_context_required`.
- **No existence oracle (O1):** an unknown client, a client of another workspace, and a client the actor was never granted all return `no_grant`. `client_archived` is reported only to an actor who held a grant on that client.
- **Interactive vs task (O2):**
  - `intent = 'interactive'`: a user's own request; pins must be absent.
  - `intent = 'task'`: **must** pass all three pins. A missing pin is an error, so a task consumer cannot omit them.
  - A task is refused with `grant_changed` if its pinned grant is not the active one: revoked, or revoked then regranted.
  - It is refused with `permission_changed` if the revision moved: any role change (demote → promote included), or a remove → rejoin.

## 4. Authorization rule and invariants

**Effective right on client C** = a live session ∧ a current membership with a sufficient role ∧ client C active ∧ an active grant for (C, actor). For a task, the pinned grant id + generation + permission revision must also be unchanged.
- **Read:** any member role with a grant.
- **Edit:** owner/admin/editor with a grant.
- **Activate:** owner/admin with a grant.

| # | Invariant | Proven by (`tests/db-contract/clientCompanyBrain.contract.test.ts`) |
|---|---|---|
| I1 | No fallback: a null client gives `client_context_required`, never agency scope or a first/latest client | test 8; mutation proof |
| I2 | The agency Brain is never returned or written for a client scope, nor a client Brain for the agency scope | test 10; source pin |
| I3 | Owner/admin get no implicit client data access; management is separate | test 3 |
| I4 | Revocation is terminal; a regrant is a new generation; an old pin is refused after regrant | test 5; mutation proof |
| I5 | Permission reductions are observable through `permission_revision`; a removal revokes grants atomically | tests 6, 6b; mutation proofs |
| I6 | `version` is content, never authorization | tests 9, 11 |
| I7 | Archive denies everything immediately and revokes all its grants atomically | test 7; mutation proof |
| I8 | Every check runs in the writer's transaction under the §5 lock order; model/external work stays outside and is re-authorized at commit | race tests 4, 6, 6b, 6c, 7; mutation proofs |
| I9 | Browser roles, and the service role directly, cannot write these tables; browsers cannot call the functions | test 12 |

## 5. Lock order

Consumers take these locks **in this order**, skipping levels they don't use, and never lock a lower level after a higher one:

1. `auth.sessions` row: consumers FOR SHARE; GoTrue logout deletes.
2. `workspace_members` row(s): consumers FOR SHARE.
   - Grant/revoke lock the **actor and target** rows FOR NO KEY UPDATE, **in `user_id` order, in one statement**. Locking the target's row serializes generation allocation even when no grant row exists yet, and waits for any in-flight Brain write by that user. There is no share → update upgrade.
   - Removal or role change takes the row lock.
3. `client_accounts` row: consumers FOR SHARE; archive FOR UPDATE.
4. `client_access_grants` active row: consumers FOR SHARE; revoke FOR UPDATE; the removal hook and archive update.
5. `client_company_brain` row: CAS / insert.

**Chains:**
- Removal: 2 → 4.
- Archive: 3 → 4.
- Grant/revoke: 2 → 3 → 4.
- Client Brain write: 1 → 2 → 3 → 4 → 5.
- AUTH-06 agency write: 1 → 2 → `company_brain`.

**Scope of the deadlock claim:** it covers only the Brain-owned writers above.
- A native test drives grant, revoke, archive, removal and writes concurrently on overlapping rows, and finds no deadlock and no failed writer. That is evidence, not a proof of universal deadlock freedom.
- The client and grant locks back each other up against archive (archive also revokes every grant row). The mutation proof therefore removes them together.
- Codex's held pilot #171 registration locks task → enrollment → membership → session. That is not yet this order. Codex will align its successor once the shared writers are final.

## 6. Acceptance and evidence

- **Native scenarios (all in the held test file, all passing):**
  - two clients A and B in one workspace, with overlapping external ids;
  - a user granted only A;
  - owner/admin without grants, and an audited self-grant;
  - revoke in flight; revoke → regrant (old pin refused); demote in flight; demote → promote (old pin refused); removal in flight with grants revoked; remove → rejoin → regrant (old pins refused); logout in flight; archive in flight;
  - a missing client;
  - cross-client and cross-workspace ids;
  - agency vs client isolation, including agent context;
  - two-writer CAS;
  - no browser or direct service writes;
  - concurrent grant serialization and mixed-traffic deadlock freedom.
- **Mutation proofs:** 12 — every lock, rule and hook the races rely on.
- **Held-revocation races:** the writer is **observed waiting on a lock in `pg_stat_activity`** (bounded deadline, a failure if never seen). This is an event, never a timeout taken as a pass (Codex LOCK-01).
- **Two kinds of "nothing happened" evidence (Codex §6):**
  - An **early refusal** (by the GET pre-check) sends **zero write requests** and changes no row.
  - A refusal **at the locked writer** (a revocation that commits between the pre-check and the write) sends **one** RPC that changes **zero rows**.
  - The tests assert each kind with its own evidence: the request log for the first, a fingerprint of every client, grant and Brain row, plus the agency Brain, for both. A request count never replaces the transaction evidence.
- **Codex** supplies the pilot-side A/B native tests and independent verification. **Backend** supplies descendant-route acceptance (OWN-01 and the pre-effect guards) and task pin consumption.

## 7. Questions

- **O1 — resolved (Codex's conservative rule, accepted by Brain):** ungranted ordinary members see no client ids or names. Owner/admin get a separate, explicitly authorized management listing that never implies data access or becomes a context fallback.
- **O2 — resolved (Codex's rule, accepted by Brain):**
  - every role change renews `permission_revision`;
  - active grants survive role changes, and the live role still gates actions;
  - membership DELETE terminally revokes all active grants in the same transaction;
  - delete → rejoin can never revive an old task: tasks must pin grant id, generation **and** revision, and the revision never repeats;
  - covered by the demote → promote and remove → rejoin → regrant tests.
- **O3 — open (Backend):**
  - **Brain's finding:** on today's code there is **no membership removal or role-change writer**. The only membership writers are `provision_workspace_for_user` and `handle_new_user` (inserts), and #159 closes browser writes.
  - The grant hooks are triggers, so they hold for any future writer.
  - **Backend, please confirm or correct:**
    - (a) where the member-remove and role-change routes will live, and that none uses `session_replication_role = replica` or another trigger-bypassing path;
    - (b) that an immutable membership identity (remove and re-add instead of re-pointing a row) is acceptable;
    - (c) that no service or admin route writes `workspace_members` outside these paths.
- **O4 — new (Backend + Codex):** the rule requires the actor's **live session** for task intent too.
  - So a stored client task resuming after the user logged out is refused (`session_invalid`).
  - That matches #166's original-session binding. A resumed task must pass its original session id along with its pins.
  - Confirm, or specify the durable task principal that replaces the session for background execution. Brain will not invent one.

## 8. Decisions for review: exact questions, options, recommendation (v2.1)

Nothing below is implemented beyond what §2–§3 already hold. Until each item is agreed, the held behaviour stays **fail-closed**.

### O3: the canonical membership removal and role-change writer (Backend)

**Today:** no code removes a member or changes a role; the only membership writers are the two provisioning inserts. The held schema's hooks are triggers, so they apply to any future writer.

| Option | What | Risk |
|---|---|---|
| **A (recommended)** | Backend adds one SECURITY DEFINER writer per action, e.g. `workspace_member_remove(ws, target, actor, session)` and `workspace_member_set_role(ws, target, role, actor, session)`. Each locks the actor's session (level 1), then the actor and target membership rows FOR UPDATE in `user_id` order (level 2), then deletes or updates. The held triggers revoke grants (level 4) and renew `permission_revision` in the same transaction | None beyond normal review; keeps one lock order |
| B | The writer revokes grants itself, with no triggers | Any other writer (service SQL, a future route) silently skips revocation. Not recommended |

**Questions for Backend:**
1. Option A or B? The function names and the module that owns them.
2. Who may remove or demote whom? For example: admins may not remove owners; the last owner can't be removed.
3. Confirm that no route uses `session_replication_role = replica`, TRUNCATE or COPY on `workspace_members`.
4. Confirm membership identity is immutable, so a "move" is remove + add. The held trigger refuses identity changes.

### O4: what a resumed background task presents (Backend + Codex)

**Held behaviour (kept until agreed):**
- `p_intent = 'task'` requires the actor's live original session **and** the three pins: grant id, generation and `permission_revision`.
- A task resuming after logout, session expiry, a revoke, a regrant, a role change or a remove → rejoin is refused.
- Brain will not add a bypass.

| Option | What | Trade-off |
|---|---|---|
| **A (recommended now)** | Keep the original-session requirement (matches #166's original-session binding) | Long tasks stop when the user logs out. That is safe, and the user can restart them |
| B | A durable, Backend-owned **task principal** recorded at enqueue while the session is live: `(task_id, actor, workspace, client, grant_id, generation, permission_revision, expires_at)`. A resume presents `task_id` instead of a session. The rule then checks: the principal exists, is unexpired and unrevoked; the actor is still a member with a sufficient role; the grant pin is the active generation; the revision is unchanged. A logout either revokes the actor's principals (B1) or doesn't (B2) | It survives logout (B2) but never a permission change. It needs a new Backend table, an expiry policy and Codex's native acceptance |
| C | A service or agency principal that runs regardless of the user | **Rejected:** a service credential is not user or client authorization (Codex A-series) |

**Questions:**
1. Is A enough for the pilot?
2. If not, should it be B1 or B2, with what maximum `expires_at`, and who owns the table? Backend, with Codex for acceptance. Brain would then add one rule variant, `p_intent = 'task'` with a principal id instead of a session, and nothing else.

### Pins in task storage (Backend)

Agreed semantics are §3/§4. **Question:** where Backend stores the pins. The proposal is task row columns `client_id`, `client_grant_id`, `client_grant_generation`, `permission_revision`, written once at authorization from `client_brain_pin`.

Every resume and retry path must pass them (Codex EXEC-01 / RETRY-01), and must never re-pin silently. A re-pin is a new user authorization.

### OWN-01 and descendants (Backend; for alignment)

**Proposal:**
- Every descendant row that belongs to a client carries `(workspace_id, client_id)` with a composite FK to `client_accounts (workspace_id, id)`.
- Contacts reference accounts by `(workspace_id, account_id)` → `accounts (workspace_id, id)`, which makes the cross-workspace contact → account case structurally impossible.
- Reads of client context go only through `_shared/clientBrain.ts`.

**Question:** does Backend accept the composite-FK approach, and in which migration order relative to this contract's held migration (the client tables must exist first)?

## 9. Interfaces Backend builds against (v2.2, after Backend's answers on #174)

**Agreed:**
- O3 option A;
- O4 option A (fail-closed) for the pilot;
- the pins as immutable `tasks` columns;
- composite FKs.

Below are the exact Brain-side calls. All are held in #176/#178, service-role only, and change nothing on refusal.

### 9.1 At authorization: record the pins (once)

`client_brain_pin(p_workspace_id, p_client_id, p_actor_id, p_session_id, p_permission)` → `(outcome, grant_id, generation, permission_revision)`.
- STABLE; call it as a GET.
- On `ok`, write all of these once on the task: `client_id`, `client_grant_id = grant_id`, `client_grant_generation = generation`, `permission_revision`, `origin_session_id = session_id`.
- On any other outcome, there is no task.
- TS: `pinClientBrain(admin, {workspaceId, clientId, actorId, sessionId}, permission)` in `_shared/clientBrain.ts`.

### 9.2 Before every effect of a resumed or retried client task

`client_brain_authorization(p_workspace_id, p_client_id, p_actor_id, p_session_id := origin_session_id, p_permission, p_intent := 'task', p_pin_grant_id, p_pin_generation, p_pin_revision)` → `'ok'` or a refusal.
- `task` intent without all three pins is a SQL error, never `ok`.
- **Refusals:** `session_invalid` (logout or expiry: O4 A), `not_member`, `forbidden_role`, `no_grant`, `client_archived`, `grant_changed` (revoked, or revoked then regranted), `permission_changed` (any role change, or remove → rejoin), `client_context_required`.
- **What Backend's guard does on a refusal:** stop before context, model, purchase, queue, message or output, and record the outcome. **It never re-pins.**
- In #179's `legacyExecutionGuard`, this check replaces today's blanket `client_scope_unsupported` refusal. That replacement happens only when you approve enabling client Brains.

### 9.3 The client Brain as agent context

`clientBrainContextForScope(admin, {kind:'client', clientId}, {workspaceId, actorId, sessionId, intent:'task', pins})` → `{outcome:'ok', profile, version}` or a refusal.
- Feed `profile` to the **existing** pure context builders (`buildCompanyBrainContext` / `compileCompanyBrainContext`). There is no second source of truth and no fallback to the agency Brain.
- Agency-scope tasks keep today's agency reader unchanged.

### 9.4 Membership writers (Backend, O3)

`workspace_member_remove` / `workspace_member_set_role`, with the agreed policy and lock order: L1 session, then L2 actor and target rows FOR UPDATE in `user_id` order, then DELETE or UPDATE.
- **The held triggers do the rest in the same transaction:** a DELETE revokes the user's active grants (`membership_removed`); a role change renews `permission_revision`.
- Brain's contract tests 6 and 6b prove both against direct SQL.
- **Suggested acceptance for Backend's writers:** after `workspace_member_remove`, every grant of that user has `revoke_reason = 'membership_removed'`; after `workspace_member_set_role`, `permission_revision` has moved and a pinned task gets `permission_changed`.

### 9.5 Descendants

The composite FK target already exists: `client_accounts` has `unique (workspace_id, id)`. Migration order: #176, then #177 (independent), then Backend's descendant migration.

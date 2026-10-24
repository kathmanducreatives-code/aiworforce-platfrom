# Client-scoped lead research: exact Backend changes once #174 is agreed

**State today:**
- Client-scoped research is **refused** before any effect by the pre-effect guard (#179, `client_scope_unsupported`).
- The canonical client contract is a proposal (#174) with a held implementation (#176).
- Nothing here is built until that contract is agreed. Brain owns the client tables, grants, client Brain and their functions; this plan only consumes them.

## Backend answers to #174

| Question | Backend answer |
|---|---|
| O3: membership writer | **Option A.** Backend adds `workspace_member_remove(ws, target, actor, session)` and `workspace_member_set_role(ws, target, role, actor, session)` in a held Backend migration. The edge route lands later. Lock order: actor session (L1) → actor and target membership rows `FOR UPDATE` in `user_id` order, one statement (L2) → delete/update. Brain's triggers revoke at L4 in the same transaction. |
| O3: who may act | Owners and admins may remove or demote members. An admin may not remove or demote an owner. The last owner can be neither removed nor demoted. A member may remove themself, except the last owner. |
| O3: bypass paths | Verified on `launch/hardening` `8b0e2b6`. The only `workspace_members` writers are the two provisioning inserts (`provision_workspace_for_user`, `handle_new_user`). No code uses TRUNCATE, COPY or `session_replication_role = replica` on it. |
| O3: identity | Confirmed **immutable** `(id, workspace_id, user_id)`; a move is remove + add. |
| O4: resumed task | **Option A for the pilot.** A client task resumes only with its original live session plus all three pins; a resume after logout is refused. Lead V2 missions are short (minutes, bounded by the mission wall clock), so restart is acceptable. Revisit B (a durable, Backend-owned task principal, B1: revoked at logout) only if long missions need it, with Codex acceptance. |
| Pins in task storage | Accepted. Columns on `tasks`: `client_id`, `client_grant_id`, `client_grant_generation`, `permission_revision`, `origin_session_id`. Written **once** at authorization from `client_brain_pin`, immutable afterwards (a Backend trigger refuses changes). Every resume and retry passes them; never re-pinned. |
| OWN-01 and descendants | Accepted. #177 already makes the 26 lead-graph references composite on `(workspace_id, id)`. Client ownership follows the same pattern. Migration order: (1) #176 client tables; (2) #177, which is independent and may go first; (3) the Backend successor below. |

## The Backend successor (one held migration + code), in order

1. **Schema** (held):
   - `client_id uuid null` on `accounts`, `contacts`, `lead_candidates`, `lead_evidence`, `signals`, `signal_events`, `outreach_drafts` and `tasks`;
   - a composite FK `(workspace_id, client_id) → client_accounts (workspace_id, id)` on each;
   - a child-to-parent check that a child's `client_id` equals its parent's (the composite FK plus a `(workspace_id, client_id, id)` unique key on parents);
   - uniqueness that includes the client. `accounts_workspace_name_key (workspace_id, name)` becomes `(workspace_id, client_id, name)` with NULLS NOT DISTINCT. Otherwise two clients prospecting the same company collide, or worse, share a row.
2. **orchestrate:**
   - accepts `client_id` only from a member;
   - calls `client_brain_authorization(intent 'interactive')` with the live session;
   - pins via `client_brain_pin`;
   - writes the pins on the plan and task;
   - the guard's client refusal becomes this authorization.
3. **Context:** a client task reads client context only through `_shared/clientBrain.ts` (`clientBrainContextForScope`), never `company_brain` directly, and never falls back to the agency Brain.
4. **run-agent, the worker runner, continuations, the sweeper:** before any context, model, purchase or queue effect, call `client_brain_authorization(intent 'task', pins, origin_session_id)`. Refuse with its codes (`session_invalid`, `grant_changed`, `permission_changed`), writing nothing.
5. **Persistence and identity:**
   - every descendant row is written with the task's `client_id`;
   - lead identity, dedup and `completed_operations` keys include the client, so client A's company is never merged into client B's even with the same domain or LinkedIn URL.
6. **Credits and ledger:** unchanged per workspace. The ledger rows' `metadata.client_id` is for reporting only.
7. **Acceptance:**
   - same workspace, clients A and B with overlapping external ids, across every descendant route;
   - revoke → regrant and logout mid-run refused;
   - a member without a grant refused;
   - non-client work unchanged;
   - Codex's native A/B suite.

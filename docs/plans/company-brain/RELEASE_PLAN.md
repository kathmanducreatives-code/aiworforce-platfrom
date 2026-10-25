# Company Brain: release plan and final acceptance checklist

2026-10-25. Nothing here has been run against production. Every hosted step needs the owner's explicit approval, preceded by its read-only preflight.

## 1. What merges, in what order

| # | PR | Head | Contains | Depends on |
|---|---|---|---|---|
| 1 | #181 (Backend) | `90bd993f` | Hiring-verifier clock fix; makes CI green on every branch | — |
| 2 | #147 | `2a6e1dcf` | One save path, one read path | launch/hardening |
| 3 | #160 | `9e3c7e6c` | Onboarding authoritative save | #147 |
| 4 | #161, #162, #163 | `85be9217`, `e0b45f8c`, `50de5eb6` | Reader agreement, reconcile dry-run, bounded planner context | #160 / hardening (independent) |
| 5 | #169 | `833affce` | Browser never writes the Brain; role gate; AUTH-06 writer | #160 |
| 6 | #176 | `1756b217` | Client schema (**held** migration) | #169 |
| 7 | **#178** | **`86d33d6f`** | **The integration vehicle:** #167 + #168 resolved onto #169/#176, #183 autosave fix, client save/read, switcher endpoint, CACHE-SESSION fix | #176 |
| 8 | **#187** | **`c3a9232b`** | UI-2 page with the client switcher (frontend only) | #178 |
| — | #167, #168, #183 | — | **Superseded by #178.** Close after #178 merges; don't merge separately (that would reopen the #168 ↔ #169 conflict) | — |
| — | #184 (Backend) | `cd3a7a00` | Radar C5; based on #168 | Retarget onto the merged #178 base |
| — | #170, #159 | `cc83eb7e`, `8d3a7d71` | Deterministic workspace; membership lock-down (#159's SQL is **already applied in production**) | Independent |
| — | #177, #179, #186 (Backend) | `05e288e1`, `08351242`, `bbbf3811` | OWN-01, pre-effect guards + commit boundary, member writers (all **held** migrations) | #186 after #176 |

Codex has independently accepted #178 `86d33d6f` for AUTH-06, autosave, the first-save race and CACHE-SESSION. #187 changes the frontend only.

## 2. Phase 1: agency Company Brain (no client features)

**Hosted order.** Apply each migration **individually, in this order**, never with a bulk `supabase db push`: the timestamps sort M-B (`20261023…`) before M-A (`20261024…`), which is the wrong way round for the handlers (see `docs/SUPABASE_TARGETING.md`).
1. **M-A** `20261024120000_company_brain_authorized_writer.sql` (#169/#178). This is additive: two service-only SECURITY DEFINER functions. Apply it **before** the functions deploy, because the handlers call it.
2. **Deploy edge functions** from the merged #178 head: `generate-company-brain-draft`, `setup-company-brain`, `integration-readiness`, `run-agent`, `pilot-chat` (`_shared` is bundled). Smoke test: one authorized save and one refused viewer save on an internal workspace.
3. **Deploy the frontend** from the #187 head (Lovable/Netlify auto-publish from `main`: confirm which commit publishes before merging to `main`). The new page writes only through the backend.
4. **M-B** `20261023120000_company_brain_server_writes_only.sql` (#169). This revokes browser writes on `company_brain`, so apply it **after** the old frontend is gone; until then an old open tab could still write directly.
5. *(Independent, owner-applied)* the collaboration-room fix `20261022130000`.

**Flags:** Phase 2 readiness, `BRAIN_READINESS_V2` (server) then `VITE_BRAIN_READINESS_V2` (frontend), only after step 4 is verified. Both are switched off by default; turning them off is the rollback.

**Rollback (reverse order):**
- turn the flags off;
- redeploy the previous frontend;
- redeploy the previous functions;
- revert M-B (re-grant, per its header) **only** if the old frontend must come back;
- drop M-A's two functions (header) last, after no deployed handler calls them.

## 2a. The agency-only TEST mission (Discovery TEST project, not production)

**Candidate:** #188 `508d438f`. It is a combined tree, **not** a merge vehicle: #187 plus Backend #181/#179/#182/#175/#180/#177. Client features stay off.

**The TEST mission does not need Company Brain.** Backend's pack runs it on a workspace with **no `company_brain` row** (preflight P10). With no Brain and the readiness flags off, the Brain code on the mission path renders a byte-identical agent Brain block.

**Rules for the TEST workspace**
- **No Brain row:** don't open onboarding or the Brain page, and don't save a Brain, on the TEST workspace before or during the run. Any save creates the row and fails P10.
- **Provisioning:** `provision_workspace_for_user` creates an empty row too, so the workspace must be seeded without it, which Backend's P10 enforces.

**If the TEST project's edge functions are deployed from the candidate**
1. Apply **M-A** to the TEST project **first**: the Brain handlers call its functions.
   - Read-only check afterwards: `select count(*) from pg_proc where proname in ('company_brain_authorized_write','company_brain_write_authorization')` → `2`.
2. Deploy the functions.
3. **M-B** is optional on TEST (no old frontend writes there).
4. **Never** apply the held client schema; the flags stay unset.

**Rollback on TEST:** redeploy the previous functions, then drop M-A's two functions (statements in its header).

## 3. Phase 3c: client Brains (separately approved, later)

**Prerequisites:** the owner approves contract #174; Backend delivers task pins, the §9.2 guard swap and same-client descendants; Codex delivers the canonical pilot-client bridge and same-workspace A/B acceptance; and the Codex/Backend raw-membership-surface findings on #186 are closed.

**Hosted order:**
1. **C-1** `20261024160000_client_company_brain.sql`: move it from `migrations-held/` into `migrations/` in a reviewed PR, then apply. It adds `permission_revision` (a brief table rewrite of `workspace_members`).
2. **C-2** #186 `20261025140000_workspace_member_writers.sql` (needs C-1's triggers).
3. **C-3** #177 `20261025120000_lead_graph_same_workspace_parents.sql`, after its read-only preflight shows zero mismatches.
4. **C-4** #179 `20261025130000_tasks_commit_boundary.sql`, after `tasks-commit-boundary-preflight.sql`.
5. **C-5** Backend's descendant `client_id` migration, then the §9.2 guard swap.

**Flags:** `COMPANY_BRAIN_CLIENTS_ENABLED` (server) then `VITE_CLIENT_BRAINS` (frontend), last. These are global switches. With no client created and no grant made, nobody sees anything new; the first clients and grants should be created for one internal agency workspace.

**Rollback:**
- turn the flags off (instant; client requests are refused again, and the agency Brain is unaffected);
- roll back the migrations in reverse with their `rollback/*.down.sql` or header statements (C-1's header drops only the new objects and column).

## 4. Final acceptance checklist

**Already satisfied (independently verified unless noted)**
- [x] AUTH-06: the unchanged 23 assertions pass (Codex 23/0 on `86d33d6f`).
- [x] One authorized save path; no direct Brain writer (source pin + tree audit).
- [x] Versioned autosave, conflict recovery, first-save race (Codex 24/0 real GoTrue; 3 merge mutation proofs).
- [x] CACHE-SESSION: mounted browser 5/5 (Codex, `86d33d6f`); 5/5 on #187 `c3a9232b` (Brain).
- [x] OWN-01 workspace isolation (Codex).
- [x] Client A/B isolation, grant revoke/regrant, demotion, archive, logout races (held schema; 15 native + 24 E2E).
- [x] Seven readers 12/0, planner context 7/0, onboarding and activation suites (Brain, with #161/#163 merged onto #187).
- [x] UI-2: viewer read-only, empty states, unsaved-edit recovery, per-Brain drafts, client-correct copy, 390px layout (Brain).

**Waiting on Backend**
- [ ] #181 merged, so CI is green.
- [ ] Raw service-role `workspace_members` UPDATE/DELETE surface (#186, Codex finding).
- [ ] Plan-parent relocation; new model attempt after removal (#179, Codex findings).
- [ ] Task pins (§9.1) and the §9.2 guard swap; same-client descendants (§9.5).

**Waiting on Codex**
- [ ] Canonical pilot-client bridge and same-workspace A/B acceptance.
- [ ] Independent acceptance of #187 (frontend only).

**Waiting on the owner**
- [ ] Approve contract #174 and decide whether promotion is allowed (#186 refuses it today).
- [ ] Approve the merge order (§1) and each hosted step (§2, §3).
- [ ] Phase 2 and client-Brain flag activation.

**Remaining Company Brain work (Brain-owned, not started; a new feature, not a fix)**
- [ ] A client-management endpoint and screen (create or archive a client, grant or revoke access) for owners and admins. Today these exist only as service-only SQL functions (`client_account_create`, `client_access_grant`, …), so an agency can't create its first client without an operator.

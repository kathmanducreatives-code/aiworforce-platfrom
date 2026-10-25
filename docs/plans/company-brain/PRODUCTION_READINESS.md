# Company Brain: production-readiness checklist

Updated 2026-10-25 (CACHE-SESSION fix). **Status: NOT production-ready.** Phase 1 FAIL; A7 NO-GO. Client Brains are built, tested and switched off.

Legend: ✅ done and verified · 🟡 done, awaiting review or approval · ⬜ not done · ⛔ blocked on another owner.

## A. Agency Company Brain (individual businesses)

| # | Item | State | Evidence / owner |
|---|---|---|---|
| A1 | One save path, one read path (#147); onboarding mirror (#160); reader agreement (#161) | 🟡 | CI green; 7 readers 12/0. Owner approval to merge |
| A2 | Planner gets a bounded Brain projection (#163) | 🟡 | 7/0 |
| A3 | Browser never writes the Brain; role gate (#169, 3a) | 🟡 | CI 16/16 |
| A4 | AUTH-06: re-authorize every write in its transaction (#169 `833affce`) | ✅ | Codex independent 23/0 |
| A5 | Membership self-join closed (#159, S0) | ✅ | Applied to prod by owner, post-check PASS |
| A6 | Room self-join fix (S0b) | 🟡 | Owner approved; owner applies manually; not yet applied |
| A7 | Readiness policy and server-saved onboarding progress (#167/#168) | 🟡 | Rebase onto #169 prepared (`integration/brain-167-168-on-169`) |
| A8 | Autosave race fix (a race lost at the write blanked typed text) | 🟡 | `fix/autosave-stale-without-copy` @ `c8aa4e2c` on #168; the same commit is in #178 (one implementation) |
| A9 | Deterministic active workspace (#170) | 🟡 | 6/0 |
| A10 | Brain page redesign, viewer read-only (UI-2) | 🟡 | Local `design/company-brain-page` @ `b50f976d`, unpublished |
| A11 | Hosted migrations `20261023120000`, `20261024120000` | ⬜ | Owner approval; apply in order D1 → F → D2 → D3 |

## B. Client Brains (agencies with many clients)

| # | Item | State | Evidence / owner |
|---|---|---|---|
| B1 | Contract v2.2 (#174): O1/O2 agreed; O3/O4 answered (A/A); pins and FKs accepted | 🟡 | Owner approval of the contract |
| B2 | Held schema: clients, grant generations, client Brains, permission revision (#176) | 🟡 | 15 native tests; 12 mutation proofs |
| B3 | Client save/read through the existing actions; fail-closed switch-off (#178) | 🟡 | E2E 19/0 (stand-in **and** real GoTrue); 7 E2E proofs |
| B4 | Client list endpoint and switcher UI (#178; UI-2 wiring local) | 🟡 | Screenshots verified; per-Brain drafts; revoked → agency |
| B5 | Real-session acceptance (real GoTrue sign-up, tokens, logout) | ✅ (local) | `tests/db-contract/run-with-gotrue.sh` 24/0 (#178 `5d5eb5e3`) |
| B5a | #168 ↔ #169/#176 save-path conflict: AUTH-06 writer + in-transaction versioning on every path | 🟡 | #178 `aeeba016`; Codex's unchanged audit 23/0; 3 merge mutation proofs |
| B5b | CACHE-SESSION (Codex #185): no client data across sign-out/sign-in | 🟡 | #178 `5d5eb5e3`; mounted browser test red→green (5/5); awaiting Codex's independent acceptance |
| B6 | Membership remove/role writers (O3) | 🟡 | **Backend** #186 `bbbf3811` (held); promotion policy needs an owner decision |
| B7 | Task pins on `tasks` and the resume check (§9.1–9.2) | ⛔ | **Backend** |
| B8 | Client context in agent execution (§9.3) | ⛔ | **Backend**; the helper is ready |
| B9 | OWN-01 composite parents (#177) | 🟡 | **Backend** delivered; Codex to verify |
| B10 | Descendant `client_id` + client-scoped uniqueness | ⛔ | **Backend**, after #176 |
| B11 | Pre-effect guards on every legacy entry (#179) | 🟡 | **Backend** delivered; refuses client scope until enabled |
| B12 | Pilot `outpost_private.clients` → `client_accounts` FK; pilot A/B native tests | ⛔ | **Codex** |
| B13 | Independent verification of #176/#178 | ⛔ | **Codex** |
| B14 | Hosted migrations for client Brains | ⬜ | Owner approval, after B1–B13 |
| B15 | Enabling flags for one internal workspace | ⬜ | Owner approval, last |

## C. Cross-cutting

| # | Item | State | Owner |
|---|---|---|---|
| C1 | CI green on all Brain PRs | ⛔ | Date-dependent funding tests; **#181** (Backend) fixes them, verified on a combined tree |
| C2 | Lead-search seller fallbacks C1–C5 (#180) | 🟡 | Backend |
| C3 | Deploy order: functions before frontend; Lovable/Netlify auto-publish checked | ⬜ | Owner, at deploy |
| C4 | Rollback scripts per migration | 🟡 | In each migration header |
| C5 | Production verification after deploy (not local tests) | ⬜ | Owner + Brain, read-only checks |

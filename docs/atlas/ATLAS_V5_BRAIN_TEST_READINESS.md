# ATLAS V5 — readiness for the isolated Brain TEST project (`jekgwafobrzamoupehnn`)

Status: **preparation only, 2026-11-28.** Nothing here has been installed, migrated or run on Brain TEST. Installation, remote migrations and paid execution there each need separate approval.

**Ownership:**
- **Company Brain session:** the Brain TEST deployment tooling and infrastructure (`scripts/test-env/brain-test`, branch `claude/brain-v2-integration`).
- **ATLAS session:** the discovery implementation, interface compatibility and the acceptance criteria below.

## 1. Functions

| Function | Why | Notes |
|---|---|---|
| `lead-pipeline` | strategy_plan / strategy_run (and the ICP walk) | `verify_jwt` on. Build header `x-agentory-build` = commit. |
| `provider-connections` | LeadOcean connection, key storage, usage | Needed only if LeadOcean is enabled on Brain TEST. |

The existing `deploy-test-functions.yml` is hard-wired to TEST `tlvnfrxzjhsjgdofwehb`. Brain TEST uses the Brain session's own deploy entry point.

## 2. Schema dependencies

| Object | Migration (supabase/migrations-held unless noted) | Needed for |
|---|---|---|
| `workspace_members` + app-surface trigger | `20261025160000_workspace_members_app_surface.sql` | owner/admin check for paid runs |
| `workspace_provider_connections`, `provider_usage_ledger`, `provider_connection_*` RPCs, `provider_usage_reserve` / `_finish` | `20261027120000_provider_connections.sql` | ledger, reservations, duplicate-purchase prevention, receipts |
| `lead_pipeline_checkpoints` | `20261031120000_lead_pipeline_checkpoints.sql` | resumable runs / adoption |
| `discovery_evidence_cache` | `20261101120000_discovery_evidence_cache.sql` | optional (flag `DISCOVERY_EVIDENCE_CACHE_ENABLED`, off) |
| `lead_pipeline_persist_lead` RPC | `20261108120000_lead_pipeline_one_lead_per_company.sql` | one lead per company |
| `company_brain`, `company_brain_memory` (+ proposals, revisions) | `20261110120000_company_brain_memory.sql` and the Brain V2 migrations (Brain-owned) | Brain context and approved-memory exclusions |
| `accounts`, `contacts`, `lead_candidates`, `task_plans`, `outreach_*`, `call_attempts` | base schema (as on TEST) | persistence, Workbench link, the smoke "no outreach" check |

Compatibility: **ATLAS V5 adds no migration.** Every new field is in function code and JSON bodies. Brain TEST needs the same migration set TEST has, plus the Brain V2 set the Brain session installs. The order is Brain's decision; ATLAS only needs the objects above to exist before the function is deployed.

## 3. Environment (names only — no values here)

- **Required:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (also derives the approval-token MAC key), `OPENAI_API_KEY`, `LEAD_PIPELINE_ENABLED=true`, `LEAD_PIPELINE_WORKSPACES=<allowlisted workspace ids>`, `PROVIDER_DISCOVERY_ENABLED=true`, `PROVIDER_DISCOVERY_WORKSPACES`, `AGENTORY_MISSION_CONTRACT_V4=enabled` (the mode that carries Brain and memory exclusions).
- **Apify (paid; separate approval):** `PROVIDER_APIFY_DISCOVERY_ENABLED`, `APIFY_API_TOKEN`.
- **LeadOcean (optional):** `PROVIDER_LEADOCEAN_ENABLED`, `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED`, plus a workspace connection through `provider-connections`.
- **Must stay absent or off:** `PROVIDER_APOLLO_ENABLED`, `APOLLO_COMMERCIAL_TERMS_CONFIRMED`, `LEAD_PIPELINE_PHONES_ENABLED`, `LEAD_PIPELINE_SIGNALS_ENABLED`, `DISCOVERY_EVIDENCE_CACHE_ENABLED`, `LEAD_PIPELINE_COMPANY_SEARCH` (company search is a separate approval).
- **Optional tuning:** `LEAD_PIPELINE_BUSINESS_MODEL_CHECK`, `LEAD_PIPELINE_RUN_WAIT_MS`, `LEAD_PIPELINE_SYNC_RUNS`, `LEAD_PIPELINE_PERSIST_TX`, `LEAD_STRICT_REQUIREMENTS_ENABLED`, `AGENTORY_MISSION_CONTRACT`.
- **Never** put a service or secret key in a `VITE_` variable.

## 4. Workspace authorization

- The workspace must be in `LEAD_PIPELINE_WORKSPACES`. Others get 403 before any model call.
- `strategy_plan` needs a member. `strategy_run` (paid) needs **owner or admin** in `workspace_members`. Seed fixture roles as postgres in the SQL editor; application roles cannot change roles, by design.

## 5. Installation sequence (for when it is approved)

1. The Brain session installs the Brain V2 schema and the migrations in §2 on Brain TEST.
2. Seed a TEST workspace, an owner and admin, and the allowlist. Add approved test memories: one `exclusion.industry` approved, one pending, one expired.
3. Set the §3 variables with **Apify off**. Deploy `lead-pipeline` at the merged ATLAS commit.
4. Run the §7 checks that need no provider.
5. Only with a separate approval: turn Apify on with its ceilings, then run one paid acceptance plan.

## 6. Rollback

- Functions: redeploy the previous build (deploy tooling keeps the version; the smoke reports `before` and `after`).
- Flags: `LEAD_PIPELINE_ENABLED=false` stops every plan and run at 404 immediately. Removing a workspace from the allowlist stops just that workspace.
- ATLAS V5 adds no schema, so there is nothing to roll back in the database. Leads written by a run are ordinary `lead_candidates` rows linked to one `task_plans` row, which can be deleted by `plan_id`.

## 7. Discovery acceptance (Brain TEST)

**No provider calls** (each is also a simulator scenario under `tests/fixtures/atlas-sim/v5-*`):
1. The plan answers 200 with `provenance`, `budget.allocation` and `stage: "plan"`.
2. An approved memory exclusion appears as `brain_memory` with its memory id, route `screened`. Pending and expired memories are listed as "not used".
3. A request for a memory-excluded industry → 422 with the question, and nothing planned.
4. Apify-only: LeadOcean allocation `not used`. LeadOcean-only: Apify `not used`.
5. Approval negatives, each 409 with `stage: "approval"`: forged token (`approval_invalid`), another walk, a changed limit (`plan_changed`), a non-member (403 `not_authorized`).
6. Production untouched; spending ledger unchanged.

**Paid** (separate approval): one Apify-only plan within its ceiling. Companies named by a memory exclusion are rejected with the reason. Receipts are `settled` or `provider_reported`. A duplicate run buys nothing twice.

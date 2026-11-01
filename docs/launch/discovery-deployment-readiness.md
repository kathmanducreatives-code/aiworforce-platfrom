# Multi-provider discovery — deployment readiness (2026-11-01)

Branch `claude/optimistic-hypatia-3bylnd`. Nothing below has been applied or deployed.

## Projects (verified read-only)

| Role | Ref | State |
|---|---|---|
| Production | `ohsdatpvfdjdemstoiuj` (agentory) | No `lead-pipeline`, `provider-connections`, `provider-discovery` or `discovery-engine` function deployed. None of the held tables exist. |
| TEST | `tlvnfrxzjhsjgdofwehb` (agentory-discovery-test) | Same: the held tables are absent. 2 workspaces. |

Dependencies present on **both**: `supabase_vault` extension, `public.workspaces`,
`public.has_workspace_access(uuid, uuid)`, `lead_candidates`, `accounts`, `contacts`.

## Migrations (in `supabase/migrations-held/`, never in `supabase/migrations/`)

| Order | File | Creates | Isolation | Rollback |
|---|---|---|---|---|
| 1 | `20261027120000_provider_connections.sql` | `workspace_provider_connections` (key in Vault; row holds only the secret id), `provider_usage_ledger`, 6 `SECURITY DEFINER` functions with `search_path = ''` | RLS on; `anon`/`authenticated` revoked; members read selected columns only via `has_workspace_access` (the Vault id column is not granted); all functions execute as `service_role` only | `rollback/…provider_connections.down.sql`: one transaction; **refuses while any ledger row exists** (reconcile + export first); deletes the Vault secrets with their rows |
| 2 | `20261031120000_lead_pipeline_checkpoints.sql` | `lead_pipeline_checkpoints` (PK workspace + walk) | RLS on; members read their own workspace's rows; `service_role` writes | `drop table if exists` |

Purely additive: new tables and functions only. Nothing existing is altered,
so applying them cannot change current behaviour; every new function is
unreachable while the flags are off. Contract tests:
`tests/db-contract/provider-connections/`.

PR #198 adds a third held migration (`20261101120000_discovery_evidence_cache.sql`)
for its own engine; it is not needed by this branch.

## Deployment order

1. Merge into `launch/hardening` (PR, CI green, review).
2. TEST project: apply migration 1, then 2; run the db-contract assertions.
3. TEST: deploy `provider-connections` and `lead-pipeline`; health check with flags off (expect 404).
4. TEST: set secrets; enable for one TEST workspace; non-billable checks (`strategy_plan` calls no provider).
5. Production: repeat 2–4 only after a separate approval, starting with one workspace and explicit ceilings.

## Secrets and flags

Secrets: `OPENAI_API_KEY` (interpretation + advisor), `APIFY_API_TOKEN` (the new billed account), the LeadOcean key is stored per workspace through `provider-connections` (Vault), `SUPABASE_SERVICE_ROLE_KEY` (platform).

Flags (all default off; unset = off): `LEAD_PIPELINE_ENABLED`, `LEAD_PIPELINE_WORKSPACES`,
`PROVIDER_DISCOVERY_ENABLED`, `PROVIDER_DISCOVERY_WORKSPACES`, `PROVIDER_LEADOCEAN_ENABLED`,
`LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED`, `PROVIDER_APIFY_DISCOVERY_ENABLED`.
Keep `LEAD_PIPELINE_SIGNALS_ENABLED`, `LEAD_PIPELINE_PHONES_ENABLED` and `PROVIDER_APOLLO_ENABLED` off.
Apollo is also disabled in code (`APOLLO_ACCESS_VALIDATED = false`).

Spending ceilings per request: `max_leadocean_records` ≤ 500 (default 50), `max_apify_usd` ≤ $5 (default $0.25); every run needs an owner/admin approval naming the plan hash.

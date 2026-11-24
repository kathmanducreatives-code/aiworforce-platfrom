# PR #195 — independent review handoff

Scope: multi-provider lead discovery (Apollo, LeadOcean, Apify).
Status: HELD, draft. Every flag is off and the migration is held. No provider has been
called, no real key used, nothing deployed, no hosted database touched.
This PR is separate from Candidate C / #194 and the TEST candidate #188. It does not
modify the mission compiler, execution guards or judges.

Base `launch/hardening` @ `8b0e2b6b`. The reviewed commit is the branch head
(`git rev-parse origin/feat/provider-discovery`).

## 0. Reproduce offline (no network, no keys)

```sh
git fetch origin && git checkout feat/provider-discovery
# 70 discovery + 5 frontend tests (mocked providers, the real compiler)
deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/discoveryProviders/ tests/frontend/providerDiscovery.test.ts
# compiler regression (unchanged code)
deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/leadMissionCompiler.test.ts
# the end-to-end offline demo
deno run --no-check --allow-read --allow-env scripts/provider-discovery-offline-demo.ts auto
deno run --no-check --allow-read --allow-env scripts/provider-discovery-offline-demo.ts apollo,apify
# held migration + rollback on a DISPOSABLE loopback Postgres (refuses non-localhost URLs)
D=$(mktemp -d); initdb -D "$D" -U postgres --auth=trust >/dev/null
pg_ctl -D "$D" -o "-p 55471 -c listen_addresses=127.0.0.1 -k $D" -l "$D/log" start
tests/db-contract/provider-connections/check.sh postgres://postgres@127.0.0.1:55471/postgres
pg_ctl -D "$D" stop
# type checks
deno check supabase/functions/_shared/discoveryProviders/*.ts supabase/functions/provider-*/index.ts
npx tsc --noEmit -p tsconfig.app.json   # 23 pre-existing errors, all in src/lib/scrapers/**; none in this PR
```

## 1. Changed files

**Backend: discovery layer.** `supabase/functions/_shared/discoveryProviders/` (all new):

- `types.ts`, `requirements.ts`, `providers.ts`, `routing.ts`
- `http.ts`, `adapter.ts`
- `adapters/{leadocean,apollo,apify}.ts`
- `normalize.ts`, `verify.ts`, `budget.ts`, `orchestrator.ts`, `enrich.ts`
- `leadProjection.ts`, `flags.ts`, `connections.ts`, `discoveryService.ts`, `supabaseStore.ts`

**Backend: edge functions** (new): `supabase/functions/provider-connections/index.ts`,
`supabase/functions/provider-discovery/index.ts`.

**Database** (held, never applied):

- `supabase/migrations-held/20261027120000_provider_connections.sql`
- `supabase/migrations-held/rollback/20261027120000_provider_connections.down.sql`

**Frontend.** New:

- `src/lib/providerDiscovery.ts`
- `src/components/integrations/ProviderConnections.tsx`
- `src/components/discovery/ProviderDiscoveryPanel.tsx`

Changed: each gets a flag-gated mount or one optional field.

- `src/pages/SettingsIntegrations.tsx` (+3)
- `src/components/chat/workspace/bubbles/WorkflowConfirmationCard.tsx` (+4)
- `src/components/leads/library/LeadDetailDrawer.tsx` (drawer section)
- `src/lib/leadLibrary/types.ts` (+3, optional field)
- `src/lib/leadLibrary/canonicalLeadRow.ts` (+2)

**Tests** (new):

- `tests/edge-functions/_shared/discoveryProviders/`: `fixtures.ts`, `discoveryProviders.test.ts`, `providerConnections.test.ts`, `discoveryService.test.ts`, `offlineDemo.test.ts`, `securityCritical.test.ts`
- `tests/frontend/providerDiscovery.test.ts`
- `tests/db-contract/provider-connections/`: `check.sh`, `vault_shim.sql`, `assertions.sql`, `rollback_check.sql`

**Docs and scripts** (new): `docs/PROVIDER_DISCOVERY.md`, this file,
`scripts/provider-discovery-offline-demo.ts`.

`git diff --stat 8b0e2b6b..origin/feat/provider-discovery` is the authoritative list.

## 2. Security model: connections, Vault, isolation, authorization

**Caller.** `authenticateUser` (shared `requestAuth.ts`) asks Supabase Auth who the
bearer is. It refuses the anon key and the service key.

**Flags.** With `PROVIDER_DISCOVERY_ENABLED` off, both functions answer 404 before
reading the body. Next comes the workspace allowlist `PROVIDER_DISCOVERY_WORKSPACES`:
when empty, no workspace is allowed.

**Membership and roles.** The caller's role is read from `workspace_members` for the
requested workspace, and a non-member gets 403.

- Any member can list connection status and plan a search, which is free.
- Only owner/admin can connect, re-verify, refresh usage, disconnect, or run a search.
- Roles are checked in `connections.ts` and `discoveryService.ts`, server side.

**Accepting a key.** A key is accepted only if all of these hold:

- the provider flag is on;
- Apollo/LeadOcean have `*_COMMERCIAL_TERMS_CONFIRMED` set;
- the key's shape is valid (8–512 characters, no whitespace);
- a free provider call proves the key works.

A rejected key is not stored.

**Storage.** The key goes to Vault through `provider_connection_store`, which is
`SECURITY DEFINER` with `search_path=''` and executable by `service_role` only. A
rotated key updates the same Vault secret, so no orphan is left behind. The table row
holds only `vault_secret_id`, a 12-hex SHA-256 fingerprint, status, usage and health.

**Reading.**

- `authenticated` has column-level SELECT without `vault_secret_id`, and RLS restricts
  it to `has_workspace_access(auth.uid(), workspace_id)`.
- No client role can write rows, call the functions, or read `vault.*`.
- `anon` can read nothing.

All of this is asserted in `assertions.sql`, and a mutation (granting full SELECT) is
caught.

**Responses.** No response or log carries the key. The edge functions log the action
and a truncated error, never the request body. Provider error text is truncated to 200
characters and treated as data. Keys travel only in headers (`x-api-key` or
`Authorization: Bearer`), never in a URL; tests check this.

**Browser.** The key is typed into a `type="password"` field, sent once to
`provider-connections`, and the field is cleared after every attempt. There is no
`VITE_*` key, no `x-api-key` in `src/`, and no browser storage of keys; a source scan
test checks all three.

**Isolation.**

- The store, ledger and secret reads are filtered by the workspace that was checked.
- `loadMission` joins `messages` to `conversations.workspace_id`, so another workspace's
  mission returns 404.
- Ledger keys are unique per workspace.
- The SQL tests and `providerConnections`/`discoveryService` tests cover
  cross-workspace reads, uses and disconnects.

**Known limits for the reviewer.**

- After a key is marked `invalid`, `provider_connection_secret` no longer returns it,
  so the user must replace the key; re-verifying it is impossible.
- CORS is `*`, matching the other functions; authentication is by bearer token, not
  cookies.

## 3. Usage ledger

Contract: `budget.ts` (`memoryLedger`) and the held SQL functions
`provider_usage_reserve` and `provider_usage_finish`.

- **Before every billable call** the orchestrator reserves credits under
  `missionId:planHash:provider:kind:pN` (verification steps use `:verify:<domain>`,
  enrichment `:enrich:<person>`). The key is unique per workspace.
- **Settled.** Replays the stored page and never calls the provider again. Stored pages
  hold no contact values; they're redacted on arrival, see §5.
- **Uncertain.** A paid request that timed out or failed in transit, a 5xx on a paid
  call, or an unexpected adapter or actor exception after a paid call is marked
  `uncertain`. Every later reservation of that key is refused (`charge_uncertain`).
  Nothing re-buys the page; reconciliation is manual against the provider's usage page.
- **Retries.** Retries happen only for statuses that can't have billed (429 with
  Retry-After up to 30s, 503), or when the call is free. That covers all of Apollo's
  people search and every verification call.
- **Concurrent requests.**
  - SQL: `pg_advisory_xact_lock(workspace:mission)` serializes reservations, so caps are
    exact. A second reservation of an in-flight key gets `in_flight`.
  - Memory: one event loop, same result; the test covers two concurrent runs, one
    purchase.
- **Caps.**
  - The per-provider ceiling is `min(approval.maxCredits[p], plan.estimatedCredits[p])`.
    A client-supplied approval can lower spend but never raise it.
  - The per-mission ceiling is `min(limits.maxCreditsPerMission (150), sum of those)`.
  - Provider overbilling is recorded as settled credits and stops the next page
    (`provider_cap`).
- **Finishing.** Only a `reserved` entry can finish. A settled or uncertain entry is
  final, which is asserted. `released` (a definite non-charge) lets the key be reserved
  again.
- **Exhausted allowance.**
  - At plan time, `remainingCredits ≤ 0` refuses the provider, and a small remainder
    shrinks the step.
  - At run time, 402 or `x-quota-state: exhausted` stops the provider without retry.
    The fallback runs only if this was the primary.

## 4. Assumed response fields and mocked-only capabilities

**From the LeadOcean OpenAPI spec** (read 2026-10-27):

- endpoints, `x-api-key`, and the parameter names used: `title`, `country`, `industry`,
  `excludeIndustry`, `excludeKeywords`, `hqCountry/hqState/hqCity`,
  `minEmployees/maxEmployees`, `domain`, `limit`, `cursor`, `order`;
- `meta.nextCursor`, `credits`, `unsupportedFilters`, `depthCapped`, `total`,
  `totalWithheld`;
- status codes 402/403/410/429/503;
- `contact_data.contact_emails[{email,type,status,verified_batch_date}]`,
  `contact_phones[{phone,type,dnc}]`, `has_email/has_phone`;
- `meta.source_ids.person_id/company_id`;
- `company_data.company_name/company_domain/naics_sector`;
- `/v1/usage` `data.used/plan.slug/plan.monthlyCredits/resetsAt`.

**LeadOcean, assumed and unconfirmed:**

- the row array key is `data` (with `results` as a fallback);
- POST accepts JSON arrays for list parameters;
- `unsupportedFilters` lists parameter names;
- the `x-quota-state` value is `exhausted`;
- every other path in `adapters/leadocean.ts` `FIELDS`:
  - `profile_data.profile_full_name|first_name|job_title|seniority|linkedin_url|location_country`;
  - `company_data.company_industry|keywords|hq_country|hq_state|hq_city|employee_count|employee_range|founded|linkedin_url`;
  - `company_metrics.employee_count`;
  - `contact_current_experiences[0].*`;
  - `meta.updated_at`;
- the enrichment response `found`, `data` and `meta.credits`;
- the vocabulary `industry` and `excludeIndustry` accept (e.g. "manufacturing", "staffing agencies");
- that `/v1/usage` is free.

**From the Apollo docs:**

- endpoints and `x-api-key`;
- People Search costs 0 credits, takes `person_titles`, `include_similar_titles`,
  `organization_locations`, `organization_not_locations`, `person_locations`,
  `organization_num_employees_ranges` ("min,max"), `q_organization_domains_list`,
  `page/per_page`, and returns `people[].id/first_name/title/last_refreshed_at/has_email/has_direct_phone/organization.name`
  plus `total_entries`;
- Organization Search costs 1 credit per page and returns
  `organizations[].id/name/primary_domain/website_url/linkedin_url/founded_year`.

**Apollo, assumed:**

- `has_direct_phone` is `"Yes"` or `true`;
- `organization.primary_domain` is present in people-search results. The docs list only
  name and `has_*` flags. **If it's absent, Apollo people rows have no domain to merge
  on or verify by, and Apollo-only leads stay `needs_verification`.**
- Organization fields `industry`, `estimated_num_employees`, `country/state/city` (not
  documented, read only if present);
- a one-row people search is free and works with the key type the user has (the docs
  may require a master key);
- a Retry-After header on 429.

**Apify, mocked only:**

- actor inputs and outputs for `apify_google_search` (`queries`, `organicResults[].url/title`),
  `apify_website_content` (`startUrls`, `maxCrawlPages` → `items[].text`) and
  `apify_ats_verification` (`{domain}` → one item per open role);
- `/v2/users/me` `data.plan`.

**Never executed:**

- every provider HTTP call (all mocked);
- the Apify invoker (`verifier: null` in `provider-discovery`, so Apify reports "not
  connected" and Apify-only checks fail closed);
- the real Vault, which the test shim replaces without encryption;
- `supabaseStore.ts` (the hosted store and ledger, via PostgREST and RPC);
- both edge function `index.ts` handlers, including `persist()` writing `accounts`,
  `contacts` and `lead_candidates`;
- the frontend components, which are type-checked and built but not rendered.

## 5. Provider-filtered requirements cannot qualify a lead by themselves

The original #195 head **failed** this item. A requirement the provider claimed to
filter, but returned no value for, counted as satisfied, so a provider that silently
ignored a filter could qualify an unchecked lead. Fixed in this revision:

- `provider_filter` satisfies a requirement only if that provider and key are on
  `TRUSTED_PROVIDER_FILTERS` in `providers.ts`. **The list is empty and frozen.**
  Adding to it is a reviewed code change, never a setting. Untrusted, the lead is
  `needs_verification` with the reason "not independently confirmed".
- A filter the provider reports ignoring (LeadOcean `meta.unsupportedFilters`) is
  `unknown`, even if it's trusted.
- One provider's trust never covers another's rows, and one key's trust never covers
  another key.
- A contradiction from any returned value rejects the lead. Disagreeing providers
  produce `conflicting`, which means `needs_verification`.

Tests:

- `discoveryProviders.test.ts`: "does NOT qualify a lead by default",
  "only a reviewed trust entry", "a trusted filter the provider reported ignoring";
- the Apollo failover and demo tests now expect `needs_verification`.

A mutation removing the trust check fails 4 tests.

## 6. Discovery approval cannot authorize enrichment or outreach

- **Enrichment.** `enrichContacts` requires `kind: "enrichment"` for this workspace and
  mission, naming each person, with its own credit cap. A `DiscoveryApproval` is refused
  by kind. Tests cover none, discovery-kind, another workspace, an unnamed person, cap
  exhaustion and idempotent replay. No edge function exposes enrichment yet.
- **Contact values.** Discovery redacts every email and phone the moment a page arrives
  (`redactContactValues`), so the run, the ledger and the Leads rows hold none. A
  mutation removing redaction is caught.
- **Outreach.** Discovery writes only `accounts`, `contacts` (email and phone null) and
  `lead_candidates` (status `qualified` or `new`, no `next_action`). Nothing in the repo
  acts on a `lead_candidates` insert: there are no triggers beyond `updated_at`, and no
  cron reads it. Outreach (`run-lead-action`) needs the user to act on chosen lead IDs.
  Tested in `securityCritical.test.ts` ("boundary").

## 7. Migration review, rollback, flags

**Review checklist** for `20261027120000_provider_connections.sql`:

- [ ] `vault.create_secret` / `vault.update_secret` exist on the project and `postgres`
  may call them, and `delete from vault.secrets` is permitted for the function owner.
  Not verifiable offline; the test uses a shim.
- [ ] `public.has_workspace_access(uuid, uuid)` exists in production. It's in the
  baseline, and no later migration drops it.
- [ ] Column grants: `authenticated` has no `vault_secret_id` and no `result`;
  `service_role` has SELECT.
- [ ] Every function is `SECURITY DEFINER`, `search_path=''`, revoked from
  public/anon/authenticated and granted to `service_role` only.
- [ ] `provider_usage_reserve`'s advisory lock key is `hashtextextended(ws:mission)`.
- [ ] `on delete cascade` from `workspaces` removes connection rows but **not** Vault
  secrets: deleting a workspace orphans its secrets. A follow-up trigger or cleanup is
  needed before production use.
- [ ] Apply to staging first, run `assertions.sql` there against the real Vault, then
  production, then move the file into `supabase/migrations/`.

**Rollback** (`rollback/…down.sql`):

- It refuses while any ledger row exists, because those rows are the only record of
  charges, including unreconciled uncertain ones.
- To roll back after use: turn the flag off, reconcile `uncertain` and `reserved` rows
  against the providers, export, and get an archival decision.
- It deletes the connections' Vault secrets, then the functions and tables, in one
  transaction.
- After rollback, both functions fail closed: 404 with the flag off, 503 without the
  RPCs.
- Tested by `rollback_check.sql`.

**Flags.** Every flag is off unless set to `1`, `true`, `yes` or `on`.

| Flag | Off means |
|---|---|
| `PROVIDER_DISCOVERY_ENABLED` | both functions answer 404 |
| `PROVIDER_DISCOVERY_WORKSPACES` | empty: every workspace gets 403 |
| `PROVIDER_{APOLLO,LEADOCEAN,APIFY_DISCOVERY}_ENABLED` | that provider is refused for connect and plan |
| `{APOLLO,LEADOCEAN}_COMMERCIAL_TERMS_CONFIRMED` | connecting is refused and the provider is refused in plans |
| `VITE_PROVIDER_DISCOVERY` | no UI is rendered, but the server flags still apply |

## 8. Security-critical tests added in this revision

In `securityCritical.test.ts`:

- an inflated client ceiling can't raise spend;
- a ceiling below the estimate is blocked before any call;
- no contact value appears in the run, ledger or rows, and email-based deduplication
  still works;
- an unexpected adapter exception after a paid call is `charge_uncertain` and isn't
  re-bought, and its text isn't surfaced;
- two concurrent runs make one purchase;
- an exhausted allowance at plan time refuses the provider;
- the enrichment cap holds across people;
- the boundary test: no outreach is written.

Elsewhere:

- the trust-list tests (§5);
- SQL: a member can't update or delete connection rows, release ledger entries or call
  `provider_usage_finish`; `anon` can read nothing; `service_role` can read; rollback
  refuses, then cleans up.

**Still uncovered.** These need a live staging stack and are listed as blockers:

- `supabaseStore.ts` against PostgREST;
- the edge `index.ts` handlers end to end;
- `persist()`;
- real Vault permissions.

## 9. Readiness

**Offline implementation: PASS.** All checks in §0 pass at the head commit.
**Customer-facing activation: FAIL.** The blockers are listed in the PR description and
`docs/PROVIDER_DISCOVERY.md` §5.

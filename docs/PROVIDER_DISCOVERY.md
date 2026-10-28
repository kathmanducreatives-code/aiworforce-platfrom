# Multi-provider lead discovery (Apollo, LeadOcean, Apify)

Status: **built and tested offline; every flag is off; the migration is held.**
Nothing here has called a provider, used a real key, touched a hosted database
or been deployed.

## 1. Existing Apollo work (audit)

- No Apollo **API** integration exists on any branch. Nothing calls `api.apollo.io`.
- Codex's work is a pilot-only **CSV preview**: #139 `codex/p3-csv-preview`
  (`_shared/pilot/pilotCsv`, `pilot-import`, `tests/fixtures/pilot-csv/apollo-synthetic.csv`).
  It is stacked on the unmerged pilot PRs #124 and #134, and it is disabled. It has no
  persistence, makes no calls and holds no credentials.
- Its rules carry over: provider ids are opaque, exact duplicates collapse, rows with
  conflicting identities are not merged, and claims a provider supplies stay unverified
  (see `normalize.ts`). The CSV preview itself is left unchanged.
- LeadOcean isn't integrated anywhere yet.
- Apify is already integrated (`actorRegistry.ts`, the capability engine and the guarded
  invoker). This layer **reuses** it through an injected `ActorInvoker` and makes no
  Apify HTTP calls of its own.

## 2. Architecture

`supabase/functions/_shared/discoveryProviders/`, a new module. It doesn't change the
compiler, the capability engine, the guards or the judges.

| Module | Job |
|---|---|
| `requirements.ts` | Turns `compileLeadMission(...).final_mission` into provider-facing hard requirements, preferences, roles and forbidden broadening. A criterion it can't represent becomes `unmappable`, which blocks the plan. |
| `providers.ts` | Data, per provider: capabilities, the filters it applies natively, the fields its rows return, its cost model and its limits. |
| `routing.ts` | Builds the plan. For each requirement and provider it records one of: `native`, `post_verify` (Agentory checks the returned field), `verify_via` (an Apify site or open-roles check) or `unsupported`. A provider with any unsupported requirement is **refused**; the requirement is never dropped. Plans can be Auto or an explicit user selection, and an explicit selection is never silently switched. Auto picks one primary and one fallback; the fallback runs only if the primary fails. The plan includes a bounded estimate, scales down to fit the remaining allowance, and its hash binds the approval. |
| `http.ts` | Timeouts, bounded retries and Retry-After handling, plus a failure taxonomy. **A paid request is retried only after a status that can't have billed it (429, 503).** A paid request that fails in transit becomes `charge_uncertain` and is never retried. |
| `adapters/leadocean.ts` | `/v1/search` and `/v1/search/companies` (1 record per row), `/v1/usage` (free; verifies the key), `/v1/enrich` (1 per call). Field paths sit in one `FIELDS` table. `meta.unsupportedFilters` means that filter was **not** applied. |
| `adapters/apollo.ts` | People API Search (0 credits, no contact values, `include_similar_titles: false`) and Organization Search (1 credit per page). The key is verified with a one-row free search. |
| `adapters/apify.ts` | Web research (`apify_google_search`), what a company's own site says (`apify_website_content`) and open roles (`apify_ats_verification`), all through the existing invoker. Token checks use `GET /v2/users/me` with the token in a header. |
| `normalize.ts` | Merges companies and people across providers. Every field keeps every provider's claim, disagreements are recorded as conflicts, and an identity conflict is kept as two records. |
| `verify.ts` | Checks each lead against the original hard requirements. Outcomes are `matched`, `provider_filter`, `contradicted`, `conflicting` or `unknown`, and each carries its evidence (provider, record id, field, value, retrievedAt). Lead status is `qualified` (verification `evidence` or `provider_attested`), `needs_verification` or `rejected`. |
| `budget.ts` | `DiscoveryApproval` covers the plan hash, workspace, mission and per-provider ceilings. `EnrichmentAuthorization` is separate and lists people by name. Usage goes through an idempotent ledger: settled entries replay, uncertain ones block, in-flight ones refuse, and there are provider and mission caps. |
| `orchestrator.ts` | Runs an approved plan with bounded pages and rows and stops once enough leads qualify. Each failure kind maps to a defined action, and the Apify verification step is bounded. **No enrichment.** |
| `enrich.ts` | Enrichment needs its own authorization and is idempotent. **Phones are never verified**; only `attachIndependentEvidence` with non-provider evidence can raise that. |
| `leadProjection.ts` | Produces `accounts`, `contacts` and `lead_candidates` rows with `raw.agentory_discovery`. Discovery stores **no contact values**, only availability and the provider's status. Rejected leads aren't written. |
| `connections.ts` / `discoveryService.ts` | Pure handlers for the two edge functions. They enforce flags, the workspace allowlist, membership, owner/admin roles and the commercial-terms gate. A key is stored only after a free verification call and is never returned. |
| `supabaseStore.ts` | Hosted store and ledger over the held migration. |

Edge functions: `provider-connections` (list, connect, verify, usage, disconnect) and
`provider-discovery` (`plan` is free; `run` requires approval). Both return 404 while
the flags are off.

Credentials: held migration
`supabase/migrations-held/20261027120000_provider_connections.sql`.

- `workspace_provider_connections`: keys live in Vault. Members get column-level read
  access to status and fingerprint only, never the Vault id.
- `provider_usage_ledger`: the reserve function takes an advisory lock.
- Service-only `SECURITY DEFINER` functions handle the writes.

UI, all behind `VITE_PROVIDER_DISCOVERY=true`:

- **Settings → Integrations:** provider cards showing status, capabilities, usage, key
  fingerprint, connect, re-check, replace and disconnect.
- **Mission card:** "Search with your data providers", with Auto or per-provider
  selection, a per-requirement breakdown of how each one is handled, unsupported
  requirements, a credit ceiling and an approval checkbox.
- **Lead drawer:** a "Data providers" section with sources, verification badge, check
  outcomes and conflicts.

## 3. Flags (all off by default)

`PROVIDER_DISCOVERY_ENABLED`, `PROVIDER_DISCOVERY_WORKSPACES` (allowlist; empty means
none), `PROVIDER_APOLLO_ENABLED`, `PROVIDER_LEADOCEAN_ENABLED`,
`PROVIDER_APIFY_DISCOVERY_ENABLED`, `APOLLO_COMMERCIAL_TERMS_CONFIRMED`,
`LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED`, and the frontend flag `VITE_PROVIDER_DISCOVERY`.

## 4. Tests

- `tests/edge-functions/_shared/discoveryProviders/`: 55 tests, all with mocked
  providers and the real compiler.
- `tests/frontend/providerDiscovery.test.ts`: 5 tests.
- `tests/db-contract/provider-connections/check.sh`: applies the held migration to a
  disposable local Postgres with a test-only Vault shim and runs the SQL assertions.
- Offline demo: `deno run --no-check --allow-read --allow-env scripts/provider-discovery-offline-demo.ts [auto|apollo,apify]`.

## 5. Open before activation

1. **Licensing.**
   - LeadOcean: confirm in writing that commercial embedding and reselling to Agentory's
     customers is allowed. The OpenAPI spec doesn't cover it; exports are kept for
     7 days. Confirm data-retention and deletion obligations for stored records.
   - Apollo: confirm API Terms allow use inside a customer-facing product, and on a
     customer's own key.
   - Only then set `*_COMMERCIAL_TERMS_CONFIRMED`.
2. **LeadOcean field names.** `profile_data` and `company_data` are untyped. Confirm the
   paths in `FIELDS` with one approved call: `count=true&limit=1` is free, and a single
   `limit=1` row costs 1 record. Until they're confirmed, unmatched fields count as
   `unknown`, so leads end up `needs_verification` rather than qualified.
3. **LeadOcean taxonomy.** Confirm the vocabulary for `industry` and `employeeRange`,
   and whether `slim` or `fields` can leave `contact_data` out of search rows.
4. **Apollo.** Confirm the People API Search key type (master key?) and that it's free
   on the plan in use.
5. **Hosted migration.** Review it, then apply the held migration deliberately.
6. **Apify wiring.** Connect `provider-discovery`'s verifier to the existing guarded
   invoker. It's `null` today, so Apify-only checks fail closed.
7. **Deploy.** Deploy both functions with the flags off, then allowlist one internal
   workspace.

## 6. Activating one provider safely (LeadOcean recommended)

LeadOcean is the recommended first provider: it filters every hard requirement
natively.

1. Get the licensing confirmation (§5.1).
2. Apply the held migration to a staging project, run `check.sh`-equivalent assertions
   there, then apply it to production once approved.
3. Deploy `provider-connections` and `provider-discovery` with every flag off. Confirm
   both return 404.
4. Set `PROVIDER_DISCOVERY_ENABLED=true`, `PROVIDER_DISCOVERY_WORKSPACES=<one internal workspace>`,
   `PROVIDER_LEADOCEAN_ENABLED=true` and `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED=true`.
   Set `VITE_PROVIDER_DISCOVERY=true` only in an internal build.
5. Connect a LeadOcean key with a small monthly allowance. This uses only the free
   `/v1/usage` call.
6. Run one `plan`, then one approved `run` with `limit` of 5 or fewer, an approval
   ceiling of 5 credits or fewer, and `PlanLimits.maxCreditsPerMission` lowered to match.
   Compare the returned field names with `FIELDS` and fix them in one edit.
7. Check `provider_usage_ledger` against LeadOcean's `/v1/usage`, and check the Leads
   rows for attribution with no contact values.

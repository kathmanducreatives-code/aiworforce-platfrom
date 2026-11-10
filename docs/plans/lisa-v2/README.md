# LISA V2 — reliable signal engine, monitoring, Company Brain integration

Status: **implemented and tested in isolation. Disabled everywhere.** Nothing here
is deployed, scheduled or applied to a hosted database.

- Endpoint `lisa-monitor` answers `409 lisa_v2_disabled` unless `LISA_V2_ENABLED=true`.
- Scheduled sweeps (`tick`) also need `LISA_V2_SCHEDULE_ENABLED=true` **and** the service key. No cron exists.
- The database change is a **held** migration: `supabase/migrations-held/20261111120000_lisa_signal_engine.sql`
  (applied only by the disposable contract lane, `tests/db-contract/bootstrap.sh`).

## Architecture

```
WatchSubject ──► collectors.planQueries ──► SearchSource (Firecrawl /v2/search; fixtures offline)
   (orchestrator.effectiveWatchlist:                       │  every call: authorizeProviderCall → settle
    watchlist ∪ Brain competitors ∪ ICP − exclusions)      ▼
                                   extract (deterministic; drops counted by reason)
                                                           ▼
                     group by event identity (verify.eventInstance → dedupe_key)
                                                           ▼
                verify (COUNTED: corroborated / self_reported / single_source / contradicted, retracted)
                                                           ▼
                stale check (FRESH_DAYS) → relevance (Company Brain, exclusions FIRST, fingerprinted)
                                                           ▼
          persistence.rpcSignalStore → lisa_record_signal (ONE transaction: event + evidence + server recount)
                                                           ▼
     signal_events (+ normalized_value.lisa) ──► weekly.toAgentSignal ──► ORION / weekly top-5 / Signals feed
```

| Module (`supabase/functions/_shared/lisa/`) | Role | Pure? |
|---|---|---|
| `types.ts` | normalized record, seams (`SearchSource`, store) | yes |
| `collectors.ts` | bounded query plan per category; 6 extension points (not implemented) | yes |
| `extract.ts` | hit → observation; only claims the text states | yes |
| `verify.ts` | event identity, dedupe key, counted verification, freshness | yes |
| `relevance.ts` | Brain relevance with reasons, why-now, next step | yes |
| `pipeline.ts` | one subject end to end; honest pass status | injected I/O |
| `persistence.ts` | row + evidence args; contact-data redaction; RPC store | injected I/O |
| `providers.ts` | Firecrawl adapter, fixture source, ledger budget | injected I/O |
| `orchestrator.ts` | effective watchlist, run keys, claim → pass → finish | injected I/O |
| `weekly.ts` | downstream contract, elevation rule, weekly top-5 | yes |

### Record

A LISA signal is an ordinary `signal_events` row (every existing reader keeps
working) plus `normalized_value.lisa`: category, company, title/description,
event date, discovery date, event instance, source URL/type, collection method,
watch origin, **verification** (level, independent sources, sources,
contradictions, retracted, confidence) and **relevance** (score, band, reasons,
why now, why it matters, next step, Brain fingerprint). Evidence: one
`signal_event_evidence` row per source URL (domain, source type, excerpt,
negation, attributes).

### Verification is counted, never asserted

| Level | Rule | `verification_status` column |
|---|---|---|
| corroborated | ≥ 2 independent publishers (domains), no contradiction | `provider_verified` (compatibility projection) |
| self_reported | the company's own site | `self_reported` |
| single_source | one independent publisher | `unverified` |
| contradicted | denial/retraction language, or amounts disagree > 25 % | `unverified` |

The column vocabulary is pinned across the codebase, so `corroborated` is
projected onto `provider_verified`; the authoritative level is always
`normalized_value.lisa.verification.level`, recomputed **by the database** over
all stored evidence on every write (`lisa_verification_of`, pinned to
`verify.ts` by the contract test). Retraction language marks the event
`retracted` permanently.

### Event identity (dedupe)

`subject_type | subject_key | signal_type | instance`, where the instance is:
funding → round (else amount + month); hiring → role family + city + quarter;
expansion → facility + city; launch → product. Series A ≠ Series B; one
announcement on three sites → one event, three evidence rows. The key is a pure
function of the observation, and `(workspace_id, dedupe_key)` is unique, so
retries and concurrent passes converge (contract scenario 19).

### Lifecycle

| Requested state | Where it lives |
|---|---|
| new / updated / duplicate | per pass: `lisa_record_signal` result, run counts |
| under review | `single_source`, active |
| verified | `corroborated` / `self_reported`, active |
| disputed | `lifecycle_status = contradicted` (evidence or a person's `dispute`) |
| dismissed | `dismissed` (person); sticky against later evidence; `restore` undoes it |
| retracted | `retracted` (evidence or person); terminal |
| expired | `expires_at` = event date + freshness window; stale events are never stored or elevated |

Human changes go through `lisa_signal_transition` (session → membership locked,
role re-checked in the transaction, audited in `signal_event_transitions`). It
does **not** use the browser-writable signal paths.

## Capability matrix

| Capability | State | Evidence |
|---|---|---|
| Funding (incl. named competitors, separate rounds) | working (offline + real DB) | unit, contract 03/04 |
| Hiring (scale or structure, not one job ad) | working | unit, contract 05 |
| Expansion (facility + place) | working | unit, contract 06 |
| Product launches (announcement required) | working | unit, contract 07 |
| Pricing, website change, acquisition, partnership, leadership, technology | **extension points only — not implemented** | `collectorFor()` returns null |
| Evidence + counted verification + contradiction | working | contract 03/08/09 |
| Retraction / stale handling | working | contract 17/18 |
| Watchlist (monitoring_subjects ∪ Brain competitors ∪ ICP − exclusions) | working | unit, contract 13/14/15 |
| Exactly-once scheduling, leases, stalled recovery, backoff | working | contract 10–12/19 |
| Credits per call + monitoring period ceiling | wired; verified with fakes + ledger RPC shape | handler tests |
| Brain relevance, fingerprint recompute | working | contract 01/02/13 |
| Brain proposals (existing mechanism) | working | contract 15/16 |
| ORION: verification, links, elevation rule | working | ORION context test |
| Weekly top-5 (no padding) | working | unit, contract 18 |
| Signals feed: verified LISA rows shown by default | working | frontend test |
| Live Firecrawl collection | **not exercised** (no paid calls) | adapter tested with recorded bodies |
| Apify collectors in LISA V2 | **not wired** (see inventory) | — |

## Provider inventory (from code; no IDs invented)

| Provider | Where | Used by LISA V2? |
|---|---|---|
| Firecrawl `/v2/search` | `run-radar-scan` (`firecrawlSearchRaw`), `lisa/providers.ts` | **yes** — the only collector; 1 credit per search (`priceFor("signal_search")`) |
| Apify `datahyena/company-funding-rounds` | monitoring capability `funding_signal_discovery` | no |
| Apify `data_xplorer/google-news-scraper-fast` | expansion / product-launch discovery | no |
| Apify `harvestapi/linkedin-job-search` | hiring verification | no |
| Apify `harvestapi/linkedin-company-search`, `harvestapi/linkedin-company` | company search / details | no |
| Apify `curious_coder/linkedin-jobs-scraper`, `automation-lab/indeed-scraper`, `apify/google-search-scraper`, others | provider registry | no |
| Radar LinkedIn actors | **env-configured only** (`RADAR_APIFY_LINKEDIN_POSTS_ACTOR`, `…_COMMENTS_ACTOR`, `…_PEOPLE_ACTOR`); no IDs in code | no |
| OpenAI | monitoring planner, evaluation, relevance judge | **no** — V2 is deterministic; `model_usd` is recorded as 0 |

Adding a provider is a new `SearchSource`; the pipeline does not change.

## Zero-output monitoring investigation (code + isolated tests only)

| Candidate cause | Status |
|---|---|
| `SIGNALS_V2` off → every event write refused (`flag_disabled`) while the runner returned `ok: true` | **reproduced in code and fixed**: the runner now returns `ok: false, refusal: events_not_persisted` (tests Z1/Z2); the subject is still stamped so a refused pass is not re-bought every tick |
| Monitoring events carry no source URL and are hidden by default in the feed | confirmed in code (audit); LISA V2 rows carry URLs and counted verification |
| Named-competitor funding not collectable by the legacy plan | confirmed in code (audit); V2 collects it (contract 03) |
| Pre-flight evidence reuse suppressing collection | **unverified** |
| Provider/engine refusals in production | **unverified** — production logs were not read |

## Performance and cost (offline)

- A competitor watch with all four categories plans ≤ 5 queries (≤ 2 per category) → ≤ 5 credits per scan; an ICP watch plans ≤ 6.
- Effective watchlist capped at 10 watches; on-demand scans at 3 watches per request.
- Pipeline: the full fixture set replays in ~150 ms; the 22 real-database tests run in ~1 s.
- No model calls: model cost 0.

## Deployment readiness

**Not ready for a hosted environment.** Blockers, in order:

1. **Security phase (P0, existing):** browser roles can write `signal_events`,
   `signal_event_evidence` and `monitoring_subjects` in production. LISA V2 must
   not be enabled until those grants are revoked; otherwise forged rows could
   look like verified LISA output.
2. Review and approval of the held migration for the isolated TEST project.
3. A live Firecrawl smoke on the TEST project (paid; needs approval).
4. A scheduler decision (cron for `tick`) — explicitly out of scope here.

## Running it

```bash
npm run dev:lisa             # replay every fixture offline
npm run dev:lisa -- --demo   # the product demonstration
deno test --allow-read --allow-env tests/edge-functions/_shared/lisa/ tests/edge-functions/lisaMonitorHandler.test.ts
tests/db-contract/run.sh tests/db-contract/lisaSignalEngine.contract.test.ts   # needs PG_ADMIN_URL + POSTGREST_BIN
```

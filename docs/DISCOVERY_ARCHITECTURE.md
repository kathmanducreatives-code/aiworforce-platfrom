# ICP walk (one strategy) — superseded as the standard by `DISCOVERY_ENGINE.md`

> **Superseded (2026-11-01):** discovery is now provider-neutral — GPT interprets the
> request and the planner chooses LeadOcean, Apify or both (Apollo planned); see
> `DISCOVERY_ENGINE.md`. This document describes the LeadOcean-led ICP walk, which
> remains available as one strategy through `lead-pipeline`.

**ICP walk: LeadOcean discovers. Apify verifies and researches. Agentory decides.**
Implemented in `supabase/functions/_shared/leadPipeline/` (`runLeadPipeline`), behind
`LEAD_PIPELINE_ENABLED` (off). Evidence for the split: `LEADOCEAN_FINAL_VERDICT.md`.

## Responsibilities

| | does | never does |
|---|---|---|
| **LeadOcean** | people / company search: industry, company type, HQ & person location, headcount, funding, technology, titles, contact flags; optional phone lookup (separate step) | prove a hard requirement; decide eligibility; look phones up during discovery |
| **Apify** | company record (identity, domain, HQ, declared size, industry, description); optional founder-relationship check; optional posts / hiring signals | qualify on its own — every item passes the evidence-authority rules (e.g. HQ needs the HQ-flagged location) |
| **Agentory** | `evaluateEligibility` (via `verifyLeads`) is the only hard-qualification authority; classification, ranking, ATLAS review queue | let a signal or a score override a hard rule |

## Sequence (each paid step reserved in the durable ledger first; no paid retries)

```
1 LeadOcean discovery     approval + plan hash; excludeIds from the walk checkpoint
2 dedupe                  identifier merge; prior-walk companies; same LinkedIn company → one paid item
3 history                 existing Lead ids kept; CRM relationships / holds block outreach only
4 initial ICP screen      provider claims decide SPENDING only: no decision-maker, headcount far
                          outside (< ½ min or > 2× max) → rejected (basis "screened"), not verified
5 Apify company records   screened-in only, highest provider-funding priority first, inside the
                          ceiling; overflow stays needs_verification ("skipped_budget")
6 final eligibility       shared engine: eligible / needs_verification / rejected ("verified")
7 founder check           optional, eligible only (apify_linkedin_company_employees, short profiles)
8 signals                 optional, eligible only (company posts, jobs; LeadOcean funding = low-confidence claim)
9 rank → ATLAS queue      eligible decision-makers without a hold → ready_for_review
— phones                  enrichQueuedPhones: a separate, separately authorized step over the queue
```

## Classification

| classification | meaning | written to Leads as |
|---|---|---|
| `eligible` | the shared engine proved every hard requirement | `qualified` |
| `needs_verification` | a hard requirement is unknown (no record, over budget, not read, no authority) | `new` (discovered) |
| `rejected` / `verified` | evidence disproves a hard requirement | not written |
| `rejected` / `screened` | provider claims show an obvious mismatch; nothing paid was spent on it | not written |
| `rejected` / `duplicate` | already walked, or the same LinkedIn company twice | not written |

## Flags (all off by default)

`LEAD_PIPELINE_ENABLED`, `LEAD_PIPELINE_WORKSPACES`, `LEAD_PIPELINE_SIGNALS_ENABLED`,
`LEAD_PIPELINE_FOUNDER_CHECK_ENABLED`, `LEAD_PIPELINE_PHONES_ENABLED` (reserved for the separate
phone endpoint), the provider-discovery LeadOcean flags, `APIFY_API_TOKEN`; live provider test
scripts additionally need `AGENTORY_PROVIDER_LIVE_TESTS=enabled`.

## Regression tests (`tests/edge-functions/_shared/leadPipeline/architecture.test.ts`)

1 LeadOcean-only evidence never qualifies · 2 wrong LeadOcean HQ caught by the Apify record ·
3 wrong headcount rejected · 4 no record / over budget → needs_verification · 5 screened and
rejected companies get no company record, signals, founder check or phone · 6 duplicate
companies → one paid item; a re-run replays from the ledger · 7 missing / failing signals do not
block · 8 a confirmed founder's provider number is still unverified · 9 workspace, role, allowlist,
Apify ceiling and enrichment-authorization scope enforced before any call · plus: an Apify record
without an HQ flag proves nothing; budget follows funding priority; founder matching rules.

## Remaining incompatibilities

- `provider-discovery` (PR #195 entry point) still runs LeadOcean → `verifyLeads` without the
  Apify company record, so its LeadOcean leads stay `needs_verification`. Recommend retiring it
  for ICP walks in favour of `lead-pipeline`, or wiring `readCompanyRecords` into it.
- `discoveryProviders/enrich.ts` (contact enrichment) shares the discovery mission's ledger scope;
  the pipeline's phone path uses its own. Not used by the pipeline.
- Funding corroboration: no funding actor is wired; LeadOcean funding stays a low-confidence claim
  unless a dated Apify post corroborates it. Industry / business model from the Apify record feeds
  ranking only (no hard industry criterion, by design).
- The founder check's live output matching (name + current company slug) relies on the
  catalogued actor shape (`currentPositions[]`); not yet observed in this pipeline.
- Held migrations `20261027120000_provider_connections.sql` and
  `20261031120000_lead_pipeline_checkpoints.sql` are not applied.

## Live validation required before production (not run; needs approval)

One ICP A walk with the recommended query, against the TEST workspace:

| step | cap |
|---|---|
| LeadOcean people search, 1 page | ≤10 records |
| Apify company records | ≤$0.05 (≤12 companies) |
| founder check (eligible only, ≤3 profiles / company) | ≤$0.11 ($0.02 + 0.003 × 3 × ≤10) |
| signals (eligible only) | ≤$0.13 |
| phones | none (separate step) |

To observe: screening counts, Apify HQ / size outcomes, the founder check's real output shape
and match rate, ledger replay on a second invocation, and projection into TEST Leads tables with
existing Lead ids preserved (requires the held migrations applied to the TEST project only).

# Lead pipeline — LeadOcean discovery + Apify signals + phone enrichment

Status (2026-10-31): implemented, validated offline (200 tests) and by live test E (see `LEAD_PIPELINE_TEST_E_RESULTS.md`). Behind
`LEAD_PIPELINE_ENABLED` (off). Not deployed; held migrations not applied. No
live run since Test V. Live test E is proposed below and needs approval.

**LeadOcean evaluation closed (2026-10-31): CONDITIONAL GO — see `LEADOCEAN_FINAL_VERDICT.md`. Live provider tests are off by default (`AGENTORY_PROVIDER_LIVE_TESTS=enabled` opens one approved run).**

## Standard architecture: LeadOcean → Apify → Agentory → ATLAS

This is Agentory's standard discovery workflow. Each provider has one job:

| Layer | Responsible for | May it decide eligibility? |
|---|---|---|
| **LeadOcean** | Company and decision-maker discovery; initial ICP narrowing (industry, HQ country, size, seniority, `hasPhone`); funding and contact-availability flags | **No.** Its rows enter as `leadocean_discovery` evidence, at most `plausible`. |
| **Apify** | Company identity, HQ and size (`harvestapi/linkedin-company`, one batched read); optional posts and hiring for ranking | Only through `AUTHORITY_RULES`: one HQ-flagged location and a declared size band, on a record whose identity matches. |
| **Agentory** | Dedupe, screening, the shared engine (`evaluateEligibility`), ranking, cost ledger, holds, the Leads/ATLAS rows | **Yes.** It is the only qualifier. |
| **ATLAS** | Review queue: `lead_candidates` `qualified` (eligible) and `new` (needs verification) | It reviews; nothing is sent. |

Execution order, with spend gated at each step:
1. LeadOcean discovery, one approved page at a time.
2. Dedupe by domain, LinkedIn URL and person group, plus the walk checkpoint. Then screen: a row whose OWN data contradicts a hard requirement (e.g. 900 employees for 11–200) is `screening: screened_out`. That is a cost decision, not a disproof: it is excluded, not verified, and not written to the Leads tables.
3. Apify verifies identity, HQ and size for each screened-in company. There is one batched run, and one URL per LinkedIn company.
4. The shared engine decides: `eligible`, `pending` (needs verification) or `ineligible` (a proven fact contradicts a requirement).
5. Optional signals run only for eligible companies that are not held from outreach. A missing signal never blocks.
6. Phone lookups (off unless approved) run only for eligible, unblocked decision-makers that have a phone flag.
7. Projection writes ATLAS rows. Eligible companies become `qualified`, pending ones become `new`. Rejected and screened companies get no row. An existing Lead is updated, never re-created.

Refusals before any spend:
- `contradictory_requirements` (e.g. at least 500 and at most 50 employees, or no role).
- A LeadOcean failure blocks the walk.
- An Apify batch whose worst case exceeds its ceiling buys nothing (`skipped_budget`).
- A failed Apify run counts its worst case and is never retried (`charge_uncertain`).

Offline proof: `tests/edge-functions/_shared/leadPipeline/tenCompanyArchitecture.test.ts` (ten companies; wrong HQ, wrong size, no record, no LinkedIn, duplicate people, a duplicate LinkedIn with a conflicting domain, a held Lead, a screened row, a signal-free eligible company, Apify failure, budget exhaustion, contradiction, LeadOcean failure).

**Funding.** LeadOcean's `company_funding` is a ranking claim. It is not a qualifier, and a year alone is not a date. Atomus funding corroboration is **not wired into this pipeline**: neither ICP requires funding. A mission that makes funding a hard requirement belongs on the Apify engine's verified funding route (Contract 3), until Atomus is added here as an approved step.

## Flow

```
ICP config ──► compiler (real) ──► LeadOcean people search (narrowed, excludeIds from checkpoint)
   │                                  │ redacted rows, idempotent pages, ledger
   │                                  ▼
   │                        merge + dedupe (domain / LinkedIn / person_group_id)
   │                                  ▼
   │        history: existing Leads keep ids · CRM / holds block outreach only
   │                                  ▼
   │   Apify harvestapi/linkedin-company by LinkedIn URL ─► Apify engine evidence items
   │                                  ▼
   │       shared engine (evaluateEligibility via verifyLeads) = the only qualifier
   │                                  ▼
   │   Apify signals (eligible only, optional): company posts, jobs; LeadOcean funding
   │                                  ▼
   └────────────► ranking (lanes from eligibility; named factors) ─► phone lookups
                                      ▼            (eligible, unblocked, has_phone, top N)
                   queue / review / excluded + yield report + checkpoint
```

Code: `supabase/functions/_shared/leadPipeline/` — `icp.ts`, `checkpoint.ts`,
`exclusions.ts`, `history.ts`, `canonical.ts`, `signals.ts`, `ranking.ts`,
`phones.ts`, `metrics.ts`, `pipeline.ts`, `apifyInvoker.ts`, `projection.ts`,
`service.ts`; edge function `supabase/functions/lead-pipeline/`.

## Five statuses, never merged

| status | values | decided by |
|---|---|---|
| discovery | new · existing · duplicate_prior_walk | identifiers vs Agentory records and the walk checkpoint |
| screening | passed · screened_out · prior_walk | the discovery row's own data (cost gate before Apify; never a disproof) |
| qualification | eligible · pending · ineligible | the shared engine only |
| enrichment | not_requested · not_eligible_for_lookup · skipped · verified_person_direct · unverified_person_associated · company_switchboard · invalid_or_mismatched · no_number | phones.ts |
| outreachReadiness | ready_for_review · blocked · not_ready | eligible + decision-maker + person-associated number + no hold. **Never "ready to call"**: a human reviews; nothing is sent or dialled by this code. |

## Rules the tests pin

- A LeadOcean people row never carries employer HQ; HQ (and the size band) is
  decided only from the Apify company record. Without it a lead stays `pending`.
- "B2B SaaS" / "agency services" are ranking relevance and LeadOcean narrowing,
  never hard criteria (no exact vocabulary match exists; as a gate nothing qualifies).
- Undated or future-dated signals are `undated` and score 0. Relative text
  ("2 weeks ago") is not a date. A funding year alone is not a date.
- A failed or unavailable signal source → that type `unavailable`; eligibility unchanged.
- A provider phone is `unverified_person_associated` at best. `verified_person_direct`
  needs independent number evidence (not the provider) **and** independent current
  employment. LeadOcean's own current-employer flag is `provider_consistent`.
- No number in any form (value, E.164, hash) leaves `contactValues`; reports carry `masked`.
- Every paid call is reserved in the usage ledger first; a settled key replays, an
  uncertain charge is never re-bought; no automatic retries of metered calls.

## Feature flags (all off by default)

`LEAD_PIPELINE_ENABLED`, `LEAD_PIPELINE_WORKSPACES`, `LEAD_PIPELINE_SIGNALS_ENABLED`,
`LEAD_PIPELINE_PHONES_ENABLED`; plus the provider-discovery flags for LeadOcean
(`PROVIDER_DISCOVERY_ENABLED`, `PROVIDER_LEADOCEAN_ENABLED`,
`LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED`). Apify needs `APIFY_API_TOKEN`; without
it canonical records and signals are unavailable and nothing qualifies on HQ.

## Provider capability comparison (for this pipeline)

| need | LeadOcean | Apify | Apollo |
|---|---|---|---|
| ICP people search (US, size, role) | yes — `/v1/search`, hqCountry, min/maxEmployees, title, seniority, industry, hasPhone; 1 record/row | no general people search used | People API Search **403 on this plan** |
| Employer HQ proof | no (people rows carry none; company rows are a claim ≤ plausible) | yes — `harvestapi/linkedin-company` HQ-flagged location, $0.004/company | — |
| Size proof | claim only (headcounts ran low vs LinkedIn in Test L) | declared band, $0.004/company | — |
| Posts / hiring / expansion / leadership | — | profile & company posts $0.002/post; job search $0.001/job + $0.001/start | — |
| Funding | `company_funding` (claim, in the row, no extra cost) | atomus funding $0.0035/company (not wired) | — |
| Phone | `/v1/people/phone` 1 record (found or not), mobile/direct/office; `dnc` published but unpopulated (null = unknown) | — | not tested |
| Independent phone verification | — | — | — (**gap**: no carrier/HLR check in the stack) |

## Account state (free reads, 2026-10-31)

LeadOcean: Free plan, **lifetime** ceiling 1,000 records, 15 used, **985
remaining**, no reset, refused past the ceiling; scopes search + enrich.
Audience (free counts, mailable default): ICP A + `hasPhone` 84,001 people at
34,572 companies; ICP B + `hasPhone` 20,865 people at 7,704 companies.
Apify: **not authenticated from this session** (401 token-not-provided).

## Live test E (approved and run 2026-10-31 — results in LEAD_PIPELINE_TEST_E_RESULTS.md)

`scripts/lead-pipeline-test-e.ts --icp a` (dry run prints this exactly):

| step | input | ceiling |
|---|---|---|
| LeadOcean people search | 1 page, `{"limit":10,"order":"ranked","slim":false,"hqCountry":["US"],"minEmployees":11,"maxEmployees":200,"title":[Founder, Co-Founder, CEO, Chief Executive Officer, Chief Revenue Officer, VP of Sales, VP Sales, Head of Sales, Head of Revenue],"industry":["Software Development","Technology; Information and Internet","IT Services and IT Consulting"],"seniority":["owner","founder","c_suite","vp","head"],"hasPhone":true}` | ≤10 records |
| Apify company records | ≤10 LinkedIn URLs from the rows, one batched run | ≤$0.05 |
| Apify signals | eligible only: company posts ≤3 (3 months) + jobs ≤5 (month, US) per company | ≤$0.13 |
| LeadOcean phone lookups | eligible, unblocked, has_phone, top-ranked, ≤5 | ≤5 records |
| **total worst case** | | **15 LeadOcean records ($0 on Free), ≤$0.18 Apify** |

Approval string: `leadocean=15,apify_usd=0.18`. Guards: exact approval match;
free preflight on both accounts; LeadOcean wire guard (search ≤1 page ≤10 rows,
phone ≤5, each request once, nothing else); Apify allowlist with
`maxTotalChargeUsd` per run; ledger reservation; 120 s timeouts count the worst
case and stop; no DB writes, no outreach. Reconciliation: LeadOcean
`/v1/account` before/after vs charged; Apify per-run caps vs reported usage.

**Prerequisite:** an Apify token reachable from the session that runs it (Network
Secret for `api.apify.com`, `Authorization` header), or run E in the Apify session.

## Yield and the 50 / 100 estimate

`metrics.ts` measures every stage and uses Wilson 95% lower bounds. Until Test E
measures them, the rates below are **assumptions**:

| scenario | eligible after canonical | number is person-associated | discovered for 50 | for 100 | lookups (50 / 100) |
|---|---|---|---|---|---|
| assumed | 50% | 60% | 191 (cons. 237) | 381 (cons. 474) | 91 / 181 |
| pessimistic | 30% | 40% | 477 (cons. 675) | 953 (cons. 1,350) | 147 / 293 |

With 985 lifetime LeadOcean records, 50 person-associated numbers fit in either
scenario; 100 fits only the assumed one. **Independently verified** direct numbers
cannot be produced at all today (no verifier). Yield levers already built: the
`hasPhone` search narrowing (free), lookups only after eligibility (no record spent
on ineligible leads), top-ranked first, Apify company reads only for non-rejected rows.

## Known gaps / blockers

1. Phone yield unmeasured: the Network Secret covers `/v1/*` only (v2 → 401); lookups now use `/v1/people/phone` behind a free auth probe. Test P1 proposed.
2. No independent phone verification source → `verified_person_direct` stays 0.
3. Held migrations (`20261027120000_provider_connections`, `20261031120000_lead_pipeline_checkpoints`) not applied.
4. `/v2/people/phone` response shape is documented, not yet observed live (test E observes it).
5. LeadOcean Free plan is a lifetime 1,000-record ceiling, not monthly.
6. `enrich.ts` (PR #195) shares the discovery mission's ledger scope, so its provider cap counts discovery records; the pipeline's phone path uses its own scope. Fix separately.

# Lead pipeline live test E — results (2026-10-31)

Approved: ≤15 LeadOcean records, ≤$0.18 Apify, no retries, no CRM writes, no outreach.
Run once (`scripts/lead-pipeline-test-e.ts --icp a`, plan hash `3df2fd31`). A first
attempt was refused at preflight before any paid request (account body parser,
fixed in `e8088a31`; nothing consumed, no lock written).

## Reconciliation

| | before | after | charged by the run | cap |
|---|---|---|---|---|
| LeadOcean records | 985 remaining | 975 remaining | 10 (search) + 0 (phone, 401) | 15 |
| Apify monthly usage | $0.216974 | $0.286348 | Δ $0.069375 (pipeline estimate $0.0884) | $0.18 |

15 Apify runs (1 company-record run of 10, 7 × company posts, 7 × job search), all
HTTP 201, each under its own `maxTotalChargeUsd`. Wire: `GET /v1/account`,
one `POST /v1/search`, one `POST /v2/people/phone` (401), `GET /v1/account`. No
retries; no database writes; nothing sent.

## Outcome

| stage | count |
|---|---|
| discovered (unique, new) | 10 |
| Apify company record read | 10 / 10 |
| eligible (shared engine) | 7 |
| ineligible | 3 — 2 HQ outside the US, 1 above 200 employees (all on the Apify record) |
| pending | 0 |
| decision-maker role | 7 / 7 eligible (all co-founders: CEO, CRO, VP Sales) |
| provider phone flag | 7 / 7 (search narrowed with `hasPhone`) |
| phone lookups | 1 attempted → 401, lookups stopped; 0 records charged |

Signals (eligible companies): 18 dated company posts (15 within 60 days, 3 stale),
4 dated job postings (none for a revenue role), 1 stale funding event, 1 stale
low-confidence expansion cue. 6 of 7 job searches returned nothing.

## Findings

1. **Phone lookups failed authentication.** `/v1/search` succeeded with the
   proxy-injected key; `/v2/people/phone` returned 401. Not billed. Likely the
   Network Secret / key does not cover the `/v2` path (the MCP `find_phone` works
   on the OAuth key). Needs the key/secret checked before phone yield can be measured.
2. HQ is decisive and only the Apify record decides it: 2 of 10 LeadOcean
   "US" rows were non-US-HQ companies; 1 was over the size bound.
3. Eligibility after the canonical record: 70% (assumption was 50%).
4. Apify cost per discovered candidate: ~$0.007 actual; ~$0.04 for the company
   records, ~$0.03 for signals.
5. Job search by company yields little at this size band; company posts carry
   real dates and were the main signal.
6. Ranking: all seven are founders with a phone flag, so role + phone dominate;
   signals added little (no relevant hiring).

Nothing in this file names a person. The full run report (with names and LinkedIn
URLs, no phone values) is kept outside the repository.

## Follow-up: the phone 401 (resolved in `00588094`)

Root cause, confirmed with rejected requests (LeadOcean: "Requests we reject are
not counted"; account counter 25 used / 975 remaining before and after):

| request (empty body / invalid) | result |
|---|---|
| `POST /v1/people/phone {}` | 400 Validation failed → key accepted |
| `POST /v1/search {"limit":0}` | 400 Validation failed → key accepted |
| `POST /v2/people/phone {}` (placeholder key) | 401 Missing or malformed x-api-key |
| `POST /v2/people/phone {}` (no key header) | 401 Missing or malformed x-api-key |

The workspace Network Secret for `api.leadocean.io` is injected on `/v1/*`
only; on `/v2/*` LeadOcean receives the placeholder. The code's header format
(`x-api-key`) matches the OpenAPI scheme on every path. The MCP `find_phone`
works because it authenticates with LeadOcean's OAuth connection, not the
Network Secret. Fix: lookups use `POST /v1/people/phone` (same cached lookup and
price per the OpenAPI), preceded by a free empty-body auth probe that stops
all lookups on 401/403. Widening the secret to `/v2/*` would also work.

Next: phone-only test P1 (`scripts/lead-pipeline-phone-test-p1.ts`), top five
eligible Test E prospects, ≤5 LeadOcean records, $0 Apify — proposed, awaiting approval.

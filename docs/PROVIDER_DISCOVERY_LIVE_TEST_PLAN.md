# Apollo and LeadOcean live tests: proposals and exact budgets (v2)

Status: **proposed; nothing metered has been run.** Both connections are verified with free calls
(`docs/PROVIDER_CAPABILITIES.md`).

Each test below needs a **separate approval by name**. Approving one test approves nothing else.

Every figure here is the **server's own worst case**. `benchmarkRunner.ts` computes it from the
committed cohort. The test "the REAL cohort's live worst case, planned with no fetch" pins it, and
the runner refuses a whole run before any call if its worst case exceeds the approved units.

## Shared rules (both tests)

**Input.**
- `benchmarks/provider-discovery/cohort.json`:
  - A01 LangChain (`langchain.com`);
  - A02 Baseten and A03 Oscilar (LinkedIn only).
  - The cohort was selected read-only from the TEST project, which holds no other real companies
    and no decision-makers.
- Group C is `mission-c-proposal.json`, compiled by the real compiler and identical for both
  providers: 10 US-headquartered companies, 51–200 employees, with their VP of Sales where
  available.

**Never.**
- Enrichment, contact reveal, exports, `people/viewed`, `add_to_my_prospects`.
- Writing to a CRM, HubSpot or Leads.
- Messages or calls.
- The Apollo adapter physically can't reach anything outside search and usage (`ALLOWED_PATHS`).

**Retries.** Never for a paid request that may have billed:
- A timeout, transit failure or 5xx on a paid call becomes `charge_uncertain`, the ledger holds it,
  and nothing re-buys it.
- 429 and 503 are retried at most twice, and only within a Retry-After of 30 s or less, because
  neither bills.

**Stop conditions.** The provider stops at its first:
- `auth_failed`
- `plan_restricted` / `forbidden_scope`
- `allowance_exhausted` (402)
- `charge_uncertain`

The steps after it aren't sent.

**Result limits.**
- Each known-company lookup is limited to 1 row.
- Group C reads 1 page of 10.
- No verification step, no fallback provider.

**Data.**
- Search rows have their contact values redacted on arrival.
- The report holds availability flags and statuses only.
- Results go to a session file, not the repository.

**Reconciliation.**
- The ledger records settled units per step under idempotent keys.
- LeadOcean: `records.used` before and after (from the free account read) must equal the ledger's
  units, otherwise the run reports `reconciled: false`.
- Apollo has no balance API: compare its in-app Credit usage page with the ledger's units.

## Test L: LeadOcean (Free plan; unit = records)

| Step | Input | Operation | Records, worst case |
|---|---|---|---|
| L1 known companies | A01 by `domain`; A02, A03 by `linkedin` | `search/companies`, `limit` 1, one call per slot | **3** |
| L2 group C | `hqCountry` US, min/maxEmployees 51/200, `title` "VP of Sales" | `search` (people), `limit` 10, one page, `slim` | **10** |
| **Total** | | | **≤ 13 records** |

**Money: $0.**
- The Free plan never bills. The 13 records come out of the account's 1,000 lifetime records, which
  is 1.3%.
- When the allowance runs out, LeadOcean answers 402 and charges nothing.

**Worst-case monetary cost:** $0.

**Already done, free:** all three cohort companies exist in LeadOcean by exact identifier
(`count_companies`, 0 records), and group C's pool is 6,395 companies for 0 records.

**How it runs.** The runner uses LeadOcean's REST API, so it needs a LeadOcean key available to the
session:
- either a `LEADOCEAN_API_KEY` environment variable;
- or a Network Secret for `api.leadocean.io`, used the same way as Apollo's.

The connected MCP server spends the same account allowance, but the runner can't drive it. Running
L by hand through MCP tools would bypass the ledger and the budget gate, so I don't propose that.

## Test P: Apollo (Professional Trial; unit = credits)

| Step | Input | Operation | Credits, worst case |
|---|---|---|---|
| P1 known company | A01 `langchain.com` | Organization Search (`q_organization_domains_list`), `per_page` 10, one page | **1** |
| P2 group C | `organization_locations` United States, `organization_num_employees_ranges` 51,200 | Organization Search, `per_page` 10, one page | **1** |
| A02, A03 | No domain held; Apollo filters companies by domain only, and a name search would be a guess | Not sent | 0 |
| **Total** | | | **≤ 2 credits** |

**Ending early.** If this trial plan also excludes Organization Search, P1's 403 bills nothing and
stops the test at **0 credits**. Answering that question is P1's main purpose.

**People.** People API Search is unavailable on this plan, so group C runs as Organization Search
and returns no contacts. Measures 2, 7 and 8 are then not applicable to Apollo.

**Money.** The 2 credits come from the trial's allowance. Apollo's API can't read that balance or
its price, so **I'm asking for a hard ceiling of $1.00** (up to $0.50 per credit). Check that the
trial still has credits in the app before approving.

## Optional test V: canonical evidence (owned by the Apify session)

Without canonical evidence, every Apollo and LeadOcean lead stays `needs_verification`. That's the
shared engine working correctly, but it leaves "qualified yield" at 0 and "cost per qualified"
undefined.

Measuring those needs the Apify engine to read the company record of each company discovered in L2
and P2: at most 20 records, or 23 including the cohort.

The other session owns that spend and its $3 canary budget. **It isn't part of this approval.** I'll
ask the Apify session for its per-company figure first. Its last published worst case for
`harvestapi~linkedin-company` was $0.00405 per start plus 1 company.

## How the providers will be compared (`benchmark.ts`, identical rules)

1. Company matching accuracy, by exact identity.
2. Decision-maker accuracy: same person, same employer, in the role. Not applicable while group B is
   unfilled.
3. HQ verification, against proven truth only. The cohort holds no proven HQ yet, so this needs V.
4. Unique companies **qualified by the shared engine**, plus how many passed only the provider
   checks.
5. Duplicate rate.
6. Overlap between providers.
7. Phone candidate coverage, from flags.
8. Independently verified direct-number coverage. This is 0 until independent evidence exists, by
   design.
9. Latency: p50, p95, max.
10. Cost per qualified result. Null, never 0, when nothing qualifies.

Plus:
- **Evidence quality:** checks answered by a returned value, versus a filter the provider claims,
  versus nothing.
- **Freshness:** the age of the provider's own update stamp.

## Totals for approval

| Test | Units, worst case | Money, worst case |
|---|---|---|
| L (LeadOcean) | ≤ 13 records | $0 |
| P (Apollo) | ≤ 2 credits | ≤ $1.00 (hard ceiling) |

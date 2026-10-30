# Apollo and LeadOcean live tests: proposals and exact budget

Status: **proposed. Nothing in this plan has been run.** No paid request has been sent, and no
key exists in the environment yet.

Each test needs your approval of its stated budget. Approving one test approves only that test.

Pricing sources, read 2026-10-30:
- Apollo: [API pricing](https://docs.apollo.io/docs/api-pricing).
- LeadOcean: the [OpenAPI spec](https://api.leadocean.io/openapi.json) and the
  [pricing page](https://leadocean.io/pricing).

## What every live test shares

**Cohort:** `benchmarks/provider-discovery/cohort.json`, selected read-only from TEST.
- A01 LangChain, A02 Baseten, A03 Oscilar.
- A04–A10 and B01–B10 are unfilled. The TEST project holds no further real companies and no
  decision-makers.
- Group C is one fixed mission, run unchanged on both providers: "10 US-headquartered B2B SaaS
  companies, 51–200 employees, and their VP of Sales".

**Never in any test:**
- enrichment of a person, or a reveal of email or phone;
- exports;
- writing to a CRM, HubSpot or Leads;
- messages or calls;
- LeadOcean's `people/viewed`;
- a retry of a paid request.

**What happens to the data:**
- Search rows have contact values redacted on arrival (`orchestrator.redactContactValues`).
- Results go to a session scratch file, not to the repository.

**Software protections:**
- The usage ledger (`budget.ts`) reserves every paid page under an idempotent key before sending
  it.
- A page whose charge is uncertain is marked `uncertain` and never sent again.
- The per-provider cap is `min(approval, server estimate)`, so an approval can't raise spend.
- The approval is bound to the plan hash.
- Paging stops as soon as the provider checks are satisfied.
- One attempt per operation, a 15-second timeout, and no automatic retry of anything paid.

**External effects:** read-only searches against each provider's dataset. Nothing is created or
changed on either account, except that:
- the account's usage counters increase;
- Apollo may log the API calls in its usage stats.

## Step 0: free access check (no cost; needs only the keys)

`deno run --allow-env --allow-read --allow-net=api.apollo.io,api.leadocean.io scripts/provider-access-check.ts --out <scratch>/access.json`

| Provider | Operations | Units consumed | Money |
|---|---|---|---|
| Apollo | `usage_stats/api_usage_stats`, `mixed_people/api_search` (`per_page`=1) | 0 credits | $0 |
| LeadOcean | `GET /v1/account`, `/v1/usage`, `/v1/filters/companies`, `/v1/companies/count` ×4 (A01–A03 and the mission) | 0 records | $0 |

This step establishes:
- the account identity (LeadOcean: account id and masked email);
- the plan, records or credits left, key scopes and rate limits;
- whether the Apollo key is a master key (People API Search and usage stats need one);
- the response field names, which settle #195's open item on LeadOcean `FIELDS`;
- LeadOcean's free exact-identity coverage of A01–A03.

The results decide whether steps 1 and 2 are needed as written. If LeadOcean holds none of
A01–A03, for example, its step 1 is dropped.

## Test L: LeadOcean (unit: records, 1 per row returned)

| Step | Input | Operation | Records, worst case |
|---|---|---|---|
| L1 known-company match | A01 by `domain`, A02 and A03 by `linkedin` | `POST /v1/search/companies`, `limit`=1, one call per slot | **3** |
| L2a discovery: companies | mission C filters (hqCountry, employees 51–200, SaaS keyword) | `POST /v1/search/companies`, `limit`=10, one page | **10** |
| L2b discovery: decision-makers | title "VP Sales", the L2a domains | `POST /v1/search`, `limit`=10, one page, `slim` | **10** |
| **Total** | | 3 searches (L2b only if L2a returns rows) | **≤ 23 records** |

**Money:**
- **$0 marginal on any plan.** LeadOcean is flat-priced and has no per-record charge.
- On the Free plan, the 23 records come out of a one-time allowance of 1,000 (2.3%); when it runs
  out, LeadOcean answers 402 and charges nothing.
- On paid plans, an exhausted window slows requests down; it doesn't bill.

**Worst-case monetary cost:** $0 beyond the subscription you already hold.

**Protection:** a ledger cap of 23 records, and `PlanLimits.maxCreditsPerMission` set to 23.

**Caveat:** the spec says an enrichment costs 1 record "whether or not it finds anything", while
the pricing page says misses are free. That's irrelevant here because no test enriches.

## Test P: Apollo (unit: credits)

| Step | Input | Operation | Credits, worst case |
|---|---|---|---|
| P1 known-company match | A01 by domain (`q_organization_domains_list`); A02 and A03 by name, then verified by LinkedIn URL | Organization Search, `per_page` ≤ 5, one page per slot | **3** (1 per page) |
| P2a discovery: companies | mission C (`organization_locations` US, `organization_num_employees_ranges` "51,200", SaaS keyword tag) | Organization Search, `per_page`=10, one page | **1** |
| P2b discovery: decision-makers | title "VP Sales", the P2a organization ids | People API Search, `per_page`=10 | **0** |
| **Total** | | 4 paid pages | **≤ 4 credits** |

**Money:** 4 credits from your plan's existing allowance. The monetary value depends on your plan.
Step 0 reads the plan, and I'll restate the figure before you approve.

**Worst-case monetary cost:**
- I haven't confirmed Apollo's per-credit price for your plan. **I'm asking for a hard ceiling of
  $1.00**, which allows up to $0.25 per credit. Step 0 reports the real figure, and if it's higher,
  I'll come back to you before running anything.
- If Apollo bills more credits than its documentation states, the ledger records the overbilling
  and the run stops at the next page.

**Protection:** a ledger cap of 4 credits, the approval bound to the plan hash, and People API
Search `include_similar_titles: false`.

## Optional test V: canonical evidence for qualification (owned by the Apify session)

Without canonical evidence, every provider lead stays `needs_verification`, which is by design.
That leaves benchmark measures 4 and 10 ("unique qualified" and "cost per qualified") at
0 and null.

Measuring them needs the existing Apify engine to:
- read the company record of each company discovered in L2a and P2a (at most 20 after the union);
- run its grounded website check for the business-model criterion.

That spend belongs to the Apify engine's guarded worker and its $3 canary budget, and the other
session owns it. I'll ask that session for its own per-company price before proposing this.
**It isn't part of this approval.**

## Total for this approval

| | Units | Worst-case money |
|---|---|---|
| Step 0 (free) | 0 | $0 |
| Test L | ≤ 23 LeadOcean records | $0 marginal |
| Test P | ≤ 4 Apollo credits | ≤ $1.00 |
| **All** | | **≤ $1.00** |

## Before any paid step

1. Add `APOLLO_API_KEY` and `LEADOCEAN_API_KEY` as environment secrets for this cloud
   environment. Never paste them into chat.
2. Run step 0 and review its report.
3. Confirm commercial terms, though for this internal test it's informational only. LeadOcean
   grants resale and embedding only on its Platform plan, and Apollo's API Terms for
   customer-facing use are still to confirm (`docs/PROVIDER_DISCOVERY.md` §5.1).
4. Check the production holds (outreach history, CRM relationship, existing Lead IDs) for
   A01–A03. TEST holds none.
5. Approve L and/or P by name with the budget above.

The live runner reuses the orchestrator and ledger, and comes with its own offline rehearsal
before the first paid call.

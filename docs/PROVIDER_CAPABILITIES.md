# Apollo and LeadOcean: verified access, real capabilities, limitations

Last verified 2026-10-31, using free operations only. No paid call has been made.

Sources:
- Apollo: the [API reference](https://docs.apollo.io/reference/organization-search) and the
  [pricing page](https://docs.apollo.io/docs/api-pricing).
- LeadOcean: the OpenAPI 1.0.0 spec (sha256 `743a760a…`, kept in
  `supabase/functions/_shared/discoveryProviders/vocabulary/leadocean.json`) and the connected MCP
  server's free tools.

## 1. Access

| | Apollo | LeadOcean |
|---|---|---|
| **Authentication** | **PASS.** The key is a cloud Network Secret that the proxy adds. `usage_stats` (no credits, master key only) returned 200 | **PASS.** Checked through the MCP connector's `get_account` (free) |
| **Identity** | One team user, `k***@gmail.com` | `p***@agentory.space`, email verified, not suspended |
| **Plan** | **Professional (Trial)** | **Free**: 1,000 records for the life of the account. Past the ceiling, requests are **refused**, not billed |
| **Key** | Master key | Scopes `search` and `enrich`; the OAuth key is "Connected apps" |
| **Remaining** | Apollo has **no API for the credit balance**. Check the app's Credit usage page | 1,000 of 1,000 records |
| **Rate limits** | 600/day, 200/hour, 50/min on the search endpoints (the documented Free-plan figures) | 5 requests/s, 300/min; **at most 2 count queries in flight** (429 `too_many_aggregations`) |
| **People search** | **Unavailable on this plan.** `mixed_people/api_search` returns 403 `API_INACCESSIBLE` | Available |
| **Organization Search** | **Unknown.** A denial is free, but a success costs 1 credit, so it needs approval (test P1) | Available |

**`auth/health` proves nothing here.** It returns `is_logged_in: true` for any header, because the
proxy injects the real key. Use `usage_stats` instead.

## 2. Which requirements each provider can genuinely answer

A requirement is **native** only when every value translates **exactly** into the provider's
vocabulary (`vocabulary.ts`). Otherwise the provider is **refused** for that requirement, and the
search is never quietly widened. Filtering is not the same as evidence: the shared engine
(`evaluateEligibility`) treats every provider row as at most *plausible*.

| Requirement | Apollo | LeadOcean | Evidence that can prove it |
|---|---|---|---|
| HQ country | Filter (`organization_locations`). **Not returned** in rows | Filter (`hqCountry`, ISO-2) **and** returned | The company record (one HQ-flagged location) |
| HQ state / city | Filter | Filter (keyword match through the employer, ≤50k companies, otherwise reported as `unsupportedFilters`) | The company record |
| Employee range | Filter (`"min,max"`). **Not returned** | Filter (min/maxEmployees; companies with no figure are excluded) and returned | The company record's declared band |
| Industry | **No exact filter** (`organization_industries` takes Apollo's own lowercase names; the vocabulary is unverified) | Filter (a closed enum of 534 labels, exact labels only) | A grounded website statement or an evaluator verdict with receipts |
| Excluded company type | No | Company search: `excludeKeywords`. People search: an exact industry label only | As industry |
| Funding stage | No exact filter | `fundingType` (the most recent round): pre-seed, seed, Series A–D. **Series E is refused** because LeadOcean's "Series E-J" is wider | The canonical funding pair |
| Recently funded (a window) | No | Year only (`minLastFundingYear`), **never a date**, so it can't answer a window | The canonical funding pair (dated rounds) |
| Hiring / dated postings | Org Search can filter by job title and posting date, but returns no postings. Job Postings costs 1 credit per page and is not called | **None** | Apify job evidence |
| Known company (exact) | Domain only | Domain or LinkedIn URL (`linkedin` / `companyLinkedin`) | Identity on the company record |
| Role / decision-maker | Title filter (`include_similar_titles=false`). Unavailable on this plan | `title` keywords, `seniority`, `jobLevel` | Provider-reported titles only. No canonical source re-reads a title |
| Person location | Filter | Filter (`country`, ISO-2) | None |
| Current employment | The person's current organization, **by name only** | `contact_current_experiences` | None. Always provider-reported |
| Contact data | Flags only (`has_email`, `has_direct_phone`) | Flags in search; values only through enrichment (1 record, separate authorization) | A phone is never verified by a provider (`enrich.ts`) |

## 3. Limits the code now enforces

- **Apollo people rows name the employer only.** There's no id or domain, so they never merge with
  another provider's company, and no website check can target them.
- **Apollo Organization Search rows carry no HQ, size or industry**, so Apollo can filter on these
  but never prove them. Rows come back under both `organizations` and `accounts`.
- **Apollo pagination is page × per_page.** `per_page` stays constant, and a short last page is
  truncated rather than re-requested.
- **When the free key check finds a plan restriction**, that search kind is refused at plan time.
  A company mission falls back to Organization Search, without contacts.
- **LeadOcean bills per row returned.** `limit` asks for no more than the step may take. Company
  search keeps financials; people search uses `slim`.
- **LeadOcean row field names are unconfirmed beyond the few the spec names.** This includes the
  funding fields. Missing paths read as *unknown*, never as met. One approved row (test L1)
  settles them.
- **LeadOcean's own data disagrees with the Apify record.** For LangChain, LeadOcean's band is
  51–200 with no HQ held, while the Apify company record (2026-10-30) counted 469 members. A
  provider band alone never settles this.

## 4. Vocabulary mismatch: why group C has no industry

Agentory's controlled vocabulary (`businessModelMatch.ts`) reads "B2B SaaS". LeadOcean has no exact
label for that, and LeadOcean's labels ("Software Development") fall outside that vocabulary. So no
industry wording is decidable by both: one provider is refused, or every company stays pending.
Closing the gap needs a reviewed label map between the two vocabularies, which is not part of this
change.

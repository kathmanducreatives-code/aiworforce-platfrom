# ATLAS discovery baseline: Apify, LeadOcean and combined strategies

**Mode:** offline. Synthetic provider data (`.example` companies), network blocked, no model call, no spend.
**Code:** `launch/hardening` at `9bb332c` (Option E complete; TEST READY on that build).
**Reproduce:** `deno run --allow-read --allow-write --allow-env scripts/dev/discovery-benchmark-report.ts`. Add `--check` to compare with the recorded baseline instead of writing it.
**Files:** `baseline.json` (machine-readable), `baseline.csv` (one row per scenario), `index.html` (dashboard).

Every scenario runs through the real Option E path: the mission compiler (from a recorded model reading), the strategy planner (semantic plan hash), the approval check, the multi-provider executor, the ledger contract and the lead projection. Only the providers are stand-ins. LeadOcean's stand-in honours the request's domain filter and row limit, because LeadOcean bills per row returned.

---

## Phase 0: capability and safety audit (read-only)

### Provider adapters

| | Apify (pipeline allowlist: `PIPELINE_ACTORS`) | LeadOcean (`adapters/leadocean.ts`) |
|---|---|---|
| Discovery used by ATLAS | `harvestapi/linkedin-job-search` (companies by a dated open role). Post search is catalogued but not approved. | `POST /v1/search` (people + employer rows). `/v1/search/companies` exists in the adapter, but **no strategy uses it** |
| Filters | job title (fuzzy; post-filtered), location | roles, HQ / person country (ISO enum), industry (closed enum, via `vocabulary.translate`), employee range, domain / LinkedIn |
| What it can **prove** | identity, hiring (dated posting); with `harvestapi/linkedin-company`: HQ (HQ-flagged location) and declared size band | nothing. HQ, size and funding are claims (HQ wrong for about 29% of companies, `LEADOCEAN_FINAL_VERDICT.md`) |
| Enrichment fields | company record: name, website, HQ location, size band, industry label, description | person, title, seniority, employer (name, domain, industry, headcount), `company_data` (NAICS, HQ, funding) |
| Cost unit | USD per item + per start. Job search $0.001 / item + $0.001 / start; company record $0.004 / item + $0.00005 / start | **records** (1 per row returned). Free plan: 1,000 lifetime, 955 left at the last measured check. **Paid per-record price never measured** |
| Maximum charge | `maxTotalChargeUsd` = the step's worst case on every run; at most 100 items; one attempt, no retry | the plan's `max_leadocean_records`; the ledger's provider cap; LeadOcean refuses past the plan's ceiling |
| Actual cost reporting | **none.** `run-sync` returns no charge, so the ledger records the worst case for the items returned. The benchmark labels Apify cost as an *upper bound* | `meta.credits` per page |

### Accounts and TEST state (checked without reading any secret)

| Check | Result |
|---|---|
| TEST deployment | **READY** at `9bb332c`: all 27 smoke checks pass (P0–P7, ledger untouched, no lead writes, production untouched) |
| Apify on TEST | `PROVIDER_APIFY_DISCOVERY_ENABLED` set; `APIFY_API_TOKEN` configured (owner-confirmed). **Billing identity not verifiable from this session:** the token exists only as a TEST function secret. Last documented: Starter plan, $19 / month |
| LeadOcean on TEST | **Not connected.** `workspace_provider_connections` has no row for any workspace. `PROVIDER_LEADOCEAN_ENABLED` and `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED` are absent. Every live LeadOcean scenario is **BLOCKED** on TEST until the owner connects it and approves the flags |
| Ledger | `provider_usage_ledger`: 0 rows. Unique `(workspace_id, idempotency_key)`; `provider_usage_reserve` takes an advisory lock and refuses `in_flight` or `charge_uncertain` reservations |
| Signed-plan approval | in force: token bound to workspace, plan hash and walk, expiring in 24h; `strategy_run` makes 0 model calls (Option E report) |
| Workspace isolation, budgets | allowlist and membership checked before the token; role check, approval at or above the estimate, ceiling at most $5 at parse |
| Production holds | unchanged. The run-agent replay gate (49 unapproved stored-mission changes) still blocks any production run-agent deploy. Nothing here touches production |

### What can run today

- **Supported:** Apify alone (signal-led); LeadOcean alone (review only: it proves nothing); Apify → LeadOcean (decision-makers at verified companies); LeadOcean → Apify (HQ and size verification of LeadOcean's companies).
- **Not supported:**
  - LeadOcean company enrichment;
  - Apify hiring *verification* of a company found elsewhere, since job search is discovery only;
  - parallel discovery from both providers;
  - Apify firmographic discovery with no signal, such as "manufacturers".

---

## Results: the 12-scenario matrix

| ID | Scenario | Verdict | Why |
|---|---|---|---|
| A1 | Apify: US companies hiring AEs | **FAIL** | Northwind and Quartz qualify correctly, but Glowcart (SDR posting) and two manufacturers (Sales Representative postings) also qualify as "hiring Account Executives". Precision 0.40 against ground truth (**D1**) |
| A2 | LeadOcean: US B2B SaaS, 20–500 | PASS | 3 unique companies from 4 records; 0 qualified; all for review; limitation stated (LeadOcean proves nothing) |
| A3 | Apify: US manufacturers hiring sales reps | PASS | both manufacturers found; "manufacturing" stays hard and unverified (a label proves no industry), so 0 qualified, 6 for review |
| A4 | LeadOcean: US insurance agencies, 10–100 | **FAIL** | the stated industry became a **preference**: the model wrote "insurance agency", the request says "agencies", so the compiler treated it as inferred (**D2**) |
| B1 | Apify → LeadOcean company enrichment | UNSUPPORTED | no LeadOcean company-enrichment capability in the registry; LeadOcean is used only for decision-makers |
| B2 | LeadOcean → Apify hiring verification | UNSUPPORTED | the planner refuses: "hiring signal (last 30 days) cannot be proven" on that chain (job search discovers; it does not verify a named company) |
| B3 | Both discover US manufacturers + dedup | UNSUPPORTED | no strategy has two discovery steps, and Apify has no firmographic discovery |
| B4 | Hiring OR expansion | **FAIL** | the OR is lost: hiring becomes hard and expansion only a preference, so a company that is only expanding can never qualify. The expansion limitation is also not stated (**D3**). "Funding OR hiring" compiles correctly |
| C1 | US-headquartered, hiring AEs | PASS | scope = headquarters; Toronto HQ rejected |
| C2 | Operating in the US | PASS | scope = **presence**, not headquarters |
| C3 | Prefer B2B, allow B2C | PASS | B2B is a preference; no hard business-model requirement |
| C4 | Hiring SDRs or AEs | **FAIL** | when the model lists the two roles separately, "SDR" is dropped: only "account executives" reaches the requirement and the search (**D4**). Glowcart qualifies only through D1 |

**Matrix: 5 PASS · 4 FAIL · 0 BLOCKED · 3 UNSUPPORTED.**

Outside the matrix:

| ID | Run | Verdict | Note |
|---|---|---|---|
| X1 | Apify → LeadOcean (founder/CEO at hiring companies) | PASS | LeadOcean was asked only for companies not disproven (Maple excluded); 3 records |
| X2 | LeadOcean → Apify (founders, verified 20–200) | PASS | Maple rejected on its record; Quartz's band (11–50) straddles 20, so it stays for review; precision 1.0, recall 0.5 |
| F1 | Fault: HQ in "Atlantis" | **FAIL** | **6 companies qualify**, including Toronto (**D5**) |
| F2 | Fault: HQ in "Texas" | **FAIL** | 6 qualify; only Northwind is in Texas (precision 0.17) (**D5**) |

### Failure injection (all pass: `tests/edge-functions/_shared/discoveryBenchmark.test.ts`)

| Fault | Behaviour |
|---|---|
| empty job search | 0 candidates, no company record bought, 0 writes |
| incomplete company records | 0 qualified, 0 rejected on missing data (all for review) |
| duplicate postings | collapse to the same companies |
| job-search timeout | one attempt, no retry; worst case recorded; ledger `uncertain`; nothing downstream bought; a retry of the same walk does not re-buy |
| company-record timeout | 0 qualified; `uncertain`; not retried |
| interrupted run (charged, never settled) | the re-run never re-buys the in-flight step |
| duplicate execution | each step bought once |
| LeadOcean empty / HTTP 500 | 0 companies and 0 records / error reported, nothing qualifies, no crash |
| invalid geography | **fails today**; recorded as F1/F2 (D5) rather than asserted away |

---

## Apify vs LeadOcean (offline, same rules)

| | Apify alone (A1) | LeadOcean alone (A2/A4) |
|---|---|---|
| Discovers by | a dated signal (open roles) | firmographic filters (country, industry label, size) |
| Can qualify a company | **yes** (HQ + size + hiring proven) | **no.** Every lead needs review (HQ / size are claims) |
| Unique companies per run | 7 from 10 postings | 3 from 4 records, 2 from 2 |
| Cost (upper bound) | $0.035 Apify | 4 / 2 LeadOcean records ($0 on the free plan; paid price unknown) |
| Cost per *truly* qualified | **$0.0175** (2 true of 5 counted) | n/a (0 qualifiable) |
| Weakness measured | role-family over-matching (D1); geography fallback (D5) | cannot verify anything; free-plan records are finite (955) |

## Combined strategies

| | Apify → LeadOcean (X1) | LeadOcean → Apify (X2) |
|---|---|---|
| What LeadOcean adds | the decision-maker (founder/CEO) at verified companies | the starting list of companies |
| What Apify adds | discovery by signal + HQ / size proof | HQ / size proof (it rejects LeadOcean's wrong HQ) |
| Qualified (true) | 2 (+2 false via D1) | 1 (precision 1.0) |
| Cost | $0.031 Apify + 3 records | $0.012 Apify + 4 records |
| Cost per truly qualified | $0.0155 + 1.5 records | $0.012 + 4 records |
| Bought for unverified companies? | people only for not-disproven companies (Maple excluded); still bought for 1 pending company | records bought before verification (by design: LeadOcean is the discovery) |

**Most verified, qualified companies per dollar, offline:** Apify-led discovery. It is the only path that discovers by a dated signal *and* proves HQ, size and hiring; LeadOcean alone can never qualify. Apify → LeadOcean is the right shape when people are wanted. This ranking needs the live pilots to confirm against real data.

---

## Defects (ATLAS) vs provider-data limitations

### ATLAS defects (fixable in our code)

| # | Severity | Defect | Evidence | Smallest fix |
|---|---|---|---|---|
| **D5** | **Critical** | A hard HQ geography ATLAS doesn't recognise (unknown place, US state) is **matched by any proven HQ**, including a foreign one | F1, F2. `candidateEligibility.ts` geography check: `geographyContradicts()` returns "not a contradiction" for an unrecognised requirement, and the hard check turns that into **pass** | an unrecognised requirement is `unknown` (needs review), never `pass`; a positive match is required to pass. **Shared engine:** this changes stored missions (e.g. "New York or California"), so it goes through the production replay gate |
| **D1** | High | "Hiring Account Executives" qualifies any sales-family posting (SDR, Sales Representative) | A1 precision 0.40. `requestedHiringFromSignals` enforces exact titles only when broadening is forbidden | **product decision:** named titles match exactly (family only when the user names a family, e.g. "salespeople") |
| **D4** | High | Two roles the model lists separately ("SDR", "Account Executive") keep only one | C4. `readSignalPhrases` folding; the single-phrase form keeps both with `role_match: any` | fold every declared role term into the hiring signal (any-of) |
| **D2** | Medium | A stated industry in a different singular/plural form than the request becomes a preference | A4 ("insurance agency" vs "insurance agencies") | match the quoted value on word stems |
| **D3** | Medium | "Hiring OR expansion" loses the OR (expansion becomes a preference) and the limitation isn't stated | B4 | extend the cross-signal OR rule (already right for funding/hiring) to every signal pair; state an unprovable branch as a limitation |

### Provider-data and capability limitations (not ATLAS bugs)

- LeadOcean HQ, size and funding are claims: about 29% of HQs are wrong (measured earlier). It can discover but never qualify alone.
- Industry is unprovable: a taxonomy label isn't proof. Industry-defined requests (A3) stay review-only with today's evidence sources.
- Apify job titles are fuzzy (post-filtered), and the run reports no actual charge (cost is an upper bound).
- No capability verifies hiring for a company found elsewhere (B2), and none discovers or proves expansion (B4).

---

## Phase 3: live pilots (prepared, NOT executed; each needs separate approval)

| Pilot | Ceiling | Ready? | What is missing |
|---|---|---|---|
| **Apify** | **$0.05** | **Ready to run**: `scripts/owner-pilot-run.ts` (owner-run; TEST only; `apify_only`; 0 LeadOcean records; at most 3 companies; plan hash typed to approve) | Your approval. Caveat: D1 means an SDR-only company may be counted as "hiring AEs". Read the posting title on each qualified company, or fix D1 first |
| **LeadOcean** | proposed $0.20 → **must be a record cap** (e.g. ≤ 20 records) | **BLOCKED** | (1) connect LeadOcean in the TEST workspace (owner, through provider-connections; never in chat); (2) approve `PROVIDER_LEADOCEAN_ENABLED` + `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED` on TEST; (3) LeadOcean bills in records (free plan), so a dollar cap can't be enforced: approve a record cap instead; (4) the pilot script needs a `--strategy leadocean_only` mode (small PR, owner merge) |
| **Combined** | $0.75 | after both pass | the same LeadOcean prerequisites; script mode `apify_plus_leadocean` |

Every paid run keeps: an independently approved plan (hash typed by the owner), a signed token bound to workspace, walk and 24h, owner/admin role at run time, TEST only, ledger idempotency, no automatic retry, no phone, contact purchase or outreach.

---

## Roadmap: the smallest set that makes ATLAS consistently useful

1. **Fix D5** (critical, small): an unrecognised geography is never a pass. Shared engine, so it goes through the production replay gate.
2. **Decide and fix D1:** exact titles when the user names titles. Without this, "hiring AEs" results overstate.
3. **Fix D4 and D3:** every listed role reaches the requirement; an either/or across any signals stays either/or. Both are compiler changes with corpus cases.
4. **Fix D2:** stem matching for quoted industries.
5. **Run the Apify pilot** ($0.05, already prepared) and record real precision against posting titles.
6. **Connect LeadOcean on TEST**, set a record cap and run the LeadOcean and combined pilots.
7. Only then consider new capabilities (company enrichment, hiring verification of a named company, firmographic discovery), chosen by the pilots' measured gaps.

Items 1–4 are each small, offline-testable compiler or engine changes. With them, the 4 FAIL scenarios and F1/F2 should flip to PASS, and every change shows in this baseline (`--check`).

# Lead V2 quality regressions

Permanent regression tests from the **Lead V2 result-quality run of 2026-10-06** (202 catalogue
queries through local pilot-chat at `1222a20e`, plus 46 Replay Lab probes). Each test encodes the
**expected correct behaviour** from the consolidated failure report. It does **not** encode what the
code does today.

```bash
npm run test:lead-v2-quality
```

## These tests are expected to fail until Fix Wave 1 lands

A test here fails while its root cause is unfixed and passes once it is fixed. The suite is
deliberately **not** run by CI and is **not** part of `npm run test:lead-v2-readiness` (which runs
`tests/replay/` only), so a red result here does not block a merge. It tells Account B which
fixes are done. When a root cause is fixed, its tests turn green; at that point consider promoting
them into the readiness gate.

Each test name reads `[quality <root cause> <query ID>] <expected>  (was: <current wrong result>) — <boundary>`,
and every case is registered in `lib/cases.ts` with the quality query ID, the original query, the
current wrong result, the expected result and the root-cause ID (index below).

## Boundaries, and the one limitation

| Boundary | What enters the pipeline |
|---|---|
| `recorded` | The run's own output (`fixtures/quality-run-2026-10-06.json`: the pilot-chat reply and compiled `LeadMissionV1`, verbatim) through the deterministic downstream. |
| `reconstructed` | A `RequestV1` rebuilt from the sentence, through the real `projectToLeadMission` → `compileRequestMission` / `compileLeadMission` → `deriveMissionCriteria` → graph → claim plan. |
| `fixture` | A Replay Lab golden-mission variant: production engine, verifiers, canonical view, continuation and real queue SQL, with zero network. |
| `pure` | Production functions called directly. |

**Limitation (compiler cases).** pilot-chat does not persist the `RequestV1` Chat Brain produced, so
the compiler cannot be replayed from the run itself. The `reconstructed` cases hand the chain the
`RequestV1` the sentence most plainly expresses in RequestV1's own vocabulary. During the run, the
serve log recorded Chat Brain's shape per query: objective, entity, count, filter *fields* and
requirement *events*, but not the values. Every reconstruction was checked against the recorded card
and reproduces the recorded wrong result. These tests prove what the **deterministic** chain does
with a faithful reading. They cannot see a fix or a regression made **only** in the Chat Brain prompt.
Persisting `RequestV1` on the card would remove this limitation.

Specific consequences:

- **Negation (RC01).** `RequestV1` filters can say `op: "not"`, but requirements carry no polarity,
  so a negated *signal* is passed positively, as the recorded cards show Chat Brain did. The test
  asks that the chain, which still holds the sentence, not compile the opposite of it.
- **Z08 window leak (RC06).** Reconstructed without a hiring recency, the chain gives hiring@30, so
  Z08's recorded 730-day hiring window came from Chat Brain itself. Z08 is therefore not encoded;
  RND39 and J07 reproduce the leak deterministically and are.
- **L05 ("funded recently OR hiring sales")** is not encoded: `RequestV1` has no any-of across
  requirements, so there is no faithful reconstruction.

## Corrections made while writing the tests

- **L03 (RC02).** The run report said a California company *fails* "New York". It does not.
  `geographyContradicts` compares countries only, so no sub-national value contradicts another. The
  criteria are still two independent hard claims (AND); the test guards the any-of and passes today.
- **U01.** A failed job search is retried in later slices under the **same** idempotency key and
  released each time (nothing charged). That is not a duplicate purchase; the guard asserts exactly that.

## Not encoded (no agreed expected behaviour yet)

These were QUESTIONABLE in the run:

- T08: size from `employeeCount` alone.
- V10: one over-ceiling company refuses a whole batch.
- V15: a dearer settlement leaves a company over its ceiling with no overrun flag.

## Case index

| Test ID | Root cause | Boundary | Original query | Current wrong result | Expected |
|---|---|---|---|---|---|
| H05 | RC03 | reconstructed | Find companies with more than 100 employees. | hard company_size {min:100,max:0} — every LinkedIn band FAILS, incl. 201–500 and 1001–5000 | an open-ended range: 201–500, 1001–5000 and 10001+ pass; 11–50 fails |
| H05 | RC03 | pure | Find companies with more than 100 employees. | validateLeadMission turns employee_range {min:100,max:null} into {min:100,max:0} (Number(null) === 0) | validateLeadMission keeps an absent upper bound absent (max null or omitted, never 0) |
| H07 | RC03 | pure | Find companies around 50 employees. | hard company_size {min:0,max:0} (an all-null range validated to zeros) — no company can ever pass | an unbounded range never becomes a {0,0} hard size requirement |
| H06 | RC03 | recorded | Find companies between 20 and 100 employees. | hard company_size 20–100 that no LinkedIn band can pass — every company stays pending, card shown as feasible | a hard size requirement is satisfiable by at least one declared band, or it is disclosed as unprovable (not an ok hard claim) |
| H08 | RC03 | recorded | Find 5 AI companies with 25–75 employees. | hard company_size 25–75 that no LinkedIn band can pass — every company stays pending, card shown as feasible | a hard size requirement is satisfiable by at least one declared band, or it is disclosed as unprovable (not an ok hard claim) |
| P01 | RC03 | recorded | Find 100 US AI companies with exactly 17 employees. | hard company_size exactly 17 that no LinkedIn band can pass — every company stays pending, card shown as feasible | a hard size requirement is satisfiable by at least one declared band, or it is disclosed as unprovable (not an ok hard claim) |
| P04 | RC03 | recorded | Find 100 recruiting agencies with exactly 42 employees. | hard company_size exactly 42 that no LinkedIn band can pass — every company stays pending, card shown as feasible | a hard size requirement is satisfiable by at least one declared band, or it is disclosed as unprovable (not an ok hard claim) |
| K03 | RC01 | reconstructed | Find companies outside the United States. | HARD geography = United States (inverted) | no United States geography requirement; the exclusion is carried, or the request is clarified |
| G08 | RC01 | reconstructed | Find companies serving the US but headquartered outside the US. | HARD geography = United States (inverted) | no US headquarters requirement; HQ-outside-US carried as an exclusion, or the request is clarified |
| K05 | RC01 | reconstructed | Find recently funded AI startups that are not currently hiring sales. | HARD hiring (gtm_sales) — job searches bought to find companies that ARE hiring | no positive hiring criterion; 'not hiring sales' carried as an exclusion, or the request is clarified |
| K01 | RC01 | reconstructed | Find AI companies that are NOT hiring sales. | target hiring (gtm_sales) — ranks hiring companies HIGHER | no positive hiring criterion; the exclusion is carried, or the request is clarified |
| K02 | RC01 | reconstructed | Find AI companies that have NOT raised venture funding. | target funding — ranks funded companies HIGHER | no positive funding criterion; the exclusion is carried, or the request is clarified |
| E07 | RC01 | reconstructed | Find companies that received grants but have not raised venture funding. | target funding (any round) — venture-funded companies rank HIGHER | venture funding carried as an exclusion (no positive venture/any-funding criterion), or the request is clarified |
| F12 | RC01 | reconstructed | Find companies hiring sales roles but not engineering roles. | 'not engineering roles' dropped silently — no exclusion anywhere on the card | the engineering-roles exclusion is carried, or the request is clarified |
| L03 | RC02 | reconstructed | Find companies in New York or California. | two independent HARD geography claims (New York AND California); masked today because geography only contradicts at country level | a company proven in California passes the geography requirement |
| L04 | RC02 | reconstructed | Find AI or developer-tools companies. | two HARD industry claims (AI AND developer-tools) — a proven AI company stays pending on developer-tools | a company proven to be AI satisfies the industry requirement |
| E05 | RC02 | reconstructed | Find 5 AI companies that raised Series A or Series B. | hard company_stage = series_a only — Series B dropped | the stage requirement admits both series_a and series_b |
| J06 | RC02 | reconstructed | Find 10 US recruiting-tech companies with 11–50 employees that raised Seed or Series A funding and are hiring sales. | hard company_stage = seed only — Series A dropped, so Series A companies are excluded | the stage requirement admits both seed and series_a |
| A09 | RC04 | reconstructed | Is Anthropic hiring account executives? | hiring is a TARGET — the job search the question asks for is never run | hiring is a HARD claim verified per company |
| A10 | RC04 | reconstructed | Does OpenAI have open sales roles? | hiring is a TARGET — the question is never answered | hiring is a HARD claim verified per company |
| A08 | RC04 | reconstructed | Check whether Delta Lake has open sales positions. | hiring is a TARGET | hiring is a HARD claim verified per company |
| F01 | RC04 | reconstructed | Find 5 companies hiring salespeople. | hiring is a TARGET — the card has ZERO hard claims | hiring is a HARD claim verified per company |
| N03 | RC04 | reconstructed | Find me some AI companies that are actually hiring sales rn. | hiring is a TARGET | hiring is a HARD claim verified per company |
| S04 | RC04 | reconstructed | Find companies hiring sales right now. | hiring is a TARGET — the card has ZERO hard claims | hiring is a HARD claim verified per company |
| A05 | RC05 | reconstructed | Has LlamaIndex raised venture funding? | REFUSED (UNSUPPORTED, no_requirement_provable: "Nothing scheduled can establish funding") — while A06 ("recently") compiles a verifiable hard funding claim for the same company | a feasible card with a hard, verifiable funding claim for LlamaIndex |
| S01 | RC05 | reconstructed | Find companies funded this year. | funding is a TARGET (279-day window correct, kind wrong) — nothing rejects a company funded last year | funding is a HARD claim on the year-to-date window |
| E01 | RC05 | reconstructed | Find 5 AI startups that have raised venture funding. | funding is a TARGET — unfunded companies qualify | funding is a HARD claim |
| RND39 | RC06 | reconstructed | Find 10 developer tools companies funded in the last 24 months hiring sales. | hiring carries the FUNDING window (730 days) — a two-year-old posting proves 'currently hiring' | hiring keeps its own window (30 days, 'currently / actively hiring'); funding keeps 730 |
| J07 | RC06 | reconstructed | Find 20 US AI infrastructure companies with 11–200 employees that have raised institutional funding in the last two years and currently have at least one revenue-related opening. | hiring carries the FUNDING window (730 days) — a two-year-old posting proves 'currently hiring' | hiring keeps its own window (30 days, 'currently / actively hiring'); funding keeps 730 |
| C07 | RC07 | reconstructed | Find 10 AI infrastructure companies. | hard_constraints['company_profile.locations'] = united states, reason "stated explicitly in the user's query", while field_provenance says company_brain — sent to the evaluator as a hard constraint | a location the user did not state is never recorded as a hard constraint stated by the user |
| A01 | RC07 | reconstructed | Check whether LlamaIndex currently has an open sales role. | hard_constraints['company_profile.locations'] = united states, reason "stated explicitly in the user's query", while field_provenance says company_brain — sent to the evaluator as a hard constraint | a location the user did not state is never recorded as a hard constraint stated by the user |
| A01 | RC08 | reconstructed | Check whether LlamaIndex currently has an open sales role. | requested_count null → effective 5; a YES for LlamaIndex ends search_exhausted '1 of 5' | one supplied company, no stated count → requested 1; one qualified → completed |
| R01 | RC08 | reconstructed | Find LlamaIndex and Llama Index. | two supplied companies (LlamaIndex, Llama Index), requested 2 — one real company, so the quota can never be met | one supplied identity; the requested count cannot exceed the distinct companies supplied |
| T07 | T07 | fixture | golden QUALIFIED card (hard US) — company record: HQ Toronto, Canada (headquarter: true) + an Austin, US office (headquarter: false) | geography PASS → qualified, quota_met → completed: a Canadian-headquartered company satisfied a hard US requirement | hard geography reads the headquarters: geography is not pass and the company is not qualified |
| T02 | T02 | fixture | golden QUALIFIED card (sales role open in the last 30 days) — the job search returns one Account Executive posting with NO posted date | hiring PASS → qualified, completed: `withinWindow` treats an undated posting as inside the 30-day window | an undated posting does not prove 'currently hiring': hiring is not pass and the company is not qualified |
| T10 | RC14 | fixture | golden QUALIFIED card — every hard claim proven (US, 11–50, Series A 200 days ago, an AE role 5 days old) | bucket low_priority — the lowest qualified label, because the company_profile anchor has no evidence dimension and is never proven | a company proving every hard requirement is labelled at least strong_opportunity |
| T01 | T | fixture | golden QUALIFIED card — a sales posting 45 days old (window 30) | hiring not pass, not qualified (correct in the run) | hiring is not pass and the company is not qualified |
| T03 | T | fixture | golden QUALIFIED card — an engineering posting for a SALES requirement | hiring not pass, not qualified (correct in the run) | hiring is not pass and the company is not qualified |
| T04 | T | fixture | golden QUALIFIED card — a posting from a DIFFERENT company | hiring not pass, not qualified (correct in the run) | hiring is not pass and the company is not qualified |
| T05 | T | fixture | golden QUALIFIED card — a Series A 800 days ago (window 730) | funding not pass, not qualified (correct in the run) | funding is not pass and the company is not qualified |
| T06 | T | fixture | golden QUALIFIED card — a round with no date | funding not pass, not qualified (correct in the run) | funding is not pass and the company is not qualified |
| T09 | T | fixture | golden QUALIFIED card — a declared band of 51–200 with employeeCount 48 | company_size not pass, not qualified (correct in the run) | company_size is not pass and the company is not qualified |
| U05 | U | fixture | golden QUALIFIED card — a company record with no locations | geography not pass, not qualified (correct in the run) | geography is not pass and the company is not qualified |
| T10 | T | fixture | golden QUALIFIED card — every hard claim proven | every proven hard claim cites its provider evidence (correct in the run) | funding cites Atomus and hiring cites the job posting |
| U01 | U | fixture | golden QUALIFIED card — the job search throws | no crash; hiring unknown; not qualified; the search ends (correct in the run) | no crash, not qualified, the failed job search is never paid for and is one purchase identity across retries, the lineage ends |
| U02 | U | fixture | golden QUALIFIED card — Atomus throws, Pvalyou knows nothing | funding unknown, not qualified (correct in the run) | funding never passes without evidence |
| U03 | U | fixture | golden QUALIFIED card — company details throws | size and geography unknown, nothing bought for the company, not qualified (correct in the run) | no crash, not qualified, no verifier purchase for an unresolved record |
| U06 | U | fixture | golden QUALIFIED card — page 1 lists the same company three times (case / trailing-slash variants) | Atomus and the job search each bought once (correct in the run) | one company, each verifier bought once |
| U07 | U | fixture | golden QUALIFIED card — no job posting, Atomus has no rounds, Pvalyou has nothing | not qualified; ends within four slices (correct in the run) | no qualification and no continuation loop |
| V01 | V | pure | per-company $0.06 ceiling: $0.00 + $0.035 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V02 | V | pure | per-company $0.06 ceiling: $0.0098 + $0.049 = $0.0588 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V03 | V | pure | per-company $0.06 ceiling: $0.011 + $0.049 = exactly $0.06 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V04 | V | pure | per-company $0.06 ceiling: $0.0111 + $0.049 = $0.0601 | refused (candidate) — gate and reserve agree (correct in the run) | refused by the candidate ceiling; the pre-purchase gate and reserve give the same answer |
| V05 | V | pure | per-company $0.06 ceiling: $0.0235 + $0.035 = $0.0585 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V06 | V | pure | per-company $0.06 ceiling: $0.0235 + $0.049 = $0.0725 (Canary 8 Delta / Actioneer) | refused (candidate) — gate and reserve agree (correct in the run) | refused by the candidate ceiling; the pre-purchase gate and reserve give the same answer |
| V07 | V | pure | per-company $0.06 ceiling: $0.0236 + $0.035 = $0.0586 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V08 | V | pure | per-company $0.06 ceiling: $0.025 + $0.035 = exactly $0.06 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V09 | V | pure | per-company $0.06 ceiling: batch of 5, A at $0.05, share $0.0098 → $0.0598 | affordable — gate and reserve agree (correct in the run) | affordable; the pre-purchase gate and reserve give the same answer |
| V11 | V | pure | mission cap $0.05: $0.001 + $0.049 = exactly the cap | affordable (correct in the run) | affordable — equality fits |
| V12 | V | pure | mission cap $0.05: $0.0011 + $0.049 | refused by the mission ceiling (correct in the run) | refused by the mission ceiling |
| V13 | V | pure | mission_credits 3 with 3 paid calls, a 4th requested | refused by mission_credits (correct in the run) | refused by mission_credits |
| V14 | V | pure | a $0.049 job search settles at $0.019; then a $0.0201 funding call for the same company | company spend $0.019; the funding call is affordable (correct in the run) | the cheaper settlement frees headroom: spend reads $0.019 and the next call fits |
| V16 | V | pure | $0.0098 spent + a $0.0502 job search (= $0.06 per company, over the $0.05 hiring per-call ceiling) | refused by the per-call ceiling (correct in the run) | refused by the per-call ceiling |
| W09 | RC16 | pure | a slice ended on a provider failure (providerFailed: true), 0 of 5 qualified, discovery routes remain | continue: replenishment_required — the replenishment branch runs before the provider-failure stop, so an outage keeps buying slices until two are barren | stop with provider_failure (frontier preserved); no further slice is dispatched |
| W01 | W | pure | continuation: qualified == requested | quota_met (correct in the run) | stop: quota_met → completed |
| W02 | W | pure | continuation: qualified > requested | quota_met (correct in the run) | stop: quota_met → completed |
| W03 | W | pure | continuation: cost units at the 40-unit cap | cost_ceiling (correct in the run) | stop: cost_ceiling → budget_exhausted |
| W05 | W | pure | continuation: max continuations reached | continuation_ceiling (correct in the run) | stop: continuation_ceiling → budget_exhausted |
| W06 | W | pure | continuation: two barren slices | no_progress (correct in the run) | stop: no_progress → search_exhausted |
| W07 | W | pure | continuation: verification routes remain, frontier empty | verification_required (correct in the run) | continue: verification_required |
| W08 | W | pure | continuation: a provider run is still executing | awaiting_provider_run (correct in the run) | continue: awaiting_provider_run |
| W11 | W | pure | continuation: nothing left anywhere | frontier_exhausted (correct in the run) | stop: frontier_exhausted → search_exhausted |
| W13 | W | pure | continuation: verification routes remain but the cost cap is hit | cost_ceiling (correct in the run) | stop: cost_ceiling → budget_exhausted |

# Lead Quality Benchmark Handoff — 2026-10-10

## Goal

Prove whether Agentory can actually return enough genuinely qualified leads
with a realistic bounded production budget.

Do NOT start with the hardest funding+hiring query.

Run the benchmark sequentially:

1. Query B — hiring only
2. Query C — funding only
3. Query A — funding + hiring

Only move to the next query after reviewing the previous result.

---

## Current production state

Railway worker:
- deployment: 5705298d
- build sha: 8e4df609
- health: ok / polling

Edge functions:
- pilot-chat: affc7df0 / v204
- orchestrate: cd9ee4b2 / v115
- run-agent: cd9ee4b2 / v267

Current mission caps:
- LEAD_V2_MISSION_PROVIDER_USD_CAP=0.80
- LEAD_V2_MISSION_CREDIT_CAP=40
- scoped workspace: e8af257d-4c42-4fc2-9d62-037cdfac27c4
- MODEL_SPEND_CEILING_USD=5.00

Do NOT change the 0.80 / 40 caps.

Previous production checks showed:
- 0 queued missions
- 0 stuck missions
- 0 unsettled provider calls
- $0 provider spend in previous 24h
- $0 model spend in previous 24h

Recheck all of these immediately before Start.

---

## Query B — RUN THIS FIRST

Exact query:

Find 3 US software companies with 11–50 employees that are currently hiring sales.

Expected compiled hard criteria:

- industry: software
- geography: United States
- company size: 11–50 employees
- hiring: sales
- hiring window: 30 days
- requested count: 3

No funding requirement.

Current offline compile already verified:

- software is one hard criterion
- no duplicate industry criteria
- sales hiring is HARD
- hiring window = 30 days
- count = 3
- Company Brain does not add another hard industry
- Company Brain only adds soft stage preferences

Discovery entry:
LinkedIn job search

Claim plan:

- hiring proof comes primarily from discovery job postings
- geography + size from company details
- industry from company details
- Firecrawl website verification only if company details cannot settle software
- job-search fallback available when needed

Rough costs:

- discovery: roughly $0.02–0.04 per job-search call
- company details: ~ $0.004/company
- Firecrawl industry verification: ~ $0.019/company when needed
- hiring fallback: ~ $0.011 when needed
- candidate: roughly $0.005–0.025

Expected full run:
approximately $0.15–0.50

Current maximum:
$0.80 provider spend
40 paid-call credits

Do NOT increase caps automatically.

---

## Query B benchmark success

Requested qualified companies:
3

A lead counts ONLY if all hard evidence is proven:

1. United States
2. declared company size 11–50
3. software industry
4. real sales-related job opening
5. posting date <= 30 days

Pending evidence does not count.

Collect:

DISCOVERED:
ENRICHED:
FULLY VERIFIED:
QUALIFIED:

REJECTED:
- geography:
- size:
- industry:
- hiring:
- unresolved:

PROVIDER SPEND:
PAID CALLS:
MODEL SPEND:

COST PER QUALIFIED LEAD:
CANDIDATES PER QUALIFIED LEAD:

TERMINAL STATE:

QUALIFIED COMPANIES:
1.
2.
3.

MANUAL EVIDENCE CHECK:
1. PASS/FAIL
2. PASS/FAIL
3. PASS/FAIL

FALSE POSITIVES:

---

## If Query B fails

Do NOT rerun.
Do NOT increase the budget.

Choose one primary diagnosis:

- DISCOVERY_RECALL
- DISCOVERY_RELEVANCE
- HIRING_DATA
- QUALIFICATION_LOGIC
- BUDGET
- PROVIDER_FAILURE

Stop and review before Query C.

---

## If Query B passes

Stop and report.

Do NOT automatically run Query C.

Query C, once approved:

Find 3 US B2B SaaS companies with 11–50 employees that raised venture funding in the last 24 months.

This isolates funding.

Only after Query B and Query C are understood should Query A run.

---

## Query A

Do NOT run yet.

Find 3 US B2B SaaS companies with 11–50 employees that raised funding in the last 24 months and are currently hiring sales.

Known compile detail:
"B2B SaaS" currently creates two hard industry criteria:
- b2b saas
- saas

This must be proven semantically harmless before Query A or C is run.

Check whether:
- both use the same evidence
- one can pass while the other fails/pends
- duplication can reject a valid B2B SaaS company
- qualification/ranking changes
- a regression test exists

If the criteria can disagree, stop and fix/audit first.

---

## Production run safety

Immediately before Start verify:

- Railway healthy
- expected worker SHA
- expected edge-function SHAs
- 0 active missions
- 0 queued/stuck missions
- 0 unsettled provider calls
- 0 reserved credits
- caps still exactly $0.80 / 40

Use a production-connected LOCAL frontend because public Netlify production
is still stale.

Do not run paid provider calls without explicit user approval.

Do not retry automatically.

Do not run Query B, C, and A in one sequence without approval between them.

---

## Existing query audit

The full deterministic query audit found:

- total cases: 66
- PASS: 52
- FAIL: 7
- PARTIAL: 5
- UNTESTED: 1
- intentionally unsupported: 1

The canonical production smoke query passes the deterministic chain.

Known remaining query issues include:
- VC funding interpreted as generic funding
- OR across requirements becomes AND
- "at least one sales opening" becomes soft
- "raised a Seed round" treated as current stage
- Seed/Angel drops Angel
- Pvalyou is_non_equity dropped
- full-width Unicode dedup failure

Query B avoids these known failures.

---

## Next action

Preparation only.

Before running Query B, return:

CURRENT WORKER:
CURRENT EDGE BUILDS:
CURRENT CAPS:
ACTIVE MISSIONS:
UNSETTLED PROVIDER CALLS:
RESERVED CREDITS:

QUERY B COMPILED CARD:
QUERY B CLAIM PLAN:

EXPECTED HARD CRITERIA MATCH: YES/NO

ESTIMATED PROVIDER COST:
ESTIMATED CANDIDATES CHECKABLE:

SAFE TO RUN QUERY B:
YES/NO

Then wait for explicit approval.

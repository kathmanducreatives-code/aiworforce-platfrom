# Diverse customer scenarios

## Boundaries

The twelve I-probes execute the actual pure compiler, criterion derivation and
enforced capability graph with supplied, recorded mock model proposals. **No GPT
stage, provider, persistence or UI ran in these probes.** The proposals are
inputs, not measurements of how a real model would interpret these requests.
Engine analogues below come from the separately rerun 40-scenario harness, which
injects only external model/provider responses and executes the real
engine/receipt/canonical/projection modules.

Readiness/Actor names below mean repository support, not current account
permission, billing authorization or live availability. No paid operation is
authorized. Positive and negative controls are both necessary.

## Four-snapshot engine scenario counts

| Snapshot    | PASS | FAIL | NOT SUPPORTED | BLOCKED | NOT TESTED |
| ----------- | ---: | ---: | ------------: | ------: | ---------: |
| integration |   13 |   12 |            10 |       3 |          2 |
| pr113       |   18 |    7 |            10 |       3 |          2 |
| pr123       |   19 |    6 |            10 |       3 |          2 |
| pr125       |   20 |    5 |            10 |       3 |          2 |

The four compiler assertions overlap engine cases. Q2 strict expectation tests
have 76 pass / 9 fail: five runtime mismatches plus four compiler assertions.
Characterization tests have 85 pass on each pin. H04 is safely unsupported at
runtime but fails semantic typing; do not count it as successful understanding.

The machine-readable [routing summary](evidence/routing-summary.json) contains
pins and compiler assertions. Full boundary traces (repetitive runtime
logs/checkpoint dumps omitted) retain original request, criteria, mandatory
signals, capability plan, Actor readiness, proposed/validated plan, synthetic
provider steps/evidence, parsed GPT receipts, canonical result, persistence
plan, Workbench/notice/task reductions, and resume where exercised:
[integration](evidence/integration-routing.jsonl),
[#113](evidence/pr113-routing.jsonl), [Q1](evidence/pr123-routing.jsonl),
[Q2](evidence/pr125-routing.jsonl).

Persistence is a pure projection/plan, not SQL writes. Customer notice is a
reducer output, not browser execution. F02 does not certify a full
funded-company mission: website/business proof is outside that harness. Such
boundaries are labelled in the traces.

## Twelve request families

### I01

> Find SaaS companies that must be hiring Account Executives in the last 30
> days.

**Status:** PASS compiler / bounded positive engine analogue.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=saas [hard];
hiring={'event': 'hiring', 'subject': 'company', 'qualifier': {'role_families':
['gtm_sales'], 'role_terms': ['account executives']}} [hard] window=30.

**Selected graph (actual):** job_discovery (apify_linkedin_job_search) →
job_deduplication → company_identity_resolution (apify_linkedin_company_search)
→ company_enrichment (apify_linkedin_company_details) → hiring_verification
(apify_linkedin_job_search) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** H01: fresh, open, matched-employer AE
posting qualifies in the real offline engine; no missing mandatory signal should
be inferred from ICP alone.

**Reasoning improvement:** Use existing call to interpret
titles/responsibilities; keep posted-date, status and employer checks in code.

### I02

> Find founders who might be considering outsourcing their outbound sales based
> on LinkedIn discussions.

**Status:** NOT SUPPORTED for LinkedIn discussion retrieval.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** unrecognised_signal=founder
discussions about outbound sales outsourcing [target].

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** L01/L02/L03/L07: unavailable comment
acquisition is not simulated as working. I02 becomes an unrecognised target
rather than a precise outsourcing-intent requirement.

**Reasoning improvement:** Clarify expressed outsourcing search versus a
speculative pain hypothesis; never label willingness to buy solely from company
growth.

### I03

> Find recruiting agencies that must be hiring internal salespeople, excluding
> client job advertisements.

**Status:** FAIL inherited employer-ICP routing.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=recruiting agencies
[hard]; hiring={'event': 'hiring', 'subject': 'company', 'qualifier':
{'role_families': ['gtm_sales'], 'role_terms': ['internal salespeople']}} [hard]
window=30.

**Selected graph (actual):** job_discovery (apify_linkedin_job_search) →
job_deduplication → company_identity_resolution (apify_linkedin_company_search)
→ company_enrichment (apify_linkedin_company_details) → hiring_verification
(apify_linkedin_job_search) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** H05: the recruiting-agency employer is
filtered before useful evidence can be evaluated. H06 preserves the separate
client-job attribution control.

**Reasoning improvement:** Claude Q3 should make routing obey explicit employer
ICP, retaining deterministic client-ad/employer ownership guards.

### I04

> Find growing manufacturing companies expanding production and struggling with
> outdated sales processes.

**Status:** FAIL intent coverage / full manufacturing workflow NOT TESTED.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=manufacturing [hard];
expansion={'event': 'expansion', 'subject': 'company', 'qualifier': {}}
[target]; unrecognised_signal=struggling with outdated sales processes [target].

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** Expansion and sales-process pain
become target-level/unrecognised clauses; graph selects general profile
research. No facility/news or pain evidence was purchased. C03 is an unsupported
combined-evidence analogue, not this manufacturing execution.

**Reasoning improvement:** Ask what observable evidence establishes outdated
sales processes; interpret production expansion separately from market/team
expansion; only propose actual supported source capabilities.

### I05

> Find companies that must have adopted Salesforce in the last 60 days,
> excluding resellers.

**Status:** FAIL mandatory preservation / acquisition NOT SUPPORTED.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** technology={'event': 'technology',
'subject': 'company', 'qualifier': {}} [target].

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** Adoption appears as a target criterion
despite must; no executable technology-adoption source is demonstrated. C03
covers the combined expansion/adoption refusal boundary.

**Reasoning improvement:** Retain adoption as mandatory; require attributed
implementation/completed-event evidence, not a job listing mentioning Salesforce
or a reseller service page.

### I06

> Find startups that must be hiring their first sales leader.

**Status:** PASS Q2 first-hire negative control / workflow unverified.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=startup [hard];
company_stage=startup [hard]; hiring={'event': 'hiring', 'subject': 'company',
'qualifier': {'role_families': ['gtm_sales'], 'role_terms': ['their first sales
leader'], 'first_in_function': {'phrase': 'first sales', 'source':
'user_explicit'}}} [hard] window=30.

**Selected graph (actual):** job_discovery (apify_linkedin_job_search) →
job_deduplication → company_identity_resolution (apify_linkedin_company_search)
→ company_enrichment (apify_linkedin_company_details) → hiring_verification
(apify_linkedin_job_search) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** H03 changes from unsupported
qualification on integration/#113/#123 to pending on Q2; H02 remains the
first-hire positive. The new startup/leader wording itself is compiler-only.

**Reasoning improvement:** Interpret commercial-role synonyms in the existing
call; require attributable first-in-function evidence and preserve Q2 UNKNOWN
when only an opening exists.

### I07

> Find software companies with confirmed seed funding in the last 90 days; hold
> conflicting funding reports.

**Status:** PARTIAL: compiler and funding-decision controls.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=software [hard];
company_stage=seed [target]; funding={'event': 'funding', 'subject': 'company',
'qualifier': {'round_type': 'seed'}} [hard] window=90.

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** Funding round/date and stage become
separate criteria; funding corroboration tests cover matching pair, incomplete
history, verified later round and unverified later round. New F01 feeds two
synthetic provider records through the real corroboration/stage decision:
matching Seed reports PASS; same-date Seed versus cited Series A records a rung
mismatch and FAIL (verified later round). This is a nonqualification control,
not a complete contradictory-news mission; that E2E is NOT TESTED.

**Reasoning improvement:** Distinguish separate rounds, conflicting descriptions
of one event and stale provider history. GPT interprets the passages; dedicated
funding completeness/date/ownership rules decide the claim.

### I08

> Find recruiting agencies that must be expanding into European markets within
> 90 days.

**Status:** FAIL mandatory/subject preservation.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=recruiting agencies
[hard]; geography=Europe [hard]; expansion={'event': 'expansion', 'subject':
'company', 'qualifier': {}} [target].

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** Expansion becomes target-level and
Europe becomes a current geography criterion; general-company discovery is
selected. Actual European expansion evidence execution is NOT TESTED.

**Reasoning improvement:** Freeze destination region on the expansion event
rather than assume headquarters/presence; plans must not become completed moves.

### I09

> Find B2B software companies hiring Account Executives OR funded in the last 90
> days, AND headquartered in the US.

**Status:** FAIL cross-signal expression.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=B2B software [hard];
geography=United States [hard]; hiring={'event': 'hiring', 'subject': 'company',
'qualifier': {'role_families': ['gtm_sales'], 'role_terms': ['account
executives']}} [hard] window=30; funding={'event': 'funding', 'subject':
'company', 'qualifier': {}} [hard] window=90.

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → hiring_verification
(apify_linkedin_job_search) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** C02 and this probe both produce
independent hard hiring/funding rather than the requested alternatives; funding
suppresses job-led discovery. C02 zero qualification has additional missing
business proof, so it is not an isolated fully-evidenced OR false-negative
proof.

**Reasoning improvement:** Claude Q3 expression/graph/canonical work first;
existing model proposes one grouped expression, code plans/proves either branch
while enforcing HQ.

### I10

> Find unusually efficient service companies with exactly 23 employees and a
> credible plan to grow, preferably founder-led.

**Status:** FAIL exact-size coverage / ambiguous concepts need clarification.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** industry=service [hard];
unrecognised_signal=credible plan to grow [target].

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** No company-size criterion represents
exactly 23 employees; credible growth becomes unrecognised target language. This
does not demonstrate real-model misunderstanding because the proposal is
supplied.

**Reasoning improvement:** Preserve exact range and optional founder preference,
clarify efficient/credible proxies, and block unsupported mandatory dimensions
instead of silently dropping them.

### I11

> Find founders explicitly seeking a CRM; exclude quotations, employees'
> opinions and statements that they are not looking for tools.

**Status:** NOT SUPPORTED acquisition; semantic risk E01.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** unrecognised_signal=founders
seeking a CRM [target].

**Selected graph (actual):** general_company_discovery
(apify_linkedin_company_search) → company_identity_resolution
(apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** L04/L05/L06 are
negative/employee/stale controls at unavailable social boundaries; no real
comments are collected. E01 separately accepts a genuine negative quote labelled
supports, while rejecting a fabricated quote.

**Reasoning improvement:** Improve existing interpretation to preserve speaker,
quotation scope and negation; do not treat those unavailable social controls as
tested live buying-intent accuracy.

### I12

> Research these approved existing Apollo leads and prepare source-backed call
> briefs. Do not find new prospects or send messages.

**Status:** PARTIAL primitives / connected workflow BLOCKED.

**Expected:** preserve all mandatory clauses and exclusions, use only
executable/authorized sources, hold missing evidence, and report the same
canonical result downstream. For ambiguous subjective concepts, clarify before
paid research.

**Compiled (actual mock-proposal boundary):** .

**Selected graph (actual):** known_company_resolution →
company_identity_resolution (apify_linkedin_company_search) → company_enrichment
(apify_linkedin_company_details) → company_brain_qualification → persistence.

**Actual evaluation/execution evidence:** Valid enriched_companies mock selects
known_company_enrichment/known-company resolution rather than general discovery.
No actual Apollo lead IDs or CSV are supplied here; research, briefing,
review/export and Apollo update E2E are NOT TESTED.

**Reasoning improvement:** Explicit approved existing-record IDs and client
scope; one source-backed writer, human review and manual handoff. Follow the
reviewed Outpost P1–P8 dependencies, not a new prospecting mission.

Raw proposed versus compiled contracts and graph objects for all twelve requests
are in [integration probes](evidence/integration-probes.json) and
[Q2 probes](evidence/pr125-probes.json). Compiler files are unchanged by Q2, so
its evidence fixes do not repair those upstream contracts.

## Scenario interpretation rules

A supported engine branch and passing mocked response do not establish semantic
model accuracy. Mandatory unsupported social/technology/expansion language must
stay visible as blocked/unsupported; adding a semantic model cannot enable an
unavailable source. A better writer can turn valid research into useful
questions, but cannot manufacture demand or a verified signal. No model is asked
to choose a qualification label independently of Q1–Q4.

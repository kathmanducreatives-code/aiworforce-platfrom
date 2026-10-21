# Discovery qualification hardening: independent handoff

Base: `b1ea21eb8d5b2589bafd142c9adaf7cdfddbdf63` (`launch/hardening`, includes
#108 and #109). This branch does not modify #110 or #112. **A7 remains NO-GO**
until independent review, final exact-SHA integration checks, external provider
readiness and explicit kickoff approval.

## Architecture and changes

User request → GPT mission proposal → validated mission/profile/criteria →
provider observations and field authority → existing batch evaluation → existing
mission evaluator → strict receipt parser → canonical eligibility → qualified
keys → lead/account persistence → task, dashboard and result panel.

The same evaluator now receives the compiler's criterion IDs, mandatory versus
preferred kinds, values, geography scope and time windows. Its existing response
returns `criterion_verdicts`: PASS, FAIL or UNKNOWN, with exact IDs and verbatim
receipts. Code checks company ownership, evidence IDs, excerpts, freshness,
source state, duplicates and missing verdicts. These checks run in the initial
and web re-evaluation paths, including monitoring. They add **no model call**.

Canonical eligibility still owns qualification. Model PASS cannot override a
failed or unsupported factual check. A cited mandatory FAIL prevents a label;
UNKNOWN or missing proof holds the candidate. Preferences never veto, and OR
alternatives remain one requirement. The same eligibility feeds persistence,
counts and the Workbench. An enabled evaluator that fails to answer cannot fall
back to broad earlier batch proof. Legacy fact-only consumers without an enabled
mission evaluator retain their existing behavior.

| Scenario | Root cause | Correction |
| --- | --- | --- |
| S03b | Geography lost the distinction between HQ and office presence | GPT carries `geography_scope` through the proposal/profile and criterion verdict. HQ needs the existing single-provider-HQ authority. Structured office presence is retained separately on the same observation, so explicit presence searches still work even with a foreign HQ. |
| S10 | A broad role-family match silently broadened a request that explicitly prohibited role broadening | Preserve the compiled literal role terms under that restriction. Modifiers around the term are allowed; no job-title exception list is added. Other requests retain contextual model interpretation. |
| S10b | Canonical factual eligibility did not consume the evaluator's criterion verdict | Carry checked criterion verdicts through the company snapshot/candidate projection into the existing eligibility function. Optimistic prose and aggregate PASS cannot override mandatory FAIL/UNKNOWN. |
| S13 | An enriched record's missing description fell back to discovery text, then inherited identity verification | Keep the actual description field's actor/record provenance. Only text from the company record plus resolved identity receives verified company-description treatment. |
| S13b | Grounding accepted the unverified description; the engine also relabeled all discovery descriptions as YC records | Reported descriptions remain visible as context but cannot establish a grounded business-model claim. Only actual YC discovery sources supply the separate YC evidence type. The model sees provider-neutral `field_origin`; raw provenance remains in normalized checkpoint records. |
| S07 | Future-dated postings previously proved recent hiring | #109's date guard is unchanged and verified passing. |

This is not a requirement that every customer buy LinkedIn company details.
Existing genuine first-party website and YC evidence remain usable through their
own evidence types. Missing LinkedIn description in the bounded A7 fixture has
no other authoritative business-description source and therefore stays unknown.

## Reproductions and validation

Before the fixes, the native targeted run passed S01 and S07 and **failed all
five** known gaps: S03b, S10, S10b, S13 and S13b. Each failure persisted a company
that should not qualify. After the fixes, those seven targeted cases pass.

The native campaign passed **25 scenarios**. Follow-up native checks cover the
three additional controls: evaluator timeout after earlier batch proof, retained
description provenance/no false YC record, and Canadian HQ with an explicit US
office-presence request. Positive/negative controls include Enterprise Account
Executive, SDR, mandatory FAIL/UNKNOWN despite aggregate PASS, genuine HQ,
missing HQ, office presence, size conflicts, future/stale/closed postings,
duplicate employers, and zero qualified candidates.

The original #109 normal/slow missions and both opt-in evidence diagnostics are
also exercised against this implementation. Tests inspect persisted lead IDs,
canonical hard checks, final response/panel counts and terminal outcomes, not
merely worker exit. Every native scenario checks the existing admission limits.

Shared backend validation: **8,314 tests passed**. Final focused receipt/authority/wiring contracts: **68 passed**; compiler/role contracts: **21 passed**. Type checks cover both changed
entry points; focused unit contracts cover the new parser and authority rules.
A source-level wiring assertion now distinguishes availability checks from the
single actual evaluator invocation. The batch fixture claiming authoritative
company-record evidence now names the real company-details source instead of an
unidentified `x` source; unknown sources are not upgraded in production.

Local reproduction (disposable localhost PostgreSQL/PostgREST only):

```sh
tests/db-contract/run.sh tests/db-contract/qualificationHardening.contract.test.ts
A7_AUDIT_KNOWN_GAPS=1 tests/db-contract/run.sh \
  --filter '/offline smoke, two actors|A7 output audit|A7 known gap/' \
  tests/db-contract/offlineSmokeProgress.contract.test.ts
deno test --allow-read --allow-env \
  tests/edge-functions/_shared/criterionVerdicts.test.ts \
  tests/edge-functions/_shared/qualificationEvidence.test.ts
```

The database runner requires its documented localhost `PG_ADMIN_URL` and local
`POSTGREST_BIN`. No hosted migration or test-project connection was used. Quotes,
model responses and provider data are synthetic; they establish no live price.
See [measured scenario summary](discovery-qualification-trace.json): 29 mission
traces across 28 test cases, at most four runtime attempts, and largest runtime
request 29,431 bytes. The original #109 normal/slow plus output/diagnostic lane
passed all seven selected checks.

## Model budget and remaining limits

- Same four runtime model attempts maximum and existing reservations. No new
  evaluator pass, retry, provider operation, model, token ceiling or spending cap.
- Same 30,720-byte request bound and 4,000-token maximum output template. Native
  mocks verify request sizes and admission; they do not prove real model output
  length or semantic accuracy. Truncation/malformed output holds the candidate.
- The four-attempt/$0.05 model, five-read (3+2), one-start-per-actor and
  $0.25/$0.20 limits are unchanged. Offline compilation is not a fifth live call.
- GPT can still misinterpret context despite valid citations. Code guarantees
  receipt integrity and preserves mandatory constraints; it cannot universally
  prove natural-language entailment. No live model-quality claim is made here.
- Under an explicit no-role-broadening restriction, synonyms/abbreviations that
  omit every compiled literal term are held. Broader customer requests continue
  through the existing contextual evaluator; there is no growing title table.
- Older cached records without description provenance remain reported. No
  backfill or paid re-evaluation is performed. Historical qualifications are not
  retroactively rewritten by this change.
- A uniform compiled geography scope applies to its locations. Mixed location
  intents can leave that field null and use the existing evaluator's individual
  criterion scopes. No new general-purpose geography parser is introduced.

## Integration and Claude review request

The independent fixture is forked from #110 head
`cfb4f3c08bd1040d61a7095e18defad9422ed77d` under distinct filenames, so no change is
required to that PR's active tests. Its mission explicitly states
**US-headquartered** to remove the generic-US/HQ ambiguity. The mock now returns
the structured evaluator contract and cites the actual company-location evidence
for its positive HQ case. Its adversarial/credulous answers are still checked by
production qualification, not trusted by the test.

#109 is already in the base. Its smoke helper receives only the mock response
contract extension. #110 overlaps `leadCapabilityEngine.ts` in separate sections;
its one-company lookup fix is not copied or changed here. After integration,
consolidate fixtures and adapt #110's model stand-in to return criterion verdicts
before enabling its gated cases. Keep #110's distinct-employer purchase tests.
#112's workflow and CI changes are untouched.

Claude Code: independently review scope preservation, parser-to-canonical
propagation (including resume/re-evaluation), strict role behavior and field
provenance. Require exact-SHA CI and integrated #110 scenarios before merge.
Then confirm Apify restoration, webhook isolation, approved actor pricing/caps,
OpenAI access/pricing/budget behavior and explicit immutable A7 authorization.
Nothing in this PR authorizes or executes that mission.

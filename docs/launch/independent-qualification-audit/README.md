# Independent qualification / evidence audit

**A7 remains NO-GO.** Five defects plus evidence-ownership boundary weaknesses were reproduced. The highest-impact failure runs through the real capability engine: an evaluator rejection or review becomes a qualified canonical company, a persistable account/lead plan, a qualified Workbench count, and a completed terminal outcome. No database write was performed.

Audited on 20 October 2026 (Asia/Kathmandu), using PR #113's tested head `ea3baf9ece0c2d54626f5db729b986b8660b483e`. PR #110 was inspected at `ee91048c767a28c3b525f48c120a0194f60da20c`; fetched `launch/hardening` was `a10efd20075ef28126eebc8688299cef3d0b98b2`. #110 database CI was still in progress at the final inspection. #113's tested implementation was used directly; it was **not merged into launch/hardening**. The provided workspace points at a different repository and was left untouched. This audit uses the separate `codex/qualification-evidence-audit` worktree/branch.

Production code is unchanged. The evidence consists of three new test files, this report, measured synthetic traces, and deliberately failing safety assertions. **The default 68 passing tests characterize observed behavior, including defects; they do not mean qualification passed acceptance.** `AUDIT_ASSERT_GAPS=1` yields **53 passed / 15 failed**. Several failures exercise the same root cause at different boundaries. Existing focused regressions yielded **132 passed**; nine additional pure request-admission checks passed.

## Execution scope and constraints

Real code exercised: compiler, criterion derivation, provider normalizers, registry builder, strict evaluator parser, grounded-claim receipt verification, evidence graph, canonical eligibility, capability engine, canonical qualified-key projection, persistence-plan construction, Workbench, checkpoint/working-set restoration, final-notice rendering and terminal/quota reducers. Native engine tests replace only external planning/model answers and provider responses. They do not replace eligibility or persistence decisions and use no fake database.

Every new test runs without Deno network permission. No Apify/OpenAI request can leave the process. No paid provider, hosted database, A7 dispatch, spending authorization, workflow dispatch, deployment, merge, schema change or migration installation occurred.

**Database writer and row-level assertions are NOT TESTED.** Local PostgreSQL/PostgREST binaries exist, but no running local server/schema snapshot was available. The existing contract runner explicitly executes migrations, including held migrations. It was not run because this assignment prohibits installing migrations. No database mock was substituted. Persistable plans below are real application output, not proof that SQL committed a row. SQL admission locking/concurrency, credit settlement, retry/cancellation/resume across persisted task/lineage rows require the final isolated-database acceptance lane.

## Scenario matrix

PASS means the named safety condition held at the stated tested boundary. FAIL means a deterministic expectation failed. NOT TESTED is an execution limitation, never an inferred pass. “Held” is pending/insufficient evidence, not a finding that the company is unsuitable. Holding alone does not establish that an extra research purchase was authorized or executed.

| ID / scenario | Result | Observed behavior and coverage |
| --- | --- | --- |
| V00 supported positive | PASS | Valid receipts → qualified in parser/canonical/Workbench and real native persistence plan. |
| V01 model PASS without evidence | PASS | Held; zero qualified keys/plans. Native engine and pure parser. |
| V02 overall PASS, one mandatory FAIL | PASS | Native fixture keeps industry PASS and makes hiring FAIL; canonical ineligible, no lead plan. |
| V03 mandatory UNKNOWN | PASS | Native hiring UNKNOWN blocks aggregate PASS. |
| V04 one required criterion omitted | PASS | Native industry row remains, hiring row omitted; pending. |
| V05 contradictory rows for same criterion | PASS | Duplicate PASS/FAIL becomes UNKNOWN; native and pure parser. |
| V06 evidence ID from another company | PASS | Foreign ID refused; no qualified native result. |
| V07 fabricated / inaccurate excerpt | PASS | Non-verbatim quote refused; no qualified native result. |
| V08 malformed JSON | PASS | Held in parser and native engine. |
| V09 truncated JSON | PASS | Held in parser and native engine. |
| V10 partly valid receipt array | PASS | Valid plus invalid receipt does not let the mandatory verdict pass. |
| V11 evaluator timeout after optimistic batch | PASS | Batch grounding is optimistic; evaluator unavailable → pending, zero plans; completed-snapshot resume does not repeat evaluation. This tests the binding's null timeout result, not elapsed network time. |
| V12 failed preference | PASS | Mandatory pass remains eligible; preference cannot veto. |
| G09 aggregate FAIL / REVIEW, all criterion rows PASS | **FAIL** | Real engine returns a qualified key/plan although evaluator says not_qualified / insufficient_evidence. Survives actual engine resume; notice and quota reducers adopt the false qualified count. |
| G01 two authoritative HQ providers disagree | **FAIL** | Conflict recorded; current US HQ still passes. Real normalizers → observations → graph → parser/canonical/Workbench. |
| G02 conflicting declared employee bands | **FAIL** | Both proven, equally ranked sources; selected 11–50 band qualifies despite 201–500 conflict. This is distinct from #113's discovery-vs-enrichment size test. |
| G11 / native stale_active | PASS | Old posting marked LISTED does not qualify within the 30-day request. |
| Native undated_job | PASS | Missing posting date leaves hiring unsupported and company pending. Parser alone has weaker timestamp validation; canonical guard saves this native case. |
| Website contradicts discovery description | PASS | Existing real evidence-monotonicity regressions: trusted consumer-only website evidence defeats B2B description proof; weaker unverified contrary text cannot overturn proof. No database/cache integration was tested. |
| G05/G06/G07 web stale/missing/invalid timestamp | **FAIL (receipt boundary)** | Old or invalid nonempty fetched_at is called current; unknown freshness is accepted for a time-bound criterion. Not an end-to-end cached-page exploit: readFreshPages separately filters stale/invalid cache rows. |
| G14 customer 7-day expansion window, source 45 days old | **FAIL** | Real observation builder grants 180-day expansion validity; registry uses 60-day freshness; neither parser nor canonical expansion check applies the customer's seven days. A proven expansion plus optimistic model PASS surfaces. |
| G03 other-employer job supplied to registry | **FAIL (registry boundary)** | Other employer's strong LinkedIn ID is retained in metadata but company_key is rewritten to candidate; criterion receipt passes. Upstream caller is expected to attribute jobs first. |
| Native employer_conflict | PASS | Actual job-discovery identity guard preserves candidate but removes hiring proof for a conflicting employer; no qualification. G03 is not evidence that this guard was bypassed. |
| G04 foreign-company observation passed directly to graph | **FAIL (graph boundary)** | Graph accepts a proven foreign item. Caller/union ownership is a precondition; customer exploit not established. |
| G10 receipt item still has foreign company_key | PASS | New #113 parser ownership check refuses it. It cannot detect upstream reattribution in G03. |
| Legitimate company, several returned identities | PASS (bounded case) | Provider returns same-name unrelated record first plus exact LinkedIn match; native engine keeps one correct company. Existing identity-authority tests also cover ambiguous/unverified lookup results. Exhaustive identity collisions NOT TESTED. |
| G08/G08b unsupported mandatory requirement | **FAIL (canonical boundary)** | Hard status != ok is filtered out; exact 23-employee mission compiled by the real compiler becomes eligible on unrelated B2B proof. Initial feasibility normally refuses exact-size requests; persisted/readiness-change admission bypass not executed. |
| G13 arbitrary explicit exclusion | PASS for safety | Compiler preserves exclusion; no evidence dimension can prove it, so it stays pending even if model says PASS. Customer proof-completion support remains limited. |
| Recruiting agency's own VP Sales posting | **FAIL** | Real native engine discards agency before qualification, despite explicit agency ICP. No company survives, one discovery call, no evaluator. Existing downstream intermediary exception never gets a chance. |
| Completed snapshot restore/resume | PASS except known G09 | All 19 native cases preserve their canonical set; no additional provider or model-stage call on a complete-snapshot replay. G09's erroneous qualified result is also preserved. |
| Real transient provider retry / interrupted SQL resume | NOT TESTED | Requires persisted disposable DB state; ordinary completed snapshots are covered. |
| Cancellation / terminal policy | PASS for pure policy; DB NOT TESTED | Existing V2 terminal tests pass including cancelled-lineage reconciliation plan. No cancellation RPC/row mutation executed. |
| Model-stage count / no repeated loop | PASS within native fixture | At most 3 external model-stage invocations, at most one search + one details invocation; resume adds none. This is not a durable SQL admission proof. |
| Request caps / no unexpected provider | PASS within tested boundary | Unexpected actors throw; pure admission tests keep bounded bytes/output/choices, vendor money cap and two-actor catalog bounds. |
| Durable dollars, starts/polls under concurrency | NOT TESTED | No authorization RPC, credit ledger or physical transport ran. Existing spending-admission guarantees are not claimed re-proven. |

## Customer requests beyond A7

These are synthetic semantic scenarios, not live customer missions. Compiler tests check preservation of each distinct request, mandatory exclusion, soft preference, and verbatim signal vocabulary. Criterion tests use contextual values instead of adding industry/title tables. Every mandatory UNKNOWN is held. Adversarial semantic tests also intentionally lie about what a valid quote means; they expose the model boundary rather than claiming a universal entailment checker.

| Customer request | Contract preservation / UNKNOWN | Adversarial quoted contradiction | Native execution coverage |
| --- | --- | --- | --- |
| Recruiting agencies expanding into Germany; exclude franchises; prefer founder-led | PASS | **FAIL semantic guarantee:** expansion=false text can be called PASS when an independent proven expansion fact is already present | Own-hiring discovery companion **FAIL** due agency filter; complete regional-expansion mission NOT TESTED |
| B2B companies hiring VP Sales; exclude staffing; prefer remote-first | PASS | **FAIL semantic guarantee:** SDR quote can be called VP Sales PASS when broad hiring proof exists and no explicit literal-role restriction applies | Full native bad-verdict/receipt suite plus positive control PASS |
| Manufacturers announcing facility expansion; exclude distributors; prefer renewable energy | PASS | **FAIL semantic guarantee:** cancelled factory announcement can be called PASS against broad proven expansion | Parser/canonical/Workbench; complete mission NOT TESTED |
| Software companies recently funded; exclude grants; prefer seed | PASS | **FAIL semantic guarantee:** negative funding text can be accepted against a pre-existing generic proven funding item without dated round records | Parser/canonical/Workbench; native funding-provider mission NOT TESTED; existing dated funding arithmetic was not replaced |
| Service businesses opening new locations; exclude franchises; prefer independent ownership | PASS | **FAIL semantic guarantee:** closure quote can be called expansion PASS against broad proven expansion | Parser/canonical/Workbench; complete mission NOT TESTED |

The five semantic tests seed a proven factual claim explicitly. They show that a verbatim citation is not a proof of natural-language meaning, **not** that arbitrary text alone can create a proven fact. Adding more role/industry exception lists is not recommended. Existing code already relies on controlled business-model vocabulary and intermediary/role recognition, so fully provider-neutral, arbitrary-language qualification is not demonstrated by this campaign.

## Verified defects, ranked, with smallest safe corrections

1. **P1 — Evaluator rejection/review is lost in canonical projection (G09).** `missionCandidatesFrom` carries only criterion_verdicts; `evaluateEligibility` consumes those and ignores aggregate decision/fit and failed_requirements. Real engine output has evaluator `not_qualified`, canonical `strong_opportunity`, and a real persistable plan whose raw fields say `verdict: QUALIFIED`, `company_brain_status: rejected`, `canonical_decision.qualified: true`, `quota_eligible: true`. REVIEW reproduces similarly. Correction: carry the enabled evaluator's validated veto/hold into the canonical decision, including restore/re-evaluation, so inconsistent aggregate/criterion responses cannot receive a label. Do not add a second evaluation or infer new criteria from prose. Covered by native aggregate_fail/aggregate_review and pure G09 tests.

2. **P1 — Equally authoritative factual conflicts do not veto qualification (G01/G02).** Graph preserves disagreements but `checkCriterion` reads current only. A tie is decided by evidence ordering/ID rather than a conflict-resolution finding. Correction: hold the relevant mandatory single-valued claim when fresh, proven, comparably authoritative sources disagree. Keep weaker discovery reports separate from authoritative records and preserve HQ versus office semantics. No new model call. Tests exercise real normalized HQ observations and declared-size facts through canonical/Workbench; full multi-provider persistence not executed.

3. **P1 — Customer-specific non-funding recency is not enforced (G14).** Registry global freshness and graph validity are broader than the criterion window. Expansion falls through to “any proven fact passes”; only funding has explicit criterion-window arithmetic. A real `observationFromWebClaim` for 45-day-old expansion is valid for 180 days and satisfies a seven-day mandatory criterion. Correction: compare the criterion's existing time_window and stated basis to the relevant event/observation timestamp in the current deterministic path; unknown or invalid dates stay unknown. Do not treat a new page fetch date as an announcement date. Preserve existing funding and hiring controls. G05–G07 additionally expose timestamp admission weaknesses at the registry/parser boundary; first fix the time-bound check, not a blanket timestamp requirement for timeless company descriptions.

4. **P1 — Requested recruiting employers are discarded by discovery.** Job discovery unconditionally applies `jobEmployerAgencyReason`, even though company-fit already has a mission-targets-intermediaries exception. Correction: align this discovery rejection with the already compiled customer target, while retaining the employer-attribution guard and rejecting client postings as proof of the agency's own hiring. Use the existing mission semantics; do not append title or industry exceptions. The native agency test fails before any evaluator runs. Retaining a candidate is not a guarantee it meets expansion/hiring criteria.

5. **P2 — Unsupported hard criteria vanish (G08/G08b).** Parser/canonical checks filter status != ok; a hard condition remains on the card but disappears from eligibility. A real compiled exactly-23-employee requirement reproduces this. Initial feasibility is a mitigating guard; actual admission bypass was not demonstrated. Correction: retain unsupported hard conditions as unknown/unmet in canonical decisions and expose that no route can establish them, rather than allowing an empty/subset hard-check set to pass. Preferences remain non-blocking; OR groups retain their current semantics.

6. **P2 boundary weakness — Job evidence is reattributed before ownership validation (G03).** Registry accepts already-attributed jobs by contract but does not validate a supplied strong employer mismatch; foreign facts receive the candidate's evidence ID/company key. Correction: validate strong employer IDs before registry admission, or assert the caller's attribution invariant before rewriting ownership. Do not rely on company-name substring matching. **Upstream native employer-conflict guard passed**, so this is not yet a verified customer-path bypass. G04 is the analogous graph-input precondition weakness; null/unassigned union evidence is intentionally valid, so a blind company-key filter is not a safe general fix.

All above corrections affect the qualification/discovery sections Claude is integrating. The audit checked PR bodies, comments/reviews, head commits and changed hunks. #110 owns its one-company purchase fix and active fixture adaptation; #113 owns the parser/canonical/HQ/provenance baseline. No published ownership response assigned these follow-up fixes by the audit cutoff. Findings were sent through GitHub comments/review; no production correction was attempted in an overlapping area. **No implementation draft PR was created**, since no independently owned narrow correction was established. This is an audit branch, not a merge candidate or a replacement for #110/#113.

## Reproduction

From the isolated worktree (Deno 2.8.2):

```sh
# Characterize the baseline, INCLUDING assertions that confirm known unsafe behavior.
# 68 tests pass; consult FAIL events, not the green command status, for safety.
deno test --node-modules-dir=auto --lock=/tmp/agentory-audit-deno.lock \
  --allow-env --allow-read \
  tests/edge-functions/_shared/independentQualificationAudit.test.ts \
  tests/edge-functions/_shared/independentQualificationEngineAudit.test.ts \
  tests/edge-functions/_shared/independentQualificationProjectionAudit.test.ts

# Safety expectations: 53 pass / 15 FAIL on exact PR #113 baseline.
AUDIT_ASSERT_GAPS=1 deno test --node-modules-dir=auto \
  --lock=/tmp/agentory-audit-deno.lock --allow-env --allow-read \
  tests/edge-functions/_shared/independentQualificationAudit.test.ts \
  tests/edge-functions/_shared/independentQualificationEngineAudit.test.ts \
  tests/edge-functions/_shared/independentQualificationProjectionAudit.test.ts

# Small native reproduction of the strongest projection defect.
AUDIT_ASSERT_GAPS=1 deno test --node-modules-dir=auto \
  --lock=/tmp/agentory-audit-deno.lock --allow-env --allow-read \
  --filter aggregate_fail \
  tests/edge-functions/_shared/independentQualificationEngineAudit.test.ts
```

No `--allow-net`, database credentials, migration runner or provider keys are required. Dependency installation/cache access is ordinary Deno module setup; it does not authorize runtime network access. All prices and company data are synthetic. The fixture's `modelCalls` is an invocation count, not billed token usage or a durable authorization count.

[Measured results](measured-results.json) contain every emitted audit/native/projection trace, including actual persistence-plan payloads. [Failing assertions](failing-assertions.txt) contain the red safety run. Scope is recorded alongside the results.

Focused existing regressions (132 pass) were run across criterionVerdicts, qualificationEvidence, budgetFailClosed, modelCostTelemetry, modelSpendIsWired, v2TerminalAgreement, runOutcomeCanonical, resumeSnapshotRoundTrip, missionEvaluationSurvivesResume, leadV2IdentityAuthority, evidenceMonotonicity, and leadV2ContinuationAndTerminal. This existing lane required `--no-check`: Deno 2.8.2 reports four existing snapshot-cast type errors in missionEvaluationSurvivesResume. New audit tests type-check during their normal runs. Nine pure smokeAdmission tests selected enforcement/classify/limits/SAF-008/templates/R3/proposal; RPC/DB mocks were not run. Lint on new files follows the repository's URL-import and async external-fixture style via explicit file-level exclusions.

## Remaining GPT limitations and combined A7 acceptance

A verbatim quote proves textual presence and attribution, not entailment. GPT can reverse negation, broaden a role or geography, conflate planned and completed expansion, mistake grants for venture rounds, and treat “opening” as current when only a stale announcement exists. Matching evidence IDs cannot detect a prior ingestion step that assigned the wrong employer. Repeated model agreement is not independent source corroboration. Four bounded attempts also cannot guarantee every customer-specific condition can be researched or every response fits the output ceiling. These mocks test enforcement and propagation; no live GPT accuracy rate is claimed.

For the combined #110/#113 exact-SHA gate, retain A7 NO-GO and require:

- All native adversarial response cases, aggregate FAIL **and REVIEW**, plus citation integrity and timeout-after-optimism. Assert the evaluator decision and each downstream qualification flag, not just mission counts.
- Proven HQ/size conflicts in both arrival orders, stale/unknown timestamps and the customer's actual signal window. Include positive office-presence and authoritative-HQ controls; do not collapse office/HQ conflicts.
- Five distinct customer missions above, with positive as well as unknown/failing controls. Test arbitrary mandatory exclusions and preferences independently. Preserve explicit no-role-broadening and OR alternatives without adding title lists.
- A recruiting employer's own role versus client advertising, strong foreign employer IDs, exact identity matches among same-name alternatives, ambiguous and conflicting identifiers, and genuine website contradictions.
- Disposable preprovisioned Postgres/PostgREST on the integrated schema; assert committed account/lead raw qualification, canonical Workbench, final notice, task, queue and lineage. Inspect both rows and real transport/admission ledger. Do not silently install held migrations under this assignment.
- Fault injection across cancellation before/after admission, transient retry, interrupted resume and re-evaluation. Pending/rejected candidates must never gain a label through fallback, legacy counters, projection, or stale optimistic checkpoints.
- Existing exact authorization limits: at most four runtime model attempts, existing token/request ceilings, five reads, one start per approved actor, and $0.05 model / $0.20 provider / $0.25 combined caps. Confirm refused or unknown starts, refunds and concurrency cannot reopen purchases. Mock providers only; no new evaluation loop.
- Complete exact-SHA CI and Claude's integrated ownership/review resolution. No merge, dispatch or spending authorization follows from this report; external/operator A7 prerequisites remain separate.

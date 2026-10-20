# A7 independent end-to-end audit

**Verdict: NO-GO.** Offline execution is connected, but strict headquarters
qualification and description provenance still have reproducible gaps. Apify
account recovery and a separately approved live kickoff remain external gates.
This audit performed no hosted database operations, real vendor requests,
workflow dispatches or live spending authorizations.

## Reviewed execution

Initial integration: `4ccf5c2b4ab19975fbd4fc4eb587220cc7ff839e`.
Final review incorporates #106 through integration
`2493eccfc679af4bef3b8b268f97a2c20863358a`. #108 is a separate pending recovery PR;
this branch does not modify its implementation or #106's transport fixes.
The separate `~/Projects/a7-package` was unavailable in this environment, so its
exact immutable kickoff payload and digest have **not** been verified here.

| Transition | What the offline test actually exercises |
| --- | --- |
| User goal → compilation | Real compiler with schema-valid mocked Luna output. The accepted compiled contract can lose distinct headquarters scope. This does not establish real-model interpretation quality. |
| Frozen request → authorization | Compile before authorization, store the final request, then call the real administrator authorization RPC in a disposable local database. |
| Authorization → worker | Native queue claim, real runner and in-process `run-agent` handler, with queue/task/lineage binding. |
| Scout → job research | Actual tool dispatch to mocked `harvestapi/linkedin-job-search`; at most three rows; duplicate employer collapsed. |
| Job rows → company details | Identity resolution selects one company; actual `harvestapi/linkedin-company` dispatch, one company and zero searches. |
| Details → qualification | Real normalization, evidence registry, planner/evaluators with mocked model responses, hard checks and explanation generation. |
| Qualification → storage | Real account/lead writer and authenticated local dashboard retrieval. |
| Storage → final state | Real queue release and terminal reconciliation helpers; task, lineage, plan, persistent assistant notice and HTTP/panel agree after this fix. |
| Company Brain | Context input, not an output destination. No Brain is created or updated. The first smoke deliberately has no Brain and its dedicated-project write guard must remain installed. |

The process-level worker loop, hosted networking, actual vendor schemas/prices,
real-model quality and browser rendering are not proven by this test. Native
claim/release and persisted response contracts are exercised, not simulated with
handwritten queue results.

## Verified defects

| Impact | Reproduction and disposition |
| --- | --- |
| P1, fixed here | A real worker saved one qualified company and completed its task, but HTTP returned `success:false`, `round_limit_reached`, zero CONTACT-ready leads and no result IDs. The response/panel now use the same canonical mission outcome and persisted writer IDs. The original regression failed before the fix. |
| P1, OPEN | A US-headquartered request is accepted with a schema-valid model proposal containing generic US geography. Remove headquarters flags from an otherwise valid US office: one company still qualifies. A known Canadian HQ correctly fails, so this is specifically missing authoritative HQ proof. Carry headquarters-versus-presence scope through the compiler/evidence contract; do not globally redefine generic geography queries. |
| P2, fixed here | A posting 45 days in the future passed the last-30-days requirement. Positive-window hiring proof now rejects negative ages and preserves the exact 30-day boundary. |
| P2, fixed here | Scheme-less LinkedIn comparison identities were stored as clickable URLs. Fresh account/lead projections now persist canonical absolute URLs; deduplication identities are unchanged. Existing records are not backfilled. |
| P2, OPEN; first-smoke evidence gate | Remove only the authoritative company description while retaining declared size and HQ. The discovery-row description still receives verified evidence treatment and permits qualification. Preserve field-level provenance; identity verification alone does not verify a description's origin. This audit does not claim the discovery description is necessarily false. |

The two open gaps have explicit opt-in failing diagnostics, rather than passing
tests that endorse false positives. They are excluded from ordinary CI. Findings
were posted on #106 for shared review before publishing this separate draft.

## Measured outputs

See [compact execution evidence](discovery-a7-e2e-trace.json). All company data,
receipts, pricing quotes and model responses there are synthetic, not account facts.

- Valid HQ fixture: three job rows, one company-details purchase, one qualified
  lead and account, working absolute source links, recent AE posting, declared
  11–50 band, explanation, persistent result notice, dashboard retrieval.
- Canadian HQ plus US office: zero qualified leads, an honest partial task/plan
  and zero-result notice. Queue execution finishes and lineage terminalizes;
  the worker's terminal reason is `budget_exhausted`, not a fabricated quota met.
- Future posting: zero qualified leads. No evidence is invented to fill the quota.
- Positive execution uses four admitted runtime model requests, two actor starts,
  five reads allocated 3+2, and no request above 30,720 bytes. Compilation is an
  extra **offline mocked** step; live execution must reuse the already compiled
  approved request, not add an unbudgeted model compilation call.
- Synthetic reservations: model $0.04992, provider $0.01000, total $0.05992.
  These are fixture quotes, not evidence of affordable live actor prices.
  Both provider purchases remain open until administrator reconciliation, even
  after execution completes. App credits and reported USD are separate ledgers.

Persisted account/library columns do not contain every requested fact: HQ flags
are in the task resume checkpoint, size/geography in `research_fabric`, job URL
and date in the lead's `raw.job_evidence`, and explanations in
`workbench_grounded_explanations`. Account `location`/`employee_count` are currently
unset on this writer path. Do not present those columns as complete evidence or
add new product fields solely for the smoke. Some legacy route/funnel diagnostics
still describe the bypassed contact controller; use canonical task results and
durable admission records for acceptance. `run_outcome.spend.unsettled_operations`
is execution-ledger telemetry, not proof that admission liabilities are closed.

## Local test evidence

- Default offline mission suite: **14 passed**, including normal/slow success,
  zero results, provider denial, duplicate delivery and the three output audits.
- Shared backend unit suite: **8,284 passed**; focused projection/hiring suites
  also passed after their original failing reproductions.
- Held-admission/no-Brain/manual-worker infrastructure assertions: **20 passed**.
- Native dedicated-project no-Brain database contracts: **7 passed**, including
  concurrent insertion, old snapshots, disabled guards and service-role writes.
- Explicit known-gap diagnostics: **2 failed as expected**, each observed one
  qualified lead where missing authoritative evidence should permit none.
- After updating this branch to the merged #106 integration: **6 affected native
  mission contracts and 30 focused unit tests passed**. The native mission trace
  also confirms both provider purchases remain open after terminal execution.

Reproduce against a disposable localhost PostgreSQL/PostgREST installation only:

```sh
tests/db-contract/run.sh tests/db-contract/offlineSmokeProgress.contract.test.ts
tests/db-contract/run.sh tests/reviews/discoveryTestNoBrain.ts
A7_AUDIT_KNOWN_GAPS=1 tests/db-contract/run.sh \
  --filter 'A7 known gap' tests/db-contract/offlineSmokeProgress.contract.test.ts
```

The runner requires its documented localhost `PG_ADMIN_URL` and `POSTGREST_BIN`.
The last command intentionally fails until the two open defects are corrected.
Run the no-Brain installation lane alone in a fresh disposable database.

## Before the single supervised live execution

1. Integrate and independently verify the response/date/URL fixes and #108 on
   the exact approved SHA. Require current CI, including native database checks.
   Confirm hosted recovery migration requirements against that final tree; local
   migration success does not install anything in the test project.
2. Resolve strict HQ semantics/provenance, or retain NO-GO for this unchanged
   mission. Do not weaken qualification or replace missing facts with model prose.
3. Operator confirms Apify access restored without bypassing billing restrictions;
   records current actor inputs, permissions, minimum charges and effective
   `maxTotalChargeUsd` enforcement. Confirm actor/task/account webhooks cannot
   call production. Worker network allowlisting alone cannot prove that isolation.
4. Operator verifies OpenAI access to the exact approved model, account-specific
   pricing/cache behavior and external budget behavior. Public assumptions and
   synthetic reservations are not verified account limits.
5. Recheck the test project and workspace against the approved package; inspect
   cron jobs, triggers, RLS/grants and no-Brain guard using the existing operator
   pack. Confirm no unresolved purchases before any authorization. No hosted
   checks were performed by this audit.
6. Verify GitHub `discovery-test` reviewer, test-only secrets, branch restrictions,
   exact worker SHA and only the approved workspace. The environment currently
   has one required reviewer and a `launch/hardening` branch policy; self-review
   is not prevented. Enforce independent approval operationally if required.
7. Review the immutable compiled kickoff and digest. Explicitly approve one
   execution, $0.25 total/$0.20 provider/$0.05 model, four model attempts, five
   reads (3+2), one start per approved actor and the 300-second deadline. No
   Firecrawl/Anthropic credentials, Brain content or extra compilation call.
8. Name the operator who stops and reconciles. Use the existing smoke runbook's
   stop RPC, queue cancellation and vendor abort procedure. Application timeout
   does not itself stop an already-running vendor actor.

## After execution

1. Verify actual actor identities/inputs/run IDs and model request admissions;
   compare every sent request to its durable operation. Check all caps and size
   bounds, queue/task/lineage/plan states and cleared leases, not merely exit 0.
2. For each qualified company inspect source URLs, posting date/open-job evidence,
   explicit HQ flag, declared band, company-record description and grounded
   explanation. Verify one persisted lead and dashboard-visible ID per company;
   no duplicate company purchases or duplicate result notices.
3. Accept zero qualified companies with truthful reasons and terminal execution.
   Never relax qualification to manufacture success. Check that no result wrote
   Company Brain content or reached production.
4. Preserve task/evidence, receipts and credit/admission ledgers. After stop/expiry,
   use `scripts/test-project/smoke-reconciliation.sql` and administrator-only
   reconciliation against terminal vendor history. `NO_RUN` requires no stored
   run ID and evidence no run exists. Unknown/over-quote liabilities stay held;
   no second mission until every purchase is reconciled.

**Claude's next actions:** review this isolated draft, fix the HQ/provenance
contracts in a separate scoped change, integrate #108 and rerun its recovery
contracts, then regenerate/review exact-SHA A7 evidence. Broader beta work can
clean up legacy diagnostics and improve dashboard field presentation; neither
justifies changing the approved mission or its spending limits.

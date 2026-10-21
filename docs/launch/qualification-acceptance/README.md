# Unified qualification: acceptance index (Q1–Q4)

Each acceptance scenario, the lane that tests it, and where it stands on the stacked branches #113 → #123 (Q1) → #125 (Q2) → this PR. **A7 remains NO-GO.** "Known gap" means a red proof that already exists and runs under its lane's flag. It is never hidden and never counted as a pass.

## Lanes

| Lane | What it exercises | Command (from a checkout of the branch under test) |
|---|---|---|
| **A7 contracts** (#110) | the real worker, engine, SQL admission, PostgREST, persistence, handler and Workbench panel on local Postgres | `A7_AUDIT_KNOWN_GAPS=1 PG_ADMIN_URL=… POSTGREST_BIN=… tests/db-contract/run.sh tests/db-contract/a7Qualification.contract.test.ts` |
| **Q1 contracts** | the evaluator veto through persistence; holds across resume | `tests/db-contract/run.sh tests/db-contract/qualificationAuthority.contract.test.ts`; `deno test … tests/edge-functions/_shared/qualificationAuthority.test.ts` |
| **Q2 contracts** | conflicts, event-dated windows, ownership, first hire | `deno test … tests/edge-functions/_shared/qualificationEvidenceIntegrity.test.ts` |
| **Q3 contracts** (this PR) | compiler intent: frozen scope, no phantom requirements, unsupported mandatory, exact size | `Q3_ASSERT_GAPS=1 deno test --allow-read --allow-env tests/edge-functions/_shared/q3IntentContract.test.ts` |
| **Codex qualification audit** (`da4b9c83`) | parser, canonical, Workbench and native engine adversarial cases | copy the three `independentQualification*` tests from `da4b9c83`, then `AUDIT_ASSERT_GAPS=1 deno test --allow-read --allow-env …` |
| **Q4 acceptance matrix** | the 10 groups below, end to end through every reducer, asserting each downstream flag | `Q4_ASSERT_GAPS=1 deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/q4AcceptanceMatrix.test.ts` |
| **Codex routing audit** (`aca94e6b`) | 40 customer requests through compiler, graph, plan, engine, decisions, persistence plans, notice and terminal | in a checkout of `aca94e6b`: `ROUTING_AUDIT_SOURCE_ROOT=<branch checkout> ROUTING_ASSERT_EXPECTATIONS=1 deno test --allow-read --allow-env tests/edge-functions/_shared/independentRoutingAudit.test.ts` |

## Status on Q2 (#125 @ `a542b2f1`)

| Area | Scenario | Lane | Status |
|---|---|---|---|
| Single authority | evaluator FAIL/REVIEW with every row PASS (G09, R09) | Q1, audit engine, routing | **pass**. The pure audit helper is still open with Codex (holds not passed; "held" vs "ineligible") |
| Single authority | holds survive checkpoint and resume | Q1 | **pass** |
| Evidence | HQ/size conflicts (G01, G02) | Q2, audit | **pass** |
| Evidence | customer windows on event dates (G14, G05–G07) | Q2, audit | **pass** |
| Evidence | ownership (G03, G04) | Q2, audit | **pass** |
| Evidence | first hire (H03; H02 control) | Q2, routing | **pass** |
| Intent | unscoped "US company" is HQ (**S02**, S03b) | A7, Q3 | **known gap** (Q3a) |
| Intent | phantom "startup" from "seed-stage" | Q3 | **known gap** (Q3a) |
| Intent | unsupported mandatory enforced (**G08**), exact size (**G08b**) | Q3, audit | **known gap** (Q3b after Q3a) |
| Intent | mandatory founder discussion stays mandatory (**C01**, L08) | routing | **known gap** (Q3a) |
| Intent | cross-signal OR (**C02**) | routing | **known gap** (Q3a schema, Q3b decision and routing) |
| Intent | per-clause windows 7d/30d (**C04**) | routing | **known gap** (Q3a) |
| Intent | sales-team growth is headcount growth, not expansion (**H04**) | routing | **known gap** (Q3a) |
| Routing | recruiting agencies' own hiring (**H05**) | routing, audit | **known gap** (Q3b) |
| Routing | unsupported social/technology stays unsupported; no substitute purchases | routing | **pass** |

Measured on `a542b2f1`:
- **Codex routing audit:** 76 pass / 9 fail (C01, C02, C04, H05, L08 runtime; C01, C02, C04, H04 compiler). On #113 it was 74/11.
- **Codex qualification audit:** 64 pass / 4 fail (G08, G08b, agency, pure G09).
- **A7 contracts:** S02 is the only required failure; S03b is a known gap.

## Status on Q3a-3/Q3b-3 (stacked on Q3a-2, #135): Q3 complete

| Scenario | Status |
|---|---|
| **S02**, S03b (unscoped "US" is headquarters) | **pass** (Q3a-1) |
| phantom "startup" from "seed-stage" | **pass** (Q3a-1) |
| **G08** unsupported mandatory enforced, **G08b** stated size kept | **pass** (Q3b-1). The requirement is blocked, never bought and never counted, unless evidence rules it out or the company's own cited words answer it. Feasibility names it at approval |
| plain "startups" (no must/only) | a disclosed **target**: describes the population, never gates. "only startups" / "must be a startup" is mandatory and enforced |
| **H05** agencies | **pass** (#127, #128) |
| **C01**, L08 founder clause necessity, **C04** per-clause windows, **H04** team growth | **pass** (Q3a-2) |
| **C02** cross-signal OR | **pass** (Q3a-3/Q3b-3): compiled as one `any_of` across signals, decided as one group, routed hiring-led |

- **Codex routing audit:** 85 pass / 0 fail. 6 of 40 qualified: Q3a-2 removed the three wrong qualifications (C01, L08, C04), and C02 now qualifies on hiring alone, with nothing bought for funding.
- **Q3 contracts:** no known gaps.
- **Codex qualification audit:** 67 pass / 1 fail (the pure G09 helper, open with Codex).
- **A7 contracts:** no known gaps.

## Q4 acceptance matrix

**Implemented in `tests/edge-functions/_shared/q4AcceptanceMatrix.test.ts`** (harness: `q4/acceptanceHarness.ts`). It runs in the edge lane, offline: the real compiler, graph, feasibility, engine, claim-verification phase (funding, business model, open role), evaluator parser, canonical decision, Workbench, persistence plan, notice and terminal, sliced and resumed as production runs them. Only the external answers are synthetic.

Every case asserts the canonical decision and, through `assertConsistent`: Workbench count, persisted rows, notice count and text, terminal state, canonical labels and buckets, and a resume that reaches the same decision while buying and evaluating nothing. Cases also assert the raw verdicts, hard checks and provider calls that matter to them.

| Group | Positive control | Negative controls | Status |
|---|---|---|---|
| 1. SaaS hiring | AE posted 2 days ago; first-hire posting | SDR when the role may not broaden; ordinary opening for "first" (blocked, nothing bought); stale, closed, undated, another employer's | **pass** |
| 2. Agencies | own internal hiring | client posting it advertises | **pass** |
| 3. Expansion | dated announcement inside the window (decision layer) | outside the window; undated page; the request refused before any Actor (no executable route) | **pass** |
| 4. Funding | round inside 90 days; venture Series A; "Seed or Series A" with a Seed | round 200 days ago; a grant for "venture"; a later Series B | **pass** |
| 5. Social | n/a: no executable social route | social-only refused before any Actor; a mixed mission keeps its mandatory founder clause (pending) | **pass** |
| 6. AND/OR | "hiring OR funding" on hiring alone (no funding bought); AND with both | AND with hiring only (pending) | **pass** |
| 6. exclusions | | **known gap Q4-EXCLUSION-INVERTED:** "excluding recruiting agencies" compiles a hard requirement to *be* one, and drops "B2B software" | **known gap** |
| 6. preferences | | **known gap Q4-PREFERENCE-HARD:** "ideally in the US" compiles a hard geography, so a preference rejects | **known gap** |
| 7. Contradictions | US HQ on the company record | Canadian HQ on the record against a US-HQ request (the evaluator's PASS doesn't outrank it); a record resolving to another company | **pass** |
| 8. Windows | 7-day hiring, 3-day posting | 10-day posting; 7d hiring and 30d social each keep their own window | **pass** |
| 9. Unsupported providers | | job search unavailable: refused, no substitute purchase; evaluator FAIL holds an all-PASS company; evaluator timeout qualifies nothing | **pass** |
| 10. Interrupted | a slice that runs out of time after discovery resumes and qualifies | each purchase made once; a further resume changes nothing | **pass** |

Both known gaps already exist on `launch/hardening` (`5d867037`); they're compiler defects older than Q1–Q3. The matrix keeps them red under `Q4_ASSERT_GAPS=1`.

### Original plan (kept for reference)

Each case runs through the A7 contract lane (real persistence) or the routing lane (all reducers), with a positive and a negative control:

1. **SaaS hiring:** exact role (AE vs SDR), first hire vs ordinary opening, stale/closed/undated postings, wrong employer.
2. **Recruiting agencies:** an agency's own internal hiring qualifies; client postings it advertises never prove the agency's hiring.
3. **Manufacturing expansion:** dated announcement inside vs outside the window; cancelled or planned vs completed; office vs region.
4. **Funding:** recent round inside and outside the window; grant vs venture; stage sets (OR).
5. **LinkedIn social engagement:** refused or clarified while unsupported; a mixed mission never drops a mandatory social clause (C01, L08).
6. **Mixed AND/OR:** cross-signal OR (C02), AND with preferences, exclusions.
7. **Contradictory evidence:** HQ/size conflicts in both arrival orders; posting vs company record.
8. **Different windows:** 7d hiring and 30d social (C04); default windows only on temporal cues.
9. **Unsupported providers:** blocked, zero Actor calls, no substitute purchase.
10. **Interrupted and resumed missions:** a checkpoint mid-run, a pending provider read, a re-evaluation. The decision is identical across canonical keys, Workbench, persistence rows, notice and terminal state.

Every Q4 case asserts the evaluator decision **and** each downstream flag (raw verdict, `quota_eligible`, `canonical_decision`, handler counts, notice), not just mission counts.

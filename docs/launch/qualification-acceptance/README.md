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

## Q4 acceptance matrix (to run once Q3 lands)

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

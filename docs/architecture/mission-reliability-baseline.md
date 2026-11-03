# Mission reliability: S0 baseline

**Code:** `launch/hardening` at `cf55180`.
**Mode:** offline: the real compiler, planner, ORION context and qualification code; recorded model readings; no model call, no spend.
**Architecture:** approved 2026-11-03 (root causes R1–R8; stages S0–S6).
**This PR:** measurement only, no runtime change.

Each later stage must move these numbers. A change to a recorded baseline is a reviewed re-record, so improvements show as diffs, never silently.

## 1. Field-name robustness (R1/R2): `scripts/dev/interpretation-fuzz.ts`

The same requirement is restated in `hard_constraints[]` under plausible model field names. Each outcome is what reaches execution.

| Requirement | Spellings | ok | unmappable | dropped | inverted |
|---|---|---|---|---|---|
| Role ("salespeople") | 30 | 11 | **19** | 0 | 0 |
| Industry ("fintech") | 10 | 4 | **6** | 0 | 0 |
| Role exclusion ("not SDRs") | 10 | 0 | **10** | 0 | 0 |
| Hiring window (30 days) | 10 | 3 | **7** | 0 | 0 |
| Size preference (20–500, hedged) | 10 | 10 | 0 | 0 | 0 |
| Geography (US) | 10 | 10 | 0 | 0 | 0 |
| **Total** | **80** | 38 | **42** | 0 | 0 |

Size and geography restatements are matched by **value**, and they are robust. Role, industry, exclusion and window restatements are matched by **field name**, and fail. The cf55180 incident (`signal role`) is pinned as a test.

**Target:** S1 brings this to 0 for covered categories; S4 makes it structurally impossible, because the v3 contract has no free field names.

## 2. Interpretation corpus: `tests/fixtures/mission-reliability/v1/cases.json`

12 meanings, 26 phrasings: paraphrases plus recorded model readings, labelled from meaning.

| | Count |
|---|---|
| Phrasings correct | **19 / 26** |
| Wrong, labelled | 7: R1 ×3 (`signal role`, `excluded_roles`, `hiring_window` restated), D4 (roles listed separately), D3 (hiring OR expansion), D2 (singular industry), D6 (North America → US) |
| Wrong, unlabelled | 0 |
| Paraphrase groups with unstable meaning | 5 of 12, exactly the groups containing a labelled defect |

Stable today:
- "Account Executives / AEs / account execs" and the phrase-only reading;
- "US / US-based / headquartered in the US / American";
- "operating in / offices in the US" (presence);
- SDRs only;
- "hiring OR funding".

## 3. Cross-component consistency (R5/R6): `scripts/dev/consistency-check.ts`

This compares criteria (qualification), `specFromMission` (planner) and `buildQualificationContext` (ORION) on 109 missions: 83 stored and 26 from the corpus.

| Disagreement | Missions |
|---|---|
| Planner geography ≠ criteria geography | **17**: on stored missions whose criteria lack `geography_scope`, the planner spec drops the geography (`geo=[]`) |
| Planner hard signals ≠ criteria hard signals | **10**: the same missions; hiring is read as not hard |
| Exclusions absent from ORION's role vocabulary | 2 (it has no representation for exclusions) |
| A criteria role missing from ORION's vocabulary | 1 (role given only in a hard constraint; ORION reads `required_signal_terms`) |
| Either/or group with no planner representation | 1 |
| **Missions with any disagreement** | **25 / 109** |

**Target:** 0, via one frozen reader (S2/S3).

## 4. Silent requirement loss (coverage invariant, extended to roles and exclusions)

The extended check found **3 genuine role losses in stored production missions**:

| Mission | Loss | Label |
|---|---|---|
| Quality run **Z08**: "hiring salespeople, sales reps, account executives, AEs" | stored as `role_terms: ["aes"]`; salespeople and sales reps dropped | D4. **With Stage 2's exact titles this mission would be narrowed to AE postings only. D4 must be fixed before Stage 2's shared code reaches production.** |
| `missionHiringSalesRoles`: "actively hiring sales roles" | the role became an unrecognised signal; the hiring requirement carries no role | R2 (production replay decision D) |
| Corpus M05: roles listed separately | SDR dropped | D4 |

All other findings are explained by named guards.

## 5. Proof the harness detects regressions

Disabling the existing hiring-restatement guard raises fuzz failures from 42 to 48 and fails the fuzz and corpus tests.

## 6. Deterministic today vs model-dependent

| Guarantee | Status |
|---|---|
| Restated size and geography | deterministic (value-matched) |
| Restated role, industry, exclusion, window | **not** deterministic: field-name dependent (42/80) |
| Hard requirements answered only on positive evidence | deterministic (engine; D5 fixed) |
| Role precision for named titles | deterministic (Stage 2) |
| One reading of the mission across components | **not** (25/109 disagree) |
| Stored mission meaning stable across deploys | **not** (run-time re-derivation; 49 replay differences) |
| Choosing the right slot for a phrase, OR vs AND, paraphrase coverage | model-dependent; measured by the corpus |

## 7. Not measured yet (needs approval)

**Live paraphrase stability:** about 180 interpretation calls, estimated under $2. Proposed for after S1, to measure the model's own variance against this corpus.

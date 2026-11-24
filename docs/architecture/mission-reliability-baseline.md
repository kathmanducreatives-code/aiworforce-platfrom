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

---

## 8. Natural-language-first evaluation (owner requirement, 2026-11-03)

**Requirement for S1–S6:** users may write in any reasonable wording: casual English, slang, typos, abbreviations, synonyms, indirect requests, complex multi-constraint missions. The LLM understands intent and produces the canonical `MissionCriterion` structure. Deterministic code **validates** that reading and executes it. Code never re-decides meaning from keyword lists.

**Corpus expanded:** 19 meanings, 49 phrasings (`tests/fixtures/mission-reliability/v1/cases.json`):
- casual and abbreviated ("need like 5 us cos hiring AEs rn");
- typos ("acount executives", "headquarterd", "operatng");
- synonyms ("sellers", "sales ppl", "HQ'd", "based out of the states", "doing business in America");
- indirect ("any US companies looking to bring on account execs?");
- complex multi-constraint (B2B SaaS, US HQ, 50–200 people, raised in the last year, hiring AEs, formal and casual);
- **contrast pairs** that must stay different: AE vs SDR, HQ vs presence, OR vs AND, "not SDRs" vs "SDRs or AEs", a named title vs a broad word, HQ synonyms vs presence synonyms.

Roles compare by meaning: a registered title by its id, a broad word by its role family.

**What this measures.** Readings are recorded, so the offline corpus tests whether the *deterministic* layers preserve a correct model reading of varied wording. GPT's own variance on casual input needs the approval-gated live study.

| | Result |
|---|---|
| Phrasings correct | **31 / 49** |
| Wrong, labelled | 18 (all with a defect ID; 0 unlabelled) |
| Contrast pairs collapsed | **0 / 6**: different meanings stay different |
| Complex mission (M17), formal and casual | correct (size, funding, AE, US HQ preserved; an implied "saas" industry is redundant, not narrowing) |

**New defect classes.** Each is a correct model reading damaged by **keyword re-reading of the user's prose after interpretation**:

| ID | Mechanism | Effect | Phrasings |
|---|---|---|---|
| **NL1** | role words resolved by keyword lists; the contract tells the model to copy role words **verbatim** | typos, "account execs", "sales ppl", "sales team", "sellers" leave the hiring requirement with **no role** (broadening) or an unresolved literal; a model-corrected title is **dropped** because the misspelt user text doesn't contain it | 6 |
| **NL2** | hard vs preference for a signal needs a keyword cue ("hiring", "recruit") | "looking to bring on…", "need sales ppl" make a required signal a **preference** (silent weakening) | 2 |
| **NL3** | locations recognised by a fixed country-word list | "in the states", "based out of the states" **demote the hard US requirement** to a preference | 3 |
| **NL4** | headquarters vs presence from a keyword list | "operate in", "have a US office", "doing business in", "operatng" read as **headquarters** (narrowing) | 4 |

The coverage invariant **cannot see NL3**: its "unstated location" guard uses the same keyword list, so it calls "the states" unstated. The corpus is what catches it. Any guard that decides meaning by keywords shares the blind spot.

### Implications for S1–S6 (no new stage)

- **S1 (value-based restatement):** consistent with the requirement. It matches a restated **value** against canonical requirements; it adds no keyword lists.
- **S4 (proposal contract v3)** is where NL1–NL4 are fixed, by moving meaning decisions to the model's structured output:
  - the model emits **canonical identifiers**: a role as a registered title ID or role-family ID; a geography as a registry place plus a scope enum (`headquarters | presence`); a signal kind enum; hard vs preference;
  - each comes with the **quoted span** of the user's words it rests on, and the model is no longer told to copy role words verbatim;
  - code **validates** instead of re-deciding: spans must exist in the request with typo-tolerant matching (not keyword lists); IDs must exist in the registries; OR groups and hardness must be consistent with the cited spans;
  - an invalid or uncertain reading becomes an explicit ambiguity, so clarification is asked only then.
- **Understanding before execution:** the plan shows a deterministic summary generated **from the canonical criteria themselves**, so what's shown is what's executed. The existing plan interpretation and the pilot script's printout become that card.
- **Prose re-readers are retired, not extended:** `scopeFromWords`, `SIGNAL_CUE`, `inQuery`, the startup and audience cues, `classifyRoleFamily` on user text, and `missionQualificationContext`'s prose vocabulary stop deciding meaning for v3 missions (S2–S4). The v1 path stays for legacy missions.
- **The live paraphrase study now matters more:** it is the only measurement of how well the model itself handles casual input. About 180 calls, estimated under $2, needs your approval.

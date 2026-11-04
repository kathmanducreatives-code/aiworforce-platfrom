# Mission reliability overhaul: progress by stage

The baseline and architecture are in `mission-reliability-baseline.md` (S0). This file
records, per stage, what changed and how each measured number moved. Every number is
reproducible from the named script; a change to a recorded baseline is a reviewed re-record.

## S1: restatement reconciliation by value (and D4)

**Root causes addressed:**
- R1: a requirement restated under a free field name became an unanswerable hard requirement.
- D4: roles listed separately collapsed to one.

### What changed

**`restatementReconciler.ts` (new, compile time only).**
- A restated `hard_constraints` entry is resolved by its **value** to the identity execution uses:
  - a registered title by its title id;
  - any other role word by its role family;
  - a window by its number;
  - an industry by the stated profile descriptor.
- Then it is compared with what the mission already requires:
  - the same requirement is a duplicate;
  - an exclusion not yet carried is **lifted** onto the hiring signal and never discarded;
  - a contradiction ("exclude AEs" while requiring AEs) is kept for the gate;
  - anything else is kept.
- **The field can only veto.** It never makes two values the same, but a field word naming another subject keeps the constraint. Examples: `previous_employer_role`, `company_age_days`, `founded_within_days`, `revenue_*`, or any word outside the small schema vocabulary.
- So an unforeseen field name fails loudly at the gate instead of silently losing meaning.
- This vocabulary covers the model's *field names*, not user phrasing. Contract v3 (S4) removes free field names entirely.

**`readSignalPhrases` (D4).**
- A role term merged into a signal that already carries roles joins as a list item ("a, b" = any of).
- A merge is accepted only if every role already carried survives it.
- Before: `["SDR", "Account Executive"]` became one role. Z08's "salespeople, sales reps, account executives, AEs" became `["aes"]`.

**Compile time only.**
- Stored missions are not re-read.
- The production replay against `e4da19e8` is byte-identical before and after S1: the same 49 pending differences, none added.

### Numbers

| Measure | S0 | S1 |
|---|---|---|
| Field-name fuzz failures (`interpretation-fuzz.ts`) | 42 / 80 | **0 / 80** |
| role / industry / exclusion / window | 19 / 6 / 10 / 7 | 0 / 0 / 0 / 0 |
| NL corpus phrasings correct (`interpretation-corpus.ts`) | 31 / 49 | **35 / 49** (R1 ×3 and D4 fixed; NL1–NL4, D2, D3, D6 remain, all labelled) |
| Contrast pairs collapsed | 0 / 6 | 0 / 6 |
| ATLAS titles eval | 29 / 30 (T23 D4) | **30 / 30** |
| Discovery benchmark C4 "SDRs or AEs" | FAIL, recall 0.67 | **PASS, recall 1.0** |
| Stored-mission semantics / verdict replay | — | 0 changes / 0 changes |
| Production replay vs `e4da19e8` | 49 pending | 49 pending (identical report) |

### Negative tests (`restatementReconciler.test.ts`)

Each of these is kept as its own constraint, never merged away:
- a different role in the same family (SDR beside AE);
- a specific title beside a broad word (AE beside "salespeople");
- another family;
- counts, thresholds and quantity fields;
- a field naming another subject (`previous_employer_role`, `company_age_days`, `founded_within_days`);
- an inverse time bound (`older_than_days`);
- a different window;
- a number that is also a size bound;
- a different industry;
- an exclusion contradicting a required role.

The existing review suites (`realGptA7Interpretation` "R2 blocking", "I6 negative") pass unchanged.

### Stored mission Z08 (D4)

The compiler is fixed: the same words now compile to all four roles. The **stored** Z08 record keeps its recorded meaning (`["aes"]`). It is listed for the owner in the S5 migration report and is not rewritten silently.

Retired coverage guard: `hiring-restatement-is-the-signal`. No compiled mission carries a restatement any more, and none of the stored missions in the repository's fixtures does.

## S2 + S3: one reader of a mission's meaning; approved missions frozen

**Root causes addressed:**
- R5: post-compile reinterpretation;
- R6: consumers reading different sources;
- R7: evidence bypassing authority.

### The reader: `missionCriteriaReader.ts`

`criteriaOf(mission, { readiness, legacy })` is now how **every** component asks what a mission requires:
- the ATLAS planner (`specFromMission`) and provider requirements (`requirementsFromMission`);
- ORION's verifier and role vocabulary (`buildQualificationContext`);
- run-agent's four decision sites, the engine's five, orchestrate, the claim plan, feasibility and the execution policy;
- the replay mirror.

What it returns depends on the mission:

| Mission | What it returns |
|---|---|
| **Frozen** (S3) | The stored criteria, verbatim, to every caller |
| **Legacy** (no version) | Exactly today's behaviour, made explicit by the caller's `legacy` policy: the planner keeps the stored copy, so plan hashes and signed approvals are unchanged; ORION re-derives, so production verdicts are unchanged |
| **Legacy, stored with no criteria** | Derived: never read as "no requirements" (the planner dropped geography and hard signals here) |

### The freeze (S3)

- The compiler's last step and pilot-chat (after the Company Brain merge, with the criteria the approval card shows) call `freezeCriteria`. It stamps `criteria_contract_version: "criteria-v1"` and a 64-bit fingerprint of the criteria plus every field they are derived from.
- A frozen mission edited later without re-freezing is **void**: it falls back to legacy behaviour and is never executed as approved.
- run-agent logs which state it executes (`[run-agent][criteria] freeze: frozen | legacy | void`).
- These fields are not in `missionHash` (its field list is explicit) or `planSemantics`, so approvals, signed plan tokens, the ledger and checkpoints are unaffected. A test pins both hashes.
- A test pins that every compiled corpus mission is frozen and that its frozen criteria equal a fresh derivation of its final fields.

### Downstream unification

- **ORION role vocabulary** comes from the hiring **criterion** for frozen missions:
  - a role stated only in a constraint reaches ORION;
  - exclusions travel as `excluded_titles`;
  - an excluded role is never sent to the job search ("AEs but not SDRs" used to search "SDR").
- **Legacy missions keep their production vocabulary.** Measured over the 83 stored missions, sourcing it from criteria would have changed 5 searches, including narrowing Z08 to its D4-damaged criteria. Result: 0 of 83 changed.
- **One posting test**, `hiringTitleMatcher`, is shared by run-agent's verifier and the replay mirror. An excluded role never satisfies on **any** branch; the family branch used to ignore exclusions.
- **Planner OR groups:** `DiscoverySpec.signalAlternatives`. "Raised funding OR hiring sales" is one requirement, met when any member can be proven. It is no longer two hard requirements, one of which (funding) is unprovable and refused the plan. AND stays two requirements.
- **Planner bug fixed:** a ranking-only signal the planner does not model (`product_launch`, `headcount_change`) was made **hard** by any unrelated hard criterion of kind "other" (industry, geography, known companies), and the planner then refused it as unprovable.
- **R7:** the engine's derived `hiring: proven` (and each derived `job` item) now goes through `authorityForEvidence`, keyed by the posting's own source. A verdict resting on postings no rule lets prove anything is `plausible`: it ranks and never qualifies. Every stored fixture's postings come from real job sources, so verdicts are unchanged; a negative test proves the gap is closed.

### Numbers

| Measure | S0 | S1 | S2 + S3 |
|---|---|---|---|
| Missions with a cross-component disagreement (excluding legacy drift) | 26 / 132 | 26 / 132 | **0 / 132** |
| Freshly compiled corpus missions with any disagreement | 7 | 7 | **0** |
| Legacy stored missions whose stored criteria differ from run-time re-derivation | (not measured) | — | **46 / 83**, listed for S5 |
| Stored-mission ORION vocabulary changes | — | — | 0 / 83 |
| Stored-mission semantics / verdict replay / production replay vs `e4da19e8` | — | 0 / 0 / 49 pending | 0 / 0 / **identical** |
| Plan hashes (benchmark, 16 scenarios) | — | — | unchanged |

The S0 checker hard-coded "exclusions" and "OR groups" as unrepresentable. It now measures the new representations. Its "criteria" side is the reader qualification actually uses. Legacy drift is its own visible category (`legacy_stored_criteria_drift`), never hidden.

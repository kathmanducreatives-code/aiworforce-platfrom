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

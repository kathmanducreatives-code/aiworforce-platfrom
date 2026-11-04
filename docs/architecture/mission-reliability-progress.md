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
- **R7:** the engine's derived `hiring: proven` (and each derived `job` item) is now **gated** by `authorityForEvidence`, keyed by the posting's own source. A verdict resting only on postings that no rule lets prove anything is `plausible`: it ranks and never qualifies. Every stored fixture's postings come from real job sources, so verdicts are unchanged, and a negative test proves the gap is closed.
  - No authority *record* is attached to the derived items. In the first cut it was attached, and DB-contract S10d (CI on #228) caught the consequence: `authorityResolvesAbstention` then kept the hiring check passing over an evaluator's "the required role is not established", whereas the reviewed contract says that unknown **vetoes**. The fix was reproduced and verified locally against Postgres and PostgREST, and the unfixed code fails the same test.

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

## S4: contract v3, natural-language understanding (NL1–NL4, D2, D3, D6)

**Principle (owner, 2026-11-03):** natural-language-first.
- The model interprets.
- Code validates and executes.
- No growing keyword lists.

### `missionUnderstanding.ts`

**The model's job.** Contract v3 adds one strict, schema-enforced block, `understanding`, to the existing GPT structured output. In it the model states the request's **meaning** in a closed vocabulary:

| Item | Closed vocabulary (schema enums) |
|---|---|
| `roles[]` | a registered title id, **or** a role family id; required or excluded; `role_match` any/all |
| `places[]` | a geography-registry place (or a named other place); scope `headquarters`/`presence`; necessity |
| `industries[]` | the kind of company; necessity |
| `signals[]` | a canonical signal kind; necessity; `signal_logic` all/any (AND/OR) |
| `ambiguities[]` | a question, only when the answer changes which companies qualify |
| `unsupported[]` | what the vocabulary cannot express |

Every item quotes the user's words (`span`).

**The code's job.** It validates; it does not re-decide:
- **Each quote must occur in the request.** The check is token-wise Damerau–Levenshtein with a small tolerance: 0 edits up to 4 letters, 1 up to 8, 2 beyond, and never a different first letter, so SDRs ≠ BDRs.
  - The user's typo and the model's correction of it both verify.
  - Words the user never wrote do not.
- **Each ID is checked again against its registry.**
- **Contradictions become questions:** a role that is both required and excluded is asked about.
- **Invalid items are not applied.** The v1 reading stands for them, and each refusal is recorded in `validator_changes`.

**The decision points.** For a v3 mission these read the validated understanding, not keywords:
- **Roles (NL1):** the hiring qualifier is set to the registered title ("Account Executive"), or to the family for a broad word. Abbreviations, slang, synonyms and typos reach the same identity, because the model resolved them.
- **Signal necessity (NL2):** whether a signal is required comes from the model's reading of the words, however indirect ("looking to bring on…"). Funding still respects verifier readiness.
- **Places (NL3) and scope (NL4):** a registry place with the stated scope, for example "the states" → hard US HQ, and "have a US office" → presence.
- **Industries (D2):** grammatical number, typos and synonyms no longer demote a stated industry.
- **AND/OR (D3):** comes from `signal_logic`.
- **Regions (D6):** "North America" is the registry place itself.

**Ambiguity.** A validated ambiguity raises `MissionNeedsClarificationError` before anything is spent. pilot-chat then asks the question (`clarificationMessage`) instead of failing.

**Unsupported requirements.** Each one becomes an explicit `unrepresentable_evidence` criterion, which the approval card lists. It is never dropped.

**The approval card** renders from the same frozen criteria that execute (S3), so what the user approves is what runs.

### Off by default

- `AGENTORY_MISSION_CONTRACT=v3` turns it on: v3 includes v2's per-signal windows plus the understanding block.
- Without it, every compile is byte-identical: mission semantics, verdict replay, benchmark and production replay are all unchanged.
- **Enabling it on TEST is a flag change for the owner.**

### Acceptance suite: `tests/fixtures/mission-reliability/v1/cases.json`

**Corpus.**
- Now 26 meanings and 55 phrasings, with 10 contrast pairs.
- New cases are the owner's own examples:
  - "sales guys";
  - "recruiting AEs but no SDRs";
  - "taking on more staff in the States";
  - "a US office" vs "headquartered in the US";
  - "getting bigger and needing salespeople".
- "Growing the sales team" now has its own meaning: team growth is **headcount growth, not proof of open roles**. The owner's rule corrects my S0 corpus, which had filed it with "hiring salespeople".
- Every phrasing carries the v3 reading a correct model gives. The live study measures how often GPT actually gives it.

**Results.**

| Mode | Correct | Wrong (labelled) | Unstable paraphrase groups | Collapsed contrasts |
|---|---|---|---|---|
| v1 (today's contract) | 36 / 55 | 19 (NL1–NL4, D2, D3, D6) | 4 | 0 |
| **v3** | **55 / 55** | **0** (labels never apply to v3) | **0** | **0** |

- v3-compiled missions add **0** cross-component disagreements: the consistency check now also runs over the v3-compiled corpus.
- Negative tests (`missionUnderstanding.test.ts`):
  - invented quotes, unknown IDs and empty roles are refused;
  - an invented place is never applied;
  - SDR vs BDR is never treated as a typo;
  - a contradiction is asked about;
  - v1 ignores an understanding and records that it did;
  - the schema is strict at every level, with closed ID enums and no free field names.

### Live paraphrase study (owner-authorised, ≤ $2, ≤ 180 calls): harness ready, **not run**

`scripts/dev/live-paraphrase-study.ts` sends every corpus phrasing to the production `mission_compilation` route, using the v3 payload and strict schema, `--repeats` times (3 × 55 = 165 calls). It compiles the model's own proposal with the real compiler and scores it against the labels. It also reports paraphrase stability and contrast collapse.

**How spending is enforced (transport guard, tested in `liveStudyBudget.test.ts`):**
- every HTTP request reserves its worst case (input estimated from the request body, plus the 4000-token output ceiling, at list price) and is **refused before sending** if it would cross the budget or the call cap;
- the provider client's own retries go through the same guard;
- a response without usage is booked at its worst case;
- only `api.openai.com` is reachable;
- an unpriced model refuses to run at all;
- the loop stops at the first refusal.

**Expected cost:** the dry run (`--dry-run`: real pipeline, stub transport) prices 165 calls on `gpt-5.6-luna` at about **$0.58** worst-case-estimated input, against the $2 cap.

**Why it was not run:** this session has no model credential. The configured key lives only in the TEST project's Supabase secrets. Running it through TEST would also need the v3 flag set there and the unmerged code deployed, and both are owner actions. To run it, with `OPENAI_API_KEY` in the environment:

```
deno run --allow-read --allow-write --allow-env --allow-net=api.openai.com scripts/dev/live-paraphrase-study.ts --repeats 3
```

## S5: historical compatibility and migration (prepared; applying it is the owner's decision)

`scripts/dev/migration-report.ts` → `docs/architecture/mission-migration/`:

| File | Contents |
|---|---|
| `report.md` | Every stored mission whose meaning would change, with each difference classified narrows / broadens / neutral, the stored-candidate verdict impact, and the owner's options |
| `report.json` | Per mission: the **original** criteria (what the live release `e4da19e8` executes), the **proposed** criteria (what this code would execute without migration), and the approval-card copy |
| `freeze-plan.json` / `rollback-plan.json` | Option A, verified |

With `--missions <export>` (an owner-run, read-only production export), the tool also writes `freeze.sql` and `rollback.sql`. Each is one transaction, and each statement applies only if the stored mission still equals the export.

**Findings (83 stored missions):**

| | Count |
|---|---|
| Missions whose meaning changes if deployed **without** migration | **49** (34 narrow, 14 broaden, 1 neutral) |
| — of which: unscoped US/state geography becomes headquarters-only | 33 + 2 (narrows) |
| — "startup" becomes a preference instead of a hard requirement | 18 (broadens) |
| Stored approval-card copies that differ from what production executes today | 46 |
| Stored candidates whose check results change | 7, with **0** eligibility changes |

**Recommendation: Option A.** Freeze each stored mission at the meaning production runs **today**, so deploying this code changes **none** of them. The migration marks the freeze `criteria_freeze_origin: "migration"`, and the fingerprint covers that mark. Readers that changed for *new* missions, such as ORION's criteria-sourced search vocabulary, keep the legacy behaviour for migrated missions. Without the mark, freezing would have changed 5 legacy searches, including narrowing Z08; a negative test pins this.
- **Verified offline:** the plan has 82 missions and 0 failures. Each reads back as frozen, executes the release's exact criteria, keeps ORION's search vocabulary, and keeps its `missionHash` (approvals and signed plan tokens unchanged).
- **Verified on Postgres:** the generated SQL round trip. The freeze applies; the stored mission reads back frozen with production's exact criteria and **IDs**; rollback restores it byte for byte.

**Found while building it:** criterion IDs depend on JSON key order, and Postgres `jsonb` reorders keys. The tool therefore derives in `jsonb` order, so frozen IDs equal what production computes, and checkpoints and verdicts keep resolving. The order-dependence of IDs itself is a latent fragility, listed under limitations.

**Z08 (D4)** remains a separate owner decision. Option A preserves its narrowed stored meaning (`aes`). Recompiling it from the user's words would broaden it back to all four roles.

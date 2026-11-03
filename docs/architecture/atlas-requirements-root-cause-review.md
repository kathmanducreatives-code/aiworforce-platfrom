# ATLAS root-cause architecture review: requirements, matching and qualification

Status: **proposal, awaiting owner approval. No implementation has started.**
Code reviewed: `launch/hardening` at `4caa960`. Evidence comes from the offline discovery baseline (`docs/benchmarks/discovery-baseline/`).

---

## 1. Executive summary

The five defects aren't caused by missing architecture. ATLAS already has:
- a typed canonical requirement (`MissionCriterion`);
- a three-valued evidence engine (`candidateEligibility.evaluateEligibility`: pass / fail / unknown → eligible / ineligible / pending, where any unknown hard requirement blocks);
- either/or groups (`any_of` + `anyOfGroupKey`);
- evidence-authority rules;
- a provider capability registry (`DISCOVERY_CAPABILITIES`: discovers / proves / claims);
- a closed field vocabulary (`requirementVocabulary.ts`).

The engine and the criteria derivation are shared by ORION (`run-agent`) and ATLAS (`lead-pipeline`).

The defects come from **four recurring patterns at the boundaries between those layers**. The same patterns caused the earlier bugs (#202, #203, #210, #211, #216, #219):

| Pattern | What happens | Defects |
|---|---|---|
| **P1: "Did the user say it?" is answered ad hoc** | 24 separate string tests in the compiler/criteria layer (`inQuery`, `containsPhrase`, `.includes`, per-signal cue regexes), each with its own normalisation. Their boolean decides hard vs preference | **D2** (+ #202, #210, #216, #219) |
| **P2: structure is applied after meaning, as decoration** | hardness is decided per criterion first; OR groups are added at the end, only among criteria already hard; role lists are folded by re-parsing concatenated prose | **D3, D4** |
| **P3: one function answers two questions, failing open** | `geographyContradicts` ("can this company be excluded?") is reused as "is this requirement satisfied?"; "unrecognised ⇒ not a contradiction" becomes "unrecognised ⇒ pass" | **D5** |
| **P4: a downstream layer trusts an upstream reading** | qualification accepts a bare `hiring: true` from discovery and compares role *families* only; the planner rebuilds requirements from three sources and ignores `any_of` | **D1** (+ the planner side of D3) |

**Recommendation:** no new requirement representation and no general Boolean tree. Make `MissionCriterion` the single authority and close the four patterns with **four small, shared building blocks**, each replacing duplicated logic rather than adding to it:

1. **one statedness function** (P1);
2. **structure-first derivation** for alternatives and role lists (P2);
3. **two versioned registries**, geography and role titles, built from tables that already exist (P3, P4);
4. **one rule in the engine: a hard requirement passes only on a positive match** (P3, P4).

Plus two gates:
- a labelled evaluation corpus;
- **eligibility replay** added to the production gate, which today replays criteria derivation only and **would not catch D5's fix or D5 itself**.

Estimated effort: about 8–11 engineering days in 7 small stages, each independently testable and reversible.

**Before the paid Apify pilot:** fix D1 (role exactness) and D5 (geography fail-closed) first: Stages 1–3, about 3–4 days. D1 directly corrupts the pilot's success measure; the pilot query hits it, and the baseline shows precision 0.40. See §10.

---

## 2. Root-cause map

| Defect | Where (evidence) | Root cause | Pattern |
|---|---|---|---|
| **D1** AE accepts SDR / Sales Rep | `hiringActorNormalizers.ts:650` `jobProvesRequestedHiring`: exact titles only when `exact_role_terms` is set, which `requestedHiringFromSignals` (`:601`) does only when broadening is forbidden. `candidateEligibility.ts:366` hiring check compares `role_families` only and accepts a bare `true` ("A bare `true` comes from a discovery posting"). Baseline A1: precision 0.40 | The requested **title** is never the matching unit: discovery filters by family, and qualification trusts discovery's verdict | P4 |
| **D2** stated industry → preference | `missionCriteria.ts:1241` `inQuery` = exact lowercase substring; "insurance agency" ∉ "insurance agencies" → `sourceFromProvenance` → `user_inferred` → `kind: target` (`:1372`). Baseline A4 | hardness hinges on a brittle string test; there are 24 such tests with different normalisation | P1 |
| **D3** hiring OR expansion loses the OR | `missionCriteria.ts:1838` cross-signal OR groups only `kind: hard` members; expansion has no `SIGNAL_CUE` (`:1054`) and no stated-requirement rule (hiring has `statedHiringRequirement`; funding has its own rules), so it compiled as a target first. The planner (`strategy.ts:250 specFromMission` and `judge`) ignores `any_of`, so even a correct OR would refuse the plan (expansion can't be proven) | OR applied after hardness; hardness rules differ per signal kind; the planner isn't OR-aware | P2, P4 |
| **D4** second role dropped | `leadMissionCompiler.ts readSignalPhrases`: each declared term is merged by re-reading `"hiring SDR Account Executive"` as prose; the reader keeps one role. The single-phrase form keeps both (`role_match: any`). Baseline C4 | role lists built by re-parsing text instead of appending structured terms | P2 |
| **D5** unknown geography qualifies | `candidateEligibility.ts:287` geography check: `geographyContradicts` (`leadEligiblePool.ts:216`) returns *false* for a requirement absent from `GEO_SCOPES` (no US states, cities) → `pass`. Pinned as correct *for exclusion* by `geographyAndNamedCohort.test.ts:100`. Baseline F1/F2: "Atlantis"/"Texas" qualify a Toronto HQ. **Production too:** two stored ORION missions require "California" / "New York" | a contradiction test is used as a satisfaction test; the geography tables are split across three modules | P3 |

---

## 3. Current architecture (traced)

```
request ──► leadMissionCompiler.compileLeadMission ─── GPT proposal + deterministic leadMission.ts parser
            │  readSignalPhrases (role folding)              (24 ad-hoc "stated?" tests across
            │  quotedHiringRoleWords (#219)                   compiler + criteria)
            ▼
        LeadMissionV1 (company_profile, required_signals, hard_constraints, field_provenance)
            │  missionHash (checkpoint identity; criteria NOT included)
            ▼
        missionCriteria.deriveMissionCriteria  ◄── re-derived at run time by run-agent (stored missions)
            │  hardness per criterion · audience/startup/restatement/location guards ·
            │  cross-signal OR (last) · stage any_of · profile "or" any_of
            ▼
        MissionCriterion[]  (kind hard|target, dimension, value, any_of, geography_scope, time_window, status)
            │                        │
            │                        ├─► requirementVocabulary (field-name validation; flag off)
            │                        ├─► missionSemantics (fingerprint, replay gate)
            ▼                        ▼
  strategy.specFromMission   ◄── reads criteria + required_signals + requirementsFromMission (3 sources)
  strategy.planStrategy/judge ── DISCOVERY_CAPABILITIES (discovers/proves/claims) · ignores any_of
            ▼
  multiProvider.runDiscoveryStrategy
     ├─ apifyDiscovery: jobProvesRequestedHiring (FAMILY filter) → evidence hiring:true
     ├─ canonical.ts: company record → HQ-flagged location, size band
     └─ leadocean adapter: claims (isoCountry / industry enum via discoveryProviders/vocabulary.ts)
            ▼
  sharedQualification → evidenceGraph → candidateEligibility.evaluateEligibility
     checkCriterion per dimension (geography: geographyContradicts · hiring: family-only)
     any_of groups (best within group) · unknown hard ⇒ pending
            ▼
  pipeline/projection: eligible | ineligible | pending  → queue / review / excluded
```

**Duplicated logic found:**
- **Geography: three implementations.**
  - `leadEligiblePool` `GEO_SCOPES`: used by eligibility; countries and regions, no states.
  - `locationMatch.ts`: countries, all US states, "missing evidence" outcome, *fails closed*; used only by compound sourcing.
  - `discoveryProviders/vocabulary.ts isoCountry`: provider filters.
  - `geographyConstraint.ts` is dead (0 importers).
- **Roles: five modules.**
  - `roleFamilies.ts` and `roleFamilyMatcher.ts`;
  - `leadRoleTaxonomy.ts` (strategy contracts);
  - `hiringRolePackFilter.ts`;
  - `leadMatchTier.ts`.

  The ATLAS path uses `roleFamilies` + `hiringActorNormalizers`.
- **Statedness:** 24 ad-hoc tests (see P1).
- **OR encodings:** four.
  - profile-value `any_of` (`ors` map);
  - stage `any_of`;
  - cross-signal `any_of`;
  - the hiring qualifier's `role_match: "any"`.
- **NOT encodings:** three. The `exclusion` dimension, `excluded_role_terms`, and negated operators (`NOT_A_RESTATEMENT_OP_RE`).

**Missing invariants** (none enforced today):
1. A hard check returns `pass` only on a **positive** match. Today D5 violates it.
2. Every hard requirement keeps its OR group through derivation. Today D3 violates it.
3. Every role the user listed reaches the hiring requirement. Today D4 violates it.
4. Qualification re-checks what discovery asserted, rather than trusting it. Today D1 violates it.
5. Stage 5's coverage invariant exists, but covers profile values and hard constraints only, not signal roles or `any_of` groups.

**Already correct, and to be reused, not replaced:**
- the three-valued engine and its evidence-authority rules;
- the "unknown hard ⇒ pending" rule;
- `any_of` group evaluation in the engine;
- `geography_scope` (headquarters vs presence);
- the capability registry;
- the signed plan and ledger;
- the semantic baseline and replay gate.

---

## 4. The five candidate improvements

| | A. Typed canonical requirement + closed vocabulary | B. Boolean requirement tree | C. Versioned geography + role registries | D. Evidence-based engine (proven / contradicted / unknown) | E. Provider capability registry |
|---|---|---|---|---|---|
| **Exists** | `MissionCriterion` (typed); `requirementVocabulary.ts` (field names; Stage 6 flag, off) | a two-level form: AND of `any_of` groups; NOT via exclusions | three geography tables; `roleFamilies` aliases | yes: `evaluateEligibility`, authority rules, unknown ⇒ pending | yes: `DISCOVERY_CAPABILITIES` (discovers / proves / claims, cost) |
| **Missing** | one statedness rule; role terms + match mode as typed fields | OR decided *before* hardness; uniform signal hardness; planner awareness | one geography resolver with states/cities and three-valued output; an explicit title-exactness table | "positive match required" for geography; hiring re-check against posting titles | `any_of`-aware feasibility (a group is provable if any member is) |
| **Defects** | D2 (via statedness), D4 (role list typed) | D3 | D5, D1 | D5, D1 | D3 (planner side) |
| **New source of truth?** | **no**, if it means tightening `MissionCriterion`. A new tree/IR would be a 5th representation (mission → criteria → spec → requirements → IR) | a general tree **would be**; keeping AND-of-OR on criteria is not | **no**, if it consolidates the existing tables; yes if added alongside them | no | no |
| **Compatibility** | criteria are re-derived at run time, so stored missions change meaning; replay gate | same | eligibility outcomes change; **needs eligibility replay** (new) | same | plan hashes change for affected plans (no stored approvals) |
| **Runtime / cost** | negligible | negligible | negligible (in-memory tables) | none; *fewer* false qualifications | may refuse fewer OR plans |
| **Complexity** | low–medium (mechanical, 24 call sites) | medium (derivation order) | low–medium | low (geography), medium (hiring evidence) | low |
| **Regression risk** | statedness changes may flip hard/target on stored missions (the baseline shows every flip) | OR grouping changes stored mission meaning | the stricter geography leaves some current passes pending (intended) | the hiring re-check may make some "qualified" pending | the planner may accept plans it refused |

**Challenge to the brief's framing:** A and B as *new* constructs are the riskiest options and fix nothing the smaller changes don't. ATLAS's requests are naturally AND-of-ORs with negated literals (CNF). The criteria list already expresses that; the defects are in *how* it is filled. A general tree adds a representation, a migration and a second evaluator. I recommend **declaring CNF as the supported shape** and routing anything deeper (nested OR-of-ANDs) to an explicit "needs clarification" refusal, never a silent flattening. The closed field vocabulary (A) is already built (Stage 4/6), but it validates *field names*; none of D1–D5 is a field-name problem.

---

## 5. Recommended architecture

```
              ONE "stated?" rule (statedness.ts)          ONE geography resolver   ONE title matcher
                     │                                     (geoRegistry.ts)          (roleFamilies.ts +
                     ▼                                          │                     titleExactness)
compiler ──► deriveMissionCriteria (structure first):           │                          │
             1. requirements + alternatives (any_of) for ALL signal kinds                  │
             2. hardness per GROUP (members inherit)                                       │
             3. hiring qualifier: role_terms[] + role_match any|all + match exact|family ◄─┘
             4. coverage invariant extended (roles, groups)                                │
                     ▼                                                                     │
          MissionCriterion[]  ── the ONLY input to ──►  planner (any_of-aware)             │
                     │                                                                     │
                     ▼                                                                     ▼
   discovery filter ── postingSatisfies(criterion, title) ◄── same function ──► eligibility hiring check
                     │                                                         (re-checks posting titles;
                     ▼                                                          never trusts a bare true)
   evaluateEligibility: a hard check passes ONLY on a positive match; unresolvable ⇒ unknown
```

Nothing new is added beside an existing module except `statedness.ts` and `geoRegistry.ts`, which replace duplicated code (24 call sites; three tables plus one dead module).

---

## 6. Authoritative qualification semantics

General rules:
- A hard requirement is `pass` only on positive evidence from a source with authority for that dimension. It is `fail` only on authoritative contradicting evidence, and otherwise `unknown`.
- Any `unknown` hard requirement means the company stays **pending (review)**. It is never qualified by default.
- A provider *claim* (LeadOcean HQ / size / funding, a job-row location) can rank and screen, but never proves.

| Requirement | Pass | Fail | Unknown |
|---|---|---|---|
| **Country**, scope headquarters | the HQ-flagged location's resolved country = the required one | it resolves to a different country | no HQ-flagged location, or the location doesn't resolve |
| **State / region** (e.g. Texas, California) | the HQ resolves to a place inside that state (registry) | it resolves outside it (a different state or country) | it doesn't resolve to state level |
| **City** | the HQ city matches (registry alias) | it resolves to a different city in a known state/country | otherwise |
| **Unrecognised place** ("Atlantis") | never | never | **always**. The plan states the limitation: "cannot be verified"; nothing qualifies on it |
| **Presence** (operating in) | any proven location (HQ or office) resolves inside | every proven location resolves outside *and* the location list is complete | otherwise |
| **Exact role** (the user names a title: "Account Executives", "SDRs") | a dated posting whose title matches the title or a registered alias of it ("AE", "Account Exec"); seniority modifiers allowed ("Senior", "Enterprise") | — (an opening for another role is not evidence against) | no matching posting |
| **Role family** (the user names a family: "salespeople", "sales roles") | a posting in that family | — | none |
| **Several roles, OR** ("SDRs or AEs") | any listed role matches | — | none matches |
| **Several roles, AND** ("both an SDR and an AE") | every listed role has its own matching posting | — | otherwise |
| **Excluded role** ("not SDRs") | — | a posting… only as the exclusion states: a company is excluded only on evidence it is hiring the excluded role *as the request defines it* | — |
| **Industry** | authoritative industry evidence (today: none, so a label is a claim) | authoritative contradicting evidence | default today; disclosed in the plan |
| **Business model** (B2B / B2C) | as industry (no provider proves it) | — | default; disclosed |
| **Company size** | the declared band lies inside the range | the band lies wholly outside | the band straddles the range, or no band |
| **Funding / hiring / expansion signal** | a dated event inside the window, from a source that proves that kind | a proven absence (rare) | otherwise; expansion is currently never provable, so it is disclosed |
| **Explicit exclusion** ("not agencies") | — | proven to be the excluded thing | it can't be shown either way: **not excluded** (an exclusion never rejects without evidence) |
| **OR group** | any member passes | every member fails | otherwise |
| **Hard vs preference** | hard iff the user stated it without a hedge. The statedness rule (stem/alias-aware) decides; members of an OR group inherit the group's hardness | — | — |
| **Contradictory evidence** | the source with higher authority wins (existing authority rules); equal authority means `unknown` | | |

The two "never"s:
- No hard requirement becomes optional silently. Any hard → target change must be explained by a named guard, enforced by the coverage invariant, which is extended to roles and OR groups.
- No provider-returned value counts as verified unless that dimension's authority rule says that source proves it.

---

## 7. Evaluation strategy

**A permanent, versioned, independently labelled corpus**: `tests/fixtures/atlas-eval/v1/`.

Each case has:
- the request;
- 1–3 recorded model readings (different phrasings and field placements);
- the **expected requirement set**, labelled by hand from the request's meaning and never generated from code output;
- synthetic provider records;
- the **expected verdict per company**.

Labels for semantic decisions (e.g. whether "AE" includes "Senior AE": yes; whether it includes "SDR": no) are listed in one owner-reviewed file.

Contents:
- the 12 baseline scenarios, the X and F runs, and D1–D5;
- every historical failure (#202, #203, #210, #211, #216, #219 and the Contract-2 canary);
- 3 phrasings per requirement class ("US-based", "headquartered in the US", "American companies"; "AEs" / "Account Executives" / "account execs");
- adversarial Boolean cases (an OR across signals, an OR inside roles, AND of ORs, a NOT inside an OR, a nested OR-of-ANDs, which must be refused);
- geography (aliases, states, cities, regions, unrecognised places, presence vs HQ);
- titles (exact, seniority variants, related same-family titles, unrelated titles);
- data faults (missing HQ, contradictory sources, a straddling size band, stale postings);
- **stored production missions**, via the replay gate.

**Metrics**, per case and aggregated, with a CI threshold for each:

| Metric | Definition | Gate |
|---|---|---|
| False qualification rate | qualified ∧ not truly qualified / qualified | **0** on the labelled corpus |
| Precision / recall | against labelled verdicts | precision 1.0; recall reported |
| Requirement preservation | labelled hard requirements present as hard (with their groups) | 100% |
| Silent demotion | hard → target without a named guard | 0 |
| Cost per truly qualified company | Apify $ (upper bound) + LeadOcean records | reported; regression > 10% flagged |
| Runtime | planner + executor (offline) | reported |
| Provider coverage | per requirement class: discoverable / provable / claim-only | reported (from the registry) |

| Tier | What runs | Needs |
|---|---|---|
| Offline (CI) | the corpus, benchmark `--check`, semantic baseline, coverage invariant, **eligibility replay** (new) | nothing |
| TEST deploy | the smoke suite (one GPT plan per deploy, existing); optional plan-only dispatch per corpus phrasing (GPT cost only; separate approval if more than a few calls) | the merge (existing automatic deploy) |
| Live spend | the Apify pilot ($0.05), LeadOcean pilot (record cap), combined pilot | **separate owner approval for each** |

---

## 8. Implementation roadmap

Each stage is one PR. Every PR runs the full suite, the semantic baseline, the discovery benchmark `--check`, the coverage invariant and, from Stage 0, eligibility replay. Rollback for every stage: `git revert` of its PR; TEST redeploys automatically, and nothing is persisted that a revert can't undo (criteria are derived, no migration).

| # | Stage | Files | Behaviour change | Regression risk / compatibility | Tests and acceptance | Owner? |
|---|---|---|---|---|---|---|
| **0** | **Evaluation corpus v1 + eligibility replay gate** | `tests/fixtures/atlas-eval/v1/*`, `scripts/dev/atlas-eval.ts`, `scripts/dev/production-replay.ts` (adds verdict replay over stored evidence fixtures) | none (it measures) | none | the corpus runs; today's failures are recorded as expected-FAIL with their defect IDs | yes: the label file (semantic decisions) and the gate (owner-required path) |
| **1** | **Geography fail-closed (D5)** | new `geoRegistry.ts` (merges the `GEO_SCOPES`, `locationMatch` country/state tables and aliases; versioned); `candidateEligibility.ts` geography check uses `resolve()` → match / contradict / unresolvable; `leadEligiblePool.geographyContradicts` delegates (its exclusion semantics unchanged); delete dead `geographyConstraint.ts` | unrecognised / sub-national places no longer pass; states and cities match properly | **ORION:** the "California / New York" stored missions change from pass-anything to correct; companies with an unresolvable HQ become pending | F1/F2 flip to PASS; `geographyAndNamedCohort` unchanged; eligibility replay lists every changed verdict | **yes**: changes production semantics (replay gate) |
| **2** | **Role exactness + one title matcher (D1)** | `roleFamilies.ts` (title alias table + `postingSatisfies(requirement, title)`); `hiringActorNormalizers.jobProvesRequestedHiring` and `candidateEligibility` hiring check both call it; discovery evidence carries the matched titles (not `true`) | a named title matches exactly (with aliases and seniority); a family word still matches the family | candidates with only family postings move from qualified to pending; ORION hiring missions change (replay) | A1 precision 1.0; C4 Glowcart only via SDR; corpus title cases | **yes**: the semantic decision (exact vs family) and replay |
| **3** | **Statedness (D2)** | new `statedness.ts` (token + stem + alias aware, one function); route `inQuery`, `containsPhrase`, `quotedHiringRoleWords`, `requirementVocabulary` quoting through it; mechanical, call site by call site | plural/singular and hyphen/space variants count as stated | hard/target flips only where the old test was too strict; the baseline lists each | A4 PASS; semantic baseline diff reviewed | yes, if the baseline changes stored missions |
| **4** | **Structure-first signals (D3, D4)** | `missionCriteria.ts` (alternatives computed before hardness; one stated-requirement rule for every signal kind, `SIGNAL_CUE` gains expansion etc.); `leadMissionCompiler.readSignalPhrases` appends declared role terms structurally (`role_terms[]`, `role_match`); coverage invariant extended to roles and groups | OR groups survive; every listed role survives | stored missions with OR text change meaning (replay) | B4 OR kept; C4 PASS; adversarial Boolean cases; nested OR-of-AND → explicit refusal | yes (replay) |
| **5** | **Planner reads only criteria; OR-aware feasibility** | `strategy.ts` (`specFromMission` takes roles and signals from criteria only; drops the phrase-family fallback; `judge` treats an `any_of` group as provable if any member is, and states the others as limitations) | B4 plans instead of refusing; no requirement read from a second source | plan hashes change for affected plans (no stored approvals; tokens are per plan) | B4 PASS; planner tests; TEST smoke | no (TEST-only path; auto-merge policy applies) |
| **6** | **Enable strict vocabulary on TEST (existing Stage 6)** | flag only | refuses model-invented requirements (0 of 100 known cases) | — | smoke | **yes**: flag change |

Order rationale: 0 measures first. 1 and 2 are the safety defects that affect correctness and the pilot. 3 and 4 are interpretation. 5 depends on 4.

---

## 9. Definition of done

- Labelled corpus v1 passes with **0 false qualifications**, 100% requirement preservation and 0 silent demotions.
- All 12 baseline scenarios PASS or are UNSUPPORTED with evidence; F1/F2 PASS.
- Exactly one implementation each of: statedness, geography resolution, title matching, and the hard-pass rule.
- The production replay gate covers both criteria and eligibility verdicts, and every change is owner-approved.
- No change to stored mission identity (`missionHash`), checkpoints, the signed plan or token, the ledger, workspace or budget controls, or TEST/production separation.

## 10. Effort, unknowns and the pilot

| Stage | Estimate |
|---|---|
| 0 Corpus + eligibility replay | 2–3 days (labelling is most of it) |
| 1 Geography | 1–1.5 days |
| 2 Role exactness | 1.5–2 days |
| 3 Statedness | 1–1.5 days |
| 4 Structure-first signals | 1.5–2 days |
| 5 Planner | 0.5–1 day |
| **Total** | **≈ 8–11 days** |

**Main unknowns**

- How often real AE searches return family-only titles; the Apify pilot measures this.
- How many stored ORION missions change verdict under Stages 1–2. Eligibility replay over stored evidence fixtures answers it, but production evidence graphs aren't in the repository; a read-only owner export would make the replay complete.
- Alias coverage for titles and cities: registries grow from observed misses, versioned.
- Whether any production consumer relies on today's fail-open geography.

**Pilot recommendation: fix D1 and D5 first** (Stages 0-lite, 1, 2: about 3–4 days).
- The pilot's success measure is "three genuinely qualified companies". D1 directly inflates that count for exactly this query (baseline precision 0.40). D5 doesn't affect a US-country query, but it's the critical safety defect and its fix is smallest.
- **Lower-cost alternative:** run the $0.05 pilot now as a *measurement*, not a success test. Record the posting titles behind each "qualified" company and score them by hand. This yields the real title-mix data that Stage 2's alias table should be built from. If you prefer data before code, do this, then Stages 1–2, then the pilot as the success test.

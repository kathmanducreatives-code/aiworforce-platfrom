# Q3: intent preservation, implementation boundaries

**All of Q3 is implemented**: Q3a-1 (#132), Q3b-1 (#133), Q3a-2 (#135) and Q3a-3/Q3b-3 (C02). Every rule below is generic (it reads the customer's own words and the compiled structure) and adds no industry, title or scenario list. The red proofs are in `tests/edge-functions/_shared/q3IntentContract.test.ts`, each paired with a passing control.

## Q3a-1: compile-time fidelity (do first: it removes the phantom requirements G08 enforcement would otherwise block on)

| Gap | Root (file:area) | Rule | Control kept |
|---|---|---|---|
| **S02-scope** (A7 S02, S03b) | `missionCriteria.ts` ~988: a criterion gets `geography_scope` only from the compile-time model proposal; when it's null, the **runtime** evaluator's scope decides | a hard geography is **always** compiled with a scope. The proposal's scope wins when present. Otherwise it's `presence` when the request's own words say office, presence, operations or operating in; otherwise `headquarters`. The evaluator can't change a compiled scope (#113 already refuses a mismatching verdict scope) | explicit office → presence; explicit HQ → headquarters |
| **PHANTOM-startup** | `leadMission.ts` ~684/818: `STAGE_MARKERS` mixes the company-kind noun ("startup") with stage and cohort words ("seed-stage", "series a", "early stage", "venture-backed", "yc"), and any of them sets `stages: ["startup"]` with `explicit_user_request` provenance | only the noun the user wrote ("startup(s)", "start-up") sets the company kind. Stage words keep driving the stage intent they already drive (`stageIntent`), and cohort words their cohort reading | "Find B2B SaaS startups" keeps a `user_explicit` company kind |
| **G08b-exact-size** | `missionCriteria.ts` ~1095 (`sizeRangeProvable`): an exact count no band can settle is compiled unprovable and, as a preference, never enforced. The deterministic parser also drops "exactly N employees" | the size the customer stated stays a **hard** criterion with an honest status (`unprovable_today` when no band can settle it), so Q3b-1 can enforce it as blocked | the A7 11–50 band stays hard and `ok` |

## Q3a-2: clause-level necessity, windows and meaning

| Gap | Root | Rule | Control kept |
|---|---|---|---|
| **C01 / L08-necessity** | `missionCriteria.ts` ~729 (`SIGNAL_CUE` covers hiring and funding cues only) and ~843 (`requirementElevation` reads phrase position and preceding modal, so a modal inside the founder clause is lost) | split the request into clauses at its own conjunctions (and/or/comma/"whose"/"which") and read each signal's necessity (must, required, needs to, has to, only vs ideally, preferably, bonus) **inside its own clause** | "ideally" founder clause → target |
| **C04-windows** | `missionCriteria.ts` ~353 (`windowDaysByKind` / `SIGNAL_CUE`): the nearest explicit window is claimed by hiring, and social falls back to its default | bind each time expression to the clause it appears in, then to that clause's signal. A clause without a window keeps its default | 7-day hiring and 90-day funding |
| **H04-growth** | `signalKinds.ts` ~225: the headcount reader matches "expanding its team" but not "expanding its **sales** team", so the expansion reader claims it | allow one modifier word between the possessive and "team(s)" (a generic slot, not a department list), so team growth reads as headcount growth. Headcount proof stays unsupported where it is unsupported (refused, never qualified on one posting) | "expanding into Germany" stays expansion |

As implemented in Q3a-2: the existing clause machinery (`SIGNAL_CUE`, `signalClause`, `requirementElevation`, `windowDaysByKind`) already split clauses and read modals and windows per clause, but only for kinds with a cue word, and only hiring and funding had one. Social activity and headcount growth now have cues, so their own "must" and their own window are read from their own clause. The team-growth readers (`signalKinds.ts`, `missionSignalDescriptor.ts`) accept one modifier word before "team(s)" that no preposition can fill.

## Q3a-3 / Q3b-3: cross-signal OR (C02)

- **Compile:** clauses joined by "or" across **different** signal dimensions become one requirement: each member criterion carries `any_of` naming the alternative dimensions (`missionCriteria.ts`, `leadMissionCompiler.ts` carry-through). AND keeps two hard criteria.
- **Decide (Q3b-3):** `anyOfResolved` groups by `dimension + any_of` today, so it must group by the shared `any_of` across dimensions (`candidateEligibility.ts`).
- **Route (Q3b-3):** discovery must not suppress the hiring-led route when funding is only an alternative (`leadCapabilityGraph.ts` ~751).
- **As implemented:** cross-signal members carry `any_of: ["signal:<kind>", …]`; `anyOfGroupKey` is the one grouping rule eligibility and the evaluator's parser share. Two kinds are alternatives when the request's text between their cues says "or" and not "and", and only mandatory, unhedged members join. The hiring-led entry means a company proving only the funding alternative isn't discovered through postings; it's found only when another route surfaces it.

## Q3b-1: enforce unsupported mandatory criteria (G08), after Q3a-1

`candidateEligibility.ts`: every **hard** criterion is read whatever its status. One no structured source can establish is answered only by a receipt-backed evaluator verdict (the same rule as #128). Otherwise it's an `unknown` check that is **blocked**: pending, never routed for purchase, never PASS. `requestFeasibility.ts` tells the customer at approval which mandatory requirement no current source can establish.

As implemented: evidence already in the graph may still rule it out (a 201–500 band rules out "20–100 employees"); a declared band never settles an exact count either way. The evaluator's receipts for it must come from a company-owned source. The noun "startup" is mandatory only when the request says so ("only startups", "must be a startup"); a plain "startups" is a disclosed target, so it describes the population without stranding every candidate (canary d1eff17a).

## Order and verification

Q3a-1 → Q3b-1 → Q3a-2 → Q3a-3 → Q3b-3. Each is a small draft stacked on the previous one.
- **Each removes its ids from `KNOWN_GAPS`.**
- **Each reruns** Codex's routing audit (`ROUTING_AUDIT_SOURCE_ROOT`) and qualification audit, plus the edge suite and Replay Lab.
- **The A7 contracts (S02/S03b)** must turn green at Q3a-1.
- **Level 2** CI runs at the Q3 integration point. Q4 acceptance follows.

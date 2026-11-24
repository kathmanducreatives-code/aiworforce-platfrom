# Retiring obsolete interpretation paths (S6): register

**Rule:** a path is removed only when no supported mission depends on it, and an executable proof says so. Proofs live in `tests/edge-functions/_shared/legacyReaderRetirement.test.ts`. A path that is still needed stays, together with the exact gate that will release it.

## Retired

| Path | Replaced by | Proof |
|---|---|---|
| Coverage guard `hiring-restatement-is-the-signal` (requirement-coverage) | S1 reconciliation at compile time | No compiled or stored mission reaches it (coverage suite) |
| Run-agent's and the replay mirror's inline role matchers (two copies, exclusions ignored on the family branch) | `hiringTitleMatcher` (one test, exclusions on every branch) | `missionCriteriaReader.test.ts`; replay mirror equality |
| Planner reading `mission.criteria` directly (empty for legacy missions) and matching an unmodelled signal to any "other" criterion | `criteriaOf` + the signal's own dimension | Consistency check: 0 disagreements beyond legacy drift |
| The engine's derived `hiring: proven` without an authority check (R7) | Gated by `authorityForEvidence` | `engineHiringAuthority.test.ts`; DB contract S10d |

## No longer decides a v3 mission (kept for v1 and v2, the current default)

For each reader below, the corpus holds a phrasing where the reader gets the meaning wrong (v1) and v3 gets it right. That pins the decision point as no longer depending on the reader for a v3 mission.

| Keyword reader | Decision | v3 replacement | Witness |
|---|---|---|---|
| Role words copied verbatim; `authorizeHiringRoles`; `classifyRoleFamily` on user text | roles (NL1) | understanding `roles[]`: title id / family id, quoted | M13 typo |
| `SIGNAL_CUE`, `statedHiringRequirement` | necessity (NL2) | `signals[].necessity` | M13 indirect |
| `inQuery` over country words | geography hardness (NL3) | `places[]` (registry place + necessity) | M15 "based out of the states" |
| `scopeFromWords` | HQ vs presence (NL4) | `places[].scope` | M16 "have a US office" |
| `crossSignalAlternatives` | AND/OR (D3) | `signal_logic` | M09 |
| `inQuery` over industry values | industry hardness (D2) | `industries[]` | M10 |
| Country normalisation of regions | region (D6) | registry place `north america` | M11 |

**Gate to delete them:** v3 becomes the default contract (`AGENTORY_MISSION_CONTRACT=v3` everywhere, an owner decision) **and** the live study confirms GPT's v3 reading at an accepted rate. Until then they are the v1 path and stay.

## Still needed: legacy stored missions

| Path | Why it stays | Gate | Proof the gate is real |
|---|---|---|---|
| `restatesHiringSignal`, `restatesFundingWindow`, `restatesEmployeeBound` (derive-time) | Stored missions re-derived at run time still carry restatements (a fixture mission hits two) | S5 option A applied: every stored mission frozen, so derivation no longer runs on them | No freshly compiled v1/v3 mission reaches them; a stored one still does (test fails the day none does) |
| `dedupeEquivalentConstraints` (compile-time field lists) | Probed: removing it fails 23 reviewed tests (size-range and exact restatements S1 deliberately leaves alone) | None yet: S1's value rules would need to cover those cases first | The probe is recorded here |
| ORION's legacy vocabulary from `required_signal_terms` | Legacy and migration-frozen missions keep the searches they ran with (5 of 83 would change otherwise) | Every stored mission re-compiled and re-approved (owner) | `migrationReport.test.ts` negative test |
| Re-derivation for legacy missions (`legacy: "rederive"`) | Production meaning of unfrozen stored missions | Option A applied | Production replay identical |

## Known limitations recorded here

- **Criterion IDs depend on JSON key order** (`jsonb` reorders keys). The migration derives in `jsonb` order, so IDs stay stable; making IDs order-independent would change every stored ID and is a separate, owner-reviewed change.
- **The compile-time keyword readers still run for v3 missions** for anything the understanding does not name (fallback). They never override a validated understanding item.

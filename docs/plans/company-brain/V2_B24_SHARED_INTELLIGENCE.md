# Company Brain V2 · B2.4: one Brain, every agent

**Branch:** `claude/company-brain-v2-b24` (built on the release candidate `claude/company-brain-v2-rc`). It is local only: nothing is deployed, there is no migration, and no model, provider or monitoring is run.

## Audit: every function that reads the Company Brain

| Consumer | Agent | Before B2.4 | After B2.4 |
|---|---|---|---|
| `pilot-chat` (chat replies) | ORION | Shared loader (`loadChatBrain`): effective profile plus the ORION memory block; stamps `brain_fingerprint` | Same, plus `brain_context_id` on every stamped reply (4 sites) |
| `daily-brief` | ORION | One shared load (`ctx.shared_brain`) for ranking and wording | Same. The stored brief (`saved_outputs.raw.brain`) and the response carry the Brain stamp |
| `run-agent`, content branch | LYRA | Raw row for the readiness gate, then a **second** read through the loader for the profile and memory, so one run could see two snapshots | **One snapshot**: the gate, the profile and the memory block all come from the same shared context. The draft records `brain_context_id` (via `memoryWriter` → `saved_outputs.raw`) |
| `run-radar-scan` (manual) | LISA | Loader plus a **hand-written memory merge in the handler**. Investigation showed that merge was dead code, because only `default_mix` was read afterwards | One shared rule, `lisaRadarPreferences`, unit-tested. The response carries the Brain stamp. Scan behaviour is unchanged, still driven by the compiled effective profile |
| `run-monitoring-scan` (manual run only; scheduling stays off) | LISA | Loader → `lisaView` and compile of the effective profile | Same, plus the Brain stamp in the response |
| LISA V2 relevance (`_shared/lisa/relevance.ts`, used by `lisa-monitor`) | LISA | Loader context; verdicts stamped with `brain_fingerprint` | Verdicts also carry `brain_context_id` |
| `company-brain-memory` (context action) | all, via "How agents use it" | Loader | Unchanged |
| `run-agent` lead paths, `pilot-chat` lead-confirmation card, `lead-pipeline`, `leadActionExecutor` | ATLAS | Raw stored profile (`BrainMergeInput` authority) | **Unchanged by design.** ATLAS's request authority stays its own. Memory integration there is a separate, coordinated decision |
| `orchestrate` planner | delegation | Raw profile | Unchanged. ORION delegation stays off |

## The context id
`SharedBrainContext.context_id` = `bctx1-` + FNV-1a-64, written as 16 letters a–p, over:
- the workspace;
- the profile's `updated_at`;
- onboarding state;
- every **servable** memory item (`id@version`);
- every unservable one (`id:status`).

Properties:
- **The same id means the same knowledge.** It changes when anything served changes, including an item crossing its review or expiry time, which the old `fingerprint` could not see. It does not change for a pending proposal, which serves nothing.
- **Versioned (`bctx1`),** so a future change of definition is visible in stored outputs.
- **Additive.** `fingerprint` is kept for existing readers.
- **Letters only.** The first version used hex. The full contract lane caught LISA's contact-data guard randomly rejecting signals whose stored id held a phone-number-like digit run. A regression test pins the fix.

## Evidence (fictional data, real Postgres and PostgREST, the real memory RPCs and the same modules each function uses)

`tests/db-contract/companyBrainSharedIntelligence.contract.test.ts`, 4 tests, all passing:
1. **An approved exclusion and an approved competitor reach every agent, and a tone reaches LYRA only.**
   - The exclusion is ORION's chat offer, approved by an editor. The competitor is LISA's proposal, approved. The tone was set by the team.
   - Exclusion: ORION chat and brief, LYRA's memory block, the LISA radar preferences and compile, the LISA monitoring view and compile, and LISA's relevance verdict ("excluded").
   - Competitor: ORION, LYRA and both LISA scans.
   - Tone: LYRA's content profile only.
   - **The 5 consumers, each loading on its own, report one identical `context_id`.**
   - An expired exclusion, a disputed fact, a fact past review and a pending proposal reach no agent.
   - ATLAS's `compilerBrainContext` and `contractBrainInput` over the stored profile are identical before and after.
2. **A newer ICP size preference moves ORION and both LISA compiles together.** The context id changes once, for everyone.
3. **Freshness:** an item crossing its review date changes `context_id`, but not `fingerprint`. A pending proposal changes neither.
4. **Isolation:** another workspace gets its own context, and a non-member's chat load gets nothing.

Unit tests: `companyBrainSharedIntelligence.test.ts` (7: id determinism and sensitivity, letters-only against the LISA guard, radar rule, stamp, consumers stamped).

**Full gates on the B2.4 tree:**

| Lane | Result |
|---|---|
| Contract lane | **478 / 0** |
| Edge functions | 10,284 passed, 1 failed (the date-dependent ATLAS RECENCY test) |
| UI | 807 / 0 |
| `deno check`, CI-style | pass |
| tsc / eslint ratchets | baseline |
| Build | pass |
| Browser tests | 4/4, 4/4 and 5/5. "Grant revoked" in cache session failed once under parallel load, then passed 5/5 twice in a row; it also fails intermittently on `launch/hardening` |

## Remaining for B2.4
- **ATLAS reading memory** (exclusions in lead search) needs a decision by the ATLAS owner. Today ATLAS honours only the stored profile, which B2.1 keeps consistent.
- **Showing the context id in the UI**, for example "this brief used Brain version …", is not yet built.
- **Deploying** `daily-brief`, `run-agent`, `run-radar-scan` and `run-monitoring-scan` needs coordination: `run-agent` is shared with the ATLAS track. See the release plan.

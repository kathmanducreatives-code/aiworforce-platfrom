# Mission Contract v4: production migration plan

**Status:** prepared, **not enabled anywhere**. Production runs v1. Nothing in this document has been done in production.

Related: [`mission-contract.md`](mission-contract.md) (implementation), [`legacy-interpreter-inventory.md`](legacy-interpreter-inventory.md) (what still reads the sentence).

## 1. Feature flags (versioned, all off by default)

Every flag is OFF unless set to the exact value shown. An unset, empty or misspelt value means off.

| Flag | Function | Value | Effect | Model calls |
|---|---|---|---|---|
| `AGENTORY_MISSION_CONTRACT_V4` | `lead-pipeline` (TEST strategy endpoints) | `enabled` | strategy_plan/run interpret via v4; the plan hash binds `mission-contract-v1:<hash>`; Brain applied to the contract | same as today: one per plan |
| `AGENTORY_CHAT_CONTRACT_V4_SHADOW` | `pilot-chat` | `enabled` | v4 is read **beside** v1 for each lead card; the comparison is stored on the card's message metadata (`mission_contract_shadow`). Card, mission and run stay v1. | **+1 per lead card** (paid) |
| `AGENTORY_CHAT_CONTRACT_V4` | `pilot-chat` | `enabled` | the card's mission **is** the v4 contract (Brain applied before approval). No v1 fallback reading. | one per lead card (replaces nothing yet: Chat Brain still runs first) |
| `AGENTORY_CHAT_CONTRACT_V4_WORKSPACES` | `pilot-chat` | comma-separated workspace ids | when set, shadow and v4 apply only to these workspaces (canary). Binding is never scoped | none |
| `AGENTORY_CHAT_CONTRACT_BINDING` | `pilot-chat` | `enforce` | a Start whose mission does not reproduce the card's stored contract hash is refused | none |

### What is always on (with no flag)

These are additive and do not change any v1 behaviour:

1. **The card is stamped with its binding.** Every lead card gets `mission_contract_binding` in its message metadata: `{version, contract_version, hash}`, or `unconvertible` with reasons. This is computed by the compatibility boundary, with no model call.
2. **Every Start is checked against that binding.** The result is logged (`[pilot-chat][contract-binding]`) and refused only under `enforce`.
3. **Integrity check before work, for v4 missions only.** `orchestrate` and `run-agent` refuse (409) a mission carrying `mission_contract` that no longer equals its contract or its approved hash, before any provider call. A v1 mission carries no contract and is not affected.
4. **The version boundary.** `missionContract/authority.ts` decides each mission's authority from the mission's own version: contract, or legacy.
   - For contract missions only, these readers use the contract instead of the sentence:
     - `leadSearchIntent`;
     - `leadIntentModel`;
     - the YC cohort check;
     - run-agent's runtime Brain gates.
   - For v1 missions they behave exactly as before.

## 2. Deployment requirements

- **Functions:**
  - `pilot-chat`, `orchestrate`, `run-agent` (and the Railway worker image, which runs run-agent in-process);
  - `lead-pipeline`.
- **Order:**
  1. run-agent and worker, then orchestrate: the integrity guards must exist before any v4 mission can be produced;
  2. then pilot-chat;
  3. then the flags.
- **Database migrations: none.** Bindings, shadow comparisons and Brain reports live in the existing `messages.metadata` JSON. The contract lives inside the existing mission JSON (`mission_contract`, `mission_contract_hash`).
- **Secrets:** none new. The flags are plain function environment variables.

## 3. Historical compatibility

| Population | Behaviour |
|---|---|
| Stored v1/v3 missions, in-flight and queued | Unchanged. `interpretationAuthority` = legacy; no integrity check (no contract); `criteriaOf` reads them as before |
| Approval cards created before this release | No binding stored → `unbound` → the Start runs exactly as before, **even under `enforce`** |
| Cards after this release, v1 | Bound via the boundary. Measured over 355 stored or compiled missions: 353 convert losslessly (2 are invalid meanings and are reported `unconvertible`, then run as before) |
| v4 missions | Bound by their embedded contract, after I1 (criteria = contract) is verified |
| Queued production missions | Not resumed by anything in this change. The Railway worker outage is a separate, owner-gated decision |

No implicit migration rewrites any stored mission or changes an approved meaning.

## 4. Rollback

Each step is independently reversible, and none needs a deploy:

1. Unset `AGENTORY_CHAT_CONTRACT_V4`. New cards become v1 again.
   - Already-approved v4 cards still run: they carry their own contract, and run-agent reads it through the authority boundary.
2. Unset `AGENTORY_CHAT_CONTRACT_BINDING`. Mismatches are only logged again.
3. Unset `AGENTORY_CHAT_CONTRACT_V4_SHADOW`. No extra model call.
4. Unset `AGENTORY_MISSION_CONTRACT_V4` on `lead-pipeline`. Strategy plans become v1.
   - Outstanding v4 approval tokens then fail closed (409, "plan changed").

**Full code rollback:** revert the release. Stored v4 missions would then lose their run-time authority boundary, so drain or cancel in-flight v4 missions first. While v4 has only been enabled on TEST, there are none in production.

## 5. Monitoring

| Signal | Source | Alert when |
|---|---|---|
| Binding verdicts | `[pilot-chat][contract-binding]` `{status, decision, enforced}` | any `mismatch` (a client sent a different mission than the card showed); `unconvertible` rate > 2% of new cards |
| Integrity refusals | `[orchestrate][mission-contract-invalid]`, `[run-agent][mission-contract-invalid]` | any |
| Shadow differences | `[pilot-chat][mission-contract-shadow]` + `messages.metadata.mission_contract_shadow` | see §6 thresholds |
| v4 card refusals | `[pilot-chat][mission-contract] refused` `{reason}` | `interpretation_failed` > 3% of lead cards |
| Spend | existing ledgers and canary guards (unchanged) | unchanged |

## 6. Shadow comparison metrics

Each record is `contract-shadow-v1` and holds meaning keys only; it never contains the user's sentence. It records:

- `added` / `removed`: requirements v4 has and v1 does not, and the reverse;
- `strengthened`: a preference became required;
- `weakened`: a requirement became a preference;
- `changed`: the same requirement with different bounds, window or roles;
- `approval`: approvable under each reading;
- `plan_hard`: the hard-requirement set the plan gates on;
- `qualification`: the criteria the evaluator checks.

**Offline baseline** (`scripts/dev/mission-contract-shadow.ts`, $0; `docs/benchmarks/mission-contract-shadow/2026-11-06.json`):

| Baseline vs v4 | Compared | Identical meaning | Added | Strengthened | Weakened | Plan-hard differs | Approval differs |
|---|---|---|---|---|---|---|---|
| v3 compiler, 55 corpus phrasings | 55 | 46 | 0 | 0 | 0 | 2 (M17 "saas" duplicate) | 0 |
| v3 compiler, run #24 live answers | 162 (+1 clarification) | 126 | 0 | 0 | 0 | 6 (all M17 "saas") | 0 |
| v1 compiler, 55 corpus phrasings | 55 | 2 | 2 | 11 | 0 | 14 | 0 |

Against v3, every removal is an invented or unsupported item that v3 compiled and v4 does not. Examples: `industry: businesses`, `industry: us`, `industry: cos`, `signal_logic` constraints, malformed `employee_range` restatements, and the M17 duplicate.

**Shadow release thresholds** (production shadow, at least 200 lead cards):

- `weakened` = 0;
- `strengthened` = 0 except documented approved differences;
- `plan_hard.added` = 0;
- every `removed` is reviewed and classified as noise removal, never as a dropped user requirement;
- `approval_differs` ≤ 2%.

## 7. Canary rollout plan

| Stage | Where | Flags | Exit criteria |
|---|---|---|---|
| 0 | TEST | `AGENTORY_MISSION_CONTRACT_V4` on `lead-pipeline` | TEST smoke + one approved plan → run with verdicts. The independent study passes G2 (≥157/165) |
| 1 | Production | none. Deploy only: binding stamp + observe-mode Start checks + integrity guards | 7 days: 0 integrity refusals, binding `mismatch` 0, `unconvertible` ≤ 2% |
| 2 | Production | `AGENTORY_CHAT_CONTRACT_V4_SHADOW` | ≥ 200 lead cards; §6 thresholds; extra model spend inside the approved budget |
| 3 | Production | `AGENTORY_CHAT_CONTRACT_BINDING=enforce` | 7 days: no false refusals (every refusal is a real mismatch) |
| 4 | Production, one internal workspace | `AGENTORY_CHAT_CONTRACT_V4` + `AGENTORY_CHAT_CONTRACT_V4_WORKSPACES` | 20 approved missions end to end; every verdict traces to a requirement; spend within ledger caps |
| 5 | Production, all | `AGENTORY_CHAT_CONTRACT_V4` | owner sign-off. Then retire the reconcilers (inventory §B) |

Stage 4 is scoped with `AGENTORY_CHAT_CONTRACT_V4_WORKSPACES=<the internal workspace id>`.

## 8. Release acceptance criteria

1. The independent live v4 study is ≥ 157/165 (G2). The failures are classified, and none is a compiler failure.
2. All suites are green:
   - edge, infra, UI;
   - Replay Lab (SAFE);
   - mission semantics, verdict replay, consistency;
   - corpus v1/v3/v4;
   - the contract-shadow baseline test.
3. Mutation checks: every defect class in `missionContractChat.test.ts` and `missionContract.test.ts` is caught.
4. TEST: an approved v4 plan runs end to end, and every lead returns one verdict per requirement.
5. Shadow thresholds (§6) are met in production shadow.
6. Rollback (§4) has been rehearsed on TEST.

## 9. Human approvals required

| Action | Who |
|---|---|
| Merge the Mission Contract PRs into `launch/hardening` | owner (required reviewer) |
| Dispatch the independent live v4 study (≤ $2), and approve the `discovery-test` Environment run | owner |
| Set `AGENTORY_MISSION_CONTRACT_V4=enabled` on TEST `lead-pipeline` | owner (TEST secret/config) |
| Any production deploy | owner |
| Each production flag change (stages 2–5) | owner |
| Extra model spend from production shadow | owner (budget) |
| Railway worker restoration, and any decision about old queued missions | owner, separately |

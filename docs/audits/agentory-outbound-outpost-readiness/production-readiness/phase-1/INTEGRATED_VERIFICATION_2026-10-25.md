# Phase 1 independent integrated verification — 2026-10-25

**Phase 1 FAIL. Phase 2 unstarted. P1–P8 disabled. A7 NO-GO.**

Draft [#185](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/185)
is a verification candidate, not an integration/release approval. No PR was
merged, no owner branch was changed, and no hosted database, deployment,
customer record, paid model/provider or outreach operation was used. Local
assembly merge commits exist only on the isolated review branch.

## Exact source composition

| PR | Pinned head | Role |
|---|---|---|
| #169 | `833affce5077ae5f50b53353cb84fa0e916918dc` | AUTH-06, inherited through #178 |
| #174 | `86f29509b33616e689098ba87c9a8b58762955d3` | v2.2 contract reviewed; docs, not installed schema |
| #176 | `1756b21717fd172cf256ca05bd1b3370248638a9` | Held canonical clients/grants/Brain, inherited |
| #178 | initial `54c92a163b33d088537aadd52785724add6dddef`; refreshed **`aeeba01673f17a25de44490247a4d05c0f8d581b`** | Brain integration + final first-save CAS correction |
| #183 | `c8aa4e2c309288fe460f7c1e48ae9da7d7b805ea` | Already inherited; autosave library byte-identical |
| #175 | `dbd73f06d69bd56700f896128a6730cf73216963` | Malformed dataset observability |
| #177 | `05e288e1ea775e1efaf53581ed7bb4e0b6d032d4` | Held workspace parent integrity |
| #179 | `d3d68201881ad241cfd4ccf3bc01efd5aec9b722` | Legacy entry guards |
| #180 | `dd7cba8470e9cbddcaf98b4de5799bb8873e3069` | C1–C4 targeting |
| #181 | `90bd993f00ef248b3d810333b89d63e1e945d48e` | Phase-clock determinism |
| #184 | `cd3a7a00548ddfc0a7a58f024b2a6f2fbd04ca82` | C5 readiness, inherited #168 |
| #173 | `70507ba059dbed0d8e396758a3fa6c00c9af2777` | Owned disabled modules/native fixtures; explicit overlay |
| #171 / #172 | `0d7cd077` / `2ffc6b5f` | Original lifecycle and AUTH-06 assertions preserved |
| #170 / #159 | `cc83eb7e` / `572dca5c` | Exact workspace diff / membership SQL in disposable integration |

Assembly `33d964027d76d55ed7dd8c7057765357f4cb757a` contains all owner runtime
changes plus the owned pilot overlay. `914a3a71220bbe3eedf85d3707c1c07c7151bd69`
completes fixtures and adds independent execution assertions; runtime behavior
is unchanged. The owner follow-up `aeeba016` is incorporated by local assembly commit
`221da7ab88f3f32f9d9bae50a679edac6e3376a5`; later owned commits change only
audit/test tooling and documentation. The previous worktree's unfinished three-file AUTH-06 edits
remain preserved. Owner implementations were not rewritten.

## Results and limits

| Boundary | Result | Evidence |
|---|---|---|
| AUTH-06 | **PASS** | Original unchanged #172: 23/0 on combined handlers; six removal/demotion/logout races403/403/401, no profile change,0 write requests,0 external calls |
| Transactional Brain locks | **PASS**, tested scope | Unchanged owner writer9/0: service-only RPC, role matrix, session ownership/expiry, activation, stale CAS; held removal/demotion/logout makes writer wait then refuse without changes |
| OWN-01 | **PASS for workspace parent integrity** | Unchanged #173 raw/P1 reproduction now PASS; owner8/0 covers browser INSERT/PATCH, service INSERT/parent-child moves, catalog26 references, embeds, optional parents/deletes and preflight rollback |
| Client Brain native isolation | **PASS for held schema/API** | Client contract15/0; separate A/B Brains in one workspace, explicit grants for all roles, revocation/regrant, demotion/promotion, remove/rejoin, archive, locks, CAS, no fallback |
| Client UI/session cache | **FAIL** | Actual key exports + actual QueryClient return prior principal's client name/Brain with0 authorization requests;1 positive/1 failing assertion. Source review confirms singleton survives auth changes. Full browser login/revocation test remains required |
| Autosave / #168 conflict | **PASS for tested server/page logic** | Initial real-GoTrue19/0; refreshed head **24/0**, including activation/logout/first-insert races; native writer retains AUTH-06 + CAS and #183 stale-without-copy preservation |
| Task permissions | **PASS for existing disabled P1 task boundary; incomplete client successor** | Lifecycle/API68/0; real-GoTrue original-session8/0; pilot/client execution entry denials9/0. Canonical task pins/bridge/descendants are not implemented |
| Execution guards | **FAIL overall; existing entry cases PASS** | Unchanged owner9/0, but independent1 positive/2 failures: foreign plan link and task persistence after committed membership removal |
| Integrated candidate | **FAIL / not customer ready** | The two execution failures, session-cache gap and missing client/task integration prevent acceptance; ordinary CI success is not security acceptance |

Other local regression results: edge9401/0, infrastructure214/0 (including new
migration-version checks), UI682/0 + Node5/0, tsc23 and ESLint1277 findings unchanged
at ratchet baselines, production buildPASS. Native focused45/0 combines
client15 + writer9 + browser-only4 + OWN-018 + guard9. Full local DB289/1 with
PostgREST16.4: the only failure is the historical D1 expectation of42703, absent
in16.4. No assertion was removed. CI uses checksum-pinned12.2.3.

Local archived mutation runs are **not a91/91 receipt**: shard0 cannot kill the
historical D1 mutant with16.4; other cold archives stop on TS2307 extensionless
frontend imports before the named E2E mutant assertion. These failed attempts
are preserved. The full Ubuntu12.2.3 workflow is authoritative for the independent
clean CI run; its completed receipt is appended below when available.

## Reproduction commands

Use only a new disposable loopback PostgreSQL17.6 environment. Native scripts
create/remove their own containers and credentials; never substitute a hosted URL.

```sh
# Candidate914a3a71 or its verification-only successor; exact source required.
OUTPOST_NATIVE_BRAIN_SOURCE=914a3a71220bbe3eedf85d3707c1c07c7151bd69 \
 OUTPOST_NATIVE_BRAIN_HANDLER_ONLY=1 tests/outpost-native/integrate-brain-owner.sh
# Expected:23 passed /0 failed; original test/checker byte-identical to172.
OUTPOST_NATIVE_BRAIN_SOURCE=914a3a71220bbe3eedf85d3707c1c07c7151bd69 \
 OUTPOST_NATIVE_RESOURCE_PARENT_ONLY=1 tests/outpost-native/integrate-brain-owner.sh
# Expected: raw_parent_integrity PASS, pilot_parent_integrity PASS.
OUTPOST_NATIVE_BRAIN_SOURCE=914a3a71220bbe3eedf85d3707c1c07c7151bd69 \
 tests/outpost-native/integrate-brain-owner.sh
# Expected roles13/0, lifecycle68/0, sessions8/0, context/surfacePASS,
# server writer4/0 and transactional writer9/0.
POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh
# Expected19/0, real signups/tokens/logout; all external providers fenced.
POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh \
 tests/db-contract/clientCompanyBrain.contract.test.ts \
 tests/db-contract/companyBrainAuthorizedWrite.contract.test.ts \
 tests/db-contract/companyBrainServerWrites.contract.test.ts \
 tests/db-contract/leadGraphSameWorkspaceParents.contract.test.ts \
 tests/db-contract/legacyPreEffectGuard.contract.test.ts
# Expected45/0.
PG_ADMIN_URL=postgres://postgres:DISPOSABLE@127.0.0.1:LOCAL/postgres \
 POSTGREST_BIN=/path/to/postgrest tests/db-contract/run.sh \
 tests/outpost-native/execution-integration-audit.test.ts
# Expected1 positive PASS /2 security FAIL; a real task committed in each attack.
node --test tests/outpost-native/cache-session-audit.test.cjs
# Expected1 positive PASS /1 cache-boundary FAIL; no network involved.
deno test --node-modules-dir=none --no-check --allow-read --allow-env tests/edge-functions/
deno test --node-modules-dir=none --allow-read --allow-env --allow-run tests/infra/
deno test --node-modules-dir=none --no-check --allow-read --ignore='tests/frontend/**/*.test.cjs' tests/frontend/
node --test tests/frontend/*.test.cjs
node scripts/ci/ratchet.mjs tsc
node scripts/ci/ratchet.mjs eslint
npm run build
# Full offline native DB, on a disposable loopback server:
PG_ADMIN_URL=postgres://postgres:DISPOSABLE@127.0.0.1:LOCAL/postgres \
 POSTGREST_BIN=/path/to/postgrest tests/db-contract/run.sh
# Full mutations require a separate disposable checkout per shard, never a shared
# live source tree. Existing mutation.sh checks the named behavioral failure.
PG_ADMIN_URL=postgres://postgres:DISPOSABLE@127.0.0.1:LOCAL/postgres \
 POSTGREST_BIN=/path/to/postgrest tests/db-contract/mutation.sh
```

The execution probe deliberately simulates a lost response **after** the first
real task INSERT has committed, then fences further work. The observed500 is
not the security assertion; native SQL persistence is. No model/provider outcome
is simulated as a successful customer operation. The cache probe runs real
query keys/QueryClient with unused hook dependencies stubbed only for module
loading; it is not a mounted React/browser acceptance test and must be verified
against the owner's selected auth-lifecycle correction.

## Root causes, owners and exact next actions

1. **EXEC-PLAN / Backend #179 successor (P1):** `referencedTaskIds` checks task
   IDs but not request `plan_id`; run-agent inserts an A task with B's plan at
   its task INSERT. Require parent-plan authorization before effects and native
   persistence integrity, including service writers and valid nonpilot controls.
2. **EXEC-REVOKE / Backend #179 successor (P1):** membership checked once before
   agent lookup; removal committed at that lookup still permits task persistence.
   Recheck/serialize the owned authorization-effect boundary. Preserve authorized
   accounting settlement; no new purchase after loss of authority. Codex does
   not implement a second ACL, ledger or executor.
3. **CACHE-SESSION / Brain #178 successor (P1):** query keys lack actor/session;
   module QueryClient survives sign-out; workspace-only selection/cache can be
   reused after a different member signs in. Require cancellation/invalidation
   and/or identity-scoped keys, including late responses and a real mounted
   auth/session test. Backend native grant denial remains correct.
4. **Contract O3/O4 / Backend + Brain:** O3 A and O4 A accepted by Codex. Original
   live session + immutable grant id/generation/revision; no silent re-pin or
   service bypass. Actual member-remove/set-role writers, last-owner concurrent
   protections, immutable task columns and resume/effect consumption still need
   delivery. A read-only pin snapshot is not atomic task registration proof.
5. **Same-client descendants / Backend:** separate client-parent FKs and177's
   workspace-only parent references do not jointly prove parent/child same-client
   ownership. Bind client identity on the parent edge itself; test A→B references
   inside one workspace, stripped/changed/null client IDs, service writes and
   explicit legacy compatibility. None is claimed implemented here.
6. **Pilot canonical bridge / Codex after shared contracts:** existing
   `outpost_private.clients` has no FK to canonical client accounts and retains
   one-client enrollment. Native catalog finds all3 canonical tables but0/15
   direct descendant client keys and no bridge. Prepare the held composite FK
   successor and reconcile task-first/member-before-session pilot locking with
   the global order; require same-workspace A/B native and replay acceptance.
7. **Migration collision / #107 maintainer:** current candidate has no duplicate
   active/held versions. Adding107 produces two held files at20261019120000.
   Reconcile with integrated108 first, then supersede or uniquely version only
   genuinely missing behavior. No blind replay/hosted renumber is authorized.

## Conflict and contract review

#178 ancestry contains resolution `8fbfb6f3`. The actual agency save helper calls
`authorizedBrainWrite`, uses `cas`/`expectedUpdatedAt` for versioned saves, returns
stale at the locked writer, enforces activation permission, and removes setup
progress on activation. Taking either original conflict side alone would lose a
protection; this resolution retains both and the real-login race tests pass.

Contract v2.2 accepts O1 denied ungranted client names (separate management list),
O2 monotonic revisions/grant generations and removal hooks, O3 Backend writers,
O4 original-session task pins. #176 supplies the Brain mechanisms. It does not
supply Backend writer policy, task persistence or descendant isolation, nor does
it authorize enablement. Codex's bridge remains separate owned work. No model
principal or agency fallback was added.

Handoffs:
[Backend execution](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/179#issuecomment-6395643693),
[Brain cache](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/178#issuecomment-6395745394),
[contract](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/174#issuecomment-6395683085),
[Brain passing evidence](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/178#issuecomment-6395683327),
[migration collision](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/107#issuecomment-6395643988).

## Release controls and evidence

Phase1 cannot pass until the two execution defects and cache boundary are fixed,
O3/task pins and client-descendant/bridge implementations arrive, and the complete
native integration passes without known security failures. Phase2 requires new
approval after that. A7 additionally needs its independent strict qualification,
reliability, authorized target/deployment, credentials/provider and cost-control
acceptance; no current CI result authorizes dispatch or paid testing.

Compressed complete local logs and source checksums are in
[verification-2026-10-25/manifest.json](verification-2026-10-25/manifest.json).
Historical17/6 and OWN-01FAIL receipts remain unchanged; this dated receipt
supersedes their current-status interpretation, not their historical evidence.

## Completed full CI and incoming-patch follow-up

Full manual CI [40178721665](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40178721665)
on914a3a71 is **SUCCESS: all16 jobs, all22 contract files,98/98 mutation
proofs across8 shards**, with the repository-pinned PostgREST12.2.3. Its
checksummed logs and tally artifacts are preserved with this receipt. The local
cold-archive errors were not reproduced by that clean Ubuntu run and are not
reported as a current CI regression. This ordinary green workflow does not run
the independent failing audit as a passing characterization.

Initial native CI40178713769 correctly stopped on an outdated fixture mode: the
combined tree already installs169, but no optional overlay flag was supplied,
so the old fixture expected browser Brain PATCH204 instead of403. Owned run.sh
now detects the active reviewed migration, verifies its existing exact checksum
and native grants, and enables the already-existing strict169 expectations.
No test or security check was removed. Local baseline native67/0+1 intentionally
ignored membership-dependent case; integrated159/native68/0 has no such ignore.

During the audit178 advanced toaeeba016. It fixes the previously uncovered
**first-save** race: a versioned save with no existing row formerly used upsert
and could overwrite another device's just-created Brain. The owner's new test
was run against the old integrated handler first: **0PASS/1FAIL (23filtered)**,
then the unchanged owner patch was incorporated. Real-GoTrue now **24/0**. The
new tests also cover blocked/successful activation, permission loss, stale
activation and logout. Original172 and pilot integration were rerun on the new
combined head. No security finding was fixed by editing Brain-owned source.

The first green98-proof workflow belongs to914a3a71, not the later101-proof
candidate; do not extrapolate its result to a new source SHA. Final candidate CI
is tracked on185 and its publication receipt. Cache/session and Backend execution
failures remain open and must not be hidden by either ordinary workflow.

## Final verified source: a3a3e895 — complete independent acceptance receipt

- Full [CI40179843416](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40179843416):
  **SUCCESS,16/16 jobs,295/0 DB assertions across22 contract files,101/101
  mutation proofs across8 shards**. The final artifact tally is101, not the
  anticipated100. Edge9401/0, infrastructure214/0, UI682/0, Node5/0, type/lint
  ratchets unchanged, buildPASS, offline Replay LabPASS.
- Separate [native40179846237](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40179846237):
  **FAIL**, solely at required execution integration acceptance:1 positivePASS,
  EXEC-PLAN and EXEC-REVOKE2FAIL. Real-GoTrue client/autosave24/0, AUTH0623/0,
  owner/private task/session, source integration and mutation steps all passed
  before that final required gate. Full logs are preserved, not reclassified
  as an acceptance success.
- Manual cache-session proof remains1positivePASS/1FAIL; not a full mounted
  browser test. Brain178aeeba016 and Backend179d3d68201 remained the latest
  inspected owner heads at freeze. No incoming execution/cache fix was present.
- Documentation-only publication successors preserve identical supabase/worker/
  src/tests/.github/scripts trees to the verified sourcea3a3e895. The manifest
  records those tree IDs and all evidence hashes; source verification is not
  falsely attributed to a different code tree.

**Phase1FAIL; Phase2 unstarted; P1–P8 disabled; A7NO-GO.** Next actions remain
Backend execution + membership/task/descendant fixes, Brain cache/auth fix and
Codex private canonical bridge + full same-workspace native acceptance. The
unchanged failing assertions must pass on the actual delivered implementations.

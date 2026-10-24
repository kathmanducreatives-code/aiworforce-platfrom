# Phase 1: native client prerequisites and resource parent integrity

2026-10-24. **Phase1 FAIL; Phase2 unstarted; P1–P8 disabled; A7 NO-GO.**
Independent successor `codex/nosh-phase1-client-contract-gates` on #172
`2ffc6b5f22b5ce2d71c965054c06f5c34cfffce9`. No production implementation, shared
schema, migration, qualification, provider/admission or owner branch is modified.

## Current GitHub state, not assumed progress

| PR | Exact checked head | Verified status |
| --- | --- | --- |
| #169 | `60be04712c41193da213a95c1918f7f4f9a4e645` | OPEN draft, CI green; no late-authorization fix commit delivered. AUTH-06 remains six failures. |
| #171 | `0d7cd07741aed8f20b824d90e45385629ff40412` | OPEN draft, completed owned task/lifecycle protections; full/native CI green. |
| #172 | `2ffc6b5f22b5ce2d71c965054c06f5c34cfffce9` | OPEN draft, full/native CI green; actual Brain audit17 pass/6 fail, NOT23/0. |

This continuation reviewed the plans, client contract, task and Brain audit
receipts, PR commits/comments/checks, all open owner PRs and Backend #150. No
canonical client schema or final A7 owner acknowledgment was delivered in those
committed branches. A coordination request is not a delivered fix.

#172's completed native CI [40078697596](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40078697596)
was read, not rerun: it records `FAILED | 17 passed | 6 failed`,
`BRAIN_EDGE_AUTH_READINESS=FAIL`, and summary outcome `failure`. The job's separate
integrity check succeeds; that does not close AUTH-06. Full CI [40078697639](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40078697639)
also passes. These replace the earlier publication's CI-pending status.
No repeated manual Brain investigation or shared writer redesign was performed.

## Independent check 1: read-only native catalog gate

The real P1 `RESOURCES` registry supplies the table inventory, plus its message
child. The audit queries only PostgreSQL catalogs in a `BEGIN READ ONLY`
transaction; `transaction_read_only=on` is recorded. It checks qualified FK targets,
paired scope columns, validation state, composite keys, RLS and effective browser
DML privileges (including PUBLIC/inheritance), and preserves actual policy text.
No customer/application rows are read by this catalog audit.

Actual tested composition: exact #169 source including #147/#160, independent
#170 `cc83eb7e` diff, unchanged SHA-pinned #159 SQL from `572dca5c`, #171 held guards
and these owned test tools. All source/SQL materialization and fixtures are confined
to a fresh temporary tree and a disposable PostgreSQL17.6 database.

**Result: BLOCKED, exit2.**

- `public.client_accounts`: absent.
- `public.client_access_grants`: absent.
- `public.client_company_brain`: absent.
- `outpost_private.clients` → canonical composite FK: absent.
-15 actual resources inventoried; direct canonical client FK coverage0/15.
  Existing parent FKs are retained as evidence. Indirect ownership is not called
  insecure merely because it lacks a direct column; it needs behavioral proof.
- Same-workspace client isolation: **NOT TESTED**, not replaced by two workspaces.
- A7 grant-generation/revoke/lock contract: pending owner confirmation/delivery.

Existing `public.clients` is not silently reused as the canonical parent. Missing
schema does not become an empty successful test run. Even future structurally
correct tables yield `STRUCTURAL_ONLY`, never automatic security acceptance.
Actual grant/role/regrant/revoke/session behavior still needs native requests.

`clientBoundaryCatalog.test.ts`: **7/0** structural-checker adversaries (not seven
application isolation scenarios): absent parents, ID-only FK, wrong schema,
unvalidated FK, reversed pairing, valid reordered pairing, duplicate keys/rows,
inherited browser write despite RLS, indirect ownership without invented verdicts.
The complete infra suite is **203/0**. Type/lint/shell checks pass.

## Independent check 2: OWN-01 — native cross-workspace parent gap

The new real GoTrue/PostgREST/SQL path creates two synthetic prospect accounts
with identical external domain/name but different workspaces. The original actor
belongs to A and cannot read B's account (`200`, empty result). Both are prospect
accounts, not the still-undelivered canonical client accounts.

| Operation | Actual result | Security verdict |
| --- | --- | --- |
| Create contact A → account A |201; SQL row stored; actual P1 prepare200, signature and one binding | PASS, legitimate control |
| Create contact A → account B, whose row actor cannot read |201; SQL stores account B under contact workspace A | **FAIL, OWN-01** |
| Pass that contact to original P1 prepare/register transaction |404 `resource_unavailable`; no signature, no binding | **PASS, existing pilot protection** |

Fresh actual GoTrue validates both preparation requests; the original P1 signer,
recursive ancestry checks and #171 native transaction execute. No mocked Auth or
database success is used. Registration flags are injected in test dependencies
only; customer/deployment flags are unchanged. No model/provider/send exists in
this path. Both native reports preserve exact synthetic trace data.

Root cause: `public.contacts.account_id` has an ID-only FK to `public.accounts.id`;
contacts INSERT policy checks membership of `contacts.workspace_id` without
constraining the referenced account's workspace. PostgreSQL FK validation does
not make that referenced parent authorized. The read RLS correctly hides B, while
the link is still stored. Existing P1 `records()` recursively loads parents using
the authorized workspace and refuses, so this test does not demonstrate a P1
briefing leak or qualified company. Legacy/service consumers need independent
containment; this is a native ownership defect, not evidence that all consumers leak.

Relevant areas: existing contacts/account migrations and policies; P1
`pilotScope.ts` (`PARENTS`, `records`); #171's `pilotTaskRegistration.ts` and native
transaction; future shared descendant ownership constraints. No qualification code
or shared table is changed here.

**Correction ownership:** Backend + Codex native ownership coordination. A validated
same-workspace composite parent constraint, compatible update/delete semantics
and data preflight are needed; when canonical clients arrive, retain client
ownership too. Do not bulk-assign existing rows, remove workspace uniqueness,
weaken P1 ancestry or invent a parallel client registry. Confirm shared migration
ownership/overlap before a held constraint successor. Existing mismatches must be
rejected/quarantined by an owner-reviewed procedure, not silently reassigned.
Positive nonpilot/account-less contact behavior and deletion semantics must remain
explicit acceptance controls. No hosted preflight or migration was run.

## Reproduction and expected outcomes

Uses the same exact Git objects and disposable harness as #172; no new migration.
Run from this successor after fetching its pinned owner refs if necessary:

```sh
deno test --allow-read tests/infra/clientBoundaryCatalog.test.ts
# 7 passed /0 failed; checker units only.
deno test --allow-read --allow-env --allow-run tests/infra/
# 203 passed /0 failed.
OUTPOST_NATIVE_CLIENT_CONTRACT_ONLY=1 tests/outpost-native/integrate-brain-owner.sh > /tmp/client-contract.log 2>&1
# Exit2: missing canonical prerequisites, NOT a passed isolation test.
python3 tests/outpost-native/check-client-contract-audit.py /tmp/client-contract.log
OUTPOST_NATIVE_RESOURCE_PARENT_ONLY=1 tests/outpost-native/integrate-brain-owner.sh > /tmp/resource-parent.log 2>&1
# Exit1: OWN-01 raw parent integrity FAIL; P1 ancestry control PASS.
python3 tests/outpost-native/check-resource-parent-audit.py /tmp/resource-parent.log
```

The required CI completeness checks reject missing evidence, failed positives or
unexpected results. Native gap steps retain their failure/blocked outcome and
job summaries explicitly distinguish catalog/audit integrity from readiness.
The original security checks, Brain reproduction and RLS scanner are unchanged.
No attempt/spend/retry limits are increased.

## Backend and final integrated acceptance

Latest inspected Backend #150 is unchanged `be625f46a5e8c63759ccdfd6e7d8612bfdb8ae86`
on #145 `37b3b1ac`. It contains verified service-bearer handling, existing spending
admission and recovery; it is not a delivery of the original pilot task/client
contract. The four requested paths (`handleRunAgent`, `handleOrchestrate`,
`createLeadMissionRunner.run`, worker callbacks) do not integrate the P1 scope or
original-session contract. A source search is not a runtime denial proof.
No Backend completion/ownership handoff reply was found; all-route pre-effect
native acceptance remains NOT TESTED/BLOCKED. No overlapping owner files edited.

Next actions, in order:
1. Brain Claude delivers the AUTH-06 writer fix at an exact head; rerun #172's same
   23 assertions once against it and require23/0, preserving legitimate controls.
2. Brain Claude confirms/delivers A7 grant generations/lock order and canonical
   client parent/grant/Brain API. A1–A6 are already accepted; no new product choice.
3. Codex/Backend agree the native descendant correction scope (including OWN-01),
   then Codex adds the agreed pilot composite bridge/adapters and same-workspace
   A/B native tests. Current one-client restriction remains intact until then.
4. Backend delivers every legacy/direct/worker/resume pre-effect guard and immutable
   executable lifecycle. Tests must prove zero unauthorized context/model/purchase/
   message/output effects, preserving nonpilot service and spending behavior.
5. Run one exact integrated candidate's native role/session/revoke/regrant,
   concurrency, descendant, retry/resume and alternative-route matrix. Only then
   consider Phase1 PASS and stop for Phase2 approval.

This continuation adds test/readiness tooling and evidence, not application
capabilities. No merges, deployment, hosted writes/migrations, customer records,
provider/model calls, paid operations, sends or activation.

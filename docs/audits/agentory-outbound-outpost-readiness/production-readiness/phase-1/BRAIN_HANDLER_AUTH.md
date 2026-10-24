# Phase 1: actual Company Brain handler authorization audit

2026-10-24. **Brain Edge authorization: FAIL. Overall Phase 1: FAIL.**
Independent test/docs successor `codex/nosh-phase1-brain-handler-audit` on #171
`0d7cd07741aed8f20b824d90e45385629ff40412`. #171's completed implementation and
CI remain unchanged. No Brain, qualification, executor, ledger or other production
implementation file is edited. P1–P8 disabled; Phase2 not started; A7 NO-GO.

## Verified finding: AUTH-06, P1 security blocker

Both actual #169 handlers authorize at the beginning of a request, then write
through a service client after current authorization has been revoked. A separate
native transaction commits membership removal, demotion to viewer or actual
GoTrue logout **before the handler reads/writes the Brain**. Each handler still
returns HTTP200, performs one service mutation and changes the stored profile.
This is a confirmed authorization timing defect, not a claim of unauthenticated
access or proof that every action/model branch is affected.

| Actual handler / action | Current code boundary | Verified result |
| --- | --- | --- |
| `setup-company-brain` / `save_basics` | initial membership/role check → `saveProfile` → `saveProfileWith` → separate service REST CAS update | remove member / demote / logout in flight: all200, changed=true |
| `generate-company-brain-draft` / `update` | initial membership/role check → `planBrainUpdate` → separate service REST CAS update | remove member / demote / logout in flight: all200, changed=true |

Exact source is Brain #169 **`60be04712c41193da213a95c1918f7f4f9a4e645`**, including
#147/#160. In that source:

- `supabase/functions/setup-company-brain/index.ts`: initial role check around
  lines120–126; native write is the service REST insert/update in `saveProfileWith`
  around lines139–165. `save_basics` calls it around lines169–176.
- `supabase/functions/generate-company-brain-draft/index.ts`: role check around
  lines168–177; `update` branch lines417–443 checks profile `updated_at` then uses
  the service client's conditional PATCH without current actor/session predicate.
- Owner migration `20261023120000_company_brain_server_writes_only.sql` correctly
  revokes browser writes. Service writes remain permitted outside enrolled pilot
  workspaces. The pilot's enrolled-Brain freeze remains intact and is not weakened.

**Root cause:** content CAS protects concurrent profile changes, not role/session
revocation. The first Auth/role check and final writer run in different database
transactions. A service client bypasses browser RLS; it carries service authority,
not the user's live authorization. There is no shared write transaction that
locks/rechecks the original session and current membership before committing.

## Actual execution, not a copied handler

`brain-handler-auth.test.ts` captures the original module's `Deno.serve` callback
without opening a listener. It dynamically imports the exact owner module; it does
not replace its logic, parsers, checks, writer or return values. Gateway routing
alone is adapted: `/auth/v1/*` goes to actual disposable GoTrue, `/rest/v1/*` goes
to actual disposable PostgREST. Real SDK clients and actual SQL writes execute.
All other fetch destinations are refused, runtime network permission is loopback
only, and provider keys are removed inside the disposable test process.

The target is a **synthetic non-enrolled agency workspace**, where #169's legitimate
server writer is meant to work. The P1–P8 enrolled-Brain freeze would refuse all
edits and cannot be used to demonstrate that this shared writer is fixed.

For each race the test waits until the real membership response has returned and
the actual handler is about to issue its first Brain read. A second real SQL
connection commits membership DELETE or role UPDATE; logout uses the actual local
GoTrue endpoint and session deletion is asserted in SQL. The original request then
continues, and a direct SQL read proves whether the edit landed. This is one
controlled interleaving, not a stress test or fabricated provider response.

## Results: 17 passing controls, six deterministic failures

| Scenario (each handler) | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| owner / admin / editor |200 and distinct persisted edit |200, one write, changed=true | PASS ×6 |
| viewer |403, no write |403, no write, unchanged | PASS ×2 |
| legacy `member` role |fail closed as viewer |403, no write, unchanged | PASS ×2 |
| membership removed before request |deny |403, no write, unchanged | PASS ×2 |
| unrelated workspace member |deny |403, no write, unchanged | PASS ×2 |
| actual GoTrue logout before request |deny |401, no write, unchanged | PASS ×2 |
| membership removed after check |deny, no persisted edit |200, one write, changed=true | FAIL ×2 |
| demoted to viewer after check |deny, no persisted edit |200, one write, changed=true | FAIL ×2 |
| GoTrue logout after check |deny, no persisted edit |200, one write, changed=true; session absent | FAIL ×2 |
| harness teardown |clean shutdown |PASS | PASS ×1 |

All22 handler receipts assert **zero external calls**. Positive controls verify
SQL changes rather than trusting HTTP200. In-flight tests assert actual unchanged
SQL, allowing a future native RPC to receive and atomically refuse the write;
they do not mandate a particular implementation strategy. Initial refusals must
precede writer dispatch. The raw Deno test command fails17/6 as it should.

`brain-handler-auth.json` contains all synthetic receipts. No Auth tokens, secrets
or real customer information are included. CI uploads the raw audit log and a
classified receipt. The integrity checker requires all22 unique receipts, all
legitimate controls and precisely the six known failing assertions; unrelated
failures or missing cases fail the required integrity step. **Audit integrity
PASS is not authorization PASS.** The actual failing audit step is explicit and
reported in the job summary; Phase1 cannot pass while these failures remain.

## Reproduction (disposable local only)

Same exact source composition as #171's `TASK_SECURITY.md`: #169 tree, #170 diff,
unchanged digest-pinned #159 SQL and owned pilot guards. No Git merge, owner branch
change, hosted database, external provider or model operation occurs.

```sh
# Requires the exact reviewed objects; fetching is read-only.
git fetch --no-tags origin 60be04712c41193da213a95c1918f7f4f9a4e645 cc83eb7ee3edf68192378ef68805a71b125edc59 8b0e2b6bdb20d6fe30542da39f0170d514d52746 572dca5c8d9c7f121731456801a035cfb6186b1e
OUTPOST_NATIVE_BRAIN_HANDLER_ONLY=1 tests/outpost-native/integrate-brain-owner.sh > /tmp/brain-edge.log 2>&1
# The preceding command currently exits1 with17 passed /6 failed.
python3 tests/outpost-native/check-brain-handler-audit.py /tmp/brain-edge.log
# Prints audit_integrity=PASS, brain_edge_authorization=FAIL, never pilot ready.
```

PostgreSQL17.6, actual digest-pinned GoTrue, local PostgREST16.4; CI independently
uses pinned PostgREST12.2.3. Runtime model/provider attempts:0. No retry/budget
changes. Full relevant CI receipt at publication head is posted on the successor
PR; historical #171 full/native CI remains green at its unchanged head.

## Precise owner handoff; no duplicate implementation

Company Brain Claude owns the fix in the canonical writer. Keep existing content
CAS/normalization/approval semantics and browser DML restrictions. Resolve writes
under one native transaction that reauthorizes the actual actor, original live
Auth session and required current role. When client Brain arrives, include active
client, current grant identity/generation and permission-reduction fence. Use a
consistent lock order with revoke/archive/membership writers. External/model work
stays outside those locks, and authorization is checked again by the final native
writer. A second Edge SELECT followed by PATCH is still racy.

Map authorization denial to401/403 and preserve owner/admin/editor positives.
Do not grant browser writes, weaken enrolled-pilot containment, change Q1–Q4,
introduce another ACL or use content `updated_at` as an authorization epoch.
Owner should rerun the same23 assertions with **23/0** on its fixed candidate;
then run model-action revocation, activation-specific permissions and writer
concurrency tests (not proven by these free-edit cases). No hosted SQL application
is approved by this report.

Canonical client tables/grant-generation contract, same-workspace descendant
isolation and Backend legacy pre-effect guards remain independent Phase1 blockers.
Durable persistence/recovery and browser end-to-end work remain later phases.

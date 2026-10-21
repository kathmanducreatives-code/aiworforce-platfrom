# P6 native storage and enablement gates — design only

No migration, RPC, native database writer, endpoint, hosted operation or live
credential resolution is implemented. All P1–P6 features remain disabled.
OO-01/OO-02/OO-03 remain mandatory before automation/approved external dispatch;
P6 does not implement dispatch. A7 NO-GO.

## Reuse the approved storage plan

Future `pilot_brief_versions` must attach to the original real task, P5 snapshot,
client/workspace policy and P4 attempt/settlement records. It is not another CRM,
queue, model router, financial ledger or qualification store.

Required fields/invariants:

- Workspace/client/task/original actor, version, unique original task operation;
  same-workspace/client composite FKs to task, snapshot and imported row where
  available. External Apollo IDs never substitute for native ownership.
- Immutable P5 packet/Brain/input hashes, task-binding hash, model-policy hash,
  prompt/schema digest and exact selected model. Native embedded-payload checks
  must agree with columns. Server computes hashes; browser labels are not proof.
- Real attempt ID and settled receipt with actual provider/model, completion,
  token usage/cost estimate and uncertainty. Shared mission/workspace counters
  and all pending reservations count toward existing caps, across workers/resume.
- Strict validated choices + server-rendered content and full provenance; bounded
  artifact bytes; server timestamps separate from collection/event dates.
- Review state starts unreviewed; human approval/export belongs to P7 and binds
  the exact immutable output/source/context/model version. No approved=true input.

Native insert-once must atomically reauthorize original actor/current membership,
lock/fence task status/binding, model policy, P5 snapshot and financial settlement,
validate exact packet/output hashes, and insert only a canonical output. Identical
retry returns the original; differing content conflicts. No upsert. Protect
update/delete, grants/RLS, fixed search_path and privileged service execution;
service role does not establish tenant authorization.

A read must authorize before fetching packet bytes and bind output to its real
settled receipt. The offline store interface does not implement those checks.
No task result/projection may relabel a brief as qualified, approved or sent.

## Output commit versus model settlement

P4 currently settles model usage before the P6 fixture inserts its draft. If
commit fails, the attempt is consumed and no result is returned. Blind retry
must not regenerate. A native adapter needs crash-consistent storage/recovery of
the accepted normalized result, linked to settlement, or an explicit uncertain
operation requiring operator recovery. Prove the exact transaction boundary with
fault injection. A failed settlement keeps the reservation and withholds output.
A lost acknowledgement after output commit must read back the same artifact.

Do not reduce charges, reset attempts, mint a new task/browser request key or
switch providers to compensate for a failed output commit. Operator-approved
regeneration later requires a newly approved task/snapshot and remaining shared
budgets; no such regeneration feature is supplied here.

## Reproduced P5 native-serialization limitation

At P5 base `2eea47a3`, `pilotEvidencePacket.ts:262` iterates
`Object.entries(c.mapping)` to build an ordered facts array. JSONB may reorder
object keys while preserving arrays. Replaying a saved packet after
`JSON.parse(canonical(packet))` rebuilds the same facts in a different order and
P5 correctly refuses `snapshot_stored_integrity_failure`.

Deterministic reproduction is included in P6's test “does not repurchase when P5
saved inputs are reordered by JSONB-style storage.” It asserts zero model calls
and zero credential resolutions. No actual native table is claimed or accessed.
This is an enablement blocker for a naïve JSONB snapshot adapter, not evidence of
cross-client disclosure or changed qualification. P5 files are untouched here.

Smallest correction in a separate P5/native-storage review: version stable mapped
column/fact ordering (or preserve exact serialized artifact bytes in a versioned
adapter), define explicit handling for existing approved v1 snapshots, and prove
actual JSONB round-trip replay. Do not remove full integrity comparisons or
silently rewrite snapshots to fit a new ordering. Native transaction/RLS gates
still apply. This finding was posted directly to #142 for coordination.

## Required disposable native tests before enablement

| Test | Required outcome |
| --- | --- |
| A/B/shared users and overlapping Apollo/contact IDs | Exact client-bound sources, Brain, receipt and output; no ID-based foreign lookup. |
| Native REST/SQL anon, unauthorized user, revoked member, forged service actor | No foreign row/content; privileged caller still enforces original actor. |
| Client write of output/receipt/approved flag or foreign embedded scope | Refused by grants/server checks/native ownership constraints. |
| Same task with mismatched snapshot, receipt, policy or model | Refusal before dispatch/output. |
| Four shared runtime attempts; model/provider/combined/workspace caps; pending reservations | No fifth attempt or overspend under concurrent separate connections. |
| Concurrent identical and differing output commits | One immutable result or explicit conflict; no duplicate charge. |
| Revoke/cancel/update policy while admission/settlement/commit/read is paused | Transactional fences prevent stale authorized commit/return. |
| Crash before/after admission, model response, settlement and output commit | No free retry; explicit held/uncertain state or replay of original accepted draft. |
| Native P5 and P6 JSONB round trips; old/new packet versions | Stable original bytes/meaning, versioned reader; no silent recomputation. |
| Current same-client Brain updates after capture | Original packet/draft reused, current authorization still enforced. |
| Legacy run-agent/queue/checkpoint resume of pilot task | No unsnapshotted model, research, fallback or send path. |
| Browser client switch, delayed responses, auth/logout and direct APIs | No stale A draft shown or actionable in B. |
| Provider result attempts free prose/new URL/fake citation or verified claim | Contract rejection and one accounted attempt, no repair. |
| Exact authorized adapter/model/account with real completion receipts | Separate bounded authorization needed; remain blocked now. |

Also verify credential bindings/consent, no secret/customer context logging, real
review UI and policy persistence, source authenticity/strong employer identity,
retention, native immutability and audit access. Old source text can be authentic
and still irrelevant/negative; E01 semantic evaluation stays with the existing
canonical evaluator, never a second P6 qualification engine.

## Demonstration boundary

Today: synthetic fixtures → real P1 signing/auth → frozen P5 → P4 mocked transport
→ grounded structured unreviewed brief, inspectable sources and unknowns. No
customer data, paid model, retrieval or send is involved.

Not yet: a live Nosh workflow, authentic Apollo import, true verified buying
signals, measured model curation quality, enabled client selector/model dropdown,
review/export, native isolation or recovery proof. P7/P8 and all prior gates plus
separate live authorization are required. Exact iGTM/Jungler identities and CRM
of record remain unverified integration questions; P6 depends on none of them.

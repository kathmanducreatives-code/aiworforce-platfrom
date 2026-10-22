# P7 native review/export gates — proposal, no migration

P1–P7 stay disabled. No schema is installed, no database is contacted, and no
live endpoint exists. The following is the required native implementation and
acceptance scope, not proof that it is working. A7 NO-GO.

## Existing-plan event store

Use the proposed append-only `pilot_artifact_events`, tied to real tasks/P5/P6
snapshots. Do not create a second queue, CRM, model router, qualification engine
or financial ledger. Required columns/contracts include:

- Non-null workspace/client/task/original actor; same-client/workspace composite
  FKs to task, immutable P6 root and P5 packet. External Apollo IDs prove no ownership.
- Sequence, previous/event hashes, operation UUID/request digest, event kind,
  trusted server time and bounded canonical payload.
- Root draft, revision, packet/Brain/input, model receipt, task-binding,
  model-policy and review-policy hashes. Embedded scope must match native columns.
- Edit choices/explicitly unverified human notes; exact-version approval or
  rejection; export-prepared manifest. No mutable approved=true property.
- Unique task sequence/head transitions and operation identity. Protect update,
  delete and rollback/truncation; define audited retention separately.

The `PilotExportStore` interface needs an **atomic** read-validate-CAS-append
transaction across every batch task, including a global workspace/client/actor/
operation fence. Same operation/exact request returns the first durable event
and preparation time; different request, task set or manifest conflicts. Native
operation uniqueness must survive restarts and parallel connections. The memory
fixture's operation Map is not an implementation. Decide a proven operation
header or equivalent locked/deferred invariant in separate schema review; an
array of best-effort inserts is insufficient. Existing-plan preference is a
single event store with grant-restricted transactional routines, not another
financial ledger.

The routine must lock/revalidate current original actor membership and revocation
epoch/session, task signature/status/version, client enrollment, original source/
model snapshot, review policy/version and latest head. Verify source/fact
references against the frozen packet and recompute server hashes. Reevaluate
approval expiry against a trusted transaction clock. Native RLS/grants and parent
constraints must reject foreign rows even for accidental service-role inserts.
Minimal security-definer grants, fixed search_path and qualified table names are
required if used; a service-role transport is not tenant authorization.

The caller authenticates using the existing server request/P1 mechanisms. Never
copy actor/workspace identity from user metadata, local selection, an approval
checkbox or client timestamps. The current dependency-injected offline functions
are not a JWT/HTTP boundary. Public/anon direct table writes must be denied;
current authorized reads must not expose foreign source bodies/errors/logs.

## Exact-version approval and export

Edits increment immutable revision even when text is restored. They clear the
current approval. Approval/rejection is a scoped direct action, not
approve-and-continue or task dispatch. Approval means **manual CSV only**; it
never proves source truth, qualifies a lead, grants an API destination or satisfies
outreach permission. Human notes keep author/edit time and unverified status.

An export transaction validates every referenced task/revision/approval, policy,
manual destination and TTL, and appends every export-prepared event or none.
No CSV bytes are returned if commit/receipt/read-back/current authorization fails.
The manifest says prepared, never downloaded/sent/Apollo updated. No remote API
is an allowed destination. Canonical structured cells, proper CSV quoting and
formula protection are representation rules, not altered canonical evidence.

A lost commit acknowledgement must return the same file/manifest when still
current and authorized, not append duplicates. A later edit, rejection, new
approval, expiry, cancellation or policy/revocation change invalidates retry.
A CSV already returned/downloaded cannot be remotely recalled. Native audit
history must make that exact version/authorization window clear.

## P5 storage-order path remains blocked

P5's `Object.entries(c.mapping)` fact order can change under JSONB object-key
reordering. Replaying that packet refuses `snapshot_stored_integrity_failure`.
P7's read-only adapter cannot capture a replacement or call a model. This is
explicitly tested, not suppressed. Do not enable a naïve JSONB P5 store for P7.

Separate correction/approval is needed: version deterministic snapshot fact
ordering or preserve the exact serialized artifact with an agreed versioned
reader. Test original capture → actual native JSONB round trip → resume without
rewriting approved content. Event JSON/canonical CSV tests in P7 do **not** prove
that P5 native round trip works.

## Disposable native acceptance suite required

| Scenario | Required result |
| --- | --- |
| A/B and shared actors with overlapping Apollo/contact IDs | Task-bound source, draft, notes, approval and export isolated; no foreign lookup by external ID. |
| Direct REST/SQL unauthorized/anon/forged actor/privileged writer | RLS/grants/server ownership prevent foreign reads/writes and forged approvals. |
| Revocation, regrant, expired JWT/session and role changes | Authorization epochs/version policy prevent stale pre-revocation approvals silently returning. |
| Edit/reject/approve races and out-of-order requests, separate DB connections | Exactly one current version/approval; stale input refuses. |
| Concurrent identical operations with differing server timestamps | First durable event/manifest returned, no duplicate event or new operation. |
| Cross-task global operation-key collision | Atomic request/task-set conflict, never mixed receipts. |
| Batch member cancelled/revoked/edited/expired while export pauses | Whole transaction refuses; no partial preparation or bytes released. |
| Crash before/after review/export commit and acknowledgement | Original durable operation recovered; no generation/spending/new source capture. |
| Latest-head rollback/truncated history/invalid embedded scope | Refusal; native high-water/head integrity enforced. |
| Real P5/P6/event JSONB round trips, old/new schema readers | Original meaning and hashes survive versioned serialization; P5 gate fixed first. |
| CSV formula/control/Unicode/quote/newline and downstream import handling | Safe explicit text, no silent fact rewrite; target-tool compatibility established separately. |
| Browser logout/client switch/pending response/download timing | Cleared scoped state; no A artifact rendered/prepared under B. |
| Legacy executor or resumed pilot task | No unsnapshotted generation, provider purchase, fallback or send. |

Existing green native CI validates only the contracts its plan includes. No P7
native table/routine or constraints exist here, so those green tests cannot
certify this proposed suite. Full P8 acceptance requires the actual approved
schema and native adapter, not a relabelled memory-store test.

## P8 decision

Proceed to P8 only as a separately scoped offline acceptance step. Customer
pilot readiness still depends on every P1–P7 native/security gate, exact combined
T01 integration, P6 model quality and explicit operator live authorization. No
bulk prospecting, Apollo/iGTM/Jungler API, automatic send, hosted migration or
production deployment is included. Preserve four runtime attempts and $0.05
model / $0.20 provider / $0.25 combined caps; review/export consumes none.

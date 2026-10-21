# P5 native persistence and enablement requirements — proposal only

**No migration, native writer, RPC, endpoint or deployment is included.**
Do not install this proposal. The offline coordinator and in-memory fixture do
not establish deployed RLS, concurrency, source authenticity or task containment.

## Required durable design

Proposed table `pilot_task_context_snapshots`, after P1's authoritative client
policy and P3 import identity schema are approved:

| Column/group | Required invariant |
| --- | --- |
| `workspace_id`, `client_binding_id`, `task_id` UUIDs | Non-null; one task belongs to one enrolled client/workspace. Unique task snapshot; composite FKs to native workspace-client policy and task ownership. Do not infer ownership from Apollo IDs. |
| `actor_id` UUID | Original authorized task actor, checked transactionally against task and current membership; no client-selected impersonation. |
| `packet_version`, `packet_hash`, `brain_hash`, `inputs_hash`, `binding_hash`, `enrollment_hash` | Non-null versioned contract; 64-lowercase-hex digests; hashes recomputed server-side using the same versioned canonical format. Hashes are integrity identifiers, not access tokens. |
| `brain_source_updated_at`, reviewed profile/compiled artifact, approval receipt ID | Original approved Brain version and trusted human review receipt; no latest-profile substitution on read. |
| `packet` JSONB | Bounded immutable complete artifact. Native checks tying embedded workspace/client/task/actor/hashes/version to columns. Reject non-object/oversized or unsupported format. |
| `created_at` | Server transaction time, separate from source collection and event dates. |
| future imported-row linkage | Composite FK to client/workspace-owned durable P3 row. Offline v1 has null import ID and cannot impersonate a persisted import. |

Exact parent constraint names cannot be chosen until P1's native ownership
schema is approved. First inventory actual local schema and approved migrations;
add required unique `(workspace_id,client_binding_id,task_id)` parent keys and
same-workspace/client ownership constraints explicitly, never assume global IDs
prove tenant ownership. Do not create a second Company Brain or qualification
engine. Frozen artifacts retain references to existing authoritative structures.

## Atomic writer contract

A narrowly granted server routine/store adapter must:

1. Authenticate the original actor or a verified delegated service request;
   enforce one client/workspace and current server-owned enrollment version.
2. Verify the P1 task signature, exact full-payload binding, actor, expected
   client policy, status and resources. Lock the task/policy/membership and
   reviewed Brain/input version, or use equivalent serializable fencing.
3. Match the trusted approved Brain artifact and source-input digests. Reading
   `profile` and `updated_at` together is necessary but not sufficient; prevent
   changes between authorization, version comparison and commit.
4. Insert once. Same task + **identical full packet** returns existing original;
   different packet is a conflict. Never use last-writer-wins/upsert or recompute
   current Brain on retry. A conflict never authorizes source/model work.
5. Refuse revoked membership, changed policy/binding, cancellation or changed
   uncommitted input version within that transaction. Commit and return only
   authorized immutable data. Failed/lost acknowledgements can be replayed.
6. Protect update/delete (including service-role paths) using minimal grants
   and native immutability enforcement; retention/deletion requires a separately
   audited administrative policy, not a worker update privilege.

The TypeScript `SnapshotFence` lists required inputs. Its interface does not
magically implement locking or validate races; the fixture only exercises
consumer behavior. Post-operation TypeScript checks cannot close TOCTOU gaps.

## Native authorization and direct API gates

RLS enabled + FORCE where applicable; anon/client roles cannot insert, update,
delete or forge approvals. Authorized reads must use current workspace
membership and client policy, not a UI selector, hash, possession of task ID,
JWT workspace metadata or creator alone. Revoke public function execution;
security-definer routines need fixed search_path, full schema qualification and
minimal controlled privileges. Service-role bypass requires the same explicit
server checks, original actor and task fences. Do not expose packet bytes in
unauthorized errors/logs or global caches.

These requirements do not fix P1's unresolved existing-table policies: Company
Brain, memory, research, tasks, drafts, credentials, destinations and imported
records need their own native isolation/composite ownership proofs. Existing
membership self-insert policies and historical contaminated records must be
resolved before pilot enablement. Legacy run-agent/queue routes must reject
pilot tasks unless they consume the same validated task boundary and snapshots.
No P5 integration into those live routes is currently authorized.

## Required disposable native database suite (not yet executed)

Use an isolated local Postgres/Supabase instance with synthetic clients A/B,
one shared admin plus A-only/B-only/revoked/anonymous actors, identical external
company/contact IDs, native user JWTs and a separately tested service role.

| Test | Required result |
| --- | --- |
| A-only direct REST/SQL reads B snapshot/Brain/memory/draft/task | Zero rows or authorization refusal; no leaked nested fields/errors. |
| Shared user chooses A but supplies B task/import/source/client | Refusal despite membership in both; no client-inferred external-ID lookup. |
| Embed B scope in A packet/columns; forged hashes/actor/approval | Native constraint/server verification refusal. |
| Anon/client direct insert/update/delete; forged review receipt | Refusal; no native bypass by calling RPC directly. |
| Signed original A task + valid approved versions | One immutable scoped packet. |
| Concurrent identical transactions, separate DB connections | One row, identical packet returned, no alternate context. |
| Concurrent differing Brain/source hashes for same task | One winner or both refused according to approved version; other conflicts. |
| Revoke/Brain version edit/enrollment change/cancel while transaction paused | Lock/fence outcome prevents stale unauthorized commit or return. |
| Crash before/after commit, lost acknowledgement | No partial row; replay returns original packet without fresh sources. |
| Change Brain after successful capture then resume | Original content reused; current identity/membership still checked. |
| Service role with wrong original actor/workspace; null service caller | Explicit refusal; privileged transport is not tenant authorization. |
| Legacy executor/queue resume with pilot task | Contained; no unsnapshotted model, provider or send. |
| Source/import foreign composite FK and deletion/update | Refusal; declared retention policy only. |
| Unsupported packet/compiler version on resume | Fail closed/versioned reader; never silently normalize to latest. |

Also require deployed routing/browser cache isolation receipts, policy/grant
catalog assertions, no cross-client logging, and server-side review/source
attestation tests. Existing green DB CI may select related contracts but does
not prove this proposed table/RPC exists or passes these tests.

## Evidence and future AI consumer gates

Supplied snapshot bytes are not HTTP/provider receipts. Before promoting any
verified fact: define canonical source receipt adapter, source ownership,
per-company/domain/alias validation, explicit collection/event timestamps and
trusted import provenance. Keep model interpretations separate; exact quote
existence is not semantic support (E01). Qualification continues through Claude's
single canonical authority. Human approval for outgoing content remains a
separate gate; this proposal authorizes no sends or AI research.

P4's atomic attempt/cost reservation, credential/model policy and T01 integration
remain separate prerequisites for P6. P5 never dispatches those paths. No model
or provider budget increase is proposed.

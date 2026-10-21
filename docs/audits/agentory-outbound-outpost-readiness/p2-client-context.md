# P2 — explicit client context, isolated preparation and memory

**Disabled implementation; not enablement approval or platform-wide isolation.**
Stacked on P1 draft #124 at `2ffd6f6cfebba8279bcca87f75ad6d2406117a2d`.
Approved plan: [PR #122 pilot P1–P8](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/bc960c3e1ea629760a01f1da78d90c928f6dcbdd/docs/audits/agentory-outbound-outpost-readiness/pilot-plan/README.md).
P1's [remaining risks](p1-client-isolation.md#remaining-risks-and-acceptance-gates)
were reviewed before implementation. No native RLS, ownership constraint,
transactional authorization/concurrency or deployed browser receipt is claimed.
A7 remains NO-GO. P3–P8 are not implemented.

## Implemented boundary

One explicitly selected, server-enrolled client per workspace. The browser never
uses the first membership as a pilot client. Each selection/read/preparation/resume
reauthorizes a real user with P1's `PilotAccess` and existing Auth/membership,
canonical Brain, seller-identity, resource-parent and signed-task checks.

The new `/outpost` route is an **isolated preparation surface**, not a new
prospecting workflow or a selector that silently grants client authority to the
legacy application. It does not mount `MainLayout`, chat, workbench, email,
calendar, imports or an executor. Its single selector is in its own header.
The existing `Header.tsx` is a public marketing header; mounting the selector
there, or changing the legacy chat/orchestration default globally, would expose
unconverted paths. This is a deliberate safety adjustment to P2's proposed file
areas, not a claim that legacy paths are fixed.

`BrowserRouter` now encloses `WorkspaceProvider`, allowing the provider to
suspend its legacy first-membership resolver/provisioning while `/outpost` is
active. Other routes preserve the existing resolution behavior. The pilot page
uses server context, never `getCurrentWorkspaceId`, profile `clients` branding,
legacy `useCompanyBrain`, previous conversations or a global memory loader.
Leaving preparation ends its scope; legacy screens do not inherit the selected
pilot client as authority.

## Default-off gates

Nothing here sets or provisions configuration. Both these new flags default off:

- Browser: `VITE_OUTPOST_PILOT_CONTEXT_ENABLED=true`.
- Server: `OUTPOST_PILOT_CONTEXT_ENABLED=true`.

The server additionally requires **all existing P1 enrollment/signing gates**.
A visible UI cannot enable the endpoint; request-supplied enablement or authorization
objects are rejected. These are operator rollout switches, not substitutes for
security proof. Do not set either until the enablement gates below pass and a
separate rollout is approved. The disabled route shows no client content and
makes no P2 context request.

## Server contract: POST pilot-context

User Auth is validated server-side. P1's existing operator policy and `PilotAccess`
are the only authorization system. A factored P1 policy parser supports bounded
enumeration (at most 100 enrolled workspaces); listing discloses only current
owner/admin memberships with active matching Brains. It returns IDs, domain
label, policy version and draft-only mode—not Brain bodies, credentials or
secret references. No arbitrary workspace search or policy editing is exposed.
The strict 16 KiB streaming request reader is shared unchanged with `pilot-scope`.
Responses are `Cache-Control: no-store`; error messages contain sanitized codes.

| Action | Fields beyond `action` | Behavior |
| --- | --- | --- |
| `list_workspaces` | none | Authorized minimal choices; no automatic first selection |
| `read_context` | workspace/client IDs, `resources` | Current Brain and only explicitly selected P1 record references |
| `prepare_task` | same plus `task_id` | Bind an existing explicitly pilot-marked owned task using P1, then reload its persisted signed scope |
| `resume_task` | same plus `task_id` | Verify the original P1 binding, original actor and immutable resource allowance; never mint a new scope |

`resources` is P1's bounded `{kind,id}` array (maximum 25). All records and known
relational parents must belong to the same selected workspace. Mixed sets fail
as a whole. No record listing, implicit recent draft/history fallback, message
loader, external-ID matching or imported-row resource is introduced. Explicit
memory, research and draft references use P1's projected records. A service
bearer may only resume an already bound task and must reauthorize its original
initiator. P2 cannot create a task or bind a legacy/unmarked task.

Context includes scope, current canonical Brain, projected selected records,
optional bound task ID and a content fingerprint. The fingerprint hashes the
JSON representation actually returned; it is **not an authorization token or
frozen generation snapshot**. Responses over 64 KiB fail rather than silently
truncate client instructions or memory. All import/model/research-execution/
export/dispatch capabilities remain false. P2 does not authorize execution via
`run-agent` or a legacy worker.

Preparation and retries use P1's persisted HMAC binding. Task/workspace/client,
original initiator, policy, unsigned payload and resource allowance cannot be
changed by browser selection, retry or resume. Same-client Brain/record updates
are read fresh and change the context fingerprint; freezing their versions for
model generation is P5, not silently added here. A later executor must reload
and validate the bound context itself, not accept this browser packet.

## Browser lifecycle and caches

`WorkspaceSelection` is a presentation lifecycle fence, never server authority.
It clears context synchronously before selecting a new scope and invalidates
React Query caches. Each request captures the selected scope and a monotonic
epoch/request sequence. Late A→B, A→B→A, superseded, logout and unmounted replies
cannot repopulate the current context. Scope, Brain workspace, record workspace
and task ID must agree before display. A failed authorization clears selection,
content and remembered scope; there is no legacy or first-member fallback.

Task/resource input controls are remounted for the new scope epoch, clearing
old task IDs, references and previews together. A task preparation may finish
its original A binding after the operator switches to B; the result is discarded
by the browser and the task remains A-bound. It cannot become B's task or
execute as a side effect. Switching UI does not cancel or authorize a backend
execution—none is implemented here.

Only IDs/version/mode are stored in per-user **sessionStorage**, not localStorage;
no Brain, record body, draft, message, token or credential is persisted there.
A tab hint needs a fresh authorized list and fresh context before restoration.
Unknown, malformed, stale-version or revoked hints fail closed. Logout/unmount
clears remembered selection. A changed authenticated principal/token starts an
empty controller; visibility return rechecks authorization. Query cancellation
is best effort; the epoch fence is what prevents late-response display.
No pilot response content is kept in a reusable cross-client query cache.

## Legacy draft memory correction (OO-04 / I02 scope)

`memoryReader.ts` formerly queried the latest workspace-wide draft bodies even
for a fresh conversation. `has_any_memory: false` did not prevent those bodies
from reaching model context. Drafts are now selected only by `lead_candidate_id`
from the already selected conversation's leads **and** `workspace_id`.
No selected leads means no draft query. Unassociated drafts and other
conversations' drafts are omitted. Positive controls preserve legitimately
associated drafts. Other legacy memory/joins are not certified as globally safe;
the pilot uses P1's explicit record boundary instead.

## Exact changed files relative to #124

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Isolated route; router encloses workspace resolution |
| `src/contexts/WorkspaceContext.tsx` | Suspend implicit legacy workspace resolution/provisioning on the pilot route |
| `src/lib/workspaceSelection.ts` | Selection, user/session hint, cache invalidation and late-response fence |
| `src/components/workspace/ClientWorkspaceSelector.tsx` | One explicit authorized selector |
| `src/pages/OutpostWorkspace.tsx` | Default-off preparation UI using only pilot-context |
| `supabase/functions/_shared/pilot/pilotPolicy.ts` | Reuse strict P1 parser for bounded enrollment enumeration |
| `supabase/functions/_shared/pilot/pilotHttp.ts` | Shared unchanged bounded P1 HTTP parsing/response helpers |
| `supabase/functions/pilot-scope/index.ts` | Consume shared HTTP helper; original P1 behavior retained |
| `supabase/functions/_shared/pilot/pilotContext.ts` | P1-authorized choice/read/prepare/resume handler |
| `supabase/functions/pilot-context/index.ts` | Edge entry point, no executor |
| `supabase/functions/_shared/memoryReader.ts` | Remove unrelated draft-memory fallback |
| `tests/frontend/clientWorkspaceSelection.test.ts` | Controller and isolated-route adversarial controls |
| `tests/edge-functions/pilotContext.test.ts` | Real endpoint/store/controller/task-binding attacks |
| `tests/edge-functions/_shared/memoryReaderScope.test.ts` | Real memory reader and scoped Supabase adapter controls |
| This document | Evidence, design adjustment and security gates |

No qualification/compiler implementation, Claude branch, T01 PR #131, worker,
financial policy, schema, migration, production secret or deployment is changed.

## Offline tests and evidence

Tests run actual P1 authorization, P2 handler/controller, signed binding,
canonical Brain and Supabase-js adapter. Auth and PostgREST transports use strict
synthetic fixtures; every unexpected external provider host is rejected. A/B
have overlapping Apollo IDs, domains/emails and distinct private content.
Database primary keys remain distinct, consistent with the current schema.

```sh
deno test --allow-read --allow-env \
  tests/edge-functions/pilotScope.test.ts \
  tests/edge-functions/pilotContext.test.ts \
  tests/edge-functions/_shared/memoryReaderScope.test.ts \
  tests/edge-functions/_shared/memoryReader.test.ts
deno test --allow-read tests/frontend/clientWorkspaceSelection.test.ts
```

Focused receipt: **99 typed backend passes**, including all 60 P1 regressions,
33 P2 context tests, 3 draft-memory scope tests and 3 existing memory tests.
**13 typed frontend tests pass.** New P2 cases total 49. Full-suite and CI
receipts are recorded on the draft PR; mocks are not native RLS/concurrency,
deployed UI or live acceptance evidence.

| Adversarial case | Result |
| --- | --- |
| Missing stage/P1 gates, missing/unauthorized/mixed scope, invalid action/token | Refused |
| Authorized A/B and shared administrator positive controls | Separate Brain/record content |
| Foreign memory/record parent; correct envelope with foreign Brain/record | Refused or withheld |
| Original task retry, user/service resume | Original signed scope retained |
| Switched workspace/client, creator, policy, payload, MAC or expanded resources | Refused |
| Switch while A preparation finishes; stale A→B→A and logout callbacks | A stays A-bound; stale display suppressed |
| Membership revoked between record read and final check | No context released |
| Invalid Brain, stale/revoked/another-user hint, failed authorization | No fallback; context cleared |
| Fresh conversation, unrelated/orphan/foreign drafts | No draft text loaded |
| Oversized request/context/resource set | Refused; no partial truncation |
| Imports, model/provider execution, dispatch or arbitrary messages | Unavailable |

## P1 enablement blockers — not solved by P2

1. Native RLS/direct authenticated API attacks across all relevant tables and
   same-workspace parent/ownership constraints remain unverified. Native policy
   and constraint changes require separate approval; no migration is provided
   or installed here.
2. Membership/Brain/parent reads and payload CAS are not one transaction.
   P2 rechecks membership/identity before release but does not claim atomicity.
   Native PostgREST CAS/concurrency and creator/payload/ownership races require
   real disposable-database proofs before enablement.
3. Protect server-owned bindings/policy and prevent direct writes/reassignment.
   Operator enrollment remains a temporary server manifest; clean dedicated
   workspaces must not be reassigned to a different client or contain historical
   mixed-client data. Known ownership checks cannot prove arbitrary stored text
   was never contaminated.
4. Legacy endpoints, direct browser APIs and executors remain outside this
   boundary. Pilot-marked tasks must never be scheduled/dispatched through them.
   Prove executor containment and prevent unsupported task writes before enabling
   either pilot switch. Do not run a legacy worker against seeded pilot tasks.
5. Deployed browser/auth/realtime behavior, cross-tab session changes, migration
   state, endpoint routing and operator enrollment have no live receipt. Offline
   request fencing and mocked filters cannot substitute for this acceptance.
6. P5's source/Brain/model snapshots, P4 model policy and P6/P7 generation/review/
   export remain absent. P2's current context packet is not a generation artifact.
   OO-01/OO-02/OO-03 still gate any automated outreach or approved external dispatch.

## Conditions for proceeding to P3

- Review/accept P1 and this stacked P2 implementation; keep both disabled.
- Agree P3's approved existing-lead CSV sample/schema and explicit source/client
  identities. No prospecting or external Apollo/iGTM/Jungler API dependency.
- Obtain separate approval for any required schema/bootstrap/migration work.
  Scoped import ownership, uniqueness and same-workspace parents must be proven
  natively, with direct API, duplicate external-ID, replay and concurrency tests.
- Imports/task preparation must consume current P1/P2 scope and signed task
  bindings, reject scope switching/expansion and avoid every legacy executor.
- Add real local persistence/import acceptance. Before customer enablement, close
  every native/ownership/concurrency/containment gate above and obtain separate
  rollout authorization. Offline P3 coding approval is not live-pilot approval.

No customer data, paid API calls, hosted writes, migrations, deployment, sends,
merge or A7 execution was used to produce this implementation.

## Local regression receipt

Full Edge suite: **8,774 passed / 0 failed** using the existing CI runtime lane.
Full frontend Deno suite: **670 passed / 0 failed**. Production Edge functions
(excluding generated MCP) and worker type-check; new P1/P2 endpoint/controller
and memory suites type-check. Frontend type/lint ratchets pass without new debt;
focused Deno lint and production build pass (existing chunk-size advisory).
All 60 P1 tests retain their meaning. The native isolation gates above remain
unverified regardless of these green mocked/offline checks.

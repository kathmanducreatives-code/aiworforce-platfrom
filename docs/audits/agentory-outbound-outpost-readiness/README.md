# Agentory — Outbound Outpost readiness audit

Audit date: 2026-10-20. Independent source snapshot: `launch/hardening` **`5d86703712205a04d059a39cf0d38a0621fc3ddb`**. Branch: `codex/outbound-outpost-readiness`. Documentation and offline fixtures only; no implementation changes.

## 1. Executive summary

**Agentory has reusable account research, structured evidence, Company Brain, drafting, task and accounting components. It does not yet provide a verified, dependable integration around Nosh's existing workflow.** Apollo/iGTM/Jungler/Sheets/Slack connectors and an outbound campaign activity model are missing. Multi-client context binding and user-selected model execution are incomplete. Qualification has independently reproduced defects; PR113 is still a separate draft. Scheduled email delivery and approval continuation have additional deterministic reliability defects.

**No customer-facing capability meets LIVE VERIFIED under this audit's required standard.** This is an evidence limit, not a claim that every feature fails in production. Current unauthenticated preflight responses prove several functions are deployed and identify their build stamps. They do not prove successful authenticated work, provider availability, correct results, persistence or recovery. No paid model/provider call or customer workflow was run.

The first useful pilot should prepare human callers from a small, approved set of **existing** accounts, with source-backed buyer facts, explicit unknowns and reviewable call briefs returned to the current CRM/Sheet. Avoid creating a second prospecting pipeline. Start with approved export/import and manual reviewed handoff, then build a bounded read adapter and approved write-back to the confirmed system of record. Automatic outreach, disposition-triggered delivery and selectable three-model execution should not be promised today.

The minimum sequence is: establish deployment/health and permissions; preserve Claude's qualification work; establish explicit client scope and approved source identities; repair approval/delivery durability; add the existing-lead import and call-brief seam. **A7 remains NO-GO.** This audit authorizes no release, migration, spending or live test.

### Working assumptions confirmed in this conversation

Nosh uses Apollo for lead management, enrichment and sequencing; iGTM for human cold calling; and Jungler for buying signals and prospect research. These describe the intended workflow, not verified Agentory connections or account access. Apollo appears central, but its status as the official CRM of record remains unconfirmed. The exact iGTM and Jungler product identities remain unconfirmed.

The pilot therefore centers on improving existing records and preparing human callers. Vendor-specific API adapters, authentication choices, event schemas and write-back destinations remain conditional until the three questions below are answered. Official API research in this report establishes possible routes, not a selected integration design. Model policy, client-context isolation and grounded draft contracts can be specified independently of those vendor identities.

The follow-on [focused implementation plan](pilot-plan/README.md) and [client-isolation boundary](pilot-plan/client-isolation.md) split the draft-only pilot into small PRs. They are proposals only and account for Claude's subsequently opened Q1 PR123; the original audit results below remain labeled by their tested snapshots.

Evidence navigation:

- [Complete feature inventory](feature-inventory.md), [per-capability JSON](feature-inventory.json).
- [Integration matrix and external API feasibility](integrations.md).
- [Multi-model support and selection disconnect](models.md).
- [Six workflow analyses and actual/proposed Mermaid diagrams](workflows.md).
- [Test receipts and reproduction](testing.md).
- [Deployment stamps](evidence/edge-build-probes.json), [health/deployment observations](evidence/deployment-observations.json), [CI jobs](evidence/integration-ci.json), [PR state](evidence/pr-state.json).
- [All Edge Function direct dependencies](evidence/edge-function-inventory.json), [all frontend routes/pages](evidence/frontend-routes.json). These are source inventories, not runtime validation.

### Evidence rules

LIVE VERIFIED requires a current deployed version plus a successful complete execution receipt with inputs, authorized operations, persisted results and correct customer outcome. IMPLEMENTED / NOT LIVE VERIFIED means a real code path exists without that proof. PARTIALLY WORKING means tested/traced components exist but the full path is incomplete. BROKEN requires a reproduced defect; a source-level defect does not prove that every deployed bundle contains it. BLOCKED names a specific access/configuration/infrastructure limitation. NOT IMPLEMENTED means the required path is absent in the inspected execution surfaces.

All runtime claims in this report identify their boundary. Offline positive controls prove application behavior against injected external responses, not provider correctness. Historical repository reports are treated as historical claims unless corroborated by accessible receipts. Current live status is separately **UNVERIFIED** where no such receipt exists. Complexity and roadmap entries are proposals, not implemented features.

## 2. Complete feature inventory

The [50-capability inventory](feature-inventory.md) records frontend entry, backend module, tables, provider dependencies, classification, issues and priority. Its [JSON](feature-inventory.json) includes deployment, most recent success, test and confidence fields per capability. Confidence is high for explicitly traced code, bounded for offline behavior and unestablished for current live full workflows.

Across these 50 capability rows: 17 IMPLEMENTED / NOT LIVE VERIFIED, 13 PARTIALLY WORKING, 13 NOT IMPLEMENTED, 5 BROKEN and 2 BLOCKED. No row is LIVE VERIFIED. These are scoped capability assessments, not a claim that every code path within a category is broken.

The broader frontend includes auth, onboarding, Brain, Leads/Workbench, Signals, Content, Agents, Workflows, approvals, billing, legacy recruiting/client metrics, email sequences and research routes. Many legacy URLs redirect into newer pages; redirects are enumerated rather than counted as functioning products. Legacy n8n upload/webhook services are not a general workflow connector. Billing displays credit state but explicitly says checkout is coming soon. The inbound Agentory MCP reads three legacy tables; it does not expose a unified external-record qualification/write-back API.

Summary classifications should not conceal different sub-capabilities: known-company website research can be implemented while broad web search remains a stub; hiring discovery can run offline while final qualification is incorrect; drafts can be safe to review while sending is unsafe to automate.

## 3. Agent-by-agent analysis

The repository's actual public name is **Mira**, not “Mirea.” Names are display identities. `src/config/agentRegistry.ts` explicitly retains legacy execution slugs and warns against treating display aliases as routing changes.

| Requested employee | Real backend identity / modules | What is reusable | Disconnected or unproven |
|---|---|---|---|
| Lyra | `scout`; run-agent, leadCapabilityEngine, leadCapabilityGraph, Radar/monitoring functions | Hiring/company discovery, evidence normalization, provider contract/readiness validation, funded-company verification components | Founder comments/posts buying-intent chain unsupported; news/technology gaps; mixed mandatory signals can be dropped; no current successful mission receipt |
| Atlas | `aria` qualification + `hawk` account research; missionEvaluation, candidateEligibility, leadActionExecutor | Research on selected internal accounts, evidence registry, structured criteria/verdicts, explanations, seller/account identity checks | Existing Apollo records cannot enter without adapter; qualification defects and split projection paths; no verified full external-lead workflow |
| Mira / requested Mirea | `penn`; generic run-agent drafting, leadActionRunner, workbench/openerBackend/openerModel, draftGate | Evidence-grounded personalized opener, seller identity/claim validation, full draft generation, approval-first storage | No iGTM call-result ingestion or dedicated call-brief contract; no per-client model choice; approved send path not complete/reliable |
| Orion | Public alias `scribe`, operational summaries; actual orchestration is Pilot/orchestrate/worker | Task/approval views, next-action organization, daily briefs, stored activity summaries | Alias does not add a workflow scheduler. Scribe's actual generic content path remains distinct. External follow-up/reporting integrations and recovery proof absent |
| Pilot | pilot-chat → orchestrate → run-agent / queue | Intake/classification, plan approval, progress/continuation UI, dispatch plumbing | Different deployed builds, failing ops checks, incomplete approval-dispatch recovery; internal task policy overrides UI model impressions |

Agent role prompts and Brain blocks enter model prompts, but that is not enforcement proof. Canonical evidence/qualification and explicit send permissions must constrain outputs outside the model. Model role labels, capabilities chosen in the builder and static “active” profile metadata are not evidence of a running autonomous employee.

## 4. Company Brain and agency isolation

### Actual storage and consumption

`company_brain` has one row per workspace; `profile` JSON carries company/seller identity, targeting, ICP/exclusions, personas, voice, positioning, qualification rules and preferences. `setup-company-brain` verifies membership and upserts on `workspace_id`. `generate-company-brain-draft` records research runs and supports reviewed refresh proposals. Deterministic normalization and compilation preserve supported schema shapes and produce targeting/query/context projections.

`getCompiledCompanyBrainForWorkspace` checks membership before loading and compiles the profile. I01 and existing consumption tests prove non-members cannot obtain another workspace's Brain through that loader against strict synthetic boundaries. Source-role stripping, seller identity conflicts, manual instruction preservation and stale-review guards have offline tests. Those tests do not establish deployed RLS or validate every service-role consumer.

Several production handlers still read `company_brain.profile` directly (run-agent, orchestrate, Radar and Pilot paths). This is a concrete reason not to equate the architectural “one loader” document with universal execution. The run-agent generic prompt gates active context with onboarding_completed; other projections and readiness derivations differ. Claude's Q1 frozen criteria / Q4 consistency work remains relevant.

Brain research provenance exists in `company_brain_research_runs`; refresh code carries origins, source roles and updated_at review guards. This is useful groundwork, not an immutable per-client history or proof every resumed task uses the same Brain version. Direct save and refresh paths need concurrent-edit and mission snapshot acceptance tests. No new schema was installed to test this.

### Shared memory and the multi-client defect

`memoryReader.ts:110–116` fetches recent outreach drafts by workspace only, even with a fresh conversation ID. I02 creates a synthetic client-A draft and asks for memory of client B's fresh conversation in the same agency workspace. The result includes `CLIENT_A_PRIVATE_VOICE`. `has_any_memory` correctly remains false, but the loaded draft is still present; that boolean does not provide client isolation. Pilot renders this memory into prompts (`pilot-chat/index.ts:4229`).

This is **same-workspace cross-client context exposure**, not a demonstrated cross-workspace RLS bypass. If clients share one workspace today, their voice, drafts and stored context can mix. The recruiting `clients`, `client_placements` and `client_active_positions` pages do not attach an outbound client identity to Brain, missions, accounts, approvals, model policy or connector credentials.

One workspace per client is the shortest reuse of existing boundaries. It still requires an explicit active-client/workspace selector: `getCurrentWorkspaceId` currently takes the first membership and WorkspaceContext provides no client switch. It also requires separating or avoiding legacy user-scoped email/calendar records, ensuring connector credentials/destinations follow the selected workspace, and testing two clients with the same external contact/account IDs. Do not demonstrate the current single-workspace workaround as safe agency support.

### Instruction correctness

Compiled instructions, exclusions and voice are context; free-form requests can still be miscompiled or overruled by model interpretation. The previous routing audit proves mandatory founder discussion and first-hire conditions can be lost despite their presence in user language. Preferences, exclusions, source roles and must-have conditions must retain typed, versioned semantics through approval, canonical decision and replay. No closed industry/job-title list should substitute for client-specific intent.

## 5. Integration assessment

[The integration matrix](integrations.md) covers all requested tools and answers read/write, auth, triggers, webhooks, limits, synchronization, idempotency and retry separately. No Nosh account integration was confirmed. The question about exact iGTM/Jungler products and CRM remains open; do not assume public websites identify his licensed products.

Apollo's official APIs make reading saved contacts and updating known approved records plausible. It is not an Agentory feature today. iGTM's candidate site describes configurable CRM integration, but a verified disposition API/event contract is missing. Jungler's candidate docs indicate API/export/webhook options but account scope and guarantees are unverified. Sales Navigator official API access is partner restricted. Google Sheets and Slack have official APIs, but their adapters, credential lifecycle and durable delivery are absent here.

The integration should improve the existing system of record: import selected existing records, retain stable vendor/client identity, enrich only approved fields, return proposed updates for review, and reconcile delivery. Do not add another lead-generation queue Nosh must operate. Existing Workbench research is the reusable processing seam, not a replacement CRM.

## 6. Multi-model support

[The model matrix](models.md) distinguishes direct OpenAI transport, Anthropic execution, internal stage selection, UI model labels and unsupported Gemini selection. It includes exact source locations and the minimum extension of existing adapters/ledger required for model choice.

Current generic TASK_MODELS fixes critical product tasks to Anthropic Haiku. Helper/tool-input planning declares an OpenAI fallback. Discovery uses a separate GPT stage router and validator-driven escalation. Old Gemini/Lovable comments are stale; current executable code does not route shared text tasks through Gemini.

The builder persists `agents.model`; generic run-agent execution does not thread it to a model selector. M01 requests OpenAI then Anthropic at the real shared generateText boundary and both synthetic transports invoke Anthropic Haiku. M02 proves missing critical credentials fail rather than silently switch; M03 proves an explicitly allowed helper fallback is normalized and marked degraded with two telemetry entries. These do not certify live provider access or durable ledger writes.

There is no enforced per-client provider/model/task policy with approved fallbacks and context snapshots. Structured output, usage and cost primitives can be reused; cross-provider output equivalence and semantic grounding remain separate requirements. Current repository pricing is not a current quote.

## 7. Complete workflows and diagrams

[All six requested workflows](workflows.md) have expected and actual paths, missing links, evidence boundaries, E2E status, demonstration feasibility and separate ACTUAL/PROPOSED Mermaid diagrams. None is currently live verified.

The useful internal path is selected internal lead → workspace context → account research → evidence → grounded draft → human review. It lacks existing-stack input/output adapters and a specific call-disposition/briefing contract. Do not construct mocks of those missing adapters and report them as implemented behavior.

## 8. Reproduced problems and root causes

Severity here describes customer impact. P0 priorities in the roadmap mean pilot gates; they are not claims of a new catastrophic security incident. Defects below were reproduced offline against real handlers/modules on the pinned integration commit.

| Finding | Severity / customer impact | Deterministic reproduction | Root cause and exact source | Smallest safe correction boundary |
|---|---|---|---|---|
| OO-01 Duplicate scheduled sends | P1: customer receives duplicate outreach, potential repeat charges | R01: two concurrent authenticated requests both read pending row; two mocked Resend acceptances for one email | `send-scheduled-emails/index.ts:63` reads pending without a claim; :84 sends without vendor idempotency key | Durable operation identity + atomic claim + accepted/uncertain state and remote reconciliation. Do not rely only on setting status after send |
| OO-02 Accepted send, failed persistence still reported successful and replayed | P1: false success, duplicate retry | R02: vendor returns success; DB PATCH returns 400; handler reports sent1, row remains pending, second call sends again | `send-scheduled-emails/index.ts:96–100` ignores Supabase update error; vendor receipt not durably stored | Check writes, preserve uncertain delivery liability and reconcile before replay; share external-effect protocol with OO-01 |
| OO-03 Approval continuation loses failed dispatch | P1: approved work silently does not run | A01: downstream run-agent 503; HTTP200 “continuing”; repeat approval says already settled and makes no new dispatch | `approve-and-continue/index.ts:94` settles approval before :129 fetch; response status ignored, no durable dispatch intent in this handler | Separate approval decision from dispatch delivery; durable outbox/recoverable task and response/receipt handling. Never simply re-send approved work without dedupe |
| OO-04 Client context cannot be separated inside one workspace | P1: wrong client voice/context and possible confidential draft exposure | I02: client B memory contains client A marker | `memoryReader.ts:110–116` workspace-wide drafts; Brain keyed workspace only | Explicit client/workspace binding across memory, prompts, records and destinations. Initially workspace-per-client plus explicit selector and legacy-path isolation |
| OO-05 Saved model choice does not reach transport | P1: product choice not honored; data/cost expectations violated | M01: explicit OpenAI preference still invokes Anthropic; builder persistence traced | `orchestration.ts:482`, `run-agent/index.ts:1236,8512`, `aiProvider.ts:317,324,270` | Server-approved task model policy threaded, snapshotted and enforced through adapter and ledger; reject unsupported UI choices |

OO-01/OO-02/OO-03 handler source files are byte-identical between the currently observed approval/sender stamped commit `a08ac0e4...` and the audited integration tree. That strengthens deployment relevance. It is not a live duplicate-send test; no email was sent. Other module bundles may differ and their live vulnerability is not inferred from the current source alone.

Additional verified findings from the [prior independent routing audit](https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/aca94e6b739e5f5c129ae0e11b56676e9da09c80/docs/launch/discovery-routing-audit/README.md) remain on the same integration SHA: mandatory social conditions become targets; first-hire qualifiers are unenforced; cross-signal OR is lost; social windows drift; sales-team growth is misrouted; recruiting employers are blanket-filtered; aggregate evaluator veto is discarded. The OR compiler loss is proven; its general-company runtime zero result is not isolated proof of a fully evidenced OR false negative. The positive funding claim test does not certify a full positive mission.

PR113 prevents five tested unsafe integration cases (exact-role broadening, invalid evidence receipt, empty details, evaluator timeout after optimistic batch, foreign company-details identity), but remains unmerged and still has the documented upstream/aggregate gaps. Its routing-tested head was `623db1b43caefe58a905445c816b294ffbc88555`; the latest head is `671edf35da4b4271ffcbd849ffece856ebd1057f`, a merge of the CI-only integration changes. The runtime diff between those heads is empty. Do not discard those fixes or duplicate Claude's Q1–Q4 implementation.

Systemic causes are repeated partial contracts: branding/configuration detached from execution; workspace tenancy used as a substitute for client context; external effects lacking durable accepted/uncertain delivery state; criteria/evaluation authority rebuilt at multiple layers; and readiness inferred from key presence or catalogs rather than live receipts. The shortest solution reuses existing modules and repairs these contracts, rather than rebuilding the qualification engine.

### Reliability and security coverage

| Risk | Observed / tested | Remaining limit |
|---|---|---|
| Cross-workspace reads/writes | I01, strict-network auth/approval/endpoint tests pass; existing loader verifies membership | No hosted RLS catalog/read probe or native isolation DB created; service-role joins and all legacy paths not certified |
| Cross-client context | I02 reproduces exposure within shared workspace | No client namespace/credential/output destination binding exists |
| Provider/model failure | M02 refuses missing key; M03 records explicit fallback; prior routing timeout controls | No real outages, live provider reliability or account scope verified |
| Duplicate external writes | R01/R02 fail deterministic safety expectations | Other future connectors have no dedupe implementation to test |
| Lost workflow handoff | A01 reproduces false continuing after 503 | Background worker replay and full task/lineage effects not executed in this audit |
| Lost/out-of-order disposition webhooks | No iGTM/Jungler event adapter found | NOT IMPLEMENTED; proposed inbox/order/suppression rules not portrayed as passed tests |
| Hallucination / routing | Existing opener evidence/claim/identity negative controls pass; qualification gaps still reproduced | Quote presence is not semantic truth; negation, employment, time and client meaning require further evals |
| Unapproved outreach | Tool registry returns awaiting_approval; authorization tests validate ownership/role/CAS; draft path does not send | Legacy scheduled sender is a separate user-triggered path, not a unified client approval policy; complete approved replay unverified |
| Spending limits | Existing budget/admission/ledger code; 40 runtime budget tests; native contracts in integration CI | Current deployed migrations/config/caps/account restrictions and concurrency not independently re-proved; no paid test |
| Tokens/secrets | Server env provider keys; user JWT/membership guards; public UI uses publishable/anon contract | Google refresh tokens stored by user; rotation/encryption/retention and deployed grants not verified; no production secrets read or changed |
| Observability | Builds from preflight; GitHub health metadata available | Latest scheduled health fails; deployment success alone excluded worker check; external sync freshness/reconciliation absent |
| Interrupted missions | Worker leases/fencing/ledger adoption and cancellation code, offline CI contracts | Live queue recovery and held migration state unknown; #107 open; no mission started here |

## 9. Deployment, CI and pilot readiness

### Current read-only deployment evidence

Unauthenticated OPTIONS on 2026-10-20 09:46 UTC, with standard TLS verification, returned:

| Surface | Reported build |
|---|---|
| run-agent | `e4da19e8828898f05414da953a13acb74c74e6a4` built Oct13 |
| pilot-chat | `86ac1b922f8519f75760642bb09cceef096168eb` built Oct13 |
| orchestrate, enqueue-lead-mission, continue-workflow, resume-stalled-leads | `b51ad3dddf2604f9d218d7c495e17e22d20932db` built Oct11 |
| approve-and-continue, send-scheduled-emails | `a08ac0e4edea6f3aa54314db4efe0073e371b82f` built Sep29 |
| ops-health | `a08ac0e4...` Sep29; OPTIONS returns405 with build header, not a health verdict |
| setup-company-brain, generate-company-brain-draft, calendar auth/events, email-tracking | Responses present, no build stamp; exact version UNVERIFIED |
| Frontend and current worker | Current version UNVERIFIED; no confirmed public frontend target/worker endpoint obtained |

The [probe artifact](evidence/edge-build-probes.json) preserves timestamps/request IDs and no cookies, credentials or customer rows. Python initially failed local CA validation; curl succeeded with default TLS verification, no TLS bypass. Presence/HTTP200 on OPTIONS is not functional success. No authenticated POST or hosted database write was performed. `integration-readiness` was not invoked because it may update Brain.

The latest reviewed scheduled [Ops health run](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39374636467), Oct20 05:23 UTC, failed with **`ops_read_failed`** and **worker `/health` HTTP404**. This establishes failing monitoring at that observation time, not whether the worker process is dead versus its URL/routing being wrong. Exact current schema/function/RPC cause is unverified without privileged metadata. The Oct13 [release run](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/38372262536) succeeded but explicitly omitted worker health because WORKER_HEALTH_URL was absent for that job. The pipeline must distinguish “not checked” from healthy.

Integration [CI run 39400841523](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39400841523) is green on `5d867037`: frontend, Edge/worker safety, offline readiness, three native database shards, eight mutation shards and aggregate gate. This is strong offline evidence, not proof this SHA is deployed or customer workflows work. A focused source test group in this audit also has a pre-existing typecheck defect; see testing.md instead of hiding it behind CI green.

### Relevant merged and open work

[PR-state evidence](evidence/pr-state.json) captures all returned PRs. Key dependencies:

- #113 qualification receipts/provenance/exact roles: OPEN draft at `671edf35da4b4271ffcbd849ffece856ebd1057f`. Latest [CI run 39403348347](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39403348347) completed with database shard 2 and aggregate gate failures; other inspected execution/frontend lanes passed. The actual failed native contract is **S02: Canadian HQ with a US office is not a US company**: it produced one qualified synthetic company. That file ended 15 pass / 1 fail / 5 ignored; S03b was ignored. [Failure excerpt](evidence/pr113-ci-failure-excerpt.txt). This is CI evidence from real local database contracts with mocked providers, not a new hosted run. It demonstrates a qualification/projection path still unsafe on the latest draft, despite the simpler discovery-vs-details C05 boundary control passing in the prior audit. See the [coordination plan](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/113#issuecomment-6284526188).
- #114 three-level CI: MERGED, final head `110c9bec...`, merge `5d867037...`; runtime source unchanged. #112 and #111 earlier CI/fixture hygiene work merged.
- #110 A7 adversarial tests and #109 result/date guards: MERGED; not synonymous with A7 live acceptance.
- #106 transport/admission and #108 exhausted-lease terminal recovery: MERGED offline reliability work. #107 exhausted-claim liability recovery remains OPEN draft and has held migration implications; do not treat it as deployed.
- #90/#94/#96 admission, lifecycle and financial hardening: merged code/proposals, some migrations deliberately held. #100/#101 read-capacity/no-Brain smoke safeguards and #104 manual-only test worker: merged; no test dispatch performed.
- #102 keyless web research: OPEN. Current `execSearchWeb` remains unavailable; do not count the proposed connector as integrated.
- Company Brain #18/#19 consumption/setup, #35 Brain geography provenance, #46/#48 disclosure: merged source improvements. Current Brain endpoint bundle/version and successful setup execution remain unverified.
- Older integration preview #85 and operator/audit drafts #95/#97/#98 remain distinct proposals; they do not confer deployment or spending authorization.

No existing branch was modified. Findings are coordinated through the audit PR/PR113 comment; Claude retains qualification/CI ownership. No fixes are included here.

### First realistic demonstration and pilot gate

**Today:** show source-backed offline demonstrations with synthetic account/contact, two separate workspace contexts, evidence-backed opener controls and real mock-transport receipts. Explain missing connectors and do not imply Nosh's tools are connected. Current full live caller-prep demo is not established.

**First real pilot after gates:** one confirmed client; a small approved export of saved existing accounts/contacts; source facts and caller brief with manual human review in the existing destination. No new leads, automatic sends, provider voting or automatic CRM mutation. Enable any real research/model call only under its separate approved credentials and budget. Establish source-of-truth IDs and unknown handling before calling the result qualified.

Pilot acceptance needs: known release/config/schema health, client/context isolation, imported-record mapping/dedupe, approved task model policy or an honestly fixed disclosed model, evidence-grounded output, one reviewed handoff receipt, bounded calls and recoverable task state. Sender fixes are a gate for any later outbound automation; they need not block an explicitly draft-only handoff with sending disabled.

A7 independently remains NO-GO until the qualification stages, exact-SHA acceptance, provider/account restrictions, budget, token/webhook preflight, fresh prices and recovery-migration decisions are resolved. Do not use the proposed pilot to bypass those restrictions.

## 10. Engineering roadmap

### Immediate blockers

Establish one approved release manifest for frontend/API/worker/functions and installed schema; repair failing health checks with read-only diagnosis before a later authorized rollout. Resolve Claude's qualification authority/evidence/projection work without parallel rewrites. Protect client boundaries and honestly disclose unsupported model/connector choices. Keep unsafe email automation disabled for any pilot.

### Quick wins

Add an explicit client/workspace selector and display current context/destination on reviewable actions. Remove or mark unimplemented model/tool choices as unavailable until execution supports them. Expose requested versus actual model and source evidence/unknowns. Add a dedicated compact call-brief schema over existing research primitives and a reviewed manual export. These are proposals; no UI edits were made here.

### Essential integrations

Confirm CRM and vendor identities/access; implement bounded existing-Apollo-record import or approved export ingestion first. Then a human-reviewed result destination in that CRM/Sheet. Add call dispositions only after an agreed event contract and exact external identity map. Integrate Jungler outputs rather than duplicate its lead generation when available and approved.

### Reliability improvements

Use durable inbox/outbox identities and accepted/uncertain/reconciled states for all effects. Repair approval dispatch and scheduled sender before automatic writes. Apply client-aware credential scopes, dedupe, stale event ordering, opt-out precedence, bounded retry and reconciliation. Extend ops views to source freshness, inbox lag, pending/uncertain delivery and per-client model/provider cost. Retain SQL spending admission and current provider-operation identities.

### Advanced capabilities

Selectable approved models with common result contracts and per-client policies; reconciled multi-source reports; safe scheduled follow-ups; better intent/negation/role evidence; partner-permitted LinkedIn integration if access exists. These depend on the identity/delivery foundation and real acceptance receipts, not more agent branding.

## 11. Implementation backlog

Complexity is relative (S: localized contract/UI; M: several modules and persistence boundaries; L: external contract plus durable integration and fault tests). These are not delivery-date promises. Every row needs a separate implementation review/authorization where applicable.

| Priority / item | Relevant files/modules | Dependencies | Required tests | Complexity | Customer value | Acceptance criteria |
|---|---|---|---|---|---|---|
| P0 release/health reconciliation | production-shas.sh; buildStamp; ops-health; worker/health; CI deploy workflow | Read-only deployment/schema metadata first; later explicit release permission | Version manifest, unavailable worker/URL, unreadable RPC, not-checked must not equal healthy | M | Know what is running and recover failures | Approved manifest identifies each surface/config/schema; current health readable and worker polling verified without running a customer job |
| P0 canonical qualification completion | Claude Q1–Q4; candidateEligibility, missionCriteria, evidenceGraph, missionEvaluation, run-agent | Preserve #113; coordinate five upstream compiler findings | Existing audit red cases, AND/OR, mandatory/preferred, first-hire, mixed dates, durable projection/resume | L, Claude-owned | Prevent false qualified accounts | Every hard obligation proven or held; same decision and evidence snapshot in rows/UI/notices/lineage; exact final SHA passes acceptance |
| P0 safe client context | WorkspaceContext; orchestration.getCurrentWorkspaceId; memoryReader; Brain loader; legacy email/calendar | Decide workspace-per-client; access roles; per-client credentials | A/B adversarial markers, same external IDs across clients, stale tab/resume, draft and output destination isolation | M/L | Agency can operate several clients safely | Explicit authorized client selection; no cross-client context/records/credentials; frozen context per job; native isolation checks |
| P0 approval dispatch reliability | approve-and-continue; workflowContinuation; tasks/operation store | Durable dispatch design and existing job identity | A01; 503/timeout, double click, concurrent approval, accepted-but-response-lost, worker replay | M | Approved work actually runs once or stays visibly pending | Approval and delivery have separate states; failed dispatch recoverable with durable receipt; repeated approval cannot silently lose or duplicate work |
| P0 before sends: delivery protocol | send-scheduled-emails; scheduled_emails; provider ledger/credit reuse primitives | Vendor idempotency policy; approved sender; migration review only if needed | R01/R02; vendor accept+lost response; failed DB write; parallel workers; cancellation; suppression | M/L | Prevent duplicate or unauthorized outreach | One logical delivery operation, remote receipt/uncertain state and reconciliation; no repeated purchase after ambiguous outcome; approval/client scope enforced |
| P1 existing lead ingest | leadActionRequestContract; leadActionExecutor; contacts/accounts/lead_candidates; new bounded source adapter | Confirm Apollo/CRM fields, approved export/read scopes and source ownership | Pagination, missing fields, repeated import, identity collision, cross-client source ID, 401/403/429 | M | Improve current lead pipeline without sourcing another list | Approved saved records imported with immutable external/client identity, provenance and bounded reads; zero new prospect purchases |
| P1 structured call brief | leadActionRunner; workbench/sellerContext/openerBackend; Brain compiled context | Imported record and seller context; model consent/budget | Supported facts vs unknowns, stale/contradictory sources, wrong employer, negative/disallowed claims, no invented resources | S/M | Better human cold calls immediately | Brief names correct contact/company, sources/timestamps, relevant approved offer, questions and explicit unknowns; review-only, no send |
| P1 destination review / write-back | Existing review UI; new source-record mapping/outbox; Sheets/CRM adapter | Confirm system of record, allowed fields and target account | Dry-run diff, denied write, stale record version, replay, remote timeout, label preservation | M/L | No new operational workflow for Nosh | Human approves exact patch; correct client destination updates once with result receipt; unrelated fields preserved; uncertain writes reconciled |
| P1 iGTM disposition ingestion | New event inbox/adapter; identity matching; tasks/drafts | Exact vendor API/export contract and sample synthetic events | Duplicate/out-of-order calls, unknown contact, wrong campaign/client, DNC dominance, signature/replay, backfill | L | Timely contextual follow-up from actual calls | Known event maps to exactly one authorized record; immutable event receipt; ambiguous matches held; no draft/send after opt-out |
| P1 model choice contract | Builder; agents.model; aiProvider; gptProvider/router; model ledger | Server-approved models/schemas and client consent; budget policy | M01, same task each adapter, missing key, refusal/truncation, bounded fallback, context replay, usage persistence | M/L | Honest choice and predictable data/cost boundaries | Selected permitted provider/model actually invoked or explicit refusal; snapshot and actual receipt persisted; no silent fallback |
| P1 source/voice versioning | Brain origin save/refresh; research_runs; task/context snapshot | Client scope and canonical criteria design | Concurrent update, stale review, source-role contamination, resume after Brain edit | M | Stable client instructions and defensible outputs | Reviewed version is traceable; task replay uses original context; unreviewed competitor content cannot replace seller |
| P2 reports and reconciliation | Dashboard/daily-brief; new activity fact projection; client report output | Source adapters + metric definitions | Source-total reconciliation, dedupe, timezones, late events, denominator changes, cross-client report | M/L | Trusted client campaign reporting | Deterministic counts match source; generated commentary cites facts and missing data; report version/client bound |
| P2 Slack review notifications | SettingsIntegrations; new approved Slack app/outbox | App scopes/channel permission, approval | Signature and URL challenge, retries, duplicate event, wrong channel/client, revoked token | M | Keep review in existing team channel | Minimal authorized notification and review link; no confidential cross-client payload; receipt/retry observable |
| P2 Calendar/bookings | Existing calendar auth/events; connector credential scope | Client context; OAuth consent; event identity | Token refresh failure, duplicate create, attendee validation, timeout reconciliation, client isolation | M | Meetings stay in existing calendars | Approved events correct calendar once; external ID persisted; no model-invented booking success |
| P2 test type hygiene | modelSpendIsBounded.test.ts:623,630 | ModelUsage fixture contract | Typechecked focused lane in addition to runtime assertions | S | Confidence in financial safety tests | Usage fixtures satisfy current shape; test remains meaningful; no relaxing cost/budget assertions |
| P3 advanced social/model/report automation | Capability graph/readiness; provider adapters; external source policies | Prior contracts, permission and evidence-semantic tests | Founder/employee role, negation, stale scrape, employment ownership, unsupported provider refusal | L | Broader intent coverage after foundation | Only proven approved capabilities offered; mandatory unsupported requirements block; no invented collection or “live” labels |

## 12. Honest demonstration checklist

Safe to show now, with explicit labels:

- Source-backed architecture, observed deployment stamps and the actual readiness gaps.
- Synthetic selected-account research/draft and seller identity/claim validation receipts from offline tests.
- Separate synthetic A/B workspace compilation and non-member refusal; explain that same-workspace clients remain unsafe.
- Actual mocked transport/model and failure traces; characterize known failures rather than presenting green characterization as acceptance.
- Proposed reviewable call brief/report designs clearly labeled PROPOSED and using synthetic data.

Do not present as working live:

- Apollo/iGTM/Jungler/Sheets/Slack synchronization, Sales Navigator API access, call-result follow-up, campaign attribution or automatic write-back.
- Selectable Claude/OpenAI/Gemini task execution or model-switching equivalence.
- Reliable unattended email sends, inbound reply handling, external booking or approved-tool delivery/recovery.
- Full deployed workspace/client RLS, current migration installation, worker recovery or A7 qualification correctness.
- Synthetic source text, mocked provider responses or historical canaries as current customer execution receipts.

Before a real demo/pilot obtain separate permission for the exact non-customer sandbox or approved customer sample, accounts and allowed operations. Required evidence/access is precise: confirmed CRM/iGTM/Jungler identities; sanitized saved-lead and call-event examples; official API/field/scopes and rate/credit limits; read-only release/worker/schema/policy metadata; approved client-to-destination map; model/data-sharing consent and explicit spend cap. Do not request production secrets in chat. Supply credentials through the approved server secret-management process only after authorization.

Any later live test must record release SHA, workspace/client, source IDs, authorized inputs and limits, actual provider/model IDs and usage, evidence dates, canonical decision, persisted output, human approval, destination receipt and replay/cancellation outcome. Without those receipts the verdict stays UNVERIFIED.

### Final questions to verify with Nosh

1. **Which exact iGTM product does he use?** Confirm the vendor URL, product/edition and supported ways to export or access call outcomes; do not assume `igtm.ai`.
2. **Which exact Jungler product does he use?** Confirm the vendor URL, product/edition and supported ways to export or access signals and research; do not assume `jungler.ai`.
3. **What is his official CRM/system of record?** Is Apollo authoritative for contacts, companies, campaign activity and follow-up state, or does another CRM own some of those records? Confirm where approved AI outputs should return.

These are discovery questions, not requests for credentials or permission to run live workflows. Account access, scopes, data-sharing consent and bounded live-test authorization remain separate later gates.

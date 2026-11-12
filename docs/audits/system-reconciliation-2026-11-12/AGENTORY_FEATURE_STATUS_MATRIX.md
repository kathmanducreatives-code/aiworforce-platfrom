# Agentory feature status matrix (2026-11-12)

**States:**
- **Working E2E:** verified on a live deployment.
- **Partial:** some of the path is live and verified.
- **Built, not deployed**
- **Demo / mock**
- **Disabled (deliberate)**
- **Broken**
- **Unknown**

"Real E2E" means an action in the real UI against a real backend, not unit tests. Unit and contract coverage is stated separately.

| Feature | Source | TEST backend | Production backend | Frontend | Database | Real E2E | State (TEST) | Main blocker | Next action |
|---|---|---|---|---|---|---|---|---|---|
| **ORION: ordinary chat** | ORION branch (OpenAI-only) | `pilot-chat` v1 | v206 (Oct code, Haiku) | ChatView / CommandDock | conversations, messages | 1 live turn on TEST (read surface) | **Partial** | No conversational turn verified live yet | Manual test T2 after redeploy |
| **ORION: company and lead Q&A** | yes | v1 (deterministic read) | Oct code | yes | lead_candidates, accounts | Live: listed 4 leads | **Partial** | D-1 (compound reads) fixed locally, not deployed | Redeploy (A3), then T3 |
| **ORION: evidence retrieval and Evidence panel** | ORION branch | flag on for ORION Pilot only | absent | `OrionEvidencePanel` | signal_events, lead_candidates | Not yet: the live turn took the read path | **Built, not verified live** | D-1 | A3, then T4/T5/T9 |
| **ORION: prioritization** | ORION branch | evidence answer (not daily-brief) in the pilot workspace | brief via daily-brief | yes | — | No | **Built, not verified** | — | T5 |
| **ORION: memory and follow-ups** | presented_referents, prior turns | deployed | yes | — | messages.metadata | No | **Built, not verified live** (handler tests pass) | — | T6/T7 |
| **ORION: briefs** | daily-brief | v7 (commit unknown) | v47 | yes | approvals, signals | No | **Unknown** | Commit unknown; Haiku helper | Not needed for the pilot |
| **ORION: multi-agent coordination** | orchestrate, run-agent; collaboration (ORION branch) | **not deployed** | orchestrate and run-agent deployed (Oct) | plan cards | tasks, task_plans; handoffs (held) | No | **Broken on TEST** (delegation target missing) | No orchestrate or run-agent on TEST | P3 |
| **ATLAS: lead discovery (Mission V2)** | launch/hardening (ATLAS workstream) | lead-pipeline v43 + CI worker | not deployed | Workbench | lead_mission_*, checkpoints | ATLAS workstream runs (not re-verified) | **Partial** (worker path) | Needs a Brain for chat-initiated sourcing | Owned by the ATLAS workstream |
| **ATLAS: qualification, fit, ICP** | yes | via lead-pipeline | Oct code | Lead Library | lead_candidates | Seeded data renders | **Partial** | No Brain, so no ICP on TEST | P2 |
| **ATLAS: Lead Library states and counts** | yes | — | — | `LeadLibrary`, `MetricStrip` | — | Owner observed | **Was broken** (Qualified 0) → **fixed locally** | Redeploy the frontend locally | T14 |
| **ATLAS: credits and paid actions** | yes | run-lead-action, unlock-founders **not deployed** | deployed | yes | credit_transactions | No | **Disabled on TEST** (no functions, no credits) | Deliberate | Keep off |
| **LISA: signal display** | yes | — | — | Signals page | signal_events | Seeded signals present | **Partial** | No scanner on TEST | — |
| **LISA: scheduled scans and V2 engine** | run-monitoring-* (prod); lisa-monitor (ORION branch) | not deployed | legacy scanner with cron `monitoring-tick` | — | monitoring_* | No | **Built, not deployed** (V2); **Unknown** (prod legacy) | Not on TEST | P3 |
| **LYRA: drafts and content** | run-agent, generate-content-image | not deployed | deployed | Content page | content_item* | No | **Broken on TEST** (no backend); **Unknown** on prod | — | P3 |
| **LYRA: approvals and publishing boundaries** | approvals | — | — | approval cards | approvals (browser read-only now) | No | **Unknown** | — | P3 |
| **Company Brain: onboarding and editing** | setup-company-brain, generate-company-brain-draft | not deployed; **writes blocked** | deployed | Brain page | company_brain | No | **Disabled (deliberate)**. The UI was misleading, now **fixed locally** (read-only banner). | — | P2 (Brain-enabled project) |
| **Company Brain: versioned memory (V1)** | ORION branch | not deployed | not deployed | memory panel | absent (held) | No | **Built, not deployed** | — | P2 |
| **Authentication** | Supabase Auth | yes | yes | Auth page | auth.users | Owner signed in on TEST | **Working E2E** | — | — |
| **Workspace membership and isolation** | RLS `has_workspace_access` | yes | yes | — | workspace_members | Rolled-back role tests on TEST (2026-11-12) | **Working** (database level) | UI picks the first membership; no switcher | P4 |
| **Browser write lock on signals and approvals** | held migrations | **applied and verified** | **not applied** | — | — | Role simulation on TEST | **Working on TEST; open in prod** | Approval | A1 |
| **Spend enforcement** | modelSpendCeiling | ceiling set; **understanding calls not recorded (D-2) → fixed locally** | Oct code | — | lead_execution_calls | 0 rows observed | **Broken** (under-counts) → fixed locally | Redeploy | A3, then T13 |
| **Model routing (Terra 6.1 / hybrid)** | ORION branch | off | absent | — | — | — | **Disabled (deliberate)** | — | Later |
| **Environment identification in the UI** | env gate | — | — | badge | — | Owner saw "NON-PRODUCTION — <ref>" | **Was wrong** (TEST treated as unknown; setup pointed at prod) → **fixed locally** | — | T1 |
| **Billing / plans** | workspaces.plan, credits | — | — | Usage page | credit tables | No | **Unknown** | — | P5 |
| **Observability** | ops-health (prod), logs | no | ops-health v2 | — | error_log | No | **Unknown** | No build SHA anywhere | P0-3 |

## Marketing claims versus product

This repository contains no marketing site source, so marketing pages could not be compared.

Measured against the in-app promises, the following are **not true on TEST today**:
- "AI workforce that coordinates ATLAS, LISA and LYRA": no orchestration backend on TEST.
- "Continuous market monitoring": no scanner on TEST.
- "Drafts content": no LYRA backend on TEST.

On production they depend on October code that was not re-verified here, so their state there is **Unknown**. Simulated content in `src/components/workforce` and `src/lib/agent3d` (3D agent states) reflects real task and approval rows, not a demo. It reports **Blocked** when it has nothing to show, which is what the owner saw for ATLAS.

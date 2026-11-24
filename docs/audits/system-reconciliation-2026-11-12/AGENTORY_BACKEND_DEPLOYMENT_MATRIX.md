# Agentory backend deployment matrix (2026-11-12)

**Evidence:**
- Supabase Management API `list_edge_functions` for both projects (versions, update times, entrypoint paths, `verify_jwt`).
- GitHub Actions run history for the deploy workflows.
- Repository source at `launch/hardening@770383ea` and the ORION branch.
- "Real path tested" means executed against a live deployment, not unit tests.

**Times are UTC.** "Local Mac" means the entrypoint path was a folder on the owner's machine, so the commit is **UNKNOWN**.

## Edge functions

| Function | What it does | In source | TEST (`tlvn…`) | Production (`ohsd…`) | Models | Key env / flags | Caller | Real path tested |
|---|---|---|---|---|---|---|---|---|
| `pilot-chat` | ORION chat: understanding, routing, read surfaces, evidence answers, delegation to `orchestrate` | yes (ORION branch differs: OpenAI-only, evidence, bundle) | **v1, 2026-11-12 14:16**, bundled CLI upload from the ORION branch. Very likely `5e615eaa`, but the SHA is not recorded by the API. **Does not yet include this pass's fixes.** | **v206, 2026-10-13 01:47, `d53a52bb`** (CI held-back run 15) | TEST: GPT-5.6 Luna (understanding and answers), GPT-5.6 Terra (repair only). Production: Luna understanding and Claude Haiku replies (old code). | `OPENAI_API_KEY`; `MODEL_SPEND_*`; `AGENTORY_ORION_EVIDENCE_CONTEXT` / `_WORKSPACES` (TEST) | Browser (`src/lib/pilotChat.ts`) | TEST: **one real turn** (2026-11-12 14:54), deterministic read; exposed defects D-1 and D-2 below |
| `daily-brief` | Executive brief from approvals, signals and runs | yes | v7, updated 2026-11-08, CLI upload; commit UNKNOWN | v47, 2026-09-11; commit UNKNOWN | `helper` task (Haiku, `gpt-4.1-mini` fallback) | `MODEL_SPEND_*` | `pilot-chat` (brief route; no longer used for the pilot evidence workspace) | No |
| `lead-pipeline` | ATLAS discovery worker (Mission V2) | yes | **v43, CI at `770383ea`** (run 55, 2026-11-10) | **not deployed** | GPT-5.6 Luna/Terra router | provider keys, `LEAD_*` | `discovery-test-worker.yml` (manual) | TEST: by the ATLAS workstream (not re-verified here) |
| `provider-connections` | Workspace provider connections | yes | **v28, CI at `770383ea`** | not deployed | — | — | Integrations page | Not verified here |
| `orchestrate` | Plans and starts multi-agent work | yes | **not deployed** | v116, 2026-10-11, local Mac (`agentory-pr54-deploy`) | Haiku (`orchestration_plan`) | — | `pilot-chat` delegation | **On TEST every delegation fails** (function absent) |
| `run-agent` | Executes agent tasks (ATLAS, LYRA …) | yes | **not deployed** | v274, 2026-10-13, `edb93ff6` (CI run 16) | Haiku plus the lead engine | — | `orchestrate` | Not on TEST |
| `setup-company-brain`, `generate-company-brain-draft` | Company Brain onboarding and edits | yes | **not deployed** (and writes are blocked by the guard) | v49 / v44, Oct, local Mac | Haiku | — | Brain pages | Not on TEST, by design |
| `company-brain-memory` | Versioned Brain memory (V1) | **ORION branch only** | not deployed | not deployed | — | held migration | Brain memory panel | No (local DB contract tests only) |
| `lisa-monitor` | LISA V2 signal engine | **ORION branch only** | not deployed | not deployed | Luna | flag-gated | — | No |
| `run-monitoring-scan`, `run-monitoring-tick`, `run-radar-scan` | Legacy signal monitoring | yes | not deployed | v110 / v30 / v50; cron `monitoring-tick` | various | — | cron | Not verified |
| `agent-collaboration`, `workforce-dashboard` | Multi-agent handoffs and the Workforce dashboard | **ORION branch only** | not deployed | not deployed | — | held migrations; flags off | — | No |
| `generate-content-image` (LYRA) | Content images | yes | not deployed | v10, Sep | image model | — | Content | Not verified |
| `run-lead-action`, `unlock-founders`, `enqueue-lead-mission`, `resume-stalled-leads`, `continue-workflow`, `approve-and-continue` | ATLAS actions, paid unlocks, queueing, approvals | yes | **not deployed** | deployed (Oct, local Mac or CI) | — | credits | Lead Library and Workbench | Not on TEST |
| `send-scheduled-emails`, `email-tracking`, `google-calendar-*`, `job-feed`, `tool-availability`, `integration-readiness`, `mcp`, `ops-health` | Outreach, email, calendar, feeds, ops | yes | not deployed | deployed (Aug–Oct) | — | — | various | Not verified |
| `firecrawl-scrape`, `provider-discovery` | Scraping and provider discovery | yes | not deployed | not deployed | — | — | — | No |

## Scheduled jobs

| Project | `cron.job` |
|---|---|
| TEST | `sweep-stuck-runs`, `release-stale-credit-reservations` |
| Production | `monitoring-tick`, `sweep-stuck-runs`, `resume-stalled-leads`, `release-stale-credit-reservations` |

**External worker:** `discovery-test-worker.yml`, manual, TEST only, for the ATLAS discovery runs.

## Defects found on the live TEST path this pass

| Id | Layer | Evidence | Status |
|---|---|---|---|
| D-1 | `pilot-chat` routing / read surface | Live turn "What companies and signals … summarize them using stored evidence": `request_understanding_log.metadata.parts = ["read","read"]`. The reply was `"4 leads saved. • Kestrel …"` with `model_used = null` and no `orion_evidence`. `planRead` (`readSurface.ts:193`) serves only the first read part. | **Fixed locally:** in evidence workspaces, compound or prose reads go to ORION's evidence answer (`departmentRouting.ts` `orionAnswersCompoundRead`). Needs redeploy (approval A3). |
| D-2 | `pilot-chat` spend ledger | `lead_execution_calls` had **0 rows** for the pilot workspace after a turn whose understanding call ran on Luna. `understandRequest` was called without `onModelCall`, so understanding and the Terra repair were never recorded, and the spend ceiling could not see them. | **Fixed locally:** understanding is now collected and drained. Mutation-tested. Needs redeploy (A3). |

## What "deployed" does not prove

- **`pilot-chat` on TEST:** its source cannot be read back cheaply (a 1.4 MB bundle), so the commit is an inference from timing and path.
- **No function publishes its commit.** `withBuildStamp` exists in `pilot-chat`; roadmap P0-3 makes every deploy record the SHA.

# GPT-6.1 Terra: validation status, ORION quality work and TEST pilot plan (2026-11-11)

Branch `claude/agentory-audit-roadmap-64uq8n`. It builds on the audit (`README.md`, dfacbb2c) and the hybrid implementation (`HYBRID_IMPLEMENTATION.md`, 56399582 + ca1418cb), both verified present.

**Nothing was deployed, migrated, activated or spent.** No paid model call has been made. The benchmark has **not** been run, and no claim is made that Terra is better.

---

## A. Implementation status

| Capability | Implemented | Tested | Deployed | Activated |
|---|---|---|---|---|
| Verified pricing: Terra, Sol (promotional, expiring), cache writes, long-context, Anthropic usage shape, reasoning telemetry | yes | yes (billing, 8 tests) | no | n/a (accounting) |
| Central per-task router (`modelRoutePolicy`) used by `aiProvider` and `gptModelRouter` | yes | yes | no | **no**: off by default |
| Independently configurable repair rung | yes | yes | no | no |
| **New:** pilot scope `AGENTORY_ROUTE_WORKSPACES` (only listed workspaces route; pipeline calls without a workspace never route) | yes | yes | no | no |
| **New:** per-call worst-case spend admission `AGENTORY_ROUTE_MAX_USD_PER_CALL` (default $0.05) | yes | yes | no | no |
| **New:** `lyra_strategy` task (content strategy / campaigns are a Terra candidate; routine drafts stay cheap) | yes | yes | no | no |
| **New:** ORION evidence context (`AGENTORY_ORION_EVIDENCE_CONTEXT`) | yes | yes | no | no |
| Benchmark: 17 tasks, 12 categories, hard caps, manifests, blind grading pack | yes | yes | — | **not run** |

## B. Terra availability

| Question | Answer |
|---|---|
| Documented by OpenAI? | **Yes.** `gpt-6.1-terra`; Chat Completions, Responses, Batch; 1,050,000 context, 922,000 max input, 128,000 max output; reasoning `none`…`max` (default `medium`); structured outputs; prompt caching. Price: $1 input, $0.05 cached input, $1.25 cache write (30 min), $5 output per 1M; prompts over 272K bill 2× input and 1.5× output. |
| Technically compatible with Agentory? | **Yes.** Agentory uses Chat Completions with `json_object` / strict `json_schema`, no tools and no streaming. Tool calling would need Responses; none is used. |
| Accessible to the TEST project? | **Unverified.** No OpenAI key is configured in this session, and none was extracted. |

**Manual step: free, read-only.** Run this with the TEST project's key loaded in your own shell; never paste the key anywhere:

1. Load the key without echoing it:
   ```bash
   read -rs OPENAI_API_KEY && export OPENAI_API_KEY
   ```
2. Run the check:
   ```bash
   deno run --allow-env=OPENAI_API_KEY --allow-net=api.openai.com scripts/model-bench/run.ts --check-model gpt-6.1-terra
   ```
3. Clear the key:
   ```bash
   unset OPENAI_API_KEY
   ```

The check sends one `GET /v1/models/gpt-6.1-terra` (not inference) and prints only "visible / not visible".

## C. Model comparison: measured vs estimated

| Item | Status |
|---|---|
| Quality, grounding, hallucination, JSON validity, instruction following | **Not measured.** The benchmark is ready, not run. |
| Latency | **Not measured** for Terra. The only recorded point is a Luna signal call at 3.8 s (786 in / 286 out). |
| Prices | **Verified** from vendor pages. |
| Per-task costs | **Estimated** (`scripts/model-bench/costModel.ts`). Token sizes are measured or computed where marked; reasoning-token volume is an assumption. |

## D. ORION quality: audit findings

| # | Question | Finding | Is the gap model reasoning or something else? |
|---|---|---|---|
| 1 | Understands the workspace | Yes. Shared Company Brain loader, onboarding gate. | — |
| 2 | Uses the approved Brain | Yes. Approved memory only; pending proposals ignored; a loader refusal is final. | — |
| 3 | Retrieves recent leads / signals / decisions | **Read questions:** yes (deterministic read surface, workspace questions). **Conversational answers:** no. They received only the Brain profile and three counters. | **Retrieval.** Fixed behind a flag: the evidence digest. |
| 4 | Current vs outdated | Read surface and evidence model label dates and stale / contradicted. Conversational answers had no dates. | **Retrieval / presentation.** Fixed: each digest fact carries its date, age and verification class. |
| 5 | Evidence and citations | Evidence answers cite [E#] (flag). Conversational answers cited nothing. | **Retrieval.** Fixed: digest facts are citable [E1…En], and the business answer shape requires citations. |
| 6 | Explains rejections | Yes. Workspace question `why_company` reads the recorded decision and resolves "this lead" from what was last shown. | — |
| 7 | Follow-ups | 8 prior turns are passed to the model. Pronouns resolve for rejection and verification questions. The companies ORION mentioned in prose were not pointable. | **Workflow.** Fixed: cited companies persist as referents (`orion_evidence`). |
| 8 | Compare and recommend priorities | Only from the Brain profile (no records). | **Retrieval first.** The digest puts named companies first. **This is where stronger reasoning (Terra) could genuinely help**, once it has the evidence. |
| 9 | Coordinates departments | ORION→ATLAS / LISA / LYRA handoffs exist (agent-collaboration, flags). Conversational replies cannot start work, by design. Plans come from `orchestrate`. | **Workflow** (flags off, held security migration not applied). Not a model issue. |
| 10 | Avoids inventing facts | Strong grounding rules with fact scopes ("a number you were not given is not a zero"). | — |

**Conclusion:** most of ORION's weak answers came from **missing retrieval**, not weak reasoning. Switching to Terra without the evidence digest would not have fixed them.

**Where Terra may genuinely help** (to be proven by the benchmark):
- comparing companies over conflicting evidence;
- prioritisation that ties evidence to goals;
- executive briefs;
- multi-department plans;
- LYRA content strategy.

**What still limits ORION regardless of model:**
- LISA V2 collection is off until the signal-table security migration is applied, so signals may be stale.
- The evidence digest is off by default.
- Retrieval reads stored records only; there is no live web search.

### ORION improvements made (no paid calls, no deploy)

- `_shared/orionEvidenceContext.ts`:
  - picks up to 8 stored evidence items for the question, with companies the message names first;
  - renders each as a citable fact with verification class, date and age, source host, and a Company Brain exclusion warning;
  - states which sources could not be read, and says when nothing matched (never implies "empty").
- `converseSurface`: an optional business answer shape covering **What happened → Why it matters → Evidence [E#] → Recommended action** (department, approval), plus explicit "say what is missing". Without the flag the prompt is byte-for-byte unchanged (tested).
- `pilot-chat`: business questions only (`complex_company_qa` / `strategic_prioritization`, classified deterministically) get the digest when `AGENTORY_ORION_EVIDENCE_CONTEXT=true`. Retrieval reuses the membership-checked, workspace-isolated, read-only path at $0. The reply records `orion_evidence.cited_ids` and the cited companies as referents.
- **Preserved:** authorization, approval gates, source verification, grounding rules, budgets.

## E. Cost efficiency (estimates)

Monthly usage assumptions per active customer:
- 300 simple chats and 60 complex questions;
- 22 briefs and 4 weekly reports;
- 20 qualifications and 4 missions;
- 30 monitoring cycles;
- 12 LYRA drafts and 4 workflows.

| Task | Current per task | Recommended per task | Per 1,000 (recommended) |
|---|---|---|---|
| Simple chat message | $0.0052 | $0.0040 | $4.00 |
| Complex company question | $0.0088 | $0.0097 (+≈$0.0005 for the evidence digest on Haiku) | $9.70 |
| ORION executive brief | $0.0070 | $0.0105 | $10.50 |
| ATLAS qualification | $0.0022 | $0.0018 | $1.76 |
| Lead mission (typical) | $0.115 + $0.27 provider | $0.114 + $0.27 provider | $114 + $271 provider |
| LISA signal analysis | $0.0017 | $0.0008 | $0.76 |
| LYRA draft | $0.0115 | $0.0155 | $15.50 |
| Weekly report | $0.0165 | $0.039 | $39.00 |

**Per active customer per month (model only):**

| Routing | Cost |
|---|---|
| Current | $3.60 |
| Terra everywhere | $7.08 |
| Hybrid | $3.61 |
| Recommended | $3.20 |

Research-provider credits add about $1.37 per customer-month for missions alone. **Measured costs: none yet.**

Spend controls now in code (all inactive until configured):
- workspace ceiling ($25/day, enforce);
- per-run routed-call cap (8);
- per-call worst-case cap ($0.05);
- pilot workspace scope;
- the benchmark's hard stage caps.

## F. Recommended routing

The model choices below are pending benchmark evidence.

| Work | Model | Why |
|---|---|---|
| Simple ORION chat | Haiku 4.5 (later: benchmark Haiku 5.5, a tenth of the price) | High volume, low stakes |
| Complex company Q&A, strategic prioritisation | **Terra candidate**, `low` effort + evidence digest | Reasoning over evidence |
| Executive briefs | **Terra candidate**, `low` | Prioritisation quality |
| Multi-department planning | **Terra candidate**, `low` | Plans drive paid work |
| LYRA content strategy | **Terra candidate**, `low` | Planning, not drafting |
| LYRA routine drafts | Haiku 4.5 | Same list price as Terra at `none`; keep until the voice benchmark |
| Lead classification, triage, extraction | gpt-5.6-luna (benchmark gpt-6-luna at half the price) | Volume; Terra costs 4.7× here |
| LISA signal screening | Deterministic V2 + Luna relevance | Cheap; escalate only on contradiction |
| Failed structured-output validation | **Terra 6.1 repair rung** | 55% cheaper per repair than gpt-5.6-terra |
| Ranking, permissions, verification | Deterministic code / database | No model |

## G. TEST readiness

| Area | Ready | Blocked / needs approval |
|---|---|---|
| Code, tests, flags, rollback | ready | — |
| Terra account access | — | free check by a TEST key holder |
| Benchmark Stage 1 (hard max **$1.4314**, cap $2) | ready | **your approval** |
| Benchmark Stage 2 (hard max **$4.3770**, cap $5) | ready | approval **after** Stage 1 review |
| Held security migration (signals / approvals read-only for browsers) | written, DB-lane proven | approval to apply to TEST |
| Deploying the changed edge functions to TEST | ready | **your approval** |
| TEST flags | plan below | **your approval** |

## H. Rollout plan

### H.1 TEST pilot activation (only after approvals)

**1. Credentials and access**
- The TEST project's `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are already used by chat; confirm both are present as TEST edge secrets.
- Run the free `--check-model` against the TEST key.

**2. Security and database prerequisites** (on TEST, via `npm run supabase:test`)
- Apply `20261113120000_workforce_v2_security.sql`.
- Re-run `workforceV2Security.contract.test.ts` against TEST.
- Confirm `lead_model_calls` exists (spend ledger).

**3. Deploy to TEST:** `pilot-chat`, `daily-brief`, `orchestrate`, `run-agent`, the four paid endpoints (role checks), `workforce-dashboard`.

**4. Environment variables** (TEST only; one pilot workspace):
```bash
AGENTORY_HYBRID_ROUTING_ENABLED=true
AGENTORY_ROUTE_WORKSPACES=<pilot workspace uuid>
AGENTORY_VERIFIED_MODELS=gpt-6.1-terra          # only after --check-model returns 200
AGENTORY_ROUTE_COMPLEX_COMPANY_QA=gpt-6.1-terra:low
AGENTORY_ROUTE_STRATEGIC_PRIORITIZATION=gpt-6.1-terra:low
AGENTORY_ROUTE_ORION_REASONING=gpt-6.1-terra:low
AGENTORY_ROUTE_MULTI_AGENT_PLANNING=gpt-6.1-terra:low
AGENTORY_ROUTE_MAX_CALLS_PER_RUN=8
AGENTORY_ROUTE_MAX_USD_PER_CALL=0.05
AGENTORY_ROUTE_FALLBACK=declared
AGENTORY_ORION_EVIDENCE_CONTEXT=true
WORKFORCE_DASHBOARD_ENABLED=true            # + VITE_WORKFORCE_DASHBOARD_ENABLED=true in the TEST build
# Leave AGENTORY_ROUTE_VALIDATION_REPAIR, lyra_strategy, and all ATLAS / LISA stage routes unset for phase 1.
```

**5. Budget caps**
- Existing workspace ceiling: $25/day, enforce.
- Routed calls: 8 per request, $0.05 worst case per call.
- Expected pilot spend: under $1 per day for one workspace at the usage assumptions above.

**6. Browser acceptance scenarios** (pilot workspace, fictional data, as an **owner**)
1. "hi" is answered on Haiku, with `model_route.decision` not `terra`.
2. "Which opportunities best match our ICP?" is answered on `gpt-6.1-terra`. The answer has What / Why / Evidence [E#] / Action, cites stored records with dates, and never recommends an excluded company.
3. Follow-up "why did we reject the second one?" resolves the company from the cited list, or asks which.
4. "What should we prioritize this week?": a deterministic read answer or a Terra prose answer, either way grounded.
5. The daily brief runs on Terra and the dashboard spend panel shows the Terra calls as priced.
6. Remove the pilot workspace from `AGENTORY_ROUTE_WORKSPACES`. The next answer is back on Haiku.

**7. Role checks**
- **Editor:** same as owner for chat. Can approve handoffs. Paid scans allowed.
- **Viewer:** chat works. Cannot approve (403 from `approve-and-continue`; a PostgREST PATCH is refused after the migration). Paid scrape / radar / unlock / image return `role_forbidden_paid_operation`.

**8. Monitoring**
- `lead_model_calls`: model, effort, tokens (including reasoning in logs), `estimated_cost_usd`, `fallback_reason`.
- Reply metadata `model_route` and `orion_evidence`.
- `/workforce` dashboard spend, failures and retries.
- Watch for:
  - `routed_attempt_failed` rate;
  - `over_call_cap`;
  - `run_call_limit_reached`;
  - p50 latency versus Haiku;
  - user-rated answer quality.

**9. Rollback:** unset `AGENTORY_HYBRID_ROUTING_ENABLED` (and `AGENTORY_ORION_EVIDENCE_CONTEXT` if needed). It takes effect on the next request with no deploy. The security migration has its own rollback file.

### H.2 Production release criteria
1. Stage 1 (and, if approved, Stage 2) shows Terra beating Haiku on ORION categories:
   - blind human grade;
   - required points;
   - grounding;
   - no rise in hallucination or invalid JSON;
   - cost per successful task within the §8 ratios of the audit.
2. One week of TEST pilot:
   - fallback rate under 2%;
   - no `over_call_cap` surprises;
   - p50 latency acceptable;
   - spend within estimate;
   - no grounding regressions in sampled answers.
3. The security migration has been applied to production by its own approval.
4. Your explicit approval for each production flag.

## I. Changes and verification

**Files changed in this pass**
- `_shared/orionEvidenceContext.ts` (new)
- `_shared/converseSurface.ts` (optional answer shape)
- `_shared/referentPersistence.ts` (`orion_evidence` kind)
- `pilot-chat/index.ts` (evidence context, referents, task reuse)
- `_shared/modelRoutePolicy.ts` (pilot scope, per-call cap, `lyra_strategy`)
- `_shared/terraPolicy.ts` (`lyra_strategy` task)
- `_shared/aiProvider.ts` (worst-case admission, workspace-aware routing)
- `_shared/departmentRouting.ts` (`lyraTaskFor`)
- `run-agent/index.ts` (LYRA strategy vs draft)
- `scripts/model-bench/{tasks,run,blind}.ts` (3 new categories, stage candidate sets, blind grading)
- both benchmark manifests
- tests: `orionQuality.test.ts` (new, 11 tests), `benchmarkCaps.test.ts` (+2)

**Test results (2026-11-11, all free; mocked or local, no real model or provider):**

| Suite | Kind | Result |
|---|---|---|
| Edge functions (`tests/edge-functions/`) | unit + mocked DB / providers | **9,985 passed, 0 failed** |
| Workforce (billing, routing, benchmark caps, ORION quality, Terra, evidence, dashboard, brain) | unit + mocked | included above (109 in the targeted run) |
| Model-routing evals | unit | 30 / 0 |
| Frontend | unit | 784 / 0 |
| AI architecture audit scenarios | unit | 24 / 0 |
| Deploy-safety (`tests/infra/`) | unit | 315 / 0 |
| DB contract lane (real Postgres 17 + PostgREST, all held migrations) | real DB | DB_LANE_RESULT |
| tsc / eslint ratchets | static | 23 = baseline / 1,265 = baseline |
| Vite build | build | ok |

**Regressions:** one, introduced and fixed in this pass. `pilotChatHandlerE2E` #14 pins `...priorTurns` within 2,000 characters of the converse route. The inline evidence block pushed it to 2,325. The block was moved into `orionEvidenceForTurn`, giving 1,979. No pre-existing failures.

**Risks**
- The evidence digest adds about 500 input tokens to business questions.
- The digest relies on stored data; stale LISA data stays stale until collection is enabled.
- Terra latency is unknown.
- After 2026-11-30, `gpt-5.6-sol` prices as unknown.

**Rollback:** every capability is flag-gated; unsetting the flags restores the prior behaviour. The code changes are additive and reversible with `git revert`.

## Decisions needed from you

1. **Run the free availability check** with the TEST OpenAI key, or name who should.
2. **Approve benchmark Stage 1:** hard maximum $1.43, cap $2. The command is in `HYBRID_IMPLEMENTATION.md` §5; it now runs 7 candidates.
3. After reviewing Stage 1: **approve Stage 2** (hard maximum $4.38, cap $5) or skip it.
4. **Name a blind grader** for `blind.ts` sheets: you or a teammate, not the model.
5. **Approve applying the held security migration to TEST.**
6. **Approve deploying the changed functions to TEST** and setting the pilot flags (§H.1), for one named pilot workspace.
7. **Decide whether to include LYRA strategy and the Terra repair rung** in pilot phase 2.

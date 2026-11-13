# GPT-6.1 Terra: feasibility, cost and integration audit (2026-11-11)

**Scope.** Read-only audit and plan. No runtime routing, flag, deployment or production configuration was changed. No paid model call was made. The only artifacts are this report and bench-only files in `scripts/model-bench/` (`prices.ts`, `costModel.ts`, extended `tasks.ts` / `scorers.ts` / `run.ts`), plus their tests.

**Repository state.**
- Branch `claude/agentory-audit-roadmap-64uq8n`, HEAD `6b2c033e`, working tree clean.
- The default branch is `launch/hardening` (last merge #267). It is fully contained in this branch.
- `origin/main` is an unrelated, stale Lovable history (no merge base, last commit 2026-05-22).
- Commit `b434e4ce` (the Terra integration) exists and matches the 13 files it lists.

**Sources.** Every external fact below is from these pages, read 2026-11-11:

| Source | URL |
|---|---|
| OpenAI model page | https://developers.openai.com/api/docs/models/gpt-6.1-terra |
| OpenAI pricing | https://developers.openai.com/api/docs/pricing |
| GPT-6 migration guide | https://developers.openai.com/api/docs/guides/latest-model |
| Prompt caching guide | https://developers.openai.com/api/docs/guides/prompt-caching |
| Anthropic pricing | https://platform.claude.com/docs/en/about-claude/pricing |
| OpenAI announcement | https://openai.com/index/introducing-gpt-6-1-terra/ (returned HTTP 403 to the fetcher; its claims are **not** used here) |

---

## Executive summary

1. **Is GPT-6.1 Terra available to Agentory?**
   - **Publicly available: yes.** `gpt-6.1-terra` is documented, priced and served on Chat Completions, Responses and Batch.
   - **Available to Agentory's API project: unverified.** The OpenAI key lives only in Supabase edge-function secrets. It is not in this container, and nothing here may read secrets.
   - The repository's comment "OpenAI offers no GPT-6 Terra" (read 2026-10-28) is **out of date**.
   - The free availability check is ready: `scripts/model-bench/run.ts --check-model gpt-6.1-terra`, run by an operator who holds the key. `GET /v1/models/{id}` is a read, not an inference call.

2. **Is it better suited to Agentory than the current architecture?**
   - **Not as a blanket replacement.**
   - It *is* a better fit than the current premium rung (`gpt-5.6-terra`). It costs 50% less on input and 58% less on output, has a newer knowledge cutoff, and supports reasoning effort `none`.
   - Quality on Agentory's tasks is **unmeasured**. Nothing in this report claims it is smarter.

3. **Where would it improve performance most?**
   - Today the high-stakes reasoning runs on the cheapest prose model, Claude Haiku 4.5, with no reasoning: ORION's complex company questions, executive briefs and weekly reports, multi-agent planning, and contradictory-evidence judgements.
   - The validator-repair rung, where it would replace a more expensive model.

4. **How much more or less would it cost?** Monthly model cost, provider credits excluded, under the stated usage assumptions:

   | Strategy | Per customer-month | vs current |
   |---|---|---|
   | Current | $3.60 | — |
   | A · Terra everywhere | $7.08 | +97% |
   | B · Hybrid | $3.61 | ±0% |
   | C · Dynamic escalation | $3.87 | +7% |
   | Recommended (hybrid + escalation, cheaper base) | $3.20 | −11% |

   Model spend is small next to research-provider credits: one recorded mission billed $0.27 in Apify alone.

5. **Recommended strategy:** hybrid, with validator-driven escalation. Use Terra for ORION's complex reasoning and as the escalation rung. Keep cheap models for understanding, classification, qualification and short prose. Benchmark a cheaper base (`gpt-6-luna`, and Claude Haiku 5.5 for simple replies) before moving off the current base.

6. **Exact changes needed** (none made in this audit):
   - Add `gpt-6.1-terra` to `MODEL_PRICES`, including its cache-write rate.
   - Let the router keep each stage's own effort on Terra (it supports `none`).
   - Make the escalation model configurable so it can be `gpt-6.1-terra`.
   - Point the `orion_reasoning` / `complex_company_qa` / `multi_agent_planning` opt-ins at verified prices.
   - Correct the `gpt-5.6-sol` price.
   - Details are in §15.

7. **What to implement first:**
   1. The free `--check-model`.
   2. The price-table fix.
   3. Stage-1 benchmark (maximum **$1.73**, request a **$2** cap).
   4. Stage-2 production-size replay (request **$5**).
   5. Enable Terra for `orion_reasoning` on TEST only.

---

## 1. Availability verdict

**Unverified for Agentory's account. Available publicly.**

| Question | Public documentation | Verified in Agentory's account |
|---|---|---|
| Model id | `gpt-6.1-terra` (only snapshot listed); Bedrock `openai.gpt-6.1-terra` | not checked: no key in this container |
| Endpoints | Chat Completions, Responses, Batch. **Not:** Realtime, Assistants, fine-tuning, embeddings | — |
| Context / output | 1,050,000 context; 922,000 max input; 128,000 max output | — |
| Knowledge cutoff | 2026-06-01 | — |
| Reasoning | `none`, `low`, `medium` (default), `high`, `xhigh`, `max` | — |
| Structured outputs | supported | — |
| Function calling | supported, **but tool calling requires the Responses API** | — |
| Streaming / prompt caching | supported | — |
| Modalities | text + image in, text out | — |
| Rate limits (Standard) | Build 5,000 RPM / 1M TPM; Launch 10,000 / 4M; Grow 15,000 / 40M | account tier unknown |
| Known limits | >272K-token prompts bill 2× input and 1.5× output; no fine-tuning or predicted outputs; not in UAE inference residency | — |

**The exact zero-cost check:**
```bash
deno run --allow-env --allow-net=api.openai.com scripts/model-bench/run.ts --check-model gpt-6.1-terra
```
An operator runs this with the TEST project's `OPENAI_API_KEY` exported in their own shell. HTTP 200 means visible; 404 means not visible to this project.

**If a paid confirmation is wanted**, the minimal request is one Chat Completions call:
- `reasoning_effort: "none"`, `max_completion_tokens: 16`, about 20 input tokens.
- Maximum cost: (20 × $1 + 16 × $5) / 1M = **$0.0001**.
- I have not run it. It needs your approval.

## 2. Capabilities and API compatibility with Agentory's code

| Agentory dependency | Terra | Status |
|---|---|---|
| Chat Completions transport (`gptProvider.ts`, `aiProvider.ts`) | supported | compatible |
| Strict `json_schema` structured output (`modelRequestBody.buildChatCompletionsBody`) | supported | compatible |
| `json_object` (aiProvider jsonMode) | supported | compatible |
| `temperature` / `max_tokens` | must be removed when effort ≠ `none` | `usesGpt5RequestShape` already routes `gpt-6*` to the right body; `openAIChatBody` (b434e4ce) omits temperature |
| `reasoning_effort` | `none`…`max` | **b434e4ce forces `"low"` on Terra** in both `aiProvider.openAIChatBody` and `gptModelRouter`. Terra accepts `none`, so stages that run at `none` today pay for reasoning they did not ask for. Fix in §15. |
| Tool / function calling | Responses API only | Agentory's OpenAI paths send no `tools`, so this does not apply today. Any future tool use needs a Responses transport. |
| Streaming | supported | Agentory streams nothing today, so no change is needed. |
| Usage accounting (`readModelUsage`) | Chat Completions `usage.prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` | Reads input / cached / output. Cache-write field names for **Chat Completions** are not on the caching page (it documents Responses `input_tokens_details.cache_write_tokens`). The parser already accepts both shapes; verify from a real response in the benchmark. |
| Pricing (`priceModelCall`) | $1 / $0.05 cached / $5; cache write $1.25 (30 min) | **Not in `MODEL_PRICES`.** Priced only through `AGENTORY_TERRA_PRICE_USD_PER_1M="in,cached,out"`, which has **no cache-write field**, so writes would be under-counted by 25%. Fix in §15. |
| Spend ceiling / run budget | — | Terra calls are counted once priced. The per-run Terra limiter (8) and the spend-collector requirement (b434e4ce) stay. |
| Errors / retry | standard HTTP codes | One-retry policy and 402/429 vendor exhaustion apply unchanged. |
| Existing tests | — | Edge suite 9,935 / 0, frontend 784 / 0, DB lane 449 / 0 (last run on this branch). The updated `terra.test.ts` passes 12 / 0. |

## 3. Inventory of model-powered features (verified 2026-11-11)

Routes were re-derived this session from `aiProvider.TASK_MODELS` and `gptModelRouter.routingTable()`, not copied from the earlier audit.

Column legend:
- **Tok in/out:** measured where marked (M); computed from prompt text (C); otherwise an assumption (A) or a cap.
- **Compatible:** Terra is technically compatible.
- **Likely gain:** Terra is likely to improve the feature.
- **Cost-effective:** upgrading would pay for itself.

| Agent | Feature (file → function) | Model / provider today | Input → output | Tok in/out | Cost basis | Compatible | Likely gain | Cost-effective |
|---|---|---|---|---|---|---|---|---|
| Shared | Chat understanding (`chatBrain.understandRequest`, stage `request_understanding`) | gpt-5.6-luna (repair gpt-5.6-terra) / OpenAI | message + 8 turns → RequestV1 JSON | C ≈2.6K / ≤1,500 | priced, `lead_model_calls` | yes | low (classification) | no; keep cheap. Repair rung → Terra: yes |
| ORION | Conversational / company Q&A (`converseSurface` via `pilot-chat`, `pilot_chat`) | Haiku 4.5 / Anthropic | facts + Brain + turns → prose | C ≈2–4.5K / ≤420 | priced | yes | **high for complex questions** | yes for complex questions; no for small talk |
| ORION | Executive brief wording (`daily-brief`, `helper`) | Haiku 4.5 (→ gpt-4.1-mini) | deterministic facts → wording | C ≈3.5K / ≤900 | priced | yes | medium–high (prioritisation) | yes ($0.0105 vs $0.0070 per brief) |
| ORION | Orchestration / multi-agent plan (`orchestrate`, `orchestration_plan`) | Haiku 4.5 | goal + registry → plan JSON | C ≈2.8K / ≤2,048 | priced | yes | **high** | yes |
| ORION | Evidence answers (`evidence/answer.ts`) | none (deterministic) | — | 0 | $0 | — | — | keep deterministic |
| ORION | Legacy intent classifier (`pilot-chat` `helper`, maxTokens 50) | Haiku 4.5 | message → label | small / 50 | priced | yes | none | no |
| ATLAS | Mission compilation, actor selection, execution plan (+ amendment, route control, opportunity reasoning) (`gptModelRouter` stages; `gptExecutionPlanner`, `gptDiscoveryPlanner`) | gpt-5.6-luna `low` → repair gpt-5.6-terra | mission + Brain + registry → plan JSON | M/A ≈7.2K / ≤2–3K per call | priced | yes | medium (planning quality drives Apify spend) | repair rung → Terra: yes (−55% per repair). Primary: benchmark first |
| ATLAS | Triage, evaluation, company qualification, pool evaluation, grounded evidence evaluation, evidence planning / extraction, summaries | gpt-5.6-luna `none` | evidence pages → verdict JSON | M/A ≈7.2K / ≤700 | priced | yes | low–medium | **no**: 4.7× the per-call cost of Luna. Escalate only on contradiction / validator failure |
| ATLAS | Pool ranking | code | — | 0 | $0 | — | — | keep code |
| ATLAS | Actor input planning (`actorInputPlanner`, `helper`) | Haiku 4.5 (→ gpt-4.1-mini) | actor schema → input JSON | ≤700 out | priced | yes | low | no |
| ATLAS | Workbench opener (`workbench/openerModel`) | Haiku 4.5 | lead → 1–2 lines | ≤300 out | priced | yes | low | no |
| ATLAS | Lead strategist (`leadStrategy/*`) | `openai/gpt-5.6-luna` via **Lovable gateway by default** | strategy JSON | — | gateway: unpriced | yes (if `LEAD_STRATEGIST_PROVIDER=openai`) | — | gated off (`GPT_LEAD_STRATEGY`). The Lovable default is stale (aiProvider notes the gateway is gone). |
| ATLAS | Decision-maker research | provider actors + Luna stages | — | — | — | — | — | covered by the stages above |
| LISA | Signal relevance (`signalRelevanceJudge`, stage `signal_relevance`) | gpt-5.6-luna `low` → repair gpt-5.6-terra | signal + Brain → relevance JSON | **M 786 / 286, 3.8 s** | priced | yes | medium on contradictory evidence | escalation only |
| LISA | V2 extraction, verification, relevance, weekly top-5 (`_shared/lisa/*`) | none (deterministic) | — | 0 | $0 | — | — | keep deterministic (removes model calls) |
| LISA | Radar (`run-radar-scan`) | none | — | 0 | provider credits | — | — | — |
| LYRA | Content / outreach drafts (`run-agent`, `agent_execution`) | Haiku 4.5 | brief + Brain + voice → draft | **M 3,153 / 308** | priced | yes | uncertain (voice) | benchmark first: Terra lists at the same price as Haiku 4.5 at effort `none` |
| LYRA | Images (`generate-content-image`) | gpt-image-1 | prompt → image | — | image table | no (Terra has no image output) | — | — |
| Brain | Setup analysis / follow-ups (`setup-company-brain`) | Haiku 4.5 | website + answers → profile | ≤1,200 / ≤600 out | priced | yes | medium (one-off per customer) | yes if benchmarked (rare, high value) |
| Brain | Draft from website (`generate-company-brain-draft`, `helper`) | Haiku 4.5 (→ gpt-4.1-mini) | pages → draft profile | ≤3,000 out | priced | yes | medium | optional |
| Brain | Memory proposals, context loading | none (deterministic) | — | 0 | $0 | — | — | keep |
| Shared | Embeddings / retrieval | **none exist** | — | — | — | — | — | — |

**Not measurable here:** per-feature latency and production token distributions. They live in `lead_model_calls`, which this audit did not read. The measured points above are recorded in the repository.

## 4. Current routing architecture

```
User ─► pilot-chat ─► auth · membership · spend ceiling ($25/day/workspace, enforce)
          │
          ├─ deterministic: workspace questions, evidence answers [flag], LISA V2, ranking  (0 model calls)
          ├─ chatBrain.understandRequest ─► gptProvider ─► gptModelRouter ─► gpt-5.6-luna ─(validator rejects)─► gpt-5.6-terra
          ├─ converse / brief / plan / LYRA ─► aiProvider.TASK_MODELS ─► claude-haiku-4-5 (2 helper tasks → gpt-4.1-mini)
          │                                   └─ Terra opt-in (b434e4ce, all gates OFF) ─► gpt-6.1-terra
          └─ lead mission ─► run-agent / lead-pipeline ─► gptModelRouter stages (Luna) + Apify / Firecrawl credits
All priced calls ─► priceModelCall ─► ModelCallCollector ─► lead_model_calls ─► spend ceiling / run budget
```

## 5. Recommended model per feature

| Feature | Recommended | Why |
|---|---|---|
| Chat understanding | gpt-5.6-luna now. Benchmark gpt-6-luna (half the price). Escalate to **gpt-6.1-terra** instead of gpt-5.6-terra. | High volume, classification. The repair rung gets cheaper and newer. |
| Simple chat reply | Haiku 4.5 now. Benchmark Claude Haiku 5.5 ($0.10 / $0.50, 10× cheaper). | Largest monthly line item (43% of current spend under these assumptions). |
| Complex company Q&A | **gpt-6.1-terra, effort `low`** | Strategic, evidence-heavy, low volume. |
| ORION brief / weekly report | **gpt-6.1-terra** (`low` / `medium`) | Prioritisation quality is the product. |
| Multi-agent planning | **gpt-6.1-terra, `low`** | Plans drive paid work; a better plan saves Apify credits. |
| ATLAS planning stages | Luna primary, **Terra 6.1 repair** | Escalate on validator rejection. |
| ATLAS qualification / evaluation / extraction | Luna (`none`); benchmark gpt-6-luna. Escalate to Terra only on contradicted evidence. | 4.7× cost ratio; volume. |
| LISA relevance | Luna; escalate to Terra on `contradicted` / `single_source` with high relevance | Measured 786 / 286 tokens: cheap. |
| LYRA drafts | Haiku 4.5 until the benchmark compares Terra-`none` (same list price), Haiku 5.5 and Sonnet 5.5 on voice | Writing quality is subjective. Measure it. |
| Company Brain setup | Haiku 4.5. Benchmark Terra for this one-off. | Rare, high value. |
| Ranking, permissions, verification, evidence answers, LISA V2 | **code / database** | No model needed. |

## 6. Terra versus existing models

| | Haiku 4.5 | gpt-5.6-luna | gpt-5.6-terra | **gpt-6.1-terra** | gpt-6.1-sol | gpt-6-luna | Haiku 5.5 |
|---|---|---|---|---|---|---|---|
| Input / cached / output ($/1M) | 1.00 / 0.10 / 5.00 | 0.20 / 0.02 / 1.20 | 2.00 / 0.20 / 12.00 | **1.00 / 0.05 / 5.00** | 2.00 / 0.10 / 10.00 | 0.10 / 0.01 / 0.50 | 0.10 / 0.01 / 0.50 |
| Reasoning control | — (no extended thinking used) | yes | yes | none → max | low → max (no `none`) | yes (`none` ok) | — |
| Role today | all prose | understanding, ATLAS, LISA | repair | opt-in, off | gpt-6 family escalation | gpt-6 family primary | unused |
| One repair call (7.25K in, 750 out, 750 reasoning) | — | — | $0.0325 | **$0.0148 (−55%)** | $0.0295 | — | — |

**Quality comparison: not measured.** The harness exists; §13 is the plan.

## 7. Pricing table (verified 2026-11-11)

See `scripts/model-bench/prices.ts`. Additional rules:
- **OpenAI Terra:** cache writes $1.25 / 1M (30 min) or $2.50 (12 h, Responses only). Cached reads cost 0.05× input. Batch and Flex are 50% off. Fast mode is 2×. Prompts over 272K bill 2× input and 1.5× output. Regional processing adds 10%.
- **Anthropic:** cache writes 1.25× (5 min) or 2× (1 h). Hits cost 0.1×. Batch is 50% off. Haiku 5.5 prompts over 100K bill $0.50 / $2.50.

**Repository drift:**
- `MODEL_PRICES` lacks `gpt-6.1-terra`.
- It lists `gpt-5.6-sol` at $5 / $0.50 / $30; the published price is $4 / $0.40 / $20. Sol is not routed today.

## 8. Cost per task

Source: `deno run --allow-read scripts/model-bench/costModel.ts`. Model cost only; provider credits are shown separately.

**Assumptions** (all in `costModel.ts`):
- Call sizes are measured or computed where marked.
- Reasoning tokens = 1× visible output at `low` and 3× at `medium`. This is the largest uncertainty; the benchmark measures it.
- Repair rate 10%.
- Escalation rates as listed per strategy.

| Task | Calls | Current | A · Terra everywhere | B · Hybrid | C · Escalation | Recommended | Provider (separate) |
|---|---|---|---|---|---|---|---|
| Simple chat message | 2 | $0.0052 | $0.0071 | $0.0045 | $0.0045 | $0.0040 | — |
| Complex company question | 2 | $0.0088 | $0.0128 | $0.0102 | $0.0103 | $0.0097 | — |
| ORION executive briefing | 1 | $0.0070 | $0.0105 | $0.0105 | $0.0092 | $0.0105 | — |
| ATLAS company qualification | 1 | $0.0022 | $0.0103 | $0.0022 | $0.0037 | $0.0018 | page credits |
| Lead discovery mission (typical, 44 calls) | 44 | $0.1152 | $0.4532 | $0.1312 | $0.1835 | $0.1137 | $0.2711 (one recorded run) |
| LISA signal analysis | 1 | $0.0017 | $0.0037 | $0.0012 | $0.0012 | $0.0008 | per cycle |
| Monitoring cycle (10 signals) | 10 | $0.0174 | $0.0365 | $0.0124 | $0.0124 | $0.0076 | not verified |
| LYRA LinkedIn draft | 2 | $0.0115 | $0.0170 | $0.0155 | $0.0145 | $0.0155 | — |
| Multi-agent collaboration workflow | 12 | $0.0335 | $0.1195 | $0.0375 | $0.0512 | $0.0331 | $0.0714 (A) |
| Weekly executive report | 1 | $0.0165 | $0.0390 | $0.0390 | $0.0368 | $0.0390 | — |

Why Hybrid's simple chat comes out cheaper than Current: its repair rung is Terra 6.1, which costs less per repair than Terra 5.6.

**Worst case under configured limits:**

| Limit | Value |
|---|---|
| Heaviest recorded mission | 95 calls / 688,303 tokens. Luna-priced ≈ $0.21 (90/10 split); on Terra-`none` ≈ $0.96 |
| Terra per-run limiter | 8 calls. At plan-size caps (2.8K in, 2,048 out + 2,048 reasoning), ≤ $0.19 per run at `low` |
| Workspace ceiling | $25/day in `enforce`, so ≤ $750 per workspace-month whatever the routing |
| Output caps per call | understanding 1,500; converse 420; brief 900; plan / LYRA 2,048; Brain draft 3,000; interpreter 4,000 |

**Cost per successful task:**
- Expected cost = cost per attempt ÷ success rate.
- Terra pays for itself on a task only when p(success with Terra) ÷ p(success today) ≥ its cost ratio. The ratios:

  | Task | Terra / current cost ratio |
  |---|---|
  | Qualification (Terra-`none` vs Luna) | 4.7× |
  | Brief | 1.5× |
  | Complex question | 1.16× |
  | Weekly report | 2.4× |

- **Qualification fails that test** unless a wrong verdict triggers downstream paid enrichment. Measure that.
- **Briefs, complex questions and planning pass it** with a modest quality gain.
- **The repair rung is cheaper outright.**

## 9. Monthly cost scenarios

**Usage assumptions per active customer per month:**
- 300 simple chats and 60 complex questions.
- 22 briefs and 4 weekly reports.
- 20 standalone qualifications and 4 missions.
- 30 monitoring cycles.
- 12 LYRA drafts and 4 collaboration workflows.

| Active customers | Current | A · Terra everywhere | B · Hybrid | C · Escalation | Recommended |
|---|---|---|---|---|---|
| 1 | $3.60 | $7.08 | $3.61 | $3.87 | $3.20 |
| 10 | $36.01 | $70.79 | $36.14 | $38.69 | $32.05 |
| 100 | $360.08 | $707.91 | $361.39 | $386.92 | $320.48 |
| 1,000 | $3,600.81 | $7,079.13 | $3,613.93 | $3,869.21 | $3,204.78 |

Research-provider credits at the recorded Apify rate add about $1.37 per customer-month for missions and workflows alone. Monitoring search credits are not verified. **Model choice is not Agentory's main cost lever. Provider credits and chat volume are.**

## 10. Cost optimisation

1. **Simple chat (43% of model spend).** Benchmark Claude Haiku 5.5 for `converse_simple`. Roughly 10× cheaper on list price.
2. **Move the repair rung to Terra 6.1:** −55% per repair, with no quality regression expected (newer model). Confirm in the benchmark.
3. **Prompt caching.** The chatBrain system prompt (≈1.8K tokens) and the master prompt (≈1.4–1.9K) are static prefixes above the 1,024-token minimum. Cached reads cost $0.05 on Terra and $0.10 on Haiku 4.5. Order prompts static-first and Brain/context last. Caching *writes* are billed at 1.25×, so caching pays only when a prefix is reused within 30 minutes. That holds for chat bursts, not for a daily brief.
4. **Batch** (50% off) for the weekly report, scheduled monitoring and Brain re-analysis. These are not interactive.
5. **Keep deterministic paths deterministic.** LISA V2, ranking, evidence answers and handoffs already removed model calls. Also: drop the actor-registry summary from writer prompts (prior audit), and skip brief wording when there is nothing new (already done).
6. **Reuse validated results.** Web-evidence cache and qualification verdicts (already). Add one: cache the ORION brief per Brain fingerprint per day.
7. **Effort discipline.** Run Terra at `none` for extraction-like work and `low` for reasoning. Do not use the `medium` default except for the weekly report.
8. **Budgets** stay as they are: workspace ceiling, per-run Terra limiter, mission budgets. Do not loosen verification or authorization to save money.

## 11. Latency

**No Terra latency was measured.** The only recorded point is a Luna relevance call at 3.8 s for 786 / 286 tokens. Reasoning tokens add generation time roughly in proportion to their count, so `low` and `medium` will be slower than `none` by an amount the benchmark must measure.

Escalation adds one sequential call, roughly the latency of a primary call, but only on the escalated share.

**UI recommendations:**
- Stream ORION's complex answers. This needs a streaming path; there is none today.
- Show research progress for missions (task status already exists).
- Run briefs, weekly reports and missions asynchronously with status.
- Support cancellation (missions already cancel).
- Allow safe retries. Idempotency keys already exist on approvals and handoffs.

## 12. Compatibility risks

1. **Forced `low` effort** on Terra in b434e4ce. It costs more than needed on stages that run at `none` today.
2. **Cache writes are not priced** in `AGENTORY_TERRA_PRICE_USD_PER_1M`.
3. **The model is not visible to the project yet:** the check has not been run.
4. **Tool calling would need Responses.** No impact today.
5. **Chat Completions cache-write usage field** is unverified. Confirm from a real response.
6. **The `gpt-6` family switch escalates to `gpt-6.1-sol`,** which costs 2× Terra. Make the escalation model independently configurable.
7. **Stale Lovable-gateway default** for the lead strategist (gated off).
8. **Rate limits:** Build tier is 1M TPM. The heaviest recorded mission used 688K tokens in total, spread over minutes. Several concurrent missions routed to Terra could approach Build-tier TPM, so confirm the tier before routing ATLAS stages to Terra.

## 13. Benchmark execution plan

**The harness** is `scripts/model-bench/`:
- 12 fictional tasks covering all 8 requested categories: executive, ICP Q&A, lead research, market signal, multi-agent planning, content, factual reliability (stale + contradictory), memory (approved exclusion + an unapproved proposal to ignore).
- 8 candidates: Haiku 4.5, Luna 5.6, Terra 5.6 `low`, Terra 6.1 `none` / `low` / `medium`, gpt-6-luna, Haiku 5.5.
- 3 repeats.
- **Scored deterministically:** JSON validity, ICP violations, suspected hallucinations, citation accuracy, required points, forbidden recommendations, latency, tokens (including reasoning tokens), cost.
- **Correctness and reasoning quality** also get a blind human grade of the recorded outputs (`--score`).

**Stages:**

| Stage | What | Maximum | Requested cap |
|---|---|---|---|
| 0 | `--check-model gpt-6.1-terra` (read) | $0 | — |
| 1 | Fixture matrix, 288 calls (dry-run maximum, outputs at cap) | **$1.73** | **$2.00** |
| 2 | Production-size replay: the same tasks wrapped in Agentory's real system prompts (≈2–7K tokens each), 288 calls | ≈ $2.80 estimated | **$5.00** |
| 3 | TEST shadow run: Terra computes ORION answers in parallel; the user sees the current answer; 1 week | bounded by the Terra limiter + workspace ceiling | **$10.00** |

**Decision rules (set before running):**
- **Adopt Terra for a task** if, over 3 repeats, its required-points and ICP scores beat the incumbent with no increase in hallucinations or invalid JSON, and its cost per successful task is within the ratios in §8.
- **Adopt a cheaper base** if it matches the incumbent's scores.

**To run Stage 1 after approval:**
```bash
AGENTORY_MODEL_BENCH_APPROVED="I approve paid model benchmark spend up to \$2.00" \
deno run --allow-env --allow-read --allow-net=api.openai.com,api.anthropic.com scripts/model-bench/run.ts --live --budget-usd 2.00 > bench-stage1.jsonl
```

## 14. Recommended integration architecture

```
User ─► ORION (pilot-chat / daily-brief / orchestrate)
          │
          ▼
   Model Router (one abstraction: aiProvider.TASK_MODELS + gptModelRouter stages + terraPolicy gates)
     ├─ simple / extraction ───────► cheap base (gpt-5.6-luna → gpt-6-luna?; Haiku 4.5 → Haiku 5.5?)
     ├─ complex reasoning (ORION) ─► gpt-6.1-terra (effort low; medium for weekly)
     └─ validator rejects / contradicted evidence ─► gpt-6.1-terra (escalation rung)
          │
          ▼
   priceModelCall (verified prices) ─► ModelCallCollector ─► lead_model_calls ─► spend ceiling · run budget · Terra limiter

ATLAS ─ gptModelRouter stages ─► cheap base; repair ─► Terra   + Apify / Firecrawl (credit-authorized)
LISA  ─ deterministic V2 engine; relevance (Luna) ─► Terra on contradiction
LYRA  ─ aiProvider agent_execution (Haiku 4.5 until benchmarked) ─► unpublished drafts (approval to send)
Company Brain ─ shared loader (approved facts only) ─► every route above; proposals stay pending
```

No new gateway. Terra stays inside the existing `aiProvider` / `gptModelRouter` / `modelCostModel` seams.

## 15. File-by-file implementation plan (not done in this audit)

| File | Change |
|---|---|
| `supabase/functions/_shared/modelCostModel.ts` | Add `"gpt-6.1-terra": { input 1.00, cached 0.05, output 5.00, cache_write 1.25, price_source: OpenAI pricing page, effective 2026-11-11 }`. Correct `gpt-5.6-sol` to 4 / 0.40 / 20. Keep `runtimeModelPrice` as an override. |
| `supabase/functions/_shared/terraPolicy.ts` | Accept an optional 4th price field (cache write). Treat a `MODEL_PRICES` entry as satisfying "priced". Update the header: Terra is publicly documented. Keep `MODEL_VERIFIED` as the per-account check. |
| `supabase/functions/_shared/gptModelRouter.ts` | Terra opt-in keeps the stage's own effort (`none` stays `none`). Add `AGENTORY_GPT_ESCALATION_MODEL` (allow-list: `gpt-5.6-terra`, `gpt-6.1-terra`, `gpt-6.1-sol`) so the repair rung can move to Terra 6.1 independently of the family switch. Default unchanged. |
| `supabase/functions/_shared/aiProvider.ts` | `openAIChatBody` takes an effort per workforce task (`orion_reasoning` → `low`, weekly → `medium`) instead of a fixed `low`. Keep the 2× completion-token headroom. |
| `supabase/functions/_shared/modelRequestBody.ts` | No change. `usesGpt5RequestShape` already covers `gpt-6*`. Add a test pinning `gpt-6.1-terra` + `none`. |
| `supabase/functions/daily-brief`, `orchestrate`, `pilot-chat` | No change. Already tagged (`orion_reasoning`, `multi_agent_planning`, `complex_company_qa`). |
| `supabase/functions/run-agent` | Keep `lyra_content` tagged, but do not opt it in until the benchmark says so. |
| `tests/edge-functions/_shared/workforce/terra.test.ts` | Pin the price entry, effort pass-through and escalation-model allow-list. |
| `src/` (later) | Streaming / progress UI for complex ORION answers (§11). |

## 16. Safe rollout plan

| Phase | Steps | Exit criterion |
|---|---|---|
| A · Compatibility | `--check-model` on the TEST project; one $0.0001 call if approved | HTTP 200 + a valid JSON response |
| B · Pricing / accounting | The §15 price-table change. Deploy to TEST. Confirm `lead_model_calls` rows price Terra as `event_priced`, including cache writes. | A Terra row with non-null cost |
| C · Benchmark | Stages 1–2 | Decision rules in §13 |
| D · One task | On TEST: `AGENTORY_TERRA_ENABLED`, `MODEL_VERIFIED`, `TASKS=orion_reasoning` | One week: cost per brief, latency, validation failures, user rating vs Haiku |
| E · Hybrid | Add `complex_company_qa`, `multi_agent_planning`, and the repair rung, only where Stage 2 shows a gain | Per-task metrics hold |
| F · Monitoring | Dashboard (`/workforce`) spend panel. Add cost per successful task, error / validation-failure / retry rates per model. | Metrics visible per task and model |
| G · Rollout | TEST only, existing project, no Docker needed locally. Production flags only with explicit approval. | Your sign-off |

## 17. Open questions and approvals needed

1. Approve **Stage 0**: someone with the TEST `OPENAI_API_KEY` runs `--check-model` (free). Optionally approve the $0.0001 inference check.
2. Approve **Stage 1 ($2)** and **Stage 2 ($5)** benchmark spend. Confirm Anthropic Haiku 5.5 may be included (it needs `ANTHROPIC_API_KEY` in the operator's shell).
3. Which OpenAI usage tier is the project on? This decides whether Terra's TPM fits concurrent missions.
4. May the §15 price-table correction land ahead of the benchmark? It changes accounting only, not routing.
5. Who grades writing quality for LYRA? Name a reviewer for the blind human grade.

---

## Final recommendation

**Adopt GPT-6.1 Terra selectively, after a $7 two-stage benchmark.**

- **Use it for:** ORION complex company questions, executive briefs and weekly reports, multi-agent planning, and as the escalation rung replacing `gpt-5.6-terra`.
- **Why there:**
  - These are low-volume, high-consequence reasoning tasks that today run on a non-reasoning prose model.
  - On the repair rung Terra is cheaper outright (−55%).
- **Do not use it for:** chat understanding, qualification, extraction, signal relevance or routine replies. Its 4.7× cost there is not justified unless a benchmark shows a matching success gain.
- **Bigger savings elsewhere:** Haiku 5.5 for simple chat, prompt caching, batch for scheduled work, and keeping deterministic paths deterministic.
- **Expected result:** model cost roughly flat to −11%, with stronger reasoning where it matters.

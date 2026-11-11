# GPT-6.1 Terra hybrid routing: implementation (2026-11-11)

Branch: `claude/agentory-audit-roadmap-64uq8n`. Follows the audit in `README.md` (commit dfacbb2c).

**Everything here is off by default.** With no new environment variables set, every task and every pipeline stage runs on exactly the model it ran on before. A test pins that rollback state. Nothing was deployed, no flag was set anywhere, and no paid call was made.

## 1. Availability of `gpt-6.1-terra`

| | Status |
|---|---|
| Model id | `gpt-6.1-terra` (only snapshot) |
| Public availability | **Documented and priced.** Chat Completions, Responses and Batch (developers.openai.com, read 2026-11-11). |
| API compatibility with Agentory | **Compatible.** Agentory's OpenAI calls use Chat Completions with `json_object` / strict `json_schema`, no tools and no streaming. Terra supports all of these. Tool calling would need the Responses API, but Agentory sends no tools. |
| Account access (TEST project) | **Unverified: blocker.** No `OPENAI_API_KEY` exists in this session, and secrets are not extractable here, by design. |
| Restrictions | Prompts over 272K tokens bill 2× input and 1.5× output. No fine-tuning, predicted outputs or UAE inference residency. Rate limits by tier (Build: 5,000 RPM / 1M TPM). |

### The free check: what it does

`scripts/model-bench/run.ts --check-model gpt-6.1-terra`:
- reads `OPENAI_API_KEY` from the operator's own shell environment;
- sends **one** `GET https://api.openai.com/v1/models/gpt-6.1-terra` (model retrieval, which is not inference and is not billed);
- discards the response body;
- prints only "IS / is NOT visible (HTTP n)".

It never prints the key, writes nothing, changes no configuration, and touches no Supabase project. **It checks whichever OpenAI project the key belongs to**, so use the TEST project's key.

### How to run it securely (operator, on any machine with Deno; no Docker)

1. Load the TEST key without echoing it:
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

The equivalent without Deno:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.openai.com/v1/models/gpt-6.1-terra -H "Authorization: Bearer $OPENAI_API_KEY"
```
HTTP 200 means available to that project; 404 means not available.

## 2. Pricing and accounting fixes (`_shared/modelCostModel.ts`)

All figures were re-verified 2026-11-11 against OpenAI's pricing and model pages and Anthropic's pricing and models pages.

| # | Bug | Fix |
|---|---|---|
| 1 | `gpt-5.6-sol` listed at $5 / $0.50 / $30 | $4 / $0.40 / $20 (cache write $5). This is a **promotional** price, published "until November 30, 2026", and no later price is published. So the entry carries `valid_until: 2026-11-30`. After that date Sol calls price as `unknown` (bounded by the run budget) instead of at a guessed rate. Sol is not routed. |
| 2 | `gpt-6.1-terra` missing from the table. It was priced only through an env tuple with no cache-write field. | Static entry: $1 input, $0.05 cached, $1.25 cache write (30 min), $5 output, plus the >272K surcharge. The env tuple now also accepts an optional 4th cache-write field. The verified static price wins over the env tuple. |
| 3 | GPT-5.6 Luna / Terra had no cache-write rate, so writes were billed as plain input (20% low) | $0.25 and $2.50 per 1M |
| 4 | Haiku 4.5 had no cache-write rate | $1.25 per 1M (Anthropic's 5-minute writes) |
| 5 | Anthropic usage shape: `input_tokens` **excludes** cache reads and writes | `readModelUsage` folds `cache_read_input_tokens` / `cache_creation_input_tokens` into the subset convention. Today's uncached responses read exactly as before. |
| 6 | Long-prompt surcharges not modelled | `long_context` on Terra and Sol (>272K: 2× / 1.5×) and Haiku 5.5 (>100K: 5× / 5×) |
| 7 | Reasoning tokens invisible | `usage.reasoning_tokens` (a subset of output, billed once) is carried into telemetry, along with the effort actually sent |
| 8 | Terra effort forced to `low` (b434e4ce) | The router keeps the stage's own effort (Terra accepts `none`). aiProvider uses each task's effort, defaulting to `none` for routine work and `low` for reasoning. |
| 9 | Fixed 2× completion headroom paid even at `none` | Headroom by effort: none 1×, low 2×, medium 4×, high 6× |
| 10 | Repair routed to `gpt-5.6-terra` ($2 / $12), or `gpt-6.1-sol` ($2 / $10) under the gpt-6 family | The repair rung is configurable on its own: `AGENTORY_ROUTE_VALIDATION_REPAIR=gpt-6.1-terra` ($1 / $5) |
| — | Added: `claude-haiku-5-5` | $0.10 / $0.01 / $0.125 write / $0.50, >100K tier. Priced for benchmark and accounting; **not routable** until its request shape (adaptive thinking) is wired. |

These are covered by permanent tests in `tests/edge-functions/_shared/workforce/billing.test.ts` (8 tests).

## 3. Hybrid routing: one resolver, two existing seams

`_shared/modelRoutePolicy.ts → resolveTaskRoute(task)` is consulted by:
- **`aiProvider.generateText`**: chat, briefs, plans, LYRA;
- **`gptModelRouter.routeModel` / `escalationRoute`**: the lead and signal pipeline stages and the repair rung.

No second router or gateway was added.

| Variable | Meaning |
|---|---|
| `AGENTORY_HYBRID_ROUTING_ENABLED=true` | Master switch. Unset means today's routing. **Rollback = unset.** |
| `AGENTORY_ROUTE_<TASK>=<model>[:<effort>]` | Per task, independently. Example: `AGENTORY_ROUTE_COMPLEX_COMPANY_QA=gpt-6.1-terra:low`. |
| `AGENTORY_VERIFIED_MODELS=gpt-6.1-terra,…` | Models confirmed callable by this account. Models already in production use are implicit. |
| `AGENTORY_ROUTE_FALLBACK=declared` (default) \| `none` | When a routed call fails: retry once on the task's declared model (recorded), or fail loudly |
| `AGENTORY_ROUTE_MAX_CALLS_PER_RUN=8` | Per-request cap on routed calls |
| Legacy `AGENTORY_TERRA_*` | Still honoured as a Terra-only shorthand |

**Tasks:**
- Complex: `orion_reasoning`, `executive_planning`, `multi_agent_planning`, `complex_company_qa`, `strategic_prioritization`, `evidence_interpretation`, `validation_repair`, `atlas_planning`.
- Benchmark first: `atlas_qualification`, `lyra_content`, `lisa_interpretation`.
- Routine: `simple_chat`, `intent_classification`, `routine_extraction`, `lead_classification`, `signal_processing`, `content_transformation`.

**Allow-list:**
- OpenAI: `gpt-6.1-terra`, `gpt-6-luna`, `gpt-6.1-sol` (no `none`), `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-4.1-mini`.
- Anthropic: `claude-haiku-4-5-20251001`.
- Every allow-listed model must be priced; a test enforces it.

**Refusal reasons** (each one recorded in `routeDecision`):
`disabled`, `no_route`, `unsupported_model`, `unsupported_effort`, `unpriced`, `not_verified`, `invalid_task`, `no_<vendor>_key`, `no_spend_collector`, `no_run_limiter`, `run_call_limit_reached`, `same_as_declared`.

**Guarantees:**
- No silent downgrade: a routed failure either falls back to the task's own declared model (recorded as `*_failed_fell_back`, with telemetry `fallback_reason: routed_attempt_failed`) or fails (`routed_model_failed`).
- Pipeline stages never switch to Anthropic.
- At most two HTTP attempts per call: routed + declared.
- The budget is checked before **every** attempt.
- The actual model and effort are attributed in `lead_model_calls` telemetry.

### Stage → task map (gptModelRouter)

| Stages | Task |
|---|---|
| Planning stages | `atlas_planning` |
| Triage, semantic classification | `lead_classification` |
| Evaluation, qualification, pool evaluation | `atlas_qualification` |
| Grounded evidence | `evidence_interpretation` |
| Summaries | `content_transformation` |
| Signal relevance | `lisa_interpretation` |
| Request understanding | `intent_classification` |
| Evidence planning / extraction | `routine_extraction` |
| Every `*_repair` stage and `escalationRoute` | `validation_repair` |

## 4. ORION integration (prepared, not activated)

| ORION feature | Call site | Task |
|---|---|---|
| Complex business Q&A | `pilot-chat` converse | `orionConverseTask(message)`, which is deterministic: `complex_company_qa` / `strategic_prioritization` / `simple_chat` (small talk never routes) |
| Strategic prioritization | same | `strategic_prioritization` |
| Executive briefings | `daily-brief` | `orion_reasoning` |
| Multi-agent planning | `orchestrate` | `multi_agent_planning` |

**Unchanged:**
- The Company Brain loader (approved memory only).
- Exclusions and ICP.
- Evidence answers, which stay deterministic and never call a model.
- Verification labels.
- Membership and role checks.
- Spend ceiling and per-run limits.
- Workspace isolation.

The routed model receives the **same** system prompt and context as the declared model, so it gets no extra facts and no new tools.

**TEST activation, for your approval only after Stage 1 results.** Set these on TEST, never on production:
```bash
AGENTORY_HYBRID_ROUTING_ENABLED=true
AGENTORY_VERIFIED_MODELS=gpt-6.1-terra
AGENTORY_ROUTE_COMPLEX_COMPANY_QA=gpt-6.1-terra:low
AGENTORY_ROUTE_STRATEGIC_PRIORITIZATION=gpt-6.1-terra:low
AGENTORY_ROUTE_ORION_REASONING=gpt-6.1-terra:low
AGENTORY_ROUTE_MULTI_AGENT_PLANNING=gpt-6.1-terra:low
AGENTORY_ROUTE_MAX_CALLS_PER_RUN=8
# optional, after the benchmark: AGENTORY_ROUTE_VALIDATION_REPAIR=gpt-6.1-terra
```
**Rollback:** unset `AGENTORY_HYBRID_ROUTING_ENABLED`. Every route returns to its declared model on the next request; no deploy is needed.

## 5. Benchmark (ready, NOT run)

**Matrix:**
- 14 fictional tasks covering executive reasoning, executive brief, planning, ATLAS qualification / research, LISA interpretation, LYRA content, structured output, factual reliability (stale + contradicted), ICP Q&A, and memory / exclusions.
- 8 candidates: Haiku 4.5, Luna 5.6, Terra 5.6 `low`, Terra 6.1 `none` / `low` / `medium`, `gpt-6-luna`, Claude Haiku 5.5 (public id and price verified; account access unverified).
- 3 repeats, 0 retries.

**Scoring:** JSON validity, ICP violations, suspected hallucinations, citation accuracy, required points, forbidden recommendations, word limit, an overall `success` flag, latency, tokens (including reasoning), cost, and cost per successful task (`--summarize`). Correctness also gets a blind human grade.

**Why the cap cannot be exceeded:**
- Each call is bounded before it is sent: input ≤ characters + 100 tokens, output ≤ the hard cap sent in the request.
- A call is admitted only if spent + its bound ≤ budget.
- Missing usage is charged at the bound.
- There are no retries.

| Stage | Prompts | Calls | Hard maximum | Cap |
|---|---|---|---|---|
| 1 | fixtures | 336 | **$1.8215** | $2.00 |
| 2 | the same tasks inside Agentory's real system prompts (production-size) | 336 | **$3.6111** | $5.00 (separate approval after Stage 1) |

Manifests (exact models, efforts, full prompts with sha256, repeats, per-call bounds, the approval string and the command): `benchmark-manifest-stage1.json` and `benchmark-manifest-stage2.json`.

**Stage 1 command, awaiting your approval.** It needs the TEST OpenAI key and, for the two Claude candidates, an Anthropic key:
```bash
AGENTORY_MODEL_BENCH_APPROVED="I approve paid model benchmark spend up to \$2.00 for stage 1" \
  deno run --allow-read --allow-env --allow-net=api.openai.com,api.anthropic.com \
  scripts/model-bench/run.ts --live --stage 1 --budget-usd 2.00 > bench-stage1.jsonl
```
Then summarize:
```bash
deno run --allow-read scripts/model-bench/run.ts --summarize bench-stage1.jsonl
```

## 6. Remaining blockers

1. **Account access:** the free `--check-model` must be run by someone holding the TEST OpenAI key.
2. **Approval:** Stage 1 needs your approval ($2 cap). Stage 2 needs a separate approval ($5 cap) after reviewing Stage 1.
3. **Unknown post-promotion Sol price:** it reads `unknown` after 2026-11-30 until recorded.
4. **Haiku 5.5 is benchmark-only:** it needs its request shape (adaptive thinking / effort) wired before it can be routed.
5. **No quality claim is made until the benchmark runs.**

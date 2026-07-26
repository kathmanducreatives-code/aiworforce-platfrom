# Agentory Intelligence Kernel

**Phase 1 — shared contracts, context, planner interface, validation, fallback.**

> **Phase 1 changes no live behavior.** Every feature flag defaults OFF, no edge
> function imports this kernel, and no planner call, capability selection, provider
> input change or new persistence occurs. This document describes what has been
> BUILT, and what must be true before any of it is ENABLED.

---

## 1. Product vision

Today a user's request is compiled by a deterministic parser into a fixed sourcing
strategy. That parser is precise and auditable, and it is also brittle: it can only
recognise what someone has already taught it. A request phrased slightly differently,
or naming a country the lexicon has never seen, is silently narrowed rather than
refused.

The target is to keep the deterministic runtime — which is the part that is correct,
cheap and provable — and put a planning layer in front of it:

```
Original user instruction
  + Company Brain
  + ICP
  + department context
  + approved capabilities
  + budget and approval policy
        ↓
   Agentory Mission
        ↓
   Claude creates a typed strategy
        ↓
   Agentory validates the strategy
        ↓
   Existing deterministic runtime executes it
```

Claude proposes. Agentory decides. Nothing a model returns reaches a provider without
passing deterministic validation, and there is always a deterministic plan to fall
back to.

## 2. Existing Lead runtime (unchanged)

```
structured intent  →  deterministic sourcing strategy  →  provider adapters
                   →  company-first runtime  →  qualification and quota logic
```

Phase 1 replaces none of it. Specifically untouched:
`executeRunAgentCompanyFirstSourcing`, the quota controller, every provider adapter,
qualification, employer verification, task checkpointing, continuation, the canonical
run context, the Workbench adapters, and the deterministic fallback.

## 3. Shared intelligence kernel

All new code lives in `supabase/functions/_shared/intelligence/`:

| Module | Responsibility |
|---|---|
| `mission.ts` | The mission envelope, authority order, geography provenance |
| `missionContext.ts` | Bounded, secret-free Company Brain / ICP projection |
| `capabilityRegistry.ts` | Planner-facing capability keys and the adapter boundary |
| `promptAssembly.ts` | Trusted/untrusted prompt sections and evidence sanitizing |
| `plannerWrapper.ts` | Typed, bounded, timeout-guarded model call with one repair |
| `strategyValidation.ts` | Deterministic policy and execution-safety checks |
| `approvalPolicy.ts` | What is autonomous vs what needs a human |
| `plannerDiagnostics.ts` | Safe, hash-based observability |
| `intelligenceFlags.ts` | Eight flags, all default OFF, plus the geography gate |

## 4. Claude vs Agentory responsibilities

| Claude decides | Agentory decides |
|---|---|
| How to interpret an ambiguous request | Whether the interpretation is allowed |
| Which capability keys to use | What those keys resolve to |
| Search order and phrasing | Budget, limits, quota, qualification |
| What to flag as ambiguous or risky | Whether anything executes at all |

Claude never sees a provider name, an actor id, an API key, a URL or a function name,
and never controls persistence.

## 5. Mission contract

One canonical envelope for all three departments — not three department-specific
ones, because the first cross-department handoff would otherwise need a lossy
translation between shapes that were never reconciled. Variation is carried by
`department` and `requested_outcome`.

Key fields: `original_instruction` (verbatim), `normalized_instruction` (display
only), `workspace_id`, `company_brain`, `icp`, `geography_context`, `parser_context`,
`requested_outcome`, `constraints.hard` / `.soft`, `approval_policy`, `budget`,
`environment.mode`.

## 6. Original-instruction priority

```
1. explicit original user instruction
2. explicit workflow configuration
3. ICP hard constraints
4. ICP soft preferences
5. Company Brain
6. strategy memory
7. model inference
```

A lower source never overrides a higher one, and equal authority never overrides.
`buildMission` stores the user's text byte-for-byte — no trim, no whitespace collapse,
no truncation — and carries the parser's reading in a *separate* `parser_context`
field so a planner can see it without mistaking it for the user's words.

## 7. Company Brain and ICP context

`missionContext.ts` **wraps** the existing loader rather than replacing it. Workspace
scoping and membership verification already exist and are correct in
`getCompiledCompanyBrainForWorkspace.ts`. This layer adds what a planner needs and
the existing loader deliberately does not do:

- bounded lists (20 items), strings (300 chars), description (1 000), total (20 000)
- deterministic ordering, so two loads produce the same prompt and the same input hash
- secret filtering by key shape *and* value shape, at any depth
- an explicit hard-constraint vs soft-preference split
- honest degradation when the Brain or the ICP is missing
- a tenant re-check on the way out (defence in depth)

The `compiled` / `normalized` / `completeness` escape hatches on the canonical brain
are **never** passed through. A planner receives a projection, never a database row.

## 8. Capability registry

A planner selects a **capability key**. It never names what runs.

Phase 1 lead capabilities, each bound to a `verifiedBinding: true` entry in the
existing `actorCapabilityRegistry.ts`:

| Key | Adapter |
|---|---|
| `jobs_search` | `apify_jobs` |
| `people_search` | `apify_people_search` |
| `company_research` | `apify_linkedin_company_details` |
| `contact_enrichment` | `apify_linkedin_company_employees` |
| `company_identity_resolution` | `firecrawl_scrape_url` |

Signals and Content capabilities exist as **definition-only** entries with no adapter
and an empty `enabled_environments`, so they are unselectable by construction. No fake
adapter was created for any of them.

`toPlannerVisible()` is an **allow-list** builder, not a spread-and-delete — so a
field added to the internal capability type later cannot leak into a prompt.

## 9. Planner wrapper

Uses the repository's existing `aiProvider.ts`. **No second Claude integration.**

Version, strict JSON schema, bounded arrays and strings, timeout, one constrained
repair attempt, deterministic validation, safe fallback, latency, model identifier,
input/output hashes, no hidden chain-of-thought persisted.

Two properties worth stating plainly:

- **It never throws.** Timeout, malformed JSON, schema violation, injection, provider
  outage — every failure resolves to a `fallback_*` status with a reason. A planner
  that throws would take down the runtime it exists to advise.
- **A throw is not a timeout.** Provider exceptions are caught before the timeout
  wrapper sees them, so diagnostics distinguish `fallback_provider_error` from
  `fallback_timeout` instead of reporting every network failure as a timeout.

The repair attempt is *constrained*: the model is re-asked with the specific problem
appended and nothing else changed. It is a chance to restate the same plan correctly,
not to plan again. **An injection finding is never repaired.**

## 10. Validation

Shared, deterministic, department-agnostic: instruction preservation, workspace
identity, capability allow-list, environment availability, hard geography
preservation, requested output/count/quota-policy preservation, budget/calls/rounds,
approval-required changes, duplicate strategy hashes, arbitrary URLs, raw actor ids,
credential-like fields, and prompt-injection attempts.

All violations are collected before returning, so one round trip reports the whole
story.

**Deliberately absent: department semantics.** Whether "Revenue Operations" belongs to
the `sales_operations` family is a Lead question already answered correctly by
`jobFamilyRegistry.ts` and `broadeningValidator.ts`. Duplicating that judgement here
would fork it and guarantee the two copies eventually disagree.

## 11. Approval policy

The dividing line is not how large a change is — it is whether it alters *what the
user asked for*.

**Autonomous:** exact synonyms, same-language safe synonyms, local-language
equivalents, search-order changes, more results within budget, an equivalent
pre-approved capability, stronger evidence research, tighter exclusions.

**Approval required:** geography expansion, company-vertical change, material
company-size relaxation, seniority change, adjacent job function, requested-count
change, output-entity change, quota-policy relaxation, qualification relaxation,
current-employer requirement change, budget increase, a materially more expensive
provider, and counting WATCH candidates toward the CONTACT quota.

Two rules make this hold:

- **Default deny.** An unrecognized change kind is `approval_required`, never
  autonomous. A change nobody has classified is a change nobody has reasoned about.
- **Non-waivable kinds.** A workspace may loosen policy for matters of taste, but can
  never pre-authorize a budget increase, a count change, an output-entity change, a
  quota-policy or qualification relaxation, or WATCH-in-CONTACT. Those protect the
  user from the system, so the system does not get to waive them.

Phase 1 builds and tests the policy. Approval *execution* is Phase 2.

## 12. Diagnostics

**No new database table.** A plain object shaped to sit inside the existing
`tasks.result` metadata under one reserved key, merged immutably.

Recorded: mission id, task id, workspace id, department, planner version, model,
provider, input hash, output hash, status, latency, token usage, strategy hash,
validation result, fallback reason, approval requirement, round, estimated cost.

Never recorded: secrets, API keys, raw Company Brain, prompt text, model reasoning,
cross-workspace content. `auditRedaction()` asserts this over produced records, so it
is a check rather than a claim in a comment.

## 13. Feature flags

`CLAUDE_FIRST_LEAD_PLANNING`, `CLAUDE_LEAD_REPLANNING`, `SEMANTIC_TITLE_VALIDATION`,
`GLOBAL_ROLE_PLANNING`, `LEAD_STRATEGY_MEMORY`, `SIGNAL_INTELLIGENCE_KERNEL`,
`CONTENT_INTELLIGENCE_KERNEL`, `CROSS_DEPARTMENT_INTELLIGENCE`.

All follow the existing `signalsV2Flag.ts` convention: default OFF everywhere,
server-side environment only, strict allow-list parsing (`true` / `1` / `enabled`),
injectable reader, fail-closed on error.

With all flags off: no planner call, no capability selection, no new persistence, no
output contract change, no provider input change. Asserted by tests, including one
that reads `run-agent`, `orchestrate` and `pilot-chat` and fails if any of them
imports the kernel.

## 14. Fallback behavior

The deterministic strategy is always available and is used whenever the planner is
disabled, times out, errors, returns malformed or schema-violating output, or returns
anything carrying an injected instruction. Fallback is the *default* path, not an
error path.

## 15. Security

Untrusted: provider results, job descriptions, scraped websites, social posts,
uploaded documents, external evidence.

Untrusted content may never add a capability, alter budget or geography, change
workspace, remove qualification, request secrets, construct provider calls, control
persistence, mark itself qualified, or override the mission.

The defence is structural before it is detective. Five fenced sections, always in this
order: `<system_policy>`, `<mission>`, `<workspace_context>`, `<retrieved_evidence>`
(untrusted), `<output_schema>`. Angle brackets in untrusted content are replaced, so
retrieved text cannot forge a section boundary; control characters are stripped;
newlines and tabs survive, because job descriptions are full of them.

Detection is the second layer, and it **reuses `detectInjection` from
`broadeningValidator.ts`** rather than reimplementing it — one pattern list in the
repository, so a pattern added for the broadening planner protects this path too.
Flagged evidence is **dropped**, not annotated: an annotated instruction is still an
instruction in the context window.

## 16. Cost controls

Capability-level `maximum_results` and `maximum_calls_per_round` ceilings that a
planner cannot raise; mission-level `maximum_calls`, `maximum_estimated_cost_usd` and
`maximum_rounds` enforced by the validator; per-capability cost metadata; bounded
planner output tokens; and `budget_increase` as a non-waivable approval.

## 17. Phase 2 — Lead integration

1. Build the mission inside run-agent from the existing intent compiler output.
2. Call the planner behind `CLAUDE_FIRST_LEAD_PLANNING`, defaulting to the
   deterministic strategy.
3. Validate with the shared validator **plus** a Lead-specific semantic validator that
   composes `jobFamilyRegistry` title validation.
4. Execute the approved strategy through the unchanged company-first runtime.
5. Attach diagnostics to the existing task result.

**Prerequisite: the geography gate in §24.**

## 18. Future — Signals integration

Same mission, `department: "signals"`, `requested_outcome` describing a monitoring
window. Capability definitions exist; adapters do not. Gated by
`SIGNAL_INTELLIGENCE_KERNEL`.

## 19. Future — Content integration

Same mission, `department: "content"`. Content planning needs evidence retrieval and
claim verification before drafting, which is why `content_claim_verification` is a
first-class capability rather than a drafting side effect. Gated by
`CONTENT_INTELLIGENCE_KERNEL`.

## 20. Cross-department handoffs

One mission contract is what makes a handoff possible without translation: Signals
finds an account → a Leads mission is built for it → Content drafts against the same
Company Brain projection. Gated by `CROSS_DEPARTMENT_INTELLIGENCE`.

## 21. Existing-code reuse map

| Existing path | Exported symbol | Current responsibility | Phase 1 responsibility | Disposition |
|---|---|---|---|---|
| `_shared/aiProvider.ts` | `generateJson`, `GenerateOpts`, `GenerateResult` | Provider abstraction (Lovable + Anthropic) | The only thing that speaks to a model | **Reused unchanged** |
| `_shared/getCompiledCompanyBrainForWorkspace.ts` | `getCompiledCompanyBrainForWorkspace`, `CanonicalCompanyBrain` | Brain load + workspace/membership scope | Supplies the brain to project | **Wrapped** |
| `_shared/companyBrainContext.ts` | `buildCompanyBrainContext`, `brainICP` | Prompt-safe brain block for agents | Prior art for bounding | **Reused unchanged** |
| `_shared/companyBrainIcp.ts` | `deriveCompanyIcp`, `DerivedCompanyIcp` | ICP derivation | ICP shape reference | **Reused unchanged** |
| `_shared/actorCapabilityRegistry.ts` | `ACTOR_CAPABILITIES`, `getActorCapability`, `isCallable` | What each actor proves and costs | Binding target behind the boundary | **Extended (projected)** |
| `_shared/actorRegistry.ts` | actor keys / implementation ids | Canonical actor identity | Never exposed to a planner | **Reused unchanged** |
| `_shared/broadeningValidator.ts` | `detectInjection`, `validateRoundPlan` | Broadening validation + injection defence | Injection patterns reused verbatim | **Reused unchanged** |
| `_shared/broadeningPlannerAdapter.ts` | `createBroadeningPlanner` | The existing narrow Claude planner | Prior art; superseded only in Phase 2 | **Reused unchanged** |
| `_shared/sourcingConstraints.ts` | `HardConstraints`, `hashHardConstraints`, `APPROVED_ACTOR_KEYS` | Hard/soft constraint model | Constraint-preservation reference | **Reused unchanged** |
| `_shared/planHash.ts` | `canonicalJson`, `sha256Hex`, `shortHash` | Canonical hashing | Mission/strategy/diagnostics hashing | **Reused unchanged** |
| `_shared/signalsV2Flag.ts` | `EnvReader`, strict parse convention | The one flag convention | Convention followed exactly | **Reused unchanged** |
| `_shared/jobIntentTaxonomy.ts` | `compileJobIntent`, `inferGeography` | Deterministic intent compilation | Feeds `parser_context` (advisory) | **Reused unchanged** |
| `_shared/jobFamilyRegistry.ts` | `validateTitleForFamily` | Title/family semantics | Phase 2 semantic validation | **Reused unchanged** |
| `_shared/qualifiedLeadRouting.ts` | `routeQualifiedLead`, quota contract | Routing + CONTACT-only quota | Preservation targets in validation | **Reused unchanged** |
| `_shared/taskStatusContract.ts` | `projectStatus`, `readStatuses` | Task lifecycle separation | Diagnostics sit beside it | **Reused unchanged** |

Nothing was duplicated under a new name. Two near-misses worth naming: the capability
registry is a **projection** over `actorCapabilityRegistry.ts`, not a second registry;
and injection detection is **imported**, not re-derived.

## 22. Migration sequence

1. **Phase 1 (this branch)** — kernel, flags OFF, unwired. No migration, no deploy.
2. **Fix the geography defect** (§24). Prerequisite for Phase 2 activation.
3. **Phase 2** — wire the Lead planner behind its flag; enable in TEST only.
4. **Phase 3** — semantic title validation, strategy memory.
5. **Phase 4** — global geography normalization; `GLOBAL_ROLE_PLANNING`.
6. **Phase 5** — Signals and Content kernels, with real adapters.
7. **Phase 6** — cross-department handoffs.

No database migration is introduced by Phase 1.

## 23. Test strategy

Offline and deterministic. The model is mocked in every planner test; there are no
live model calls, provider calls, database reads or writes anywhere in the suite.

122 tests across eight files cover: mission creation, verbatim instruction
preservation, parser-context separation, explicit geography outranking parser
inference, unresolved explicit geography retention, Company Brain and ICP loading,
tenant isolation, context size limits, secret removal, deterministic ordering,
capability validation (unknown / disabled / wrong-department / unavailable-environment
/ limits / cost / determinism / no secrets), planner schema, invalid output, timeout,
repair, fallback, hard-constraint / budget / output-entity / requested-count
preservation, approval detection, prompt injection, all-flags-off, and the
behavior-preservation proof.

## 24. Geography gate before Phase 2 activation

`inferGeography` in `jobIntentTaxonomy.ts` resolves only US states plus
`/\b(united states|usa|u\.s\.|\bus\b)\b/`. Two consequences:

1. Every non-US location — Germany, the UK, Canada, India — resolves to `[]`.
2. The `\bus\b` alternative matches the **pronoun**:

```
"Show us founders in Germany hiring RevOps"  →  ["United States"]
"Find us 5 leads in France"                  →  ["United States"]
```

Under the deterministic runtime this narrows a search. Under Claude-first planning it
becomes a correctness bug with a far larger blast radius: the planner would receive
parser output confidently asserting a country the user never named, and plan against
it.

The mission contract already defends against this — explicit user wording is kept
separate from and authoritative over parser output, and
`resolveGeographyAuthority()` refuses to let parser locations contribute when the user
named any location. **That is what makes Phase 1 safe to build.**

It is not what makes Phase 2 safe to enable. The contract prevents the planner from
*trusting* bad parser output; it does not repair the output, and it does not help a
non-US request that produced no geography at all.

> **Gate:** the lowercase `us` false positive must be removed before
> `claude_first_lead_planning` can be enabled.

This is a prerequisite to **enabling Phase 2**, not to building Phase 1. Full
worldwide geography normalization is Phase 4; removing the false positive is a
small, separate fix. Explicit original geography must never be overwritten.

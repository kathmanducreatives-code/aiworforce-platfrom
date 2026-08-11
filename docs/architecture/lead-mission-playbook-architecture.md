# Lead Mission → Research Playbook Architecture

**Phase 3a — the supported hiring playbook is wired.** The playbook is now the
explicit boundary between `LeadMissionV1` and execution, for the hiring shape
only. `funding`, `social`, `news` and `multi_signal` are untouched: the boundary
returns `applies: false` for them and their execution behaves exactly as before.

Base: `a1dc649e` (Phase 2) → `c86df417` (Phase 2.5 hardening) on
`feat/lead-mission-v1`.

---

## 1. The pipeline

```
USER REQUEST  (the user's own sentence, verbatim)
      ↓
GPT MISSION COMPILER                     leadMissionCompiler.ts
      ↓
LeadMissionV1                            leadMission.ts
      ↓
MISSION VALIDATION                       validateLeadMission
      ↓
RESEARCH PLAYBOOK SELECTION              leadResearchPlaybooks.ts   ← this doc
      ↓
PLAYBOOK CONTRACT (ResearchPlaybookSelection)
      ↓
CAPABILITY REQUIREMENTS                  leadCapabilityGraph.ts
      ↓
PLAYBOOK AUTHORIZATION                   leadPlaybookExecution.ts
      ↓                                  (hiring only — see §6)
PAID EXECUTION PREFLIGHT                 leadPaidExecutionPreflight.ts
      ↓
CAPABILITY EXECUTION                     leadCapabilityEngine.ts
      ↓
PROVIDER / ACTOR                         hiringActorCatalog.ts
```

Four rules hold throughout, and each has a test:

1. **Raw text is not reinterpreted after Mission compilation.** The Mission is
   the only semantic authority. Playbook selection reads three typed Mission
   fields and never touches `original_user_query`.
2. **Playbooks are research workflows, not actors.** A playbook names
   capabilities. It survives an Actor being swapped, repriced or retired.
3. **Capabilities are implementation-level abilities.** `CAPABILITY_REGISTRY` owns
   them and what each may reach.
4. **Providers/actors are implementations of capabilities.** They are named only
   in the registry and in `hiringActorCatalog`.

---

## 2. The two strategy vocabularies

The name `strategy` denoted **three** unrelated things before this phase. They
are now documented and separated.

| Concept | Values | Meaning | Reads it |
|---|---|---|---|
| **`MISSION_STRATEGIES`** | `hiring`, `funding`, `social`, `news`, `supplied_company`, `multi_signal` | **The canonical research shape.** User-level; the model decides it; one strategy → one playbook. | `selectResearchPlaybooks` |
| `directives.source_strategy` (`SOURCE_STRATEGIES`) | `startup_cohort_first`, `job_signal_first`, `company_profile_first`, `known_companies_only`, `evidence_reuse_first` | **An execution preference** — which approved source to reach for first, for a shape already chosen. | `buildCapabilityGraph` (one value only) |
| `SourceStrategy` in `leadIntentModel` | `account_first`, `profile_first` | Legacy DTO field on `SeparatedIntent` + the canonical run-trace stamp. Not a research shape. | `leadCanonicalStamp` run trace |
| `source_strategy_adjustment` (`roundPlanContract`) | free text | A round-to-round broadening hint. Unrelated. | multi-round planner |

**The canonical semantic route is `MISSION_STRATEGIES`.**

`source_strategy` is an execution preference and stays on `LeadMissionV1.directives`,
where it belongs. Three of its five values imply no research shape at all — which
is what an execution hint should look like. Two do:

| `source_strategy` | implies shape |
|---|---|
| `job_signal_first` | `hiring` |
| `known_companies_only` | `supplied_company` |
| `startup_cohort_first` | — (source preference) |
| `company_profile_first` | — (source preference) |
| `evidence_reuse_first` | — (source preference) |

### The second routing authority, and how it is being retired

`buildCapabilityGraph` reads `job_signal_first` when choosing an entry capability.
A mission may therefore declare `strategies: ["funding"]` while its directives say
`job_signal_first`, and today the graph routes the hiring shape with nothing
recording the disagreement.

`selectResearchPlaybooks` **does not read `source_strategy` to select**. When the
caller supplies directives it reports the disagreement as a
`routing_conflicts` entry. That makes the conflict measurable in production
before Phase 3 removes the graph's use of it — retiring it on data rather than on
assumption. Changing the graph now would change execution, which this phase does
not do.

---

## 3. `expansion` — resolved as a SIGNAL, not a strategy

`required_signals[].type` is an **open** vocabulary; `MISSION_STRATEGIES` is a
**closed** one. They answer different questions, and the dividing line is which
half of the research a signal belongs to:

- **`discovery_shape`** — there is a source you can search to *enumerate*
  companies that have the signal, so it can be a research workflow of its own.
  Only `hiring` and `funding` qualify.
- **`qualifier`** — the signal is something you *prove* about companies you
  already found. There is no "list the expanding companies" source.

`expansion` is a **qualifier**. Evidence, from the code:

- The registry gives it `expansion_signal_verification` — a *verification* stage,
  applied to a set discovery produced.
- Its nominal discovery entry `expansion_signal_discovery` points at
  `apify_linkedin_company_search`, a company-profile search with **no expansion
  filter**. The "discovery" is a general company search wearing an expansion label.
- Neither of its capabilities is engine-driven.
- Promoting it would oblige `leadership_change`, `technology` and `product_launch`
  to become strategies too — the thirty-name taxonomy `leadCapabilityGraph`'s own
  header rejects.

**Consequence:** a mission whose only signal is a qualifier selects no playbook
and reports `ok: false` with `qualifying_signals: ["expansion"]`. That is the
honest answer — nothing can discover companies for it — and it is reported rather
than rounded to `hiring`. Unrecognised signal types default to `qualifier`: an
unknown signal is at most something to prove, never a licence to invent a
discovery source.

`expansion` was **not** added to `MISSION_STRATEGIES`.

---

## 4. The Playbook contract

`ResearchPlaybookSelection`, version `lead-research-playbook-v2`.

| Field | Answers |
|---|---|
| `playbooks[]` | **Every** shape the mission asked for — with `status`, `gaps`, `requirements`, `selected_by`, `reason` |
| `runnable[]` | Which of them can actually run today |
| `blocked[]` | Which cannot, with gaps, `unwired_actor_keys` and notes |
| `unknown_strategies[]` | Strategy values outside the vocabulary |
| `qualifying_signals[]` | Signals that are qualifiers, not shapes |
| `combination` | `single` / `all_must_hold` / `any_may_satisfy` / `none` |
| `strategy_source` | `mission_strategies` / `derived_from_mission_fields` / `none` |
| `routing_conflicts[]` | `source_strategy` hints disagreeing with the Mission |
| `ok` | Is the request answerable today |
| `reason` | Why, in one line, for the audit row |

`requirements[]` per playbook is the Phase 3 hand-off:

```ts
{ capability, role: "discovery" | "proving", providers: string[], engine_driven: boolean }
```

### Inputs

Exactly three Mission fields, named in the function's own type so a later edit
cannot quietly add a fourth:

```ts
Pick<LeadMissionV1, "strategies" | "required_signals" | "company_profile">
```

`directives.source_strategy` may be supplied for **conflict detection only**.

Precedence: a declared `strategies` value outranks anything derivable. With no
declared strategy, the shape is derived from `known_companies` and from
discovery signals — still Mission fields, never text.

### `multi_signal`

Not a sixth playbook. The Mission's own contract defines it as "two or more of
the others holding TOGETHER", so it is a **combination rule**: `combination:
"all_must_hold"`, and `ok` is true only when **every** named shape is supported.
A conjunction with one runnable half is `ok: false` — delivering that half as
though it were the answer is the silent substitution this boundary prevents.

### Discovery is a *list*, not a single entry

`discovery_capabilities` is ordered, most-specific-first, because the capability
graph legitimately refines the entry by company profile: a hiring mission
targeting startups enters at `startup_company_discovery`, one targeting
manufacturers at `general_company_discovery`. Both are the hiring playbook.
Naming one entry would either contradict the graph or duplicate its refinement.

---

## 5. Support matrix — traced through real code

"Supported" means **the capability engine actually drives it**. For a task
carrying a `LeadMissionV1`, `runCapabilityPlan` claims execution outright
("the capability graph is the state machine"), so a capability the engine does
not implement returns `skipped_no_input` and produces nothing — however many
providers its registry entry lists.

The engine drives **10 of 16** capabilities. It explicitly skips six:
`known_company_resolution`, `job_discovery`, `funding_signal_discovery`,
`expansion_signal_discovery`, `job_deduplication`, `expansion_signal_verification`.

| Strategy | Playbook | Capability | Engine-driven | Provider | Executable | Status |
|---|---|---|---|---|---|---|
| `hiring` | `hiring` | `startup_company_discovery` | ✅ | `apify_yc_companies_memo23`, `…_solidcode` | ✅ compiled input | **SUPPORTED** |
| | | `general_company_discovery` | ✅ | `apify_linkedin_company_search` | ✅ compiled input | |
| | | `hiring_verification` | ✅ | `apify_linkedin_job_search` (+ free YC openJobs) | ✅ | |
| `funding` | `funding` | `funding_signal_discovery` | ❌ skipped | `apify_yc_companies_memo23` | ❌ | **UNSUPPORTED** |
| `supplied_company` | `supplied_company` | `known_company_resolution` | ❌ skipped | *(none — 0-cost by design)* | ❌ | **UNSUPPORTED** |
| `social` | `social` | *(none defined)* | — | 4 registered, unbound | ❌ | **UNSUPPORTED** |
| `news` | `news` | *(none defined)* | — | 4 registered, unbound | ❌ | **UNSUPPORTED** |
| `multi_signal` | *combination rule* | — | — | — | — | **N/A** |
| `expansion` | *not a strategy* | `expansion_signal_discovery` / `_verification` | ❌ skipped | `apify_linkedin_company_search` | ❌ | **QUALIFIER** |

**Only `hiring` is genuinely supported today.** Phase 2 reported `funding` and
`supplied_company` as supported; that was wrong — it tested "a capability exists
and names providers" rather than "an implementation runs it". The test
`the engine-driven capability list matches the engine's own source` re-derives
the list from `leadCapabilityEngine.ts` so this cannot drift back into a
comfortable fiction.

### Gaps behind each unsupported shape

- **`funding`** — the deeper problem is not just the engine skip.
  `funding_signal_discovery` is declared with `apify_yc_companies_memo23`, whose
  verified input schema (`compileMemo23YcInput`) has **no funding field at all**:
  mode, industries, sizes, batch, regions, `isHiring`. YC batch membership is a
  funding *proxy*, not a funding search. This shape needs a real funding source.
- **`supplied_company`** — the downstream pipeline (identity, enrichment,
  qualification) *is* engine-driven; only resolution of the supplied list is not,
  so the shape currently starts with an empty company set.
- **`social`** — `apify_linkedin_posts`, `apify_linkedin_company_posts`,
  `apify_linkedin_profile_posts`, `apify_linkedin_post_comments` are registered
  and runtime-gated, and pilot-chat's `signal_sourcing` branch already drives
  them for the **social workflow** — a different product surface. No lead
  capability names them, so no lead mission can reach them.
- **`news`** — `apify_google_search`, `search_web`, `firecrawl_scrape_url`,
  `apify_website_content` exist; none is bound to a news discovery capability,
  and a general web search is not a news source.

### `social_posts` as an output

`RequestedOutput.social_posts` can express "posts are the artefact", but
`TARGET_ENTITY_FOR_OUTPUT` maps it to `person` because the entity enum has no
post value. That mapping is **provisional** and is recorded in the `social`
playbook's notes. A mission may therefore *state* a social request honestly while
neither its output entity nor its research shape can be executed.

---

## 6. The execution boundary (Phase 3a)

```
LeadMissionV1
     ↓
selectResearchPlaybooks(mission)        → ResearchPlaybookSelection
     ↓                                     buildCapabilityGraph(mission) → CapabilityPlan
     ↓                                     ↓
authorizePlaybookExecution(selection, plan, mission)
     ↓
PlaybookAuthorization  → buildPaidExecutionPreflight({ …, playbook })
     ↓
assertPaidExecutionAllowed → runCapabilityPlan
```

`authorizePlaybookExecution` (`leadPlaybookExecution.ts`) answers the last
question before money moves: **is the plan about to execute the research shape
that was selected?** It authorises; it does not route. The graph still builds the
plan.

### What it governs

`applies: true` only for a **hiring-only** selection — `runnable === ["hiring"]`
with nothing blocked. Every other mission gets `applies: false` and is inert.
A *mixed* selection (hiring alongside an unsupported shape) is deliberately not
governed either: deciding what to do about a half-answerable request is the next
phase's question.

### What it authorises

| Plan entry | Verdict |
|---|---|
| `startup_company_discovery` / `general_company_discovery` | `playbook_discovery` — the playbook's own |
| `known_company_resolution` when `known_companies` is non-empty | `mission_forced` — the mission demanded it |
| `job_discovery` when `requested_output === "job_listings"` | `mission_forced` — postings are the answer |
| anything else | **unauthorized** |

Plus: every capability the playbook requires *and the plan schedules* must be
engine-driven.

### The divergence it catches

A mission with `strategies: ["hiring"]` that also carries a funding signal and no
compiled capabilities enters at `funding_signal_discovery` — which the engine
**skips**. Before this boundary that run reported success having discovered
nothing. It is now refused at the paid gate with `playbook_not_authorized`.

That is a hiring-strategy mission being misrouted, not a change to funding
execution: a mission whose *strategy* is funding is not governed at all.

## 7. What this phase deliberately did not do

- No execution for `funding`, `social`, `news` or `multi_signal`. A test asserts
  the boundary adds no preflight block for any of them.
- No change to `buildCapabilityGraph`. Its use of `job_signal_first` is recorded
  as a conflict, not removed — removing it changes execution.
- No new capability, provider or Actor. Nothing was marked supported to make a
  test green.

---

## 8. Remaining decisions before the next phase

1. **Which shapes does Phase 3 make executable first?** Only `hiring` runs today.
   `supplied_company` is the cheapest to close (resolution of a supplied list is
   deterministic work); `funding` needs a real funding source; `social` and `news`
   need a capability *and* a provider binding.
2. **`funding`'s source.** YC batch membership is not a funding search. This needs
   a product decision about what a funding signal is allowed to be.
3. **Retiring `job_signal_first` from `buildCapabilityGraph`.** Safe once
   `routing_conflicts` has shown production data on how often the two disagree.
4. **`social_posts` → `target_entity`.** The entity enum needs a post value, or
   the output value needs to stop implying an entity.

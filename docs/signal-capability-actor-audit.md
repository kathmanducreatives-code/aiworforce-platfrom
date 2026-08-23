# Agentory Signal / Capability / Actor Audit

**Phase 0 — audit before implementation.**

Branch `feat/lead-mission-v1` @ `4e897c99` · worktree `/Users/prasidha/agentory-main-local`
Baseline suite: **5262 passed, 0 failed** (`deno test --allow-read --allow-env --no-check tests/edge-functions/`, 17s)
No production code modified.

Every claim in this document was derived by **executing** the repository's own modules offline, not by reading them. The scripts are reproducible and are listed in [Appendix A](#appendix-a--reproduction).

---

## 00 · Sync verification

### Correction to the handoff

The session's stated working directory, `/Users/prasidha/claudecode-agentory`, contains nothing but a `.claude/launch.json`. It is not a git repository and holds no Agentory code.

Three other checkouts named "agentory" share the remote `remix-of-remix-of-screeningpilot`, and **none of them contains commit `4e897c99`** — on that remote, `feat/lead-mission-v1` points at an unrelated `9974f7c3`. Taking the handoff at face value would have put this work in the wrong repository.

The real tree is **`/Users/prasidha/agentory-main-local`** — a linked git worktree of `/Users/prasidha/screeningpilot/screeningpilot`, on remote `aiworforce-platfrom.git`. There, everything the handoff claims holds exactly:

```
branch                                    feat/lead-mission-v1
HEAD                                      4e897c99
git status                                nothing to commit, working tree clean
git rev-list --left-right --count
  HEAD...origin/feat/lead-mission-v1      0    0
```

All work below is in that worktree.

---

## 01 · Current signal architecture

There is no single signal vocabulary. There are **six**, defined in six modules, joined by hand-written switch statements and synonym tables. Each layer re-states what a signal is, and they disagree.

| Vocabulary | Defined in | Members |
|---|---|---|
| `MISSION_SIGNAL_TYPES` | `leadMission.ts` | hiring · funding · expansion · leadership_change · technology · product_launch |
| `LeadSignalType` | `leadEntityIntent.ts` | hiring · funding · product_launch · expansion · **new_executive** · **recent_post** |
| `EvidenceCategory` | `evidenceContract.ts` | job_signal · funding_signal · launch_signal · expansion_signal · founder_activity_signal · gtm_signal (+8 identity/fit) |
| `EvidenceType` | `evidenceType.ts` | job_post · funding_announcement · intent_post · **comment** · product_launch · hiring_page · company_page · person_profile · company_news |
| `ScenarioId` | `discoveryScenarioMatrix.ts` | 30 scenarios across hiring, funding, social, news, discovery, technology, corporate events |
| `ActorCapability` | `apifyIntelligenceRegistry.ts` | company_discovery · company_enrichment · hiring_signal · funding_signal · news_signal · social_activity · technology_signal · person_discovery · person_enrichment |

Only `hiring` and `funding` appear, unchanged, in all six.

### The joins between them are lossy, and the loss is measurable

```
token                inMission  inIntent   evidenceCat                scenarios                      runnable
------------------------------------------------------------------------------------------------------------
hiring               true       true       job_signal                 hiring_engineers               3 actors
funding              true       true       funding_signal             recent_funding                 NONE
expansion            true       true       expansion_signal           expansion_signals              NONE
leadership_change    true       false      NULL                       founder_announcements          NONE
technology           true       false      NULL                       technology_stack_verification  NONE
product_launch       true       true       launch_signal              product_launches               NONE
new_executive        false      true       gtm_signal                 NONE                           NONE
recent_post          false      true       founder_activity_signal    NONE                           NONE
```

Three defects are visible in that table alone:

- `leadership_change` and `technology` return `NULL` from `signalToEvidenceCategory()`, so they **can never become a timing requirement** in a compiled evidence contract. The mission may require them; the contract cannot express them.
- `new_executive` and `recent_post` exist in the intent layer but in no mission vocabulary and no scenario, so they resolve to nothing at both ends.
- Every signal except `hiring` resolves to **zero runnable actors**.

### Normalization silently discards the request's specificity

```
"currently hiring"        -> hiring            IN-VOCAB     runnable: 3 actors
"enterprise sales hiring" -> hiring            IN-VOCAB     runnable: 3 actors   <- role lost
"recently funded"         -> recently funded   UNRECOGNISED runnable: NONE       <- near-miss dropped
"funding round"           -> funding           IN-VOCAB     runnable: NONE
"US expansion"            -> expansion         IN-VOCAB     runnable: NONE       <- topic lost
"leadership posts"        -> leadership posts  UNRECOGNISED runnable: NONE
"company posts"           -> company posts     UNRECOGNISED runnable: NONE
"comments"                -> comments          UNRECOGNISED runnable: NONE
"headcount growth"        -> headcount growth  UNRECOGNISED runnable: NONE
"GTM growth"              -> GTM growth        UNRECOGNISED runnable: NONE
"office opening"          -> office opening    UNRECOGNISED runnable: NONE
"AI adoption"             -> AI adoption       UNRECOGNISED runnable: NONE
```

`MissionSignal.type` is a single scalar. It cannot hold the three facts a B2B signal actually carries — **what happened** (a post), **to whom** (a leader, not the company), and **about what** (US expansion). "Enterprise sales hiring" and "leadership posted about US expansion" both collapse to one word, and the rest is gone before any planner sees it.

Role specificity survives only by a *separate* route: `MissionSignal.role_families` plus `required_signal_terms`, consumed at qualification by `missionQualificationContext.ts`. That route is real and works well (see §04), but it is parallel to the signal type, not part of it, and it exists for roles only. There is no equivalent for topics, geographies, or the subject of a social signal.

---

## 02 · Current capability graph

The graph is two-tiered, and the separation is genuinely well made. The **public catalogue** is the only vocabulary the model can write into; deterministic code alone expands it onto internal stages and approved actor keys. There is no field anywhere in which a model can name an actor.

| Public capability | Kind | Paid | Internal stages |
|---|---|---|---|
| `startup_company_discovery` | execution | yes | `startup_company_discovery` |
| `general_company_discovery` | execution | yes | `general_company_discovery` |
| `known_company_identity_resolution` | execution | yes | `known_company_resolution`, `company_identity_resolution` |
| `company_details_enrichment` | execution | yes | `company_enrichment` |
| `embedded_hiring_evidence` | free_evidence | no | — (free branch) |
| `external_hiring_verification` | execution | yes | `hiring_verification` |
| `company_semantic_evaluation` | execution | no | `company_brain_qualification` |
| `portfolio_ranking` | execution | no | `persistence` |
| `offer_founder_unlock` | offer | no | — (runs nothing) |
| `offer_contact_unlock` | offer | no | — (runs nothing) |

`assertOffersRunNothing()` returns `[]` — verified by execution. The people stages are unreachable from any public capability.

### The central gap

**Of ten public capabilities, exactly two concern a signal, and both are hiring.** There is no vocabulary in which a planner can request funding evidence, a company post, a leadership post, an expansion proof, headcount growth or a product launch. The model cannot ask for them, so it cannot plan them, and nothing downstream can be asked to supply them.

### The internal graph claims more than the actors can do

Internally, `CAPABILITY_REGISTRY` declares three signal stages beyond hiring. Each declares providers that structurally cannot produce the evidence the stage requires:

| Internal stage | Declared providers | `evidence_required` | Can the provider produce it? |
|---|---|---|---|
| `funding_signal_discovery` | `apify_yc_companies_memo23` | `company_name`, `funding_event` | **No.** A YC directory scraper. Its verified output list contains no funding event, date or amount. |
| `expansion_signal_discovery` | `apify_linkedin_company_search` | `company_name` | **No.** Its own card declares `not_for: ["semantic/concept search"]`. It matches company *names*; it cannot enumerate expanding companies. |
| `expansion_signal_verification` | `apify_linkedin_job_search` | `location_evidence` | **No.** A job search actor. A job posting's location is not evidence of market expansion. |

The containment guard, `assertProviderAllowed()`, checks that an actor is declared by the capability it runs under. It cannot check that the actor can produce the evidence the capability claims. **The guard is sound; the data it guards is untruthful.** These three stages will pass containment, spend credits, and return nothing that satisfies the signal.

---

## 03 · Current actor coverage

`HIRING_ACTOR_CATALOG` is the executability boundary: an actor absent from it has no repo key, so `toRepoKey()` returns null and no capability can call it. **Seven actors are executable.**

| Repo key | Store id | Scope | Role | Signals it can evidence |
|---|---|---|---|---|
| `apify_yc_companies_memo23` | `memo23/y-combinator-scraper` | Company · **YC cohort only** | Discovery + embedded hiring | hiring (via `isHiring`, `openJobs[]`) |
| `apify_yc_companies_solidcode` | `solidcode/ycombinator-scraper` | Company · **YC cohort only** | Discovery (fallback) | — |
| `apify_linkedin_company_search` | `harvestapi/linkedin-company-search` | Company | Discovery (name index) | — |
| `apify_linkedin_company_details` | `harvestapi/linkedin-company` | Company | Enrichment only | — (firmographics) |
| `apify_linkedin_job_search` | `harvestapi/linkedin-job-search` | Company-scoped | Verification only | hiring |
| `apify_linkedin_company_employees` | `harvestapi/linkedin-company-employees` | **Person** | Founder discovery *(unlock)* | leadership identity |
| `apify_people_search` | `harvestapi/linkedin-profile-search` | **Person** | Founder discovery *(unlock)* | leadership identity |

Two of seven are person-scoped and reachable only through an explicit, credit-reserved unlock. Neither can be scheduled by a plan.

### Known but not executable — described only

The intelligence registry documents eight further actors that **no capability declares**, so calling one would bypass containment. These are precisely the actors every non-hiring signal depends on:

| Store id | Would serve | Scope | Status |
|---|---|---|---|
| `memo23/crunchbase-scraper` | funding event, round type, investors | Company | No repo key; amount gated behind session cookie |
| `data_xplorer/google-news-scraper-fast` | funding, expansion, launch, acquisition, news | Company | No repo key |
| `harvestapi/linkedin-company-posts` | company post activity | **Company** | No repo key; consumes URLs, cannot find them |
| `harvestapi/linkedin-profile-posts` | leadership post activity | **Person** | No repo key; requires identified profile URL |
| `harvestapi/linkedin-post-search` | topic-scoped post discovery | Mixed | No repo key |
| `builtwith/builtwith-official-technology-scraper` | technology verification | Company | No repo key; domain in → stack out, no reverse lookup |
| `apidojo/google-search-scraper` | SERP fallback | Mixed | No repo key |
| `haketa/ycombinator-companies-scraper` | YC discovery, 76 named regions | Company · YC | No repo key |

Four further job-board keys — `apify_jobs`, `apify_linkedin_jobs_crawlworks`, `apify_indeed_jobs_automation_lab`, `apify_glassdoor_jobs` — are declared by `job_discovery` but are **uncarded**: no verified schema, so no bounded input can be compiled and no cost estimated. The graph's own comments acknowledge this and route around them.

### Answers to the ten audit questions

| # | Question | Answer |
|---|---|---|
| 1 | What signals already exist? | Six named in `MISSION_SIGNAL_TYPES`; ~30 scenarios in the matrix; nine evidence categories. |
| 2 | Which are names only? | **Five of six.** funding, expansion, leadership_change, technology, product_launch all resolve to zero runnable actors. |
| 3 | Which have actual actors? | **Hiring only**, plus company discovery/enrichment which are not signals. |
| 4 | Company-level actors? | Five of seven (memo23, solidcode, company_search, company_details, job_search). |
| 5 | Person-level actors? | Two (company_employees, people_search) — both unlock-gated. |
| 6 | Discovery vs verify/enrich? | Discovery: memo23, solidcode, company_search. Verify: job_search. Enrich: company_details. Person discovery: the two unlock actors. |
| 7 | Real evidence semantics? | Hiring only — dated job title + employer + role-family match, with a mandatory post-filter. |
| 8 | Currently impossible? | Company posts, leadership posts, comments/engagement, headcount growth, GTM growth, office openings, US expansion, product launch, technology adoption, funding amount. |
| 9 | Hiring special-casing to generalise? | Evidence-required-per-stage, embedded-vs-paid free branch, actor cards with `not_for`, deterministic post-filter, role-family qualification, coverage reporting. |
| 10 | What stays hiring-specific? | Role-family taxonomy and fuzzy-title post-filtering; the `openJobs[]` embedded free branch; "dated open role" as the proof shape. |

---

## 04 · Hiring as reference architecture

Hiring works because six things are true of it that are true of no other signal. These are the reusable patterns — and they are patterns about **proof discipline**, not about job postings.

**1 — The actor card tells the truth.**
Verified schema, verified enums, input limits, real output fields, cost model, and `known_defects` with evidence references. `apify_linkedin_job_search` records that `jobTitles` is fuzzy ("Sales Operations Manager" returned "Operation Manager Trainee"), that the posting company is not necessarily the employer, and that 25% of rows in one pack were duplicates. Each defect carries a mitigation and a run reference. **This is the single most valuable pattern in the repository** and it generalises to every actor.

**2 — Free evidence before paid evidence.**
`embedded_hiring_evidence` maps to no internal stage at all. YC's `openJobs[]` answers the hiring question at zero cost, and paid verification is requested only when embedded evidence would be missing, stale or ambiguous. Every signal needs this split.

**3 — Evidence required per stage.**
`evidence_required: ["job_title", "posted_date"]`. A stage declares what it must produce for the next stage to be legitimate. Undated evidence is not hiring evidence.

**4 — Deterministic post-filter after a fuzzy provider.**
`hiringRolePackFilter` is mandatory because the provider's own search is fuzzy. Provider output is a candidate, never a verdict.

**5 — Role specificity at qualification.**
`role_families` + `required_signal_terms` → `missionQualificationContext`. `sales_operations` is deliberately not part of `gtm_sales`, so a Sales-Ops request is never widened into quota-carrying SDR roles. This is the mechanism that makes "enterprise sellers ≠ software engineers" enforceable — and it currently exists only for roles.

**6 — Coverage is reported, not enforced.**
A signal with no actor does not refuse the mission; it produces a shortfall statement. The right call, and the right shape for every signal. The defect is not the policy; it is that the report is computed from the wrong inputs (§06).

**What must not be generalised:** the proof shape. A funding event is a dated third-party record with a round type; a leadership post is an identified person plus a dated post plus a topic; an expansion claim is a stated new market. Forcing these into "a dated open role at an employer" would reproduce exactly the conflation that `expansion_signal_verification` already commits.

---

## 05 · Signal coverage matrix

Verdicts are derived by executing `coverMissionSignals()`, `executableScenarioActors()` and `buildCapabilityGraph()` — not asserted. **Supported** means an actor that can genuinely produce the evidence is reachable by a declared capability today.

| Signal | Scope | Discovery | Verification | Runnable actors | Verdict |
|---|---|---|---|---|---|
| `currently_hiring` | Company | Yes — YC cohort embedded | Yes — job_search | 3 | **SUPPORTED** |
| `role_specific_hiring` | Company | Partial | Yes + post-filter | 3 | **SUPPORTED** |
| `sales_hiring` | Company | No — YC has zero GTM-Ops coverage | Yes | 3 | **PARTIAL** |
| `engineering_hiring` | Company | Yes | Yes | 3 | **SUPPORTED** |
| `recent_funding` | Company | No | No | 0 | **UNSUPPORTED** |
| `funding_round` | Company | No | No | 0 | **UNSUPPORTED** |
| `funding_recency` | Company | No | No | 0 | **UNSUPPORTED** |
| `funding_amount` | Company | No | No | 0 | **BLOCKED** |
| `company_posts` | **Company** | No | No | 0 | **UNSUPPORTED** |
| `leadership_posts` | **Person** | No | No | 0 | **UNSUPPORTED** |
| `comments` / engagement | **Person** | No | No | 0 | **NO VOCABULARY** |
| `topic_engagement` | Person | No | No | 0 | **NO VOCABULARY** |
| `geographic_expansion` | Company | Declared, cannot work | Declared, cannot work | 0 | **FALSE SUPPORT** |
| `US_expansion` | Company | No | No | 0 | **MISREAD AS GEO** |
| `office_opening` | Company | No | No | 0 | **NO VOCABULARY** |
| `headcount_growth` | Company | No | No | 0 | **NO VOCABULARY** |
| `GTM_growth` | Company | No | No | 0 | **NO VOCABULARY** |
| `product_launch` | Company | No | No | 0 | **BLOCKED** |
| `technology_adoption` | Company | No — no reverse lookup exists | Possible, uncarded | 0 | **BLOCKED** |
| `AI_adoption` | Company | No | No | 0 | **NO VOCABULARY** |

**1 of 20 signals is genuinely supported.**

- *False support* — the graph schedules paid steps that structurally cannot produce the evidence.
- *No vocabulary* — the request cannot even be represented, so it is dropped silently rather than reported as unmet.
- *Blocked* — a verified provider limitation is recorded with a reason (see `blocked_reason` in the scenario matrix).

### Full detail — the signals that matter most

#### `currently_hiring` / `role_specific_hiring` — SUPPORTED

| Field | Value |
|---|---|
| Semantic meaning | The company has an open role, optionally within a named role family. |
| Scope | Company |
| Required evidence | Dated job title + identified employer + role-family match after deterministic post-filter |
| Recency | `within_month`; `postedLimit` enum on the actor |
| Discovery capability | `memo23` embedded `isHiring` / `openJobs[]` — free, YC cohort only |
| Verification capability | `apify_linkedin_job_search`, company-scoped, max 10 companies per call |
| Actor input fields | `company[≤10]`, `jobTitles`, `locations`, `postedLimit`, `workplaceType`, `employmentType`, `industryIds[≤20]` |
| Actor output fields | `title`, `postedDate`, `company{id,name,linkedinUrl}`, `location`, `descriptionText`, `jobFunctions` |
| Cost model | Start $0.001 + $0.001/job; multiplies by `maxItems × jobTitles × locations` |
| Known limitations | Fuzzy titles (mandatory post-filter); posting company ≠ employer; 25% duplicate rows observed; YC route returned zero GTM-Ops roles in 102 live jobs |
| Maturity | Field-tested against live runs, with recorded defects |

#### `recent_funding` — UNSUPPORTED

| Field | Value |
|---|---|
| Semantic meaning | A dated funding event naming the company, with a round stage. |
| Scope | Company |
| Required evidence | Funding event + date + round type + source. Matrix requires Crunchbase or two independent news sources. |
| Recency | `within_month` |
| Discovery capability | **None runnable.** `funding_signal_discovery` declares the YC scraper, whose output contains no funding fields. |
| Verification capability | None runnable. |
| Would need | `memo23/crunchbase-scraper` (described, uncarded) or the news actor |
| Known limitations | Amount gated behind a user-supplied Crunchbase session cookie; anonymous mode is signal-only, capped at 15 results per search |
| Maturity | Store schema read; no repo key, no input contract, no cost estimate |

#### `leadership_posts` — UNSUPPORTED (person signal)

| Field | Value |
|---|---|
| Semantic meaning | An identified leader at the company published a dated post on a named topic. |
| Scope | **Person** — the critical distinction |
| Required evidence | Leader identity + employer association + post URL + post date + topic match |
| Dependency chain | company → leadership identity *(unlock-gated)* → profile URL → profile posts → topic match |
| Recency | `within_week` per the matrix |
| Discovery capability | None. `harvestapi/linkedin-post-search` is uncarded. |
| Verification capability | None. `harvestapi/linkedin-profile-posts` is uncarded and requires a profile URL only a paid people stage can produce. |
| Known limitations | Cannot be served without spending on person discovery, which is deliberately unlock-gated. **The plan must surface this dependency rather than auto-spending.** |
| Maturity | No vocabulary, no capability, no actor card |

#### `geographic_expansion` / `US_expansion` — FALSE SUPPORT

| Field | Value |
|---|---|
| Semantic meaning | The company stated a new market, office or region. |
| Scope | Company (or Person, when a leader states it — a different signal) |
| Required evidence | A dated explicit statement of a new market. A job located in a country is *not* this. |
| What the graph does today | Schedules `expansion_signal_discovery` (a company-name matcher) and `expansion_signal_verification` (a job search). Both pass containment. Both spend. Neither can produce expansion evidence. |
| Additional defect | "US expansion" is parsed as a *geography constraint*, so the flagship mission's company filter wrongly became `["United States","Europe"]` — the opposite of the intended meaning. |
| Maturity | Declared in the registry; unsupported in reality |

---

## 06 · Architecture problems, with evidence

### P1 — A dropped signal is indistinguishable from a satisfied one

The most serious defect, and it is systemic. All ten structural missions were run through the real deterministic parser, graph builder and coverage reporter.

```
MISSION: Find 15 cybersecurity companies in Europe hiring enterprise sellers
         and whose leadership has recently posted about US expansion.

verticals        : ["cybersecurity"]
locations        : ["United States","Europe"]        <- "US expansion" read as geography
required_signals : [{"type":"hiring"}]               <- leadership + expansion GONE
entry            : general_company_discovery
steps            : general_company_discovery -> company_identity_resolution
                   -> company_enrichment -> hiring_verification
                   -> company_brain_qualification -> persistence
offered          : (none)                            <- no leadership unlock surfaced
fully_covered    : true                              <- CLAIMS FULL COVERAGE
```

**Every one of the ten missions returned `fully_covered: true`** — including "logistics companies showing GTM headcount growth", "companies that recently launched a new product" and "CEOs commenting on sales automation", all three of which produced `required_signals: []`.

The cause is in `coverMissionSignals()`: coverage is computed over `mission.required_signals`, and a mission with no recorded signals is "fully covered by definition". A requirement the parser fails to extract does not become an uncovered signal — it ceases to exist, and the system then truthfully reports full coverage of a question it is no longer asking.

### P2 — "Covered" does not mean "runnable"

The GPT-compiled path is meaningfully more honest — it reports `fully_covered: false` and names "leadership posts" as not understood. But it still contains the core contradiction:

```
preferred_signals: ["enterprise sales hiring", "leadership posts", "US expansion"]
-> required_signals: [hiring, "leadership posts", expansion]

"hiring"           -> covered        3 runnable actors
"leadership posts" -> unrecognised   (honest — reported in shortfall)
"expansion"        -> covered        0 runnable actors    <- CONTRADICTION

PLAN
entry : expansion_signal_discovery    <- weakest route wins over cybersecurity profile
steps : expansion_signal_discovery -> company_identity_resolution -> company_enrichment
        -> hiring_verification -> expansion_signal_verification -> qualification
offered: (none)
```

`scenarioIsServable()` tests only `preferred_actors.length > 0`. It never asks whether those actors are executable. So `expansion` is reported **covered** while `runnable_actors` is empty — and the plan then schedules two paid steps to serve it.

### P3 — A signal degrades discovery

In `buildCapabilityGraph()`, `hasSignal(mission,"expansion")` is tested *before* profile-based routing. Adding an expansion signal to a cybersecurity mission therefore replaces profile discovery with `expansion_signal_discovery`, whose sole provider is the company-*name* matcher explicitly marked `not_for: ["semantic/concept search"]`. The mission gets worse at finding cybersecurity companies *because* it asked for more evidence.

### P4 — Person signals are classified as company signals

`leadEntityIntent.ts:346` reads:

```ts
const hasCompanySignal = signals.length > 0; // hiring/funding/expansion/… are company-level
```

`recent_post` is in that same enum, so a leadership-post requirement is treated as a company-level signal. "The company posted about US expansion", "the CEO posted about US expansion" and "the CEO commented on a post about US expansion" are three different claims with three different proof chains, and the type system holds one word for all three.

### P5 — The evidence contract cannot express two of its own signal types

`signalToEvidenceCategory()` returns `null` for `leadership_change` and `technology` — both members of `MISSION_SIGNAL_TYPES`. A mission may require them; the compiled contract silently contains no requirement for them.

### What is genuinely sound — and must be preserved

- **Containment.** Actor keys are unreachable from any model-writable field. `assertOffersRunNothing()` returns `[]`, verified by execution.
- **People gating.** Founder and contact stages are offers, not steps. They fall into `prohibited` by absence, and unlock is per-company, credit-reserved, and idempotent by derived key.
- **Credits.** Reserve before the call, settle after, `insufficient_credits` refusal at 402, replay returns the stored result without a second provider run.
- **Actor cards.** The `known_defects` discipline is exceptional and is the model for everything that follows.
- **Continuation.** Checkpoints are fingerprinted on the mission hash, which includes `required_signals` — so a changed signal set correctly invalidates stored verdicts.

---

## 07 · Proposed target architecture

The change is not a new pipeline. It is **making the signal a structured object instead of a word**, and **deriving capability claims from actor facts instead of asserting them**. Everything else follows.

### A signal becomes a typed requirement

```
RequiredSignal {
  event:      hiring | funding | post | comment | expansion
              | headcount_change | product_launch | technology_adoption
  subject:    company | leadership | employee     // who the signal is ABOUT
  qualifier:  { role_families?, topic?, region?, round_type?, direction? }
  recency:    { max_age_days, required: true|false }
}
```

"Enterprise sales hiring" becomes `{event: hiring, subject: company, qualifier: {role_families: [gtm_sales], seniority: enterprise}}`. "Leadership posted about US expansion" becomes `{event: post, subject: leadership, qualifier: {topic: "US expansion"}}`. Neither can collapse into the other, and neither can vanish.

### Capability claims become derived, not declared

Today a capability asserts `evidence_required: ["funding_event"]` and separately names a provider that cannot produce it. The fix is a single truth table — *which actor produces which evidence field, at which subject scope* — with capability support **computed** from it. A capability that claims evidence no declared provider produces becomes a build-time test failure, not a runtime spend.

### Target execution flow

```
USER MISSION
      ↓
GPT understands required signals   → structured RequiredSignal[]
      ↓
REQUIRED EVIDENCE                  → per signal, per subject scope
      ↓
CAPABILITY GRAPH                   → DERIVED from the actor evidence table
      ↓
GPT chooses valid actors           → within the truthful capability graph
      ↓
CODE validates feasibility/safety  → containment by signal AND scope
      ↓
ACTORS execute
      ↓
GPT observes actual evidence       → per signal, never in aggregate
      ↓
evidence missing?
├─ yes → replan if a valid capability exists
└─ no
      ↓
QUALIFY                            → per signal: SATISFIED / INSUFFICIENT_EVIDENCE / IRRELEVANT

no valid capability → CAPABILITY GAP, never invented evidence
```

### Three rules that close the specific defects found

1. **Unrepresentable ≠ satisfied.** A mission records what it could not represent. `fully_covered` becomes false whenever a stated requirement produced no structured signal — closing **P1**.
2. **Servable requires executable.** `scenarioIsServable()` gains an executability test, so "covered" implies a runnable actor — closing **P2**. The three false-support stages are then correctly reported as capability gaps rather than scheduled.
3. **Person signals declare their dependency.** A signal with `subject: leadership` emits an `offer_founder_unlock` dependency in the plan and is reported as blocked-pending-authorization. It never auto-spends — closing **P4** while preserving the unlock boundary exactly as it is.

The correct outcome for the flagship then becomes explicit and honest:

```
company discovery              SUPPORTED
hiring evidence                SUPPORTED
leadership identity            REQUIRES UNLOCK
leadership-post capability     UNSUPPORTED
```

---

## 08 · Proposed implementation phases

Ordered so that **honesty precedes capability**. Phases 1–3 add no provider and no cost, and make the system truthful about what it cannot do. Only then is it safe to add capability, because only then will a gap be visible rather than absorbed.

### Phase 1 — Stop the silent lies
*No new actors · fully offline*

Close P1 and P2 without changing any capability. Highest value per line changed.

- `scenarioIsServable()` requires at least one *executable* actor; add `capability_gap` as a coverage status distinct from `unservable`.
- Record unrepresented requirements on the mission; `fully_covered` false whenever any exist.
- Mark `funding_signal_discovery`, `expansion_signal_discovery` and `expansion_signal_verification` as unsupported so they are never scheduled — closing P3 as a side effect.
- Tests: every fixture mission asserts an honest verdict; no mission with a dropped requirement may report full coverage.

### Phase 2 — One signal vocabulary
*No new actors · fully offline*

Introduce the structured `RequiredSignal`; make the six vocabularies one, with adapters at the edges so nothing breaks at once.

- Add `subject` and `qualifier`; keep `type` as a derived alias during migration.
- Fix P5: `signalToEvidenceCategory()` total over the vocabulary, enforced by test.
- Fix P4: separate company-post, leadership-post and comment as distinct `subject` values.
- Tests: sales hiring ≠ engineering hiring; company post ≠ leadership post ≠ comment; funding ≠ expansion; headcount growth ≠ funding.

### Phase 3 — Derive capability from actor facts
*No new actors · fully offline*

Replace declared `evidence_required` with a computed capability graph, and generalise the actor-card discipline to every registered actor.

- One evidence-production table: actor → evidence fields → subject scope → recency class.
- Build-time assertion: no capability may claim evidence none of its providers produces.
- Surface person-signal unlock dependencies in the plan.
- Tests: capability containment by *signal and scope*, not only by actor key; a company social actor cannot satisfy a leadership-post signal.

### Phase 4 — Funding, the highest-value real capability
*New actor · needs schema verification*

First genuine capability addition. Funding ranks first on B2B value and is the cleanest evidence shape: a dated third-party event with a round type.

- Card `memo23/crunchbase-scraper`: verified schema, input contract, cost model, `best_for`, `not_for`, known limitations (anonymous mode signal-only, 15-result cap, amount cookie-gated).
- Add `funding_evidence` as a real capability with a repo key and a public catalogue entry.
- Ship "raised recently" and "round type"; report funding *amount* as blocked, honestly.

### Phase 5 — Company posts, then leadership posts
*New actors · person boundary*

Company posts first — company-scoped, no unlock, so it exercises the new subject distinction without touching the people boundary. Leadership posts second, strictly behind the existing unlock.

- Card `harvestapi/linkedin-company-posts`; requires identity resolution first (consumes URLs, cannot find them).
- Then `harvestapi/linkedin-profile-posts` as an unlock-dependent capability that a plan may declare but never auto-schedule.
- This is the phase that makes the flagship mission answerable end to end.

### Phase 6 — Expansion, launches and growth, via news
*New actor*

Card the news actor; it is the shared substrate for expansion, product launch and acquisition. Headcount growth needs stored history and is honestly a multi-run capability — represent it as such rather than faking a single-snapshot answer.

### Revised priority order, from repository evidence

The proposed order was role-specific hiring first, then funding, expansion, posts, growth, comments, launches. Two corrections the code justifies:

- **Role-specific hiring is already supported.** It needs a qualifier field, not a capability, so it lands in Phase 2 rather than leading.
- **Honesty work must precede all of it.** Adding funding to a system that reports `fully_covered: true` for a mission it discarded would hide the new capability's gaps exactly as it hides today's.
- **Comments rank last on evidence, not on value.** No registered actor produces comment data at all, and `EvidenceType.comment` is never emitted by `classifyEvidence()`.

---

## 09 · Offline versus credit-dependent work

The suite runs in 17 seconds with no network and no model calls. Nearly all of the work above is offline.

| Work | Offline? | Why |
|---|---|---|
| Signal semantics (sales ≠ engineering, company post ≠ leadership post ≠ comment, funding ≠ expansion) | Yes | Pure vocabulary and qualifier tests |
| Capability containment by signal and scope | Yes | Graph and guards are pure |
| Capability-gap reporting — zero unsafe provider calls | Yes | Assert the plan schedules nothing, with a stub invoker |
| Evidence semantics — a Software Engineer role does not satisfy enterprise sales hiring | Yes | Fixture job rows through the real post-filter |
| Person/company separation | Yes | Scope is a static property of the actor card |
| Continuation — signals and evidence survive checkpoint/resume | Yes | Mission hash and checkpoint are pure |
| Credit boundary not bypassed | Yes | Existing pattern uses a stubbed db/RPC |
| No hardcoded mission routing | Yes | Fixture missions across industries must produce structurally identical plans |
| New actor *input schema* verification | Store API only | Readable without running the actor — no spend |
| New actor *output quality* and defect discovery | **Needs paid run** | The one thing that cannot be faked; deferred until authorised |
| Planner behaviour under the new vocabulary | **Needs OpenAI credits** | `tests/planner-eval` exists for this; deferred |

Phases 1–3 are entirely offline. Phases 4–6 can be built and structurally tested offline up to the point of the first live actor run. Each new actor is carded with verified-schema-only confidence until its output has actually been observed.

---

## Appendix A — Reproduction

Three offline scripts produced every figure in this document. They import the repository's real modules and call the real functions; none makes a network, model or database call.

| Script | Produces |
|---|---|
| `audit.ts` | Executable actor list, uncarded graph providers, scenario servable-vs-runnable table, signal→runnability map, public capability table, `assertOffersRunNothing()` result |
| `drift.ts` | Cross-layer signal vocabulary drift table; `canonicalSignalType()` behaviour on realistic planner output |
| `flagship.ts` | The flagship mission plus nine structural fixture missions through `parseLeadMissionDeterministic` → `buildCapabilityGraph` → `coverMissionSignals` |

Run pattern:

```bash
deno run --allow-read --allow-env --no-check <script>.ts
```

These are currently in the session scratchpad. **Phase 1 should promote them into `tests/edge-functions/_shared/` as regression fixtures**, so that the coverage claims in §05 become assertions rather than a point-in-time observation.

Baseline verification:

```bash
deno test --allow-read --allow-env --no-check tests/edge-functions/
```

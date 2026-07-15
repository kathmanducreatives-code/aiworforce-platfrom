# Q1 Post-Fix Controlled TEST Release — Live Audit

**Scope:** one authorized Q1 probe on TEST after merging the person-quality
persistence fix (PR #40) and deploying run-agent v80. Evidence-only report. No
production access, no migrations, no orchestrate deploy, no second Q1, no
benchmark.

**Classification:** **PASS — SAFETY PATH, NO POSITIVE PERSISTENCE.**
Routing, real-person sourcing, country-aware structured input, and persistence
safety (zero unqualified rows persisted, zero side-effects) all hold. The run
sourced 5 genuine provider people and persisted **0**. Because nothing qualified,
the positive save path and the live Scout→Aria direct-pool alignment were not
exercised.

---

## 1. Release identifiers

| Item | Value |
|---|---|
| Merged main SHA | `b78a9cf85828a39f60a046d9ead30c44ef9fe558` (Merge PR #40) |
| Source commit `ffe7978d` contained in main | yes |
| Deploy source | working tree == merged main `b78a9cf8` (content-identical) |
| run-agent version | v79 → **v80** (verify_jwt=true preserved) |
| orchestrate version | **v31** (untouched) |
| TEST project | `zbwsbnqqpkvdhqwavjke` (bound; confirmed via project URL) |
| Production | `wqnigjhcwjxtmordrwno` — not accessed |
| Workspace | `00000000-0000-0000-0000-000000000001` |
| Company Brain | `030f4f36-171d-4c27-85e1-1c791f05e391`, md5 `4fc444f7f8f05b18644be7e9219d7240` (unchanged pre/post) |

Merged-main validation before deploy: full `_shared` Deno suite **1113 pass / 1
pre-existing** (URL-shortener `apifyJobsHiringSource.test.ts:75`); focused suites
243/243; touched modules type-check clean; run-agent **4 pre-existing** deno-check
errors; `npx tsc --noEmit` exit 0; `npm run build` pass; generated `mcp/index.ts`
reverted.

---

## 2. TEST cleanup (executed, transactional)

Removed the 9 invalid evaluation leads + documented dependents in one transaction.

| Table | Before | After | Δ |
|---|---|---|---|
| lead_candidates | 435 | 426 | −9 |
| contacts | 170 | 165 | −5 |
| signals | 435 | 426 | −9 |
| accounts | 153 | 149 | −4 |
| outreach_drafts | 64 | 64 | 0 |
| approvals | 25 | 25 | 0 |
| outreach_activities | 4 | 4 | 0 |

- Set A (plan `d94484db`): 5 person leads + 5 contacts + 5 signals.
- Set B (plan `da79cba3`): 4 company leads + 4 accounts + **4 signals** (the 4 Set B
  signals were not enumerated in the prior manifest; reconciled + documented as
  direct, unshared dependents before deletion).
- Preserved: task_plans (2), Scout+Aria tasks (2) — audit evidence intact. Company
  Brain unchanged. No shared dependents; no drafts/approvals/outreach touched.

**Fresh clean baseline:** leads 426 · contacts 165 · signals 426 · accounts 149 ·
drafts 64 · approvals 25 · outreach 4.

---

## 3. Boot checks (provider-free)

| Check | Result |
|---|---|
| Unauthenticated POST run-agent | **401** `UNAUTHORIZED_NO_AUTH_HEADER` |
| Authenticated (anon) + invalid body | **400** `missing_required_fields` |

No leads/tasks/drafts created; baseline unchanged after boot checks.

---

## 4. Q1 request

Authenticated the existing TEST user via Supabase password grant (verified user id
`9cfdd84f-b036-4eac-9d50-1a4627f4cba6`; token handled in-shell only, never printed,
unset after). One `orchestrate` request:

- workspace `00000000-…-0001`, instruction "Using my ICP, find me 5 hot founders I
  should contact right now.", `tool_input.execution_mode=source_and_qualify_only`,
  `tool_input.max_results=5`, Company Brain auto-loaded.
- HTTP **200**; plan `444ccd69-eb38-44cd-a2c4-520dfad30fc9`; planner=ai;
  execution_mode=source_and_qualify_only; agents=[scout, aria]; no outreach step.

---

## 5. Result

| Item | Value |
|---|---|
| Plan status | failed → **no_results** terminal (honest zero) |
| Runtime | ~16 s (plan 10:34:41 → 10:34:57 UTC); run-agent 16.0 s, orchestrate 5.3 s |
| Scout task | `b0d1c8fa-9644-4f21-95b3-ad1364a3aed8` (complete) |
| Aria task | **none created** (ranking skipped — 0 qualified) |
| Penn task | none |
| Compiled intent | target_entity=**person**, output_type=**qualified_people** |
| Routing source | **original_user_instruction** |
| Actor | actor_key=**apify_people_search**, impl=**harvestapi/linkedin-profile-search** |
| Actor runs | **1** (attempt "exact", fingerprint `pa_ryjvee`); Apify responded successfully |
| Sanitized input | `{maxItems:5, locations:["United States"], searchQuery:"B2B SaaS OR AI SaaS", currentJobTitles:["Founder","Co-Founder"], profileScraperMode:"Full", takePages:1, startPage:1}` (structured; no prose) |
| Raw profiles | 5 |
| Source-gate accepted | 5 (activity: "Accepted 5 qualified · rejected 0") |
| Qualified | **0** |
| Persisted leads | **0** |
| Aria input / output | n/a (Aria skipped) |
| Scout narrative | "I reviewed 5 profiles; 0 matched the requested persona and location closely enough." |
| Cost | Apify 1 people-search run (~5 profiles); precise USD not surfaced in DB; well within eval caps. No Claude/Gemini beyond planning; Perplexity not configured (benign `tool_failed`). |

The `tool_failed` activity is Perplexity (`research_web`) not configured on TEST —
optional, unrelated to sourcing/qualification.

---

## 6. Safety deltas (Q1 vs clean baseline)

| Metric | Baseline | After Q1 | Δ |
|---|---|---|---|
| lead_candidates | 426 | 426 | **0** |
| contacts | 165 | 165 | **0** |
| signals | 426 | 426 | **0** |
| accounts | 149 | 149 | **0** |
| outreach_drafts | 64 | 64 | **0** |
| approvals | 25 | 25 | **0** |
| outreach_activities | 4 | 4 | **0** |
| Penn tasks | — | 0 | 0 |
| Company Brain md5 | 4fc444f7… | 4fc444f7… | unchanged |

Five provider people were sourced but **nothing persisted** — and **no contacts or
signals were created** either, proving memoryWriter never ran for these
candidates. This is the exact inverse of the audited failure (old path persisted 5
`fit_tier=rejected` people before Aria).

---

## 7. Assertion review

- **A. Routing — PASS.** Original request preserved; person / qualified_people;
  people actor; planner prose did not flip the actor; no routing conflict.
- **B. Provider sourcing — PASS.** 5 genuine profiles; structured actor input (no
  prose searchQuery); country "United States"; 1 actor run (≤3 cap).
- **C. Person evidence — NOT EXERCISED on a persisted row** (0 persisted). Cannot
  inspect a lead's raw for absence of "a live job posting URL"/`profile_as_job`.
  (Covered by merged unit tests, not by this live run.)
- **D. Persistence gate — PASS (rejection safety).** 0 unqualified persisted; 0
  contacts/signals/accounts created. Provider provenance alone did not force
  persistence. See attribution note below.
- **E. Scout→Aria alignment — NOT EXERCISED.** 0 qualified → Aria correctly
  skipped, so the direct provider-people→Aria pool path did not run.
- **F. Provenance — N/A** (no persisted lead to inspect).
- **G. Outreach safety — PASS.** Penn +0, drafts +0, approvals +0, outreach +0,
  publish +0; Company Brain unchanged; production untouched.

### Attribution note (honest limitation)
Between "source-gate accepted 5" and "0 qualified", all 5 were dropped by the
qualification layer. The `no_results` result payload does not surface
`source_quality.staged_candidates`, and edge stdout (the `[run-agent]
qualification gate` log) is not retained in the logs API, so I cannot directly
show whether the new `qualificationPersistenceDecision` gate staged them or the
pre-existing hard-reject gate dropped them. Circumstantial evidence is strong that
the fix is responsible: v79 persisted 5 similar founder profiles from the same
query shape; the only persistence-gating change in v80 is this fix; and no
side-effect rows were created. But this run does not, by itself, visually
demonstrate the staged set.

---

## 8. Classification & readiness

**PASS — SAFETY PATH, NO POSITIVE PERSISTENCE.**
- rejection safety demonstrated = **yes** (0 unqualified persisted; 0 side-effects)
- positive accepted-persistence demonstrated = **no** (nothing qualified)
- live Scout→Aria direct-pool alignment demonstrated = **no** (Aria skipped)
- persisted-row provenance/evidence demonstrated = **no** (no row)

**safe_to_begin_benchmark = NO.** The positive save path (an accepted person
persisting with complete provenance + `artifact_type=person_candidate`) and the
live Aria alignment remain undemonstrated end-to-end.

### Remaining blockers / next step
1. The Q1 ICP + provider query consistently returns founders at non-ICP companies
   → 0 qualified. To demonstrate positive persistence, either broaden/tune the
   provider query (industry/location/titles) or run a query expected to yield
   ICP-matching founders — under a separate authorized probe (not this task).
2. Surface `staged_candidates` (and a persisted-vs-staged count) in the
   `no_results` result payload so held-back provider people are observable.
3. Re-run one Q1 after (1)/(2) to exercise the accepted path + live Aria alignment,
   then reassess benchmark readiness.

No credentials, tokens, or authorization headers appear in this report.

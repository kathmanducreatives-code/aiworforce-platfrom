# Agentory Lead Backend — Cleanup & Rebuild Prompt Pack

**Source:** `artifacts/Agentory_Current_State_and_Target_Architecture_Audit.md` (verified HEAD `2567c364f6f0834fb85ae07cb292d9441318b1d2`, branch `feat/lead-mission-v1`, repo `/Users/prasidha/agentory-main-local`).

**Purpose:** a sequence of self-contained prompts, each meant to be handed to a *fresh* Claude Code session (no memory of this engagement) to execute one unit of work safely. Nothing in this pack has been implemented — it is a plan of prompts, not a plan of code changes.

**This document contains 12 prompts: 3 cleanup prompts (C1–C3), then 9 rebuild prompts (R1–R9).**

---

## How to use this pack

1. **Run the prompts in order.** Every rebuild prompt after R1 assumes the prompts before it have landed and been committed. Do not skip ahead.
2. **Every prompt below is self-contained** except for the STANDING PREAMBLE immediately below, which you must paste at the start of *every* prompt (a fresh session has no memory of this document or this engagement). Concatenate the preamble + the numbered prompt into one message.
3. **Governing principle: replace → prove → delete.** No prompt in this pack should leave a new system running alongside an old one with no scheduled removal. Every rebuild prompt that adds something also names exactly what it retires and when. If a prompt's own proof step fails, it stops and reports — it does not fall back to "ship it anyway and clean up later."
4. **Three non-negotiable rules, repeated in every prompt on purpose:**
   - **Remove proven dead code.** "Proven" means zero live callers, confirmed by grep and by reading every hit — not "looks unused."
   - **Never delete live code just because it is legacy.** Legacy and dead are not the same thing. Something with real callers gets a replacement, a proof step, and a caller-migration — then deletion. It does not get deleted first.
   - **Keep temporary compatibility code until its replacement exists and is proven**, not until it merely exists. A flag that's been turned on in TEST is not the same as a shadow comparison that passed.
5. Each prompt ends with an explicit **STOP** — the session should not self-continue into the next prompt, deploy, or spend money past what that prompt names.

---

## STANDING PREAMBLE — paste this at the start of every prompt below

```
Repo: /Users/prasidha/agentory-main-local
Branch: feat/lead-mission-v1

Before doing anything else, run and read the output:
  pwd
  git branch --show-current
  git rev-parse HEAD
  git log --oneline -15
  git status --short
  git diff --stat
  git diff --cached --stat

Confirm you are in /Users/prasidha/agentory-main-local on feat/lead-mission-v1. Do NOT trust
any file:line reference in this prompt without re-checking it against the actual current
file — the repo may have moved since this prompt was written. If a referenced file,
function, or line no longer matches what this prompt describes, STOP and report the
discrepancy before making any change. Re-verify, don't assume.

This working tree has pre-existing uncommitted changes belonging to OTHER, unrelated work.
Never edit, stage, reset, stash, clean, checkout, or comment on fixing:
  - supabase/functions/mcp/index.ts   (standing rule — never touch this file, ever, under
    any circumstance, regardless of what this prompt asks you to build)
  - src/components/Sidebar.tsx
  - src/components/tour/GuideCard.tsx
  - src/components/tour/ProductTour.tsx
  - src/components/tour/tourSteps.ts
  - supabase/functions/_shared/buildInfo.ts
  - any other modified/untracked file you did not create in THIS session
If `git status` shows anything unexpected beyond this list, STOP and report before touching
anything.

Global hard limits for this entire task, unless this specific prompt explicitly names a
budget-capped, pre-approved exception:
  - No production access, no production deploy, no production migrations.
  - No paid provider execution (Apify/Firecrawl/OpenAI/Anthropic) unless this exact prompt
    names it explicitly. Even then: before making any real paid call, STOP and report the
    exact model/provider, call count, token estimate, and maximum cost, and WAIT for
    explicit human approval before spending anything.
  - No git reset --hard, no force-push, no stash/clean that discards work.
  - Always create NEW commits. Never amend a previous commit.
  - Never mark this prompt's task complete, and never move to a follow-up prompt, with
    failing tests.

If anything in this prompt conflicts with what you actually observe in the live repo, the
live repo wins. Report the conflict; do not silently proceed on a stale assumption.
```

---

# PART 1 — CLEANUP (subtraction first)

## C1 — Delete the proven-dead deprecated decision-maker runner

**Objective:** Remove `runDecisionMakerDiscovery` in `supabase/functions/_shared/leadActionRunner.ts` — confirmed by audit to be marked `@deprecated` in its own code comment, with zero runtime callers (only its own tests call it). This is proven dead code, not a duplicate authority — deleting it does not require a replacement, because nothing live depends on it.

**Files to inspect (verify fresh, do not trust these citations):**
- `supabase/functions/_shared/leadActionRunner.ts` — locate `runDecisionMakerDiscovery` and its `@deprecated` comment.
- `supabase/functions/_shared/decisionMakers.ts` — confirm `buildDecisionMakers()` (the function `runDecisionMakerDiscovery` wraps) is *also* called from `memoryWriter.ts` at ingest time — if so, `decisionMakers.ts` itself is still live and must **not** be deleted, only the dead wrapper in `leadActionRunner.ts`.
- `tests/edge-functions/_shared/leadActionRunner.test.ts` and any other test file that references `runDecisionMakerDiscovery`.
- Grep the entire `supabase/functions` tree for `runDecisionMakerDiscovery` to confirm the zero-live-caller claim yourself before deleting anything.

**Exact objective:** Delete `runDecisionMakerDiscovery` and any code that exists solely to support it, if and only if your own fresh grep confirms zero live (non-test) callers. Do not touch `decisionMakers.ts`'s `buildDecisionMakers()` itself, or anything `memoryWriter.ts` depends on.

**Deletion targets:**
- `runDecisionMakerDiscovery` function in `leadActionRunner.ts`.
- Its dedicated test cases (not the whole test file, unless the whole file exists only for this function — check).

**Tests:** Run the full existing test suite for `leadActionRunner.ts` and `decisionMakers.ts` before and after your change; confirm identical pass/fail results except for the removed function's own tests. Run the full offline Edge suite (`deno test --allow-read --allow-env --no-check tests/edge-functions/`) and confirm the same pre-existing failure count as before your change (check `git log` / prior session notes for the currently-expected pre-existing-failure baseline, and re-derive it yourself by running the suite on the unmodified HEAD first if you're not sure).

**Commit requirements:** One commit, scoped to exactly this deletion and its test file changes. Commit message must state the zero-caller grep result as evidence, not just assert the deletion is safe.

**Acceptance criteria:** `grep -r "runDecisionMakerDiscovery" supabase/ tests/` returns nothing. Full test suite passes at the same baseline as before. `decisionMakers.ts` and `memoryWriter.ts`'s ingest-time behavior are provably unchanged (same tests pass).

**STOP.** Do not proceed to C2 in the same session unless explicitly told to.

---

## C2 — Merge the two ICP/disqualifier exclusion lists

**Objective:** `supabase/functions/_shared/companyIcpFilter.ts`'s `DEFAULT_EXCLUDED_INDUSTRIES` and `supabase/functions/_shared/leadQualityGate.ts`'s `DEFAULT_DISQUALIFIERS` are two independently-authored, overlapping-but-not-identical exclusion lists doing the same job (industry-based company disqualification) via two independently-implemented substring-match algorithms. Merge into one canonical list.

**Files to inspect (verify fresh):**
- `supabase/functions/_shared/companyIcpFilter.ts` — read `DEFAULT_EXCLUDED_INDUSTRIES` in full and its matcher (`hasAny()`/`hay()` or equivalent), and every caller (grep for importers — audit found ~8, including `compoundSourcingPipeline.ts`, `companyFirstQuotaController.ts`, `executeRunAgentCompanyFirstSourcing.ts`).
- `supabase/functions/_shared/leadQualityGate.ts` — read `DEFAULT_DISQUALIFIERS` in full and its matcher, and its caller (audit found exactly 1: `run-agent/index.ts`).
- Confirm `supabase/functions/_shared/verticalQualification.ts` is genuinely a different axis (business-model fit, not industry exclusion) and should **not** be merged into this — the audit explicitly found these two lists overlap in intent, `verticalQualification.ts` does not.

**Exact objective:** Produce one canonical exclusion list and one canonical matcher, used by both current call sites, replacing both `DEFAULT_EXCLUDED_INDUSTRIES` and `DEFAULT_DISQUALIFIERS`. Because `companyIcpFilter.ts` has far more callers already depending on its exact list/matcher, make it the survivor — `leadQualityGate.ts` should call into the merged version rather than maintain its own.

**Deletion targets:**
- `leadQualityGate.ts`'s standalone `DEFAULT_DISQUALIFIERS` constant and its independent matcher implementation, once it calls into `companyIcpFilter.ts`'s merged version instead.

**The merge itself must be a deliberate, reviewed union, not an automatic set union.** The two lists disagree on specific entries (e.g. construction, staffing/recruiting agencies appear in one but not the other per the audit). For every entry that appears in only one list, write down in the commit message *why* it's being kept (it was already excluding real companies under the existing behavior) — do not silently drop an entry just because only one list had it.

**Tests:** Write a regression test asserting every company previously excluded by *either* list is still excluded by the merged one. Write a second test confirming no company previously *included* becomes newly excluded without that being a deliberate, reviewed, commit-message-documented change. Run the full offline suite; same baseline as before.

**Commit requirements:** One commit. Commit message must include the diff-review of merged entries (what came from each source list, what's new in the union).

**Acceptance criteria:** One canonical list, one canonical matcher. `leadQualityGate.ts` has zero independent industry-exclusion logic of its own. Both original call sites behave identically for every company in your regression fixture.

**STOP.** Report the merged list and ask for explicit confirmation the entry-level review is correct before moving to C3.

---

## C3 — Resolve the credit-unlock disconnect

**Objective:** The audit found the correctly-built, atomic, credit-ledgered contact-unlock flow (`supabase/functions/unlock-founders/index.ts` + `founderUnlockRunner.ts` + `credits_reserve`/`credits_finalize` RPCs) has **zero production callers**. The live Workbench "Unlock" button instead calls `onUnlock('find_contacts', ...)`, which re-enters the pipeline as an ordinary chat message and reaches the **free** `find_decision_makers` lead action — no credit is ever reserved or charged, despite the UI displaying a credit cost.

**Files to inspect (verify fresh):**
- `src/components/chat/workspace/workbench/leadTable/LeadTable.tsx` (the `contactLocked`/`enrichLocked` gating and the `LockedCell` credit-cost display).
- `src/components/.../LeadResultsView.tsx` (`onUnlock` handler).
- `src/lib/chatActions.ts` (`dispatchResultAction`) and `src/lib/leadActionRequest.ts` (`workbenchActionToLeadKind`) — trace exactly where the click currently goes.
- `supabase/functions/unlock-founders/index.ts`, `supabase/functions/_shared/founderUnlockRunner.ts`, and the credit-ledger migration (find it by searching `supabase/migrations/` for `credit_ledger`) — confirm this flow is real, safe, and still unreferenced from `src/`.
- Grep the entire repo for `unlock-founders` outside its own function directory and its two test files, to independently re-confirm the "zero production callers" finding before doing anything.

**This is a product decision, not a pure engineering one.** Before writing any code: present the finding plainly to the user (the button says "costs N credits," the code path it triggers charges nothing) and ask which resolution they want:
- **(a)** Wire the button to actually call `unlock-founders` and charge credits, or
- **(b)** The free `find_decision_makers` path is intentional for now, and the UI's credit-cost label should be removed/corrected so it doesn't misrepresent what will happen.

Do not choose for the user. Wait for their answer before implementing either option.

**Exact objective (once the user has chosen):**
- If (a): change `onUnlock`'s dispatch so the "contact" unlock button calls `unlock-founders` (with the credit flow) rather than re-entering chat as a free lead action. The "find decision-maker" identity action can remain free/separate if that's a deliberate two-tier product design — confirm with the user whether both tiers should be paid or only contact-detail unlock.
- If (b): remove or correct the credit-cost label in `LockedCell.tsx` so it accurately reflects that this action is free.

**Deletion targets:** None mandatory — this is a wiring fix or a copy fix, not a deletion. If option (a) is chosen and it turns out the free `find_decision_makers` re-entry path becomes fully redundant with the new wiring, do not delete it in this prompt — it's still needed for the identity-only, non-paid use case per the audit's own finding that "unlock" today conflates identity resolution with (nonexistent) contact-detail enrichment.

**Tests:** New test(s) proving the button's actual network call matches its displayed cost. Full offline suite at the same baseline.

**Commit requirements:** One commit, referencing the product decision made and by whom (quote the user's answer in the commit message).

**Acceptance criteria:** The UI's stated cost matches what the triggered code path actually charges, verified by a test, not just a manual check.

**STOP.** This is the end of the cleanup phase. Do not proceed into any rebuild prompt (R1 onward) without a fresh review of C1–C3's committed state first.

---

# PART 2 — REBUILD (replace → prove → delete, one system at a time)

## R1 — GPT raw-query Mission compiler (shadow, then cutover)

**Objective:** Today, GPT never sees the user's raw sentence in the live planning path — a chain of at least five independent deterministic regex parsers (`leadEntityIntent.ts`, `jobSearchSpec.ts`, `qualifiedLeadRouting.ts`, `leadIntent.ts`, `leadIntentModel.ts`) extracts meaning first, and GPT only sees a pre-extracted whitelist. A correctly-shaped GPT mission-compiler call already exists — `supabase/functions/_shared/leadMissionCompilerBinding.ts`, gated by flag `GPT_LEAD_MISSION_COMPILER` + workspace allow-list — but is off by default. This prompt turns it on, proves it, then makes it authoritative.

**Files to inspect (verify fresh):**
- `supabase/functions/_shared/leadMissionCompilerBinding.ts` — `proposeMission()`, its exact prompt/schema, what fields it currently asks GPT to extract.
- `supabase/functions/_shared/leadMissionCompiler.ts` — `compileLeadMission()`, how it merges a GPT proposal with deterministic fallback/repair.
- `supabase/functions/pilot-chat/index.ts` — `buildMissionForPrompt()`, the actual call site.
- `supabase/functions/_shared/leadEntityIntent.ts`, `jobSearchSpec.ts`, `qualifiedLeadRouting.ts` — read these fully; you are about to make them non-primary, so you need to know exactly what they currently extract (geography, persona, signals, execution_mode, no-broadening, quantity, exclusions) so the GPT schema can cover the same ground without losing information.
- `tests/planner-eval/dataset.ts` — the existing 15-case dataset; reuse it, do not invent a new one.

**Stage A — Schema extension (no model call, no spend).** Extend the GPT mission-compiler's structured-output schema so it explicitly asks for every field the deterministic parsers currently extract: geography (with a hard/soft flag), persona/decision-maker intent, hiring/signal terms, requested quantity, exclusions, recency, explicit restrictions (no-broadening), allowed broadening, supplied companies/entities, and social/hiring/research intent. Write this as a schema change only — do not call anything yet.

**Stage B — Offline replay (no live model call).** Using the 15-case dataset's `query` field only (no network), confirm the schema change alone doesn't break anything — run `deno check` and the existing offline `tests/planner-eval/` test suite.

**Stage C — Real shadow comparison (small, budget-capped model spend, requires approval).** Turn on `GPT_LEAD_MISSION_COMPILER` for one TEST workspace. Before making any real call: compute and report the exact model, expected call count (15, one per dataset case), token estimate, and maximum cost — mirroring the format used for prior real-GPT qualification runs in this engagement (exact model name, provider, calls, tokens, cost, wait for approval). **STOP and wait for explicit human approval before Stage C's real calls.** Once approved: run all 15 cases through the now-live GPT mission compiler, capture its structured output for every field, and compare field-by-field against what the deterministic parsers currently produce for the same 15 cases. Produce a written comparison report — not a cutover.

**Deletion targets:** None yet in this prompt. Stage C is measurement only.

**Tests:** New regression tests locking in the extended schema's shape. The shadow-comparison report itself, saved as an artifact (not code) for the next prompt to reference.

**Commit requirements:** Two commits: one for the schema extension (Stage A/B), one for nothing code-related from Stage C (the comparison report is a document, not a commit — save it under `artifacts/`, do not commit it unless asked, matching this engagement's own convention).

**Acceptance criteria:** A field-by-field comparison report exists showing where GPT's raw-sentence extraction agrees and disagrees with the current regex pipeline, across all 15 cases, with disagreement severity noted per field.

**STOP.** Do not cut over to GPT-primary in this prompt. That is R2's job, and only if this report shows acceptable agreement — a human needs to read this report and decide, not the agent.

---

## R2 — One canonical Mission (cutover + consolidation)

**Depends on:** R1's shadow comparison report, reviewed and approved by a human.

**Objective:** Two things, in order: (1) make the GPT mission compiler authoritative for new requests, with the deterministic parsers as fallback-only (not primary) when the model call fails or is disabled; (2) consolidate the mission/intent shape proliferation the audit found — `LeadEntityIntent` is independently recomputed at two live call sites for the same request, and there are 10 distinct mission/intent-shaped types total.

**Files to inspect (verify fresh):**
- `supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts:147` and `supabase/functions/run-agent/index.ts:1136` — the two independent `compileLeadEntityIntent()` call sites for the same request. Confirm this duplication still exists before changing it.
- `supabase/functions/_shared/leadIntentModel.ts` (`SeparatedIntent`) and `supabase/functions/_shared/peopleSearchQueryBuilder.ts` (`PeopleSearchIntent`) — two further re-parses inside `run-agent` alone.
- `supabase/functions/_shared/leadMission.ts` (`LeadMissionV1` — the one shape that's already persisted and spend-gating; this becomes the canonical base).
- `supabase/functions/_shared/intelligence/mission.ts` (`AgentoryMission`) and `supabase/functions/_shared/intelligence/leads/leadMission.ts` (`LeadSourcingMission`) — confirm via fresh grep whether these still have zero live callers (the Claude planning path was off by default at audit time; re-confirm the flag state before deleting anything built on them).

**Stage A — Cutover.** Make `leadMissionCompilerBinding.ts`'s GPT call the primary path for building `LeadMissionV1`, with the existing deterministic parse (`parseLeadMissionDeterministic()`) as the fallback used only when the model call is disabled, times out, or fails validation — the same "propose, validate, repair-or-fallback" pattern already used elsewhere in this codebase (e.g. `leadStrategyValidator.ts`'s `validateLeadStrategy()`/`deterministicLeadStrategy()` pair). Do this behind a flag first, TEST-only, shadow-compared against R1's report before flipping the default.

**Stage B — Consolidate `LeadEntityIntent`.** Make it computed exactly once per request (at `leadPlanOrchestration.ts`'s plan-time call), persisted as part of the canonical mission (fold its `execution_mode`, `company_gate_required`, `freshness`, and signal fields into `LeadMissionV1` directly, following the `CanonicalLeadMission` shape sketched in the audit §7.3), and read (not recomputed) at `run-agent/index.ts:1136`.

**Stage C — Retire the Claude-only mission shapes, conditionally.** Fresh-grep `AgentoryMission`/`LeadSourcingMission` for live callers. If genuinely zero (and the Claude planning flag is confirmed still off), delete both types and their construction functions. If the flag has been turned on since the audit, or callers exist, **STOP and report** — do not delete a shape a live, flagged-on path depends on.

**Deletion targets:**
- `SeparatedIntent` (`leadIntentModel.ts`) and its construction call in `run-agent/index.ts` — once Stage B's persisted canonical mission carries the same information, this re-parse has nothing left to do.
- `PeopleSearchIntent`'s redundant re-parse in `run-agent/index.ts` (not the whole `peopleSearchQueryBuilder.ts` file if it serves other purposes — check first).
- `AgentoryMission`/`LeadSourcingMission`, conditionally per Stage C.

**Tests:** Full regression suite proving `run-agent/index.ts`'s behavior is unchanged when reading the persisted intent instead of recomputing it. New tests proving `LeadEntityIntent` is computed exactly once per request (count actual invocations, don't just read the code and assume).

**Commit requirements:** Separate commits for Stage A (cutover), Stage B (consolidation), Stage C (conditional deletion) — do not squash these; if Stage C is blocked, Stages A and B should still land.

**Acceptance criteria:** GPT-primary mission compilation is live in TEST for at least one workspace. `LeadEntityIntent` has exactly one construction call site per request, verified by an invocation-counting test (the existing `leadPlannerCallSite.test.ts` pattern — driving the real call site with counted stubs — is the right model to follow here). The Claude-only shapes are either deleted (with proof) or explicitly left in place with a written reason.

**Estimated LOC:** meaningfully net-negative once Stage C completes; do not be alarmed if Stage A/B alone are net-positive (schema/plumbing work) — the deletion in Stage C and R8 later is where the reduction happens.

**Paid execution allowed:** TEST-only, small budget, same approval-gate pattern as R1 Stage C.

**STOP.** Report which of Stage A/B/C completed and which were blocked, before proceeding to R3.

---

## R3 — Three governed playbooks

**Depends on:** R2 (a canonical mission with `execution_mode` reliably populated, from GPT or fallback).

**Objective:** Today only `company_first` is a real, working execution shape. `person_social_first` has **no execution path at all** — a person-first request falls through to the ungoverned legacy `generic_sourcing_v1` branch, entirely outside `leadOwnership.ts`'s tracked owners. `existing_list_first` exists as a capability-graph entry point (`known_company_resolution`) but is unreachable in the realistic case because `extractKnownCompanies()` only matches domain-looking strings, not company names, and is additionally blocked by a `!wantsPeople` condition that the realistic supplied-list query ("research these companies and find their decision-makers") fails. Build both for real.

**Files to inspect (verify fresh):**
- `supabase/functions/run-agent/index.ts` — read the full `if (shouldRun && routingEntityIntent && isCompanyFirstRequest(routingEntityIntent))` block (audit found it spans roughly lines 1177–3493) to understand exactly what it does before adding a sibling branch — do not extend this block, build a new one alongside it.
- `supabase/functions/_shared/runAgentCompoundBridge.ts` (`isCompanyFirstRequest()`).
- `supabase/functions/_shared/leadCapabilityGraph.ts` — the six existing entry capabilities (`known_company_resolution`, `job_discovery`, `startup_company_discovery`, `general_company_discovery`, `funding_signal_discovery`, `expansion_signal_discovery`) and `buildCapabilityGraph()`'s entry-selection logic.
- `supabase/functions/_shared/leadMission.ts` (`extractKnownCompanies()`) — the domain-only regex that needs to become a real company-name/list extractor.
- `supabase/functions/_shared/radarIntel/` — real LinkedIn-post/social discovery code exists here, wired only into the separate `run-radar-scan` function, persisting to `public.signals` not `lead_candidates`. Evaluate whether any of this is reusable for the new `person_social_first` entry point, or whether it's genuinely a different concern (radar/monitoring vs. lead sourcing) — do not assume either way, read it first.

**Stage A — `existing_list_first` (smaller, do this first).** Add a `known_entities`/`supplied_companies` field to the canonical mission (GPT should be asked for this directly per R1's schema — company names, not just domains). Fix `extractKnownCompanies()`'s deterministic fallback to also recognize plain company names when GPT is disabled (a reasonable heuristic: capitalized multi-word noun phrases following "these companies:"/"companies:" list-style punctuation — keep it conservative, false negatives are safer than false positives here). Remove or correct the `!wantsPeople` condition that currently blocks a supplied-list-plus-decision-maker request from being classified as list-first.

**Stage B — `person_social_first`.** Add a genuine entry point: when the canonical mission's `execution_mode === "person_first"` (not `company_first`), route to a new, ledger-tracked execution owner (add it to `LeadExecutionOwner` in `leadOwnership.ts` — do not leave it untracked like `generic_sourcing_v1`). Its pipeline: person/social discovery → employer/company resolution → evidence → company qualification → decision-maker authority → Workbench, reusing `capability_engine_v1`'s existing capability-graph machinery rather than hand-rolling a fourth engine — add the missing entry capability to `leadCapabilityGraph.ts` rather than bypassing it.

**Deletion targets:** None yet — this prompt only builds real paths where none existed. The corresponding legacy fallback deletion is R5's job, once this prompt's paths are proven.

**Tests:** New acceptance tests built directly from realistic phrasings — reuse the dataset's own `social-01` ("Find 5 LinkedIn posts where founders complain about outbound problems") and `enrich-01` ("Research these companies... Fireworks AI, Notch...") cases as the primary acceptance fixtures, since the audit specifically traced these as the real-world failure cases. Prove each now reaches a governed owner and produces a Workbench-shaped result (offline — stub any provider call).

**Commit requirements:** Separate commits for Stage A and Stage B.

**Acceptance criteria:** `routeQualifiedLead`/`isCompanyFirstRequest`-equivalent classification for `social-01` and `enrich-01` now resolves to a **governed** owner (present in `LeadExecutionOwner`), not the ungoverned fallback. Both new paths pass through the same evidence/Company-Brain/decision-maker stages `company_first` already uses — no shortcut around qualification.

**Paid execution allowed:** No, offline/stubbed only in this prompt.

**STOP.** Report both new paths' test results before proceeding to R4.

---

## R4 — Provider/capability consolidation

**Objective:** The audit found **10** overlapping provider/capability registries (not the 4 originally assumed, not even the 9 from an earlier pass). `actorRegistry.ts` is the ground-truth tier (real actor IDs, runtime gating). `leadCapabilityGraph.ts` is the orchestration tier and is already code-documented as `hiringRouteContract.ts`'s successor (`leadMissionRuntime.ts`'s `legacyLoopReachable()` names the older path legacy directly) — but `leadCapabilityGraph.ts` itself has a real, newly-introduced drift problem: its `providers[]` arrays are hardcoded string literals, not derived from `hiringActorCatalog.ts`'s verified cost/defect data. Fix this *during* consolidation, not after.

**Files to inspect (verify fresh — re-run this grep yourself, do not trust the count below):**
- `supabase/functions/_shared/actorRegistry.ts` (root, ~21 entries)
- `supabase/functions/_shared/actorCapabilityRegistry.ts` (~7 entries)
- `supabase/functions/_shared/hiringActorCatalog.ts` (~7 entries, richest verified data — target merge destination)
- `supabase/functions/_shared/hiringSourceCatalog.ts` (~5 entries)
- `supabase/functions/_shared/hiringRouteContract.ts` (3 routes, already legacy per `legacyLoopReachable()`)
- `supabase/functions/_shared/leadCapabilityGraph.ts` (16 capability IDs, orchestration root)
- `supabase/functions/_shared/intelligence/leads/leadCapabilityCatalogue.ts`
- `supabase/functions/_shared/intelligence/capabilityRegistry.ts`
- `supabase/functions/_shared/sourceCapabilities.ts` (UI-facing, legitimately separate — do not fold this one in, just re-point its underlying keys if they move)
- `supabase/functions/_shared/intelligence/leads/leadCapabilityCards.ts` (a 10th registry-shaped file the audit found late — confirm it still exists and re-derive its caller list)

For each: confirm it still exists, re-count its entries, and re-grep its full caller list (do not trust the audit's counts — they may have shifted).

**Stage A — Merge data into `hiringActorCatalog.ts`'s schema.** Fold `actorCapabilityRegistry.ts`'s evidence-category typing, `hiringSourceCatalog.ts`'s semantic-filter/evidence fields, `intelligence/capabilityRegistry.ts`'s department/environment gating, and `leadCapabilityCards.ts`'s adaptive-strategist grades into `hiringActorCatalog.ts`'s card shape as additional optional fields (it already has the richest, most rigorously-verified data — live-benchmarked defects, real USD cost models). Do not build a new file.

**Stage B — Fix `leadCapabilityGraph.ts`'s hardcoded providers.** Change its `CapabilitySpec.providers` arrays to read from the merged `hiringActorCatalog.ts` (via `actorRegistry.ts` for actual actor IDs) instead of hardcoded string literals. This closes the drift the audit flagged.

**Stage C — Repoint every caller.** Audit estimated 45-55 call sites across the mid-tier registries, concentrated in tests (mostly import-path changes). Do this file by file, running the full test suite after each.

**Stage D — Retire `hiringRouteContract.ts`.** Once `leadCapabilityGraph.ts` (via Stage B's fix) can answer every question the route contract answered (including its `actorLimitationBriefing()` defect/limitation surfacing), and `legacyLoopReachable()` returns false for all live traffic, delete it.

**Deletion targets:**
- `actorCapabilityRegistry.ts`, `hiringSourceCatalog.ts`, `intelligence/capabilityRegistry.ts`, `leadCapabilityCatalogue.ts`, `leadCapabilityCards.ts` — once Stage C repoints every caller.
- `hiringRouteContract.ts` — Stage D, gated on `legacyLoopReachable()` proving false.

**Acceptance bar (explicit, from the audit):** the unified registry must select the **same-or-cheaper valid provider** for every existing hiring fixture — run the existing hiring-fixture test suite before and after and diff provider selection, not just pass/fail.

**Tests:** Every existing hiring fixture, re-run against the consolidated registry. A dedicated regression test for the two real conflicts the audit found (two differently-vendored "LinkedIn jobs" actors that must not be conflated by name-matching; the two YC-scraper actors' drift into `hiringActorCatalog.ts` without a corresponding `actorRegistry.ts` entry). Full offline suite at baseline.

**Commit requirements:** One commit per stage (A/B/C/D), not squashed — Stage C alone may need several commits, one per batch of repointed callers, to keep each reviewable and revertible independently.

**Acceptance criteria:** Zero remaining imports of the retired files (grep-verified). `leadCapabilityGraph.ts` has zero hardcoded provider-key literals. Hiring-fixture parity proven, not assumed.

**Paid execution allowed:** No.

**STOP** after Stage D, or after whichever stage you reach — report exactly which stages completed.

---

## R5 — Removal of `generic_sourcing_v1`

**Depends on:** R3 (both new governed playbooks live and proven).

**Objective:** `generic_sourcing_v1` is a legacy fallback path in `run-agent/index.ts` (audit found it around lines 3848/4561) that is **not** a member of `LeadExecutionOwner` in `leadOwnership.ts` — it runs entirely outside the ownership ledger's "one task, one owner" discipline, with no capability graph, no evidence gates, no Company Brain qualification. It exists today only because person-first and supplied-list requests had nowhere governed to go. Once R3 gives them somewhere governed to go, this path should have zero real traffic — verify that, then delete it.

**Files to inspect (verify fresh):**
- `supabase/functions/run-agent/index.ts` — every reference to `generic_sourcing_v1`, and the `if (shouldRun) { ... }` block it lives in (audit found this starts around line 3495, right after the company-first block's unconditional `return`).
- `supabase/functions/_shared/leadOwnership.ts` — confirm `LeadExecutionOwner`'s current membership (should now include the new `person_social_first`-equivalent owner from R3).

**Stage A — Prove zero real traffic.** Before deleting anything, add (temporary) logging/counting to confirm that with R3's paths live, nothing in your TEST traffic/replay set reaches the `generic_sourcing_v1` branch anymore. If anything still does, find out why — there's a request shape R3 didn't cover, and R3 needs a follow-up before this prompt can proceed, not a workaround here.

**Stage B — Delete.** Remove the `generic_sourcing_v1` branch and its associated dead code (`runAdaptiveSourcing`/`sourcingRetry.ts` if nothing else calls it — check first, this may be shared with other paths).

**Deletion targets:** The `generic_sourcing_v1` branch in `run-agent/index.ts`. `_shared/sourcingRetry.ts`'s `runAdaptiveSourcing`, only if grep confirms no other caller.

**Tests:** A test asserting every one of the dataset's 15 cases (plus R3's new acceptance cases) resolves to a tracked `LeadExecutionOwner`, never falls through to an untracked path. Full offline suite at baseline.

**Commit requirements:** One commit, with Stage A's traffic-proof evidence quoted in the commit message.

**Acceptance criteria:** `grep -r "generic_sourcing_v1" supabase/` returns nothing. `LeadExecutionOwner`'s membership accounts for 100% of governed traffic — no ungoverned fallback remains.

**Paid execution allowed:** No.

**STOP.** If Stage A finds real traffic still falling through, stop there and report which request shape is uncovered — do not delete a path that's still catching real cases.

---

## R6 — Decision-maker consolidation

**Objective:** The audit found five decision-maker-related implementations: the canonical pipeline (`_shared/decisionMaker/`, live, correctly scoped to the manual `find_decision_makers` action), `decisionMakers.ts` (plural, live but narrow — offline text parsing only, at ingest via `memoryWriter.ts`), a top-level `employerVerification.ts` and `companyIdentity.ts` genuinely distinct from their same-named counterparts inside `decisionMaker/` (different type shapes: a 5-valued string enum vs. an object with `.status`), and `workbench/decisionMakerResolver.ts` (a reconciliation shim between two storage locations). C1 already removed the one proven-dead piece (`runDecisionMakerDiscovery`). This prompt consolidates the four remaining live ones.

**Files to inspect (verify fresh):**
- `supabase/functions/_shared/decisionMaker/{pipeline,companyIdentity,personProfile,employerVerification,roleFamily,ranking,searchPlanner,providerAdapter,integration,persistenceGuard}.ts` — the canonical pipeline, read in full.
- `supabase/functions/_shared/decisionMakers.ts` — confirm its exact live scope (ingest-time only, no network call, per the audit).
- `supabase/functions/_shared/employerVerification.ts` and `supabase/functions/_shared/companyIdentity.ts` (root, not inside `decisionMaker/`) — read both, diff their type shapes against the `decisionMaker/` versions, and list every caller (audit found `run-agent/index.ts`, `unlock-founders/index.ts`, `compoundSourcingPipeline.ts`, `runAgentCompoundBridge.ts` for the root `employerVerification.ts`).
- `supabase/functions/_shared/workbench/decisionMakerResolver.ts`.

**Stage A — Unify verification/identity types.** Pick one type shape (recommend the `decisionMaker/` versions, since they're the ones the canonical, most-used pipeline already relies on) and make the root-level callers (`run-agent/index.ts`, `unlock-founders/index.ts`, `compoundSourcingPipeline.ts`, `runAgentCompoundBridge.ts`) construct/consume the unified shape instead. This touches a **paid flow** (`unlock-founders`) — treat it with the same shadow-comparison rigor as a planner change: run the unified verification against historical unlock decisions and diff outcomes before cutover.

**Stage B — Unify storage.** `decisionMakers.ts`'s ingest-time write and the canonical pipeline's write currently go to two different storage locations, which is why `workbench/decisionMakerResolver.ts` exists as a reconciliation shim. Collapse to one location. Backfill/reconcile existing data carefully — this needs a read-compatibility window so the Workbench UI doesn't break mid-migration; do not do a hard cutover in one commit.

**Deletion targets:**
- Root `employerVerification.ts` and `companyIdentity.ts`, once every caller is repointed to the `decisionMaker/` versions.
- `decisionMakers.ts`'s independent `verifyCompanyMatch()`/`classifyRole()` logic, once its callers use the unified pipeline instead — but its ingest-time *scheduling* (running cheaply at ingest, before a paid search) is a legitimate distinct stage; do not delete the stage, only its duplicate classification logic.
- `workbench/decisionMakerResolver.ts`, once Stage B proves the storage-reconciliation it exists for is no longer needed (its eligibility-check test cases should be ported first, to confirm the unified single-storage path produces identical outcomes).

**Tests:** Full regression suite for `unlock-founders`' paid flow specifically, given cost sensitivity — this is non-negotiable given real money is at stake. Storage-reconciliation correctness tests (no decision-maker record lost or duplicated in the backfill).

**Commit requirements:** Separate commits per stage; the paid-flow-touching parts of Stage A should be their own commit, reviewable independently from the storage work in Stage B.

**Acceptance criteria:** Zero remaining imports of the four retired pieces. One storage location, proven by the resolver shim becoming genuinely dead code (not assumed dead) before its own removal. `unlock-founders`' paid flow shows zero verification-outcome regressions in shadow comparison.

**Paid execution allowed:** TEST-only, gated on the shadow comparison passing.

**STOP.** Report the shadow-comparison results for the paid-flow change before considering this prompt complete.

---

## R7 — Credit-gated unlock, made first-class

**Depends on:** C3 (the immediate wiring/labeling fix already landed).

**Objective:** C3 fixed the *symptom* (UI cost label vs. actual charge). This prompt makes credit-gated unlock a first-class, tested, structurally-enforced part of the target architecture — ensuring no current or future discovery/qualification path can reach a contact-detail or paid-identity provider without going through the credit gate, and that this remains true as R3's new playbooks and R6's decision-maker consolidation land.

**Files to inspect (verify fresh):**
- `supabase/functions/_shared/leadCapabilityGraph.ts` — the "PEOPLE ARE OFFERED, NEVER SCHEDULED" containment mechanism (`assertProviderAllowed()`/`isProviderAllowedForCapability()`, throwing `CapabilityContainmentError`). Confirm this still holds after R3/R6's changes — re-run the audit's own check: automatic sourcing plans must never include `founder_discovery`/`employer_verification`/`contact_enrichment` in their `steps`.
- `supabase/functions/unlock-founders/index.ts`, `_shared/founderUnlockRunner.ts`, the credit-ledger RPCs (`credits_reserve`/`credits_finalize`).
- Whatever R3's new `person_social_first` playbook added — confirm it also respects the containment invariant (it's new code, it needs this proof independently, not by inheritance).

**Exact objective:** Write a standing architectural test (not a one-off check) that asserts, for every playbook and every capability-graph entry point that exists *after* R3 and R6 land: no automatic sourcing plan ever schedules a contact-detail or paid-identity-unlock capability as a `step` — only as an `offered_capability`. This test should fail loudly if a future change (by anyone, in any future session) accidentally reintroduces early enrichment.

**Deletion targets:** None — this is additive test/guard work. If C3 chose option (a) (wire the real paid flow), remove the now-fully-redundant free re-entry path only if R6 confirms nothing else needs it as a distinct identity-only tier — check this explicitly, don't assume.

**Tests:** The standing containment test described above, run against all three playbooks (`company_first`, and R3's two new ones). A test proving the credit ledger's idempotency/double-spend guards still hold after any storage changes from R6.

**Commit requirements:** One commit for the new standing test, separate from any cleanup it triggers.

**Acceptance criteria:** The containment test exists, passes, and is written so that a future accidental regression fails CI rather than shipping silently.

**Paid execution allowed:** No — this prompt is test-writing, not spend.

**STOP.**

---

## R8 — Final removal of temporary regex parsers

**Depends on:** R2 (GPT-primary mission compilation live and proven in TEST for a meaningful period, not just landed).

**Objective:** The audit's Step-3B critique classified several regex-based functions as **temporary compatibility scaffolding (C)** — useful only because nothing else extracted this information from raw text, explicitly *not* permanent architecture:
- `extractRequiredSignalTerms()` in `jobSearchSpec.ts`
- The two routing-phrase additions in `qualifiedLeadRouting.ts` ("draft outreach", "for outbound")
- The geography/persona/`keyword_queries` backfill logic in `leadPlanOrchestration.ts`

Two other Step-3B additions were classified **B — genuine deterministic validation, keep permanently**: `validateLeadStrategy()`'s no-broadening/required-signal rejection, and `deterministicLeadStrategy()`'s matching fallback fix. **Do not touch the B-classified pieces in this prompt** — they stay regardless of what replaces the C-classified extraction.

**Files to inspect (verify fresh — re-confirm these classifications still hold, do not assume the audit's snapshot is current):**
- `supabase/functions/_shared/jobSearchSpec.ts` — `extractRequiredSignalTerms()`.
- `supabase/functions/_shared/qualifiedLeadRouting.ts` — the "draft outreach"/"for outbound" phrase matches specifically (not the whole routing module — `PERSON_TARGET_RE` etc. may still be needed as a cheap pre-filter, decide based on what R2's cutover actually looks like).
- `supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts` — the backfill block.
- `supabase/functions/_shared/leadStrategyValidator.ts` — confirm exactly which parts are the B-classified validator/fallback logic (keep) vs. anything that specifically depends on the C-classified extractors' output shape (may need adjusting, not deleting).

**Exact objective:** Before deleting anything, confirm via R2's now-live GPT-primary path that `mission.no_broadening_requested`, `mission.required_signal_terms`, `mission.geography`, and `mission.decision_maker_roles` are reliably populated **directly from GPT's structured output**, not from the regex fallbacks, for a representative sample of real (or replayed historical) requests. Only once that's true does deleting the regex extractors stop being a regression risk.

**Deletion targets:**
- `extractRequiredSignalTerms()` and its call site in `leadPlanOrchestration.ts`.
- The "draft outreach"/"for outbound" regex phrases (the routing decision itself should come from GPT's own extracted intent by this point, not text-matching).
- The geography/persona/`keyword_queries` backfill logic — once the canonical mission carries these fields natively from GPT, the backfill has nothing left to compensate for.

**What must NOT be deleted:** `validateLeadStrategy()`'s and `deterministicLeadStrategy()`'s no-broadening/required-signal enforcement (B-classified) — these validate whatever GPT proposes now, they don't extract from raw text, and they remain the deterministic safety net regardless of who does extraction. Keep the deterministic fallback path itself (for when the model call fails/times out) — you are deleting the *primary-path* regex extraction, not the fallback-of-last-resort.

**Tests:** Re-run the full 15-case dataset (plus R3's acceptance cases) through the now-GPT-primary path with the regex extractors removed, confirm no regression on any of the four failure classes the original Step 3B fixed (dropped geography, changed persona, signal made optional, violated no-broadening) — this is the single most important regression check in this entire pack, since deleting these functions is exactly what would reopen those original failures if done too early.

**Commit requirements:** One commit, with the regression-check results (all four failure classes, all 15+ cases) quoted in the commit message as evidence this is safe now, not just claimed safe.

**Acceptance criteria:** Zero remaining primary-path calls to the deleted functions (fallback-path retention, if any, must be explicit and named as such, not accidental leftover code). All four original Step-3B failure classes remain fixed, now via GPT extraction instead of regex.

**Paid execution allowed:** TEST-only, for the regression-check calls, budget-capped and approved the same way as R1/R2.

**STOP.** If the regression check shows any of the four original failure classes reappearing, do not delete — report which one and why, and stop for human review.

---

## R9 — Final independent audit / readiness gate

**Depends on:** R1–R8, all committed.

**Objective:** Before any first paid TEST run across the rebuilt architecture, run a fresh, independent, read-only audit — using the same method as the original audit this pack is based on: verify HEAD, don't trust prior commit messages or this pack's own claims, re-derive everything from current code.

**This prompt should be given to a genuinely fresh session with no memory of R1–R8's implementation**, for the same reason the original audit insisted on independence — a session that just built something is the wrong session to grade it.

**Scope of the re-audit:**
- Re-verify every acceptance criterion from R1–R8 against current code, not against those prompts' own commit messages.
- Re-run the full offline test suite and confirm the baseline.
- Re-confirm the containment invariant from R7 (no automatic path reaches contact enrichment/unlock).
- Re-confirm `LeadExecutionOwner` accounts for 100% of governed traffic (R5's acceptance criterion).
- Re-confirm zero remaining imports of every file this pack's prompts targeted for deletion (C1–C3, R2 Stage C, R4 Stages A/D, R5, R6, R8).
- Produce a definition-of-done checklist matching the original audit's §20, checked off against actual current code, not assumed.
- Explicitly flag anything this pack's prompts claimed to complete that the re-audit cannot verify — do not let an unverifiable claim pass silently.

**Files to inspect:** Start from the same six-area breakdown the original audit used (request path, mission/intent, playbooks, registries, decision-maker/unlock, and now a seventh — GPT/deterministic boundary, re-checked against the *new* state instead of the original one) — a fresh full-repo pass, not a diff-only review.

**Output:** A markdown report (`artifacts/Agentory_Rebuild_Readiness_Audit.md`) plus a PDF, in the same format and rigor as `artifacts/Agentory_Current_State_and_Target_Architecture_Audit.md`, ending in an explicit **READY FOR FIRST PAID TEST RUN: yes/no**, with named blockers if no.

**Tests:** The full offline suite, one more time, as part of this audit's own verification — not trusted from any prior prompt's claim.

**Commit requirements:** None — this is a read-only audit, matching the original's constraints exactly (no implementation, no fixes, even if the audit finds something wrong; findings get reported, not silently patched).

**Acceptance criteria:** The audit report exists, is independently derived, and gives an explicit yes/no readiness verdict with reasoning.

**Paid execution allowed:** No — this prompt is entirely read-only, identical restriction to the original audit.

**STOP.** This is the last prompt in the pack. Do not proceed to a paid TEST run in this same session even if the verdict is "ready" — that decision and its own approval gate (exact model, cost, call count) belongs to a separate, explicitly-authorized follow-up, matching how every paid step in this engagement has required its own standalone approval.

---

*End of prompt pack. Nothing in this document has been implemented — it is 12 prompts (C1–C3, R1–R9) meant for future sessions, written from the audit at HEAD `2567c364f6f0834fb85ae07cb292d9441318b1d2`.*

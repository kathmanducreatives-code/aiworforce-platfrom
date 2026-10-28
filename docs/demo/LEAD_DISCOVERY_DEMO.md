# First end-to-end lead discovery demo

Branch `demo/lead-discovery-e2e`, stacked on PR #196 (`d437d108`) with **both #196 flags off**
(`AGENTORY_GPT_MODEL_FAMILY`, `AGENTORY_MISSION_CONTRACT` unset → gpt-5.6 routing, contract v1;
compiled missions are those of Candidate C except for the parser fix below). Verified offline only.

## The path the demo uses (all existing code)

Pilot chat → mission compiler (GPT, compiled once and stored on the approval card; run-agent reuses
it) → approval card → run-agent worker → `runCapabilityPlan` (guarded Apify invoker, spend ledger,
run budget) → claim verification phase (funding: Atomus, Pvalyou fallback) → canonical P5
qualified set → `createPersistPlan` → Lead Library → Leads page.

Every provider it calls is READY in `PRODUCTION_READINESS` and live-proven:
`apify_linkedin_job_search` (job discovery, hiring), `apify_linkedin_company_details` (enrichment),
`apify_funding_atomus` / `apify_funding_pvalyou` (funding verification).

PR #195 (Apollo / LeadOcean) is **not** on the demo path; see "Not in the demo".

## What this branch fixes (the demo blockers)

| # | Blocker (reproduced offline) | Fix |
|---|---|---|
| 1 | "…companies hiring Account Executives **that** raised funding…" compiled to a **Founder/CEO contact** mission (`executives that` read as people). Also "…hiring Account Executives **in** the last 7 days" (6 of 873 corpus requests). | `parseLeadMissionDeterministic`: a hireable noun (executives, people) right after a hiring verb is the opening, not the deliverable. |
| 2 | Hiring + funding with no industry/size entered through company search, which **refuses an unfiltered search**: 0 results. | `buildCapabilityGraph`: job-first entry when funding discovery is not runnable, a funding verifier is READY, and the profile states no industry, named company or size (sized missions keep the funding pool screen). |
| 3 | Leads page showed no source for these rows; funding was a bare `"pass"`. | `canonicalHardEvidence` → `canonical_decision.hard_evidence` on the row; the Leads view renders each requirement with its standing: **verified** (rule over cited evidence), **provider record** (a provider's own field — never shown as independently verified), **missing**, **not met**. |

## Acceptance (offline) — `tests/edge-functions/_shared/leadDiscoveryDemoE2E.test.ts`

Request: *"Find 100 US companies hiring Account Executives that raised funding within the last six months."*

1. Mission: companies, 100, US hard, hiring AE hard (30-day default, recorded), funding hard 180 days.
2. Entry `job_discovery`; every call is a READY production route; no person/contact purchase.
3. Every call holds a spend reservation; a run budget too small for a call buys nothing.
4. Only the company meeting all three requirements qualifies; funding 300 days old fails; an SDR opening does not prove AE hiring (and no funding is bought for it); no funding record stays *unknown*.
5. One Lead Library row with hiring (verified, posting URL) and funding (provider record, Atomus) evidence.
6. Re-runs and duplicate provider rows create no duplicate account or lead.
7. The same company in two workspaces is two workspace-scoped rows.
8. Missing evidence is shown as missing.
9–10. Parser fix pinned both ways; sized funding missions keep the screen route.

Run: `deno test -A tests/edge-functions/_shared/leadDiscoveryDemoE2E.test.ts tests/frontend/leadRequirementEvidence.test.ts`

## Live demonstration procedure (needs approval — see below)

1. Deploy this branch's `run-agent` (and the frontend build) to the **TEST** project only. No migration: the new data is JSON inside `lead_candidates.raw`.
2. Keep both #196 flags unset until #196's independent review passes.
3. In one internal workspace, send the request with a **small count first** ("Find 5 US companies…") and a run budget (e.g. `provider_usd` ≤ $1.00, `max_candidates` ≤ 10).
4. Check the approval card shows the compiled requirements (US, AE hiring 30 days, funding 180 days) and the estimate; approve.
5. Watch the Workbench; then open Leads → the lead drawer → *Source history*: one line per requirement with its standing and link.
6. Re-run the same request: no duplicate leads.
7. Only after that, the 100-company request with a budget sized from step 3's actual spend.

## Not in the demo (recorded, not fixed here)

* **PR #195** is a parallel discovery path, not connected to the engine. Before it can serve this request:
  * Licensing confirmation is needed.
  * The held migration must be applied.
  * Keys must be configured.
  * The LeadOcean field paths must be confirmed.
  * Its Apify verifier must be wired (it is `null` today).

  Two correctness issues:
  * Its `signal` requirement drops time windows and is satisfied by *any* open role, so a funding requirement can be marked matched by open roles.
  * Its `persist` inserts a new `lead_candidates` row on every run, with no dedup.
* **#196** (GPT-6 Luna/Sol, contract v2, the mission escalation cap) stays off pending its independent review.
* Default family: engine repairs are one per decision with no mission-level cap. The cap exists only under gpt-6.
* "Who should I contact" timeframes and per-signal windows: see #196's audit §10.

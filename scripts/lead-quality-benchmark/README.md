# Lead-quality benchmark

A **replayable, TEST-only** benchmark for one question:

> Does Agentory consistently return real, relevant, evidence-backed leads that a
> founder would genuinely contact?

One fixed query, one tightly-bounded live sourcing run, and cached artifacts so
lead quality can be refined **without repeatedly spending on Apify**.

Fixed query (never paraphrased, never changed between runs):

```
Founders of SaaS startups hiring Sales Operations in the United States
```

## Safety model (read first)

- **TEST only.** The harness refuses to run unless the resolved Supabase project
  ref is exactly `luvostyizefajbltukkc`. Production (`luvostyizefajbltukkc`),
  unknown projects, missing credentials, missing TEST workspace identity, or
  unbounded Apify settings all terminate the run **before any request**
  (`env-guard.ts`).
- **No secrets are printed or committed.** Guards work on credential *presence*
  (booleans), never values; `redact.ts` scrubs any object that is logged.
- **No outreach, ever.** The allow-list is sourcing / decision-makers / company
  research only; every outreach/campaign/dialer/send action throws
  (`live-runner.ts`).
- **Hard Apify budget:** soft-stop $4.50, hard-cap $5.00. The upper-bound cost is
  computed from the bounded limits *before* any call; the run soft-stops at
  $4.50 and never intentionally exceeds $5.00 (`budget.ts`).
- **Run-once:** a LIVE run happens at most once per run id; a second attempt
  (success **or** failure) is refused — refine via replay instead (`run-lock.ts`).

## Pipeline audit (the real runtime chain)

Sourcing entrypoint: the **`run-agent` Edge Function** (`supabase/functions/run-agent/index.ts`),
tool `source_with_apify`, actors resolved from `ACTOR_REGISTRY`
(`supabase/functions/_shared/actorRegistry.ts`). Stages:

| Stage | Where |
|---|---|
| Query interpretation | `leadSearchIntent.ts`, `leadIntent.ts`, `leadProviderQueryBuilder.ts` |
| Company/hiring discovery | `apify_jobs` → `curious_coder/linkedin-jobs-scraper` via `jobsSignalAdapter.ts` / `jobsSignalOrchestrator.ts` |
| Job normalization | `apifyJobsNormalizer.ts` |
| Source gating | `sourceGates.ts`, `leadSourcingGate.ts`, `locationMatch.ts` |
| Company enrichment | `companyEnrichment*.ts`, `structuredCompanyEnrichment.ts` |
| Founder discovery | `apify_people_search` → `harvestapi/linkedin-profile-search` via `contactDiscovery.ts` / `harvestApiPeople.ts` |
| Contact→account association | `contactAccountAssociation.ts` |
| Qualification | `leadQuality*.ts`, `finalQualificationPolicy.ts`, `qualificationPersistence.ts` |
| Ranking / tiering | `leadPreRank.ts`, `leadMatchTier.ts`, `leadDecision.ts` |
| Why-now / explanation | `leadAnalyst.ts`, `leadOpportunity.ts` |

The benchmark **reuses** the real import-clean modules (`isSaasCompany`,
`detectRecruiterProxy`, `parseDomain`, `normalizeCountry`, `normalizeTerm`, …)
rather than a parallel mock, and adds an **independent audit layer** (hard gates,
benchmark score, verdict, why-now/angle audits) that preserves and reports
Agentory's own scores/decisions separately.

## Toolchain

The pipeline is Deno; this harness is Deno too, validated with `deno test`
(the same locked toolchain used by `supabase/functions/_shared/*.test.ts`). The
repo has **no Vitest runner** — do not add one.

```bash
# 48-case deterministic suite
deno test --allow-read --allow-env scripts/lead-quality-benchmark/
# or
npm run qa:lead-quality:test
```

## Modes

```bash
npm run qa:lead-quality -- --mode=dry-run
npm run qa:lead-quality -- --mode=live    --run-id=<id>
npm run qa:lead-quality -- --mode=replay  --run-id=<id>
```

- **dry-run** — validates environment, credentials (presence only), TEST project,
  bounded limits, and the cost upper bound. Invokes no provider, writes no rows.
- **live** — *allowed exactly once.* Invokes the bounded TEST pipeline, captures
  raw provider output + Agentory outputs + run ids, never touches outreach.
- **replay** — offline; re-runs normalization/gates/scoring/ranking/audit against
  cached raw data. Zero Apify calls, deterministic, and compares baseline↔refined.

### Environment for a LIVE run (operator-supplied; never committed)

```
VITE_SUPABASE_PROJECT_ID=luvostyizefajbltukkc   # or a TEST *.supabase.co URL
VITE_SUPABASE_ANON_KEY=<test anon key>
SUPABASE_SERVICE_ROLE_KEY=<test service role>    # optional; used as bearer
APIFY_API_TOKEN=<apify token>                    # configured in TEST edge runtime
BENCHMARK_WORKSPACE_ID=<isolated TEST QA workspace id>
```

> **This repository checkout cannot perform the LIVE run:** it has no `.env`
> (only `.env.example`), and `supabase/config.toml` points at production. The
> env guard therefore blocks `--mode=live` here by design. A paid live run must
> be an explicit, credentialed, one-time operation in a TEST-configured
> environment, with the ~$3 (bounded) Apify spend authorized.

## Artifacts

Runtime artifacts are written under the **gitignored**
`artifacts/lead-quality-benchmark/<run-id>/`:
`run-manifest.json`, `raw-apify-results.json`, `normalized-candidates.json`,
`agentory-results.json`, `benchmark-evaluation.json`, `ranked-leads.csv`,
`rejected-leads.csv`, `quality-report.md`, `human-review.csv`.

A **sanitized, fully-fictional** example set is committed under
[`examples/`](./examples) as the artifact schema reference.

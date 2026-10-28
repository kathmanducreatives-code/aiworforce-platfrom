# First end-to-end lead discovery demo

Branch `demo/lead-discovery-e2e`, stacked on PR #196 (`d437d108`) with **both #196 flags off**. Everything
below is verified offline (mocked providers, local Postgres) only. **No live run has happened.**

## 0. Environment safety — read first

* **There is no isolated TEST Supabase project today.** `supabase/config.toml`, `src/lib/env/projectEnvironment.ts`,
  `scripts/verify-deploy-target.mjs` and `scripts/supabase-target.mjs` all map "test" to the **production**
  project `ohsdatpvfdjdemstoiuj` (`docs/SUPABASE_TARGETING.md`). `npm run supabase:test` reaches production.
* This branch makes that fail closed: while the two refs are equal, `supabase:test` allows only read-only commands
  (`functions list`, `secrets list`, `migration list`, `projects list`, `inspect db`); a deploy, secret or migration
  through it is refused (`testTargetRefusal`, tests/infra/deployTargeting.test.ts).
* **The demo never deploys an edge function.** The live path is the existing guarded TEST worker
  (`.github/workflows/discovery-test-worker.yml`), which runs the approved commit's code in GitHub Actions against an
  isolated project. Before anything starts, the worker refuses:
  * the production and abandoned refs;
  * a ref differing from the Environment's;
  * more than one workspace.

  It also enforces `DISCOVERY_SMOKE_ADMISSION`, a $0.20 provider cap, 5 paid calls and a 300 s mission clock, and
  never sets `LEAD_V2_PROVIDER_PROBE_*` or `LEAD_V2_ALLOW_EXPERIMENTAL_ROUTES` (pinned in
  `demoFundingKickoff.test.ts`).
* The kickoff preparer refuses the production and abandoned refs and requires `--project-ref` for the demo.

### Isolated TEST environment — plan (each step needs approval; nothing here is done)

1. Create a new, empty Supabase project. Record its ref. It must not be `ohsdatpvfdjdemstoiuj` or `wqnigjhcwjxtmordrwno`.
2. Enable `pg_cron` and `pg_net`, then:
   `TEST_PROJECT_REF=<ref> TEST_DB_URL=<url> scripts/test-project/build-test-schema.sh --confirm <ref> --with-held-billing-fix --with-held-admission`
3. Confirm `select jobname, command from cron.job` lists only `sweep-stuck-runs` and `release-stale-credit-reservations`. No job may call production.
4. Seed one internal workspace (`credits_grant` 10 credits). Use no production data and no production keys in its vault.
5. Fill GitHub Environment `discovery-test`, which has a required reviewer:
   * vars `TEST_PROJECT_REF` and `TEST_WORKSPACE_ID`;
   * test-only secrets `TEST_SUPABASE_*`, `TEST_OPENAI_API_KEY` and `TEST_APIFY_API_TOKEN`;
   * an Apify account spending limit.
6. Optional, for viewing results in the Leads UI: a frontend build pointed at the TEST project. Until then, results are checked by SQL.

## 1. What the demo runs (existing code)

Compiled mission (once, by the kickoff) → queue row → TEST worker → `runCapabilityPlan` (job-first discovery, guarded
Apify, spend ledger) → claim verification (funding: Atomus, then Pvalyou) → canonical qualified set →
`createPersistPlan` → Lead Library. Every route is READY in `PRODUCTION_READINESS`: LinkedIn job search, company details,
Atomus and Pvalyou, each with live settlements on record.

## 2. Fixes on this branch

| # | Fix | Test |
|---|---|---|
| 1 | Hiring a role is not a request for people ("companies hiring Account Executives that…" had compiled to Founder contacts) | `leadDiscoveryDemoE2E` DEMO 1, 9 |
| 2 | Hiring + funding with no industry/size enters job-first (company search refused the unfiltered request: 0 results); sized missions keep the funding screen | DEMO 2, 10 |
| 3 | Lead rows carry per-requirement evidence. The Leads page names the **provider** (never an engine rule), says **"Reported by …, not independently confirmed"** for one provider's record, and says **"Independently confirmed"** only when two independent origins agree | DEMO 5, `tests/frontend/leadRequirementEvidence.test.ts` |
| 4 | Kickoff `--scenario demo_funding`: five-company request, D1–D7 interpretation checks, the assumed 30-day hiring window printed and written into the SQL as `ASSUMED, NOT STATED BY THE USER` (exit 3 until `--acknowledge-defaults`), Atomus/Pvalyou templates at **zero starts** | `demoFundingKickoff.test.ts`, `tests/db-contract/demoFundingCatalog.contract.test.ts` |
| 5 | `supabase:test` refuses mutating commands while it resolves to production | `tests/infra/deployTargeting.test.ts` |

**Deduplication.** It is application-level: `createPersistPlan` selects, then inserts, on `(workspace_id, domain)` for
accounts and reuses the company's lead row. Verified by DEMO 6 (re-runs, duplicate rows) and DEMO 7 (workspaces).
**Remaining race:** there is no unique index on `accounts` or `lead_candidates`, so two missions writing the same company
in one workspace *at the same moment* can both insert. It is not reachable in the TEST run: the worker runs one mission
at a time, under a concurrency group of one and a lineage lease. A reviewed unique index (held migration) is the fix before
concurrent customer runs.

## 3. Still blocking a paid five-company run

1. **No isolated TEST project yet** (§0 plan).
2. **Smoke admission read cap.** `authorize_discovery_smoke` (held migration `20261015140000`) refuses read allocations
   over 5 in total. Jobs, details, Atomus and Pvalyou need about 9 (status + dataset each, plus a receipt). Pinned by
   `demoFundingCatalog.contract.test.ts`. Lifting it is a reviewed change to that held migration.
3. **Details per call.** The details template allows one company per call and the smoke one start; five companies need up
   to five starts.
4. **Worker caps** ($0.20, 5 paid calls, 300 s) fit the one-company A7 smoke. Five companies with funding checks will
   likely stop partway; revising them is a reviewed workflow change.
5. **Prices.** The Atomus ($0.0035/company found + $0.00005 start) and Pvalyou basic ($0.02/company + start) maxima in
   `smoke-catalog-demo-funding.json` come from the actor cards and their 2026-09-23 settlements. They must be re-observed on
   the TEST Apify account within 24 h of authorization, and account access and `maxTotalChargeUsd` enforcement must be verified.
6. **GitHub CI** has not run on the release commit: no PR, and the branch isn't in CI's push list.

## 4. What can run safely today, once §0 exists: the zero-purchase rehearsal

```
# 1. Dry run — no model call, no database:
deno run --allow-env --allow-read --allow-write=<out> --allow-net=api.openai.com \
  scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts --scenario demo_funding \
  --project-ref <isolated TEST ref> --approved-by "<name, date>" --out <out> \
  --workspace <TEST_WORKSPACE_ID> --user <TEST user uuid> --pricing-version <v> \
  --jobs-max <µ$> --details-max <µ$> --atomus-max <µ$> --pvalyou-max <µ$> \
  --observed-at <ISO, within 24 h> --price-source "<where observed>" \
  --proposal docs/launch/proposals/demo-funding-reviewed-mission-proposal.json
#    → D1–D7 PASS and "ASSUMED Hiring: … last 30 days is Agentory's default …"; exit 3 until --acknowledge-defaults.
# 2. The same without --proposal, with OPENAI_API_KEY=<TEST key>: one real Luna compile (≤ 2 calls, ≈ $0.006).
# 3. Review <out>/kickoff.sql; run it once on the TEST project as administrator (queues the mission, authorizes
#    every actor for ZERO starts).
# 4. Dispatch discovery-test-worker.yml: confirm_project_ref=<TEST ref>, expected_sha=<CI-green commit>,
#    providers=openai-only, session_minutes ≤ 25. The gate refuses every Apify start; the run shows the
#    mission, model calls and refusals, and buys no provider data.
```

A *paid* five-company run is possible only after §3 items 2–5 are reviewed and a separate authorization SQL sets non-zero
`actor_limits` (proposed in the catalog, not authorized).

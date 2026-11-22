# Company Brain V2 foundation: release manifest

Covers B2.0–B2.4 plus R1.2.1. **Nothing in this document has been run against a hosted project.** Every step that touches production or a new Supabase project needs the owner's explicit approval, given step by step.

## 1. Release commits

The branches are integrated in this order: `launch/hardening` → R1.2.1 → RC → B2.4. Each later branch contains the earlier ones.

| Item | Branch | SHA |
|---|---|---|
| Base | `launch/hardening` (includes PR #278, the date-dependent test fix, and #277) | `784b8829` |
| R1.2.1 workspace binding | `claude/r1.2.1-workspace-binding` | see §8 |
| Brain V2 release candidate (B2.0–B2.3) | `claude/company-brain-v2-rc` | see §8 |
| B2.4 plus the acceptance suite and Brain TEST tooling | `claude/company-brain-v2-b24` | see §8 |
| **Release (everything above)** | `claude/brain-v2-integration` | see §8 |

## 2. Database delta to production

Production (`ohsdatpvfdjdemstoiuj`) already has the V1 memory and the Brain write hardening (see ENVIRONMENT_INVENTORY.md). The release adds three held migrations, applied in this order:

| # | Migration | What it adds | Rollback |
|---|---|---|---|
| 1 | `20261121120000_conversation_workspace_guard` (R1.2.1) | A trigger that binds app chats to the workspace they were created in. Applied on ATLAS TEST since 2026-11-21 | `rollback/20261121120000_…down.sql` |
| 2 | `20261122120000_company_brain_provenance` (B2.2) | `source_kind`, `source_ref` and `reason` on revisions, plus `company_brain_provenanced_write` | `rollback/20261122120000_…down.sql` |
| 3 | `20261122130000_company_brain_memory_activation` (B2.3) | Decision proposals in `company_brain_proposal_submit` | `rollback/20261122130000_…down.sql` |

- **They are additive.** The B2.0–B2.4 code checks each capability and degrades if a migration is missing. For example, a save is recorded without provenance rather than failing.
- **Applying them is not a code prerequisite.** It is needed for the feature to be complete.

**Before migrating production:** the org is on the free plan, so **there are no automatic backups**. Take a manual dump first, kept off the repo:

```bash
supabase db dump --db-url "$PROD_DB_URL" -f prod-pre-brain-v2.sql
```

Also take a data-only dump with `--data-only`.

**Rollback order:** the reverse of the table above (3 → 2 → 1), then redeploy the recorded function versions (§3).

- The down migrations were verified on the local contract lane.
- Rolling back B2.2 keeps the revisions already written; their provenance columns are dropped.

## 3. Function deployment manifest

These are the functions whose own source changed. Each one bundles `_shared` code at deploy time.

> **Revised 2026-11-22 (V2_HOSTED_VALIDATION_PLAN.md §5).**
> - The initial production release is `generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory` and `daily-brief`.
> - `pilot-chat` follows only with the ATLAS owner's sign-off on the ungated `businessModelMatch` and `icpDiscoveryConstraints` rule changes it would carry, or after the ATLAS production release.
> - `run-radar-scan` and `run-monitoring-scan` are deferred.
> - Brain TEST still receives all seven.

| Function | Production now | Why it is redeployed | Depends on |
|---|---|---|---|
| `generate-company-brain-draft` | v46 | B2.0 completion saves: goals, gtm and evidence are not updatable in v46, so **completion saves fail until this is deployed**. B2.1 ICP resolution and B2.2 provenance | migration 2 (degrades without it) |
| `setup-company-brain` | v51 | B2.1 consistency and B2.2 provenance | migration 2 |
| `company-brain-memory` | v1 | B2.3 Teach Agentory, decision proposals and context; B2.4 `context_id` | migration 3 (degrades without it) |
| `pilot-chat` | v211 | R1.2.1 workspace binding; B2.3 ORION memory offer; B2.4 stamp | migration 1 |
| `daily-brief` | v49 | B2.4 Brain stamp on the stored brief | none |
| `run-radar-scan` | (record) | B2.4 single LISA radar rule. **Manual scans are unchanged and stay available** | none |
| `run-monitoring-scan` | (record) | B2.4 stamp. Manual run only; scheduling stays off | none |
| ~~`run-agent`~~ | v275 | **Excluded from the Brain release.** It has 41 bundle commits since v275, mostly ATLAS, and ships with the ATLAS release. LYRA keeps working; it only lacks the B2.4 stamp | — |

- **Not redeployed:** `lisa-monitor`, `orchestrate`, `agent-collaboration`, `lead-pipeline`, `run-lead-action`, `unlock-founders` and `workforce-dashboard` import changed shared modules. They keep their current bundles, which stay valid because every shared change is additive.
- **Kept off:** monitoring scheduling and ORION delegation.
- **Before deploying:** record each function's version with `supabase functions list --project-ref ohsdatpvfdjdemstoiuj`, so a rollback can redeploy from the matching commit.

## 4. Deploy order

1. **Brain TEST:** build (§5), deploy, then run the acceptance suite.
2. **Production database:** take the dump, then apply migrations 1 → 3.
3. **Production functions:** deploy in the table order, without `run-agent`. **Every one of these bundles includes ATLAS's `_shared/missionContract`, and its V4 commits (`9656073e`, `adc69510`) are not yet live, so the ATLAS owner's agreement is required first** (V2_HOSTED_VALIDATION_PLAN.md §5).
4. **Frontend.** The production branch is **verified as `launch/hardening`** (V2_HOSTED_VALIDATION_PLAN.md §2): merging the release is the frontend deploy. Vercel builds every branch, previews included. `main` was last committed on 2026-05-22 and has no Vercel status, while `launch/hardening` deploys on every push. **The production branch could not be verified from this environment.** The owner checks it in Vercel → Project → Settings → Git → Production Branch, or with `curl https://<prod-domain>/version.json` (its `context` and `sha` show the branch and commit). If production tracks `launch/hardening`, merging the release **is** the frontend deploy, so steps 2–3 must be done first.

## 5. Brain TEST environment: reproducibility

This needs a **new, empty** Supabase project. Do not use ATLAS TEST, whose no-Brain guard stays. Do not use `luvostyizefajbltukkc` (AgriDrone).

**Build:**

```bash
BRAIN_TEST_PROJECT_REF=<ref> BRAIN_TEST_DB_URL=… scripts/test-project/brain-test/build-brain-test.sh --confirm <ref>
```

- The script runs `build-test-schema.sh` (baseline, every shipped migration, the held Lead V2 chain, cron detach) **without** the no-Brain guard.
- It then applies the production-equivalent held security migrations, then V1 memory, B2.2, B2.3 and the R1.2.1 guard, and checks the catalogue.
- It refuses production, ATLAS TEST, AgriDrone and the abandoned ref before connecting.
- It was rehearsed on an empty local Postgres (§7).

**Deploy:**

```bash
BRAIN_TEST_PROJECT_REF=<ref> scripts/test-project/brain-test/deploy-brain-test.sh --confirm <ref>
```

- Always passes an explicit `--project-ref`.
- Needs a Supabase access token for that project, held by the owner's local session or a GitHub environment. It is never pasted into chat.

**Secrets:** none are required by the acceptance suite. `OPENAI_API_KEY` is needed only for the optional `--allow-orion-chat` check, which makes one model call.

## 6. Acceptance

```bash
BRAIN_TEST_URL=https://<ref>.supabase.co BRAIN_TEST_ANON_KEY=… BRAIN_TEST_SERVICE_KEY=… \
  deno run -A scripts/test-project/brain-test/acceptance.ts --confirm <ref> --report out.json
```

- Uses fictional data only (Northwind Clinics); it seeds its own users and workspaces.
- Makes no provider or model call.
- Covers eight areas:
  1. profile completion;
  2. ICP conflict resolution;
  3. research suggestions;
  4. provenance;
  5. Teach Agentory;
  6. ORION conversation → memory → new conversation;
  7. one context across ORION, LISA and LYRA;
  8. workspace isolation and roles.
- It was proven locally against real GoTrue, real PostgREST and the real handlers: `tests/browser/brainAcceptance.local.test.ts`, **38/38**.

## 7. Evidence on the release tree (`claude/brain-v2-integration` at `475ce518`, 2026-11-22)

All runs are local: fictional data, loopback only, no provider call.

| Gate | Result |
|---|---|
| Contract lane (real Postgres and PostgREST) | **483 / 0** (at `bcfcce49`; the later commits add only the acceptance suite, the scripts, and `context_id` in one response) |
| Mutation proof | **152 / 152 killed** |
| Edge functions | **10,303 / 0** (includes PR #278's date fix) |
| Infra | 335 / 0 |
| UI | 813 / 0 |
| `deno check`, CI-style | pass |
| tsc / eslint ratchets | 23 / 23 and 1,265 / 1,265, both at baseline |
| Browser (real GoTrue, real page in headless Chrome) | completion 4/4, memory 4/4, cache session 5/5 |
| Hosted acceptance suite against the local stand-in | **38/38**; eight areas; zero model calls |
| Real-process rehearsals | 4 / 0 |
| `build-brain-test.sh` on an empty database | builds; all four catalogue checks ok |
| Rollback 3 → 2 → 1, then re-apply 1 → 3 (same database) | clean both ways; catalogue back to the same state |

## 8. Recorded at release time

| Branch | SHA |
|---|---|
| `launch/hardening` | `784b8829` |
| `claude/r1.2.1-workspace-binding` | `06297002` |
| `claude/company-brain-v2-rc` | `ddc9c389` |
| `claude/company-brain-v2-b24` | this commit's parent is `c4447aaf` (code); docs-only on top |
| `claude/brain-v2-integration` | code tested at `475ce518`; the merge of this document follows |

**Not yet done, and needs the owner:**
- a Brain TEST project;
- acceptance against it;
- the Vercel production branch;
- the production dump and migrations;
- the function deploys.

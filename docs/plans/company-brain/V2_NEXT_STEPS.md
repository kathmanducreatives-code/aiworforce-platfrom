# Company Brain V2: R1.2.1 live gate and Brain TEST setup

Status as of 2026-11-23. Release candidate: `claude/brain-v2-integration`. Nothing below has been run against a hosted project.

## 1. R1.2.1 live acceptance: **not completed**

Evidence (read-only, ATLAS TEST `tlvnfrxzjhsjgdofwehb`, 2026-11-23):
- **No model calls** in the ORION pilot workspace (`a71a…11a1`) since 2026-11-17. The run's spend ledger is never deleted by its cleanup, so a completed run would show here.
- `pilot-chat` on TEST is **v11, deployed about 2026-11-17**, which is before R1.2.1. The run deploys the R1.2.1 build itself (step 5 of the script), so it has never run.
- The R1.2.1 database guard has been on TEST since 2026-11-21: one conversation-workspace trigger is present. Both pilot workspaces exist.

**Correction to earlier notes:** the automatic "TEST deploy" workflow deploys only `lead-pipeline` and `provider-connections` (`deploy-test-functions.yml`). It never redeploys `pilot-chat`, so a push to `launch/hardening` cannot overwrite the R1.2.1 build on TEST.

### Procedure (owner's shell; a paid run, about $0.07 expected, **$0.30 hard limit**)

**What it does:** `scripts/test-project/r11-test-run.sh`, on `claude/r1.2.1-workspace-binding` at `06297002`, runs on ATLAS TEST only:
1. Refuses any URL that names production.
2. Checks TEST secrets by name: `OPENAI_API_KEY`, `AGENTORY_ORION_EVIDENCE_CONTEXT`, `MODEL_SPEND_ENFORCEMENT`, `MODEL_SPEND_CEILING_USD`, `MODEL_SPEND_PERIOD_DAYS`. It refuses if any Terra, routing or model-family override is set.
3. **If `AGENTORY_DELEGATION_ENABLED` is absent, it sets it to `false` on TEST.** This is its only secret write.
4. Snapshots content, tasks, drafts, approvals, missions, provider calls and leads.
5. Seeds the fictional R1.1 records.
6. Deploys `pilot-chat` (the R1.2.1 build) to TEST as one bundle, and refuses unless TEST then serves this exact commit.
7. Runs 20 R1.1 prompts, the **R1.2.1 binding probe** and the isolation probe, then the 14 R1.2 acceptance prompts. No retries.
8. Passes only if nothing was created in the snapshotted tables, spend is ≤ $0.30 (from the ledger) and only OpenAI answered.
9. Cleans up this run's conversations, probe rows and seed. The spend ledger is kept.

**The R1.2.1 probe passes only if:**
- an app-created chat (no workspace) is accepted;
- it is bound to the workspace on first use;
- a new chat that names its workspace is accepted;
- a chat that names a **foreign** workspace is **refused** by the database.

**Requires (owner's machine; never in chat):**

| Need | Source |
|---|---|
| A **clean** checkout of `claude/r1.2.1-workspace-binding` at `06297002`, after `npm install` (esbuild) | git |
| `psql`, `deno`, `node`, the Supabase CLI | local tools |
| CLI access to ATLAS TEST (`npm run supabase:test` checks the target) | the existing login, or `SUPABASE_ACCESS_TOKEN`, with access to the org that holds ATLAS TEST |
| `TEST_DB_URL`: the ATLAS TEST database URL | password manager, or the `discovery-test` GitHub environment's value |
| `ORION_PILOT_OWNER_EMAIL`/`_PASSWORD` and `ORION_PILOT_OUTSIDER_EMAIL`/`_PASSWORD` (fictional TEST users), or their JWTs | password manager |

```bash
git switch claude/r1.2.1-workspace-binding && git pull --ff-only && git status --short   # must print nothing
```

```bash
npm install
```

```bash
TEST_DB_URL='…' ORION_PILOT_OWNER_EMAIL='…' ORION_PILOT_OWNER_PASSWORD='…' ORION_PILOT_OUTSIDER_EMAIL='…' ORION_PILOT_OUTSIDER_PASSWORD='…' scripts/test-project/r11-test-run.sh --confirm tlvnfrxzjhsjgdofwehb
```

**Pass:** the script prints `R1.2.1 workspace binding: ok {…all true…}` and `TEST VALIDATION PASSED`. Keep `r11-transcript.json` and `r12-transcript.json`.

**Coordination:** the run leaves ATLAS TEST's `pilot-chat` on the R1.2.1 build, which is `launch/hardening` plus R1.2.1. Tell the ATLAS session before running.

**Order:** run it **before** the ATLAS TEST transfer, so the transfer cannot change the CLI token's reach mid-run.

## 2. Brain TEST setup checklist

**The free-project limit decides the order.** Production and ATLAS TEST are the owner's two active free projects today. A third free project (Brain TEST) can only be created once production's org is on Pro. **Step 4 is the purchase, and it needs separate approval.**

| # | Step | Who | Approval |
|---|---|---|---|
| 1 | **R1.2.1 live gate** (§1) passes on ATLAS TEST | owner, ATLAS session told | paid run, $0.30 cap |
| 2 | Read-only checks: the GitHub `SUPABASE_ACCESS_TOKEN` is account-wide or org-scoped? ATLAS TEST has no GitHub integration? No overdue invoice? Original org's members noted? Production secret names (`AGENTORY_CHAT_CONTRACT_V4`, `_V4_SHADOW` absent; `_BINDING` not `enforce`)? | owner (dashboard) | none |
| 3 | Create the Free org "Agentory TEST" (owner is its only Owner/Admin). Agree a time with the ATLAS session, then **transfer ATLAS TEST** into it. Check that the ref and URL are unchanged, and that the TEST workflows still authenticate. Replace the token if it was org-scoped. AgriDrone stays paused; move it only if a transfer is offered | owner + ATLAS session | transfer |
| 4 | **Upgrade the original org (production) to Pro**: about $25/month net | owner | **purchase** |
| 5 | In the Free org: create `agentory-brain-test`, region `ap-south-1`, strong DB password into the password manager. Enable the `pg_cron` and `pg_net` extensions | owner (dashboard) | create |
| 6 | Give this session the **ref only**. Keys stay in your shell or a GitHub environment `brain-test` | owner | — |
| 7 | **Build the schema:** `BRAIN_TEST_PROJECT_REF=<ref> BRAIN_TEST_DB_URL='<session pooler URL>' scripts/test-project/brain-test/build-brain-test.sh --confirm <ref>`. Four `ok` lines | owner's shell | write to Brain TEST |
| 8 | **Deploy and set the spend ceiling:** `BRAIN_TEST_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=… scripts/test-project/brain-test/deploy-brain-test.sh --confirm <ref> --spend-ceiling-usd 0.25`. Needs Docker for bundling. Deploys 7 functions, never `run-agent` | owner's shell | deploy to Brain TEST |
| 9 | **Acceptance without the model:** `acceptance.ts --confirm <ref> --report brain-acceptance.json`. Pass = `0 failed`, all 8 areas | owner's shell | none (no spend) |
| 10 | Add `OPENAI_API_KEY` on Brain TEST (Edge Functions → Secrets), then **acceptance with the two real ORION turns:** `… --allow-orion-chat --max-usd 0.25`. Pass = `0 failed` including A6.9–A6.13; the report gives the exact spend (about $0.01 expected) | owner | paid run, $0.25 cap |
| 11 | **Hosted acceptance review:** send this session the two report files | owner → this session | review |

**Full commands:** V2_HOSTED_VALIDATION_PLAN.md §6.

## 3. Then: release preflight (separate approval)

1. Production backup: `scripts/ops/backup-production.sh --confirm ohsdatpvfdjdemstoiuj`, verdict **PASS**.
2. Record the production function versions.
3. **Scope:**
   - `generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory`, `daily-brief`.
   - `pilot-chat` only with the ATLAS owner's sign-off on the two ungated rule changes (V2_HOSTED_VALIDATION_PLAN.md §5).
   - `run-agent`, `run-radar-scan` and `run-monitoring-scan` are excluded.
4. Migrations in order: R1.2.1 guard, then B2.2, then B2.3. Rollback runs in reverse.
5. Merge into `launch/hardening` last. That merge is the production frontend deploy.

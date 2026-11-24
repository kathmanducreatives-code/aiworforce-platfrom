# Agentory: environment source of truth (2026-11-12)

Every claim below names its evidence. Where something could not be checked from this session, it says **UNKNOWN** and names the missing evidence. Production was only **read**: Management API metadata and catalog-only SQL (counts, grants, policies). No production rows were copied, written or deployed.

## 1. Environments

| Environment | Supabase project | Frontend configuration | Backend deployment | Database | Active features | Intended purpose |
|---|---|---|---|---|---|---|
| **Production** | `ohsdatpvfdjdemstoiuj` ("agentory", ap-south-1, Postgres 17.6) | A production build without `VITE_SUPABASE_URL` falls back to this project (`src/integrations/supabase/client.ts` `resolveSupabaseUrl`). Hosting: `.lovable` marker in the repo. **The deployed frontend's commit is UNKNOWN**: there is no hosting API or deploy log in this session. | 25 edge functions, **last deployed 2026-10-13**: `pilot-chat` v206 at `d53a52bb`; `run-agent` v274 at `edb93ff6` (GitHub Actions *Deploy held-back functions* runs 15 and 16). Others came from local Mac folders (`agentory-pr54-deploy`, `agentory-main-local`, a release scratchpad), so their commits are UNKNOWN. **193 commits behind `launch/hardening`.** | 28 migrations (latest `20261012132826`). 3 workspaces, 2 Company Brain rows (counts only). | Company Brain writable (no guard). Chat on the 2026-10-13 code (Anthropic Haiku replies). Monitoring and stalled-lead cron jobs on. **Security flaws open** (see §3). | Real customers |
| **Isolated TEST** | `tlvnfrxzjhsjgdofwehb` ("agentory-discovery-test", ap-northeast-2, created 2026-10-18) | Local Vite with `.env.local` pointing at it. Shows a non-production badge. | `pilot-chat` v1 (2026-11-12 14:16 UTC, bundled deploy, ORION branch); `lead-pipeline` and `provider-connections` from CI at `770383ea` (`launch/hardening`, run 55, 2026-11-10); `daily-brief` v7 via a CLI upload (2026-11-08, commit UNKNOWN). **Not deployed:** `orchestrate`, `run-agent`, Company Brain functions, LISA, LYRA, collaboration. | 5 migrations, including both security fixes (2026-11-12). Two fictional ORION workspaces plus 4 older ones. **0 Company Brain rows; guard trigger enabled.** | ORION chat (OpenAI-only), evidence context for ORION Pilot only, $0.49 per workspace per 7 days spend ceiling (set by the owner, per their report), ATLAS discovery worker (CI). | Safe fictional testing |
| Local development (this session) | none of its own; points at TEST through `.env.local` | Vite on port 8080 | none (edge functions run only as tests) | — | — | Code and tests |
| `luvostyizefajbltukkc` | INACTIVE (paused) project in the same organization | not referenced by current code | — | — | — | Abandoned; do not use |

No staging or preview environment was found: no project, workflow or branch database.

## 2. Configuration that treated production as TEST (fixed locally)

| Where | What it said | Status |
|---|---|---|
| `src/lib/env/projectEnvironment.ts` `CANONICAL_PROJECT_REFS.test` | **`ohsdatpvfdjdemstoiuj`, the production ref.** The app therefore classified the real TEST project as "unknown", badged it "NON-PRODUCTION — tlvnfrxzjhsjgdofwehb", and treated production as TEST. | **Fixed:** now `tlvnfrxzjhsjgdofwehb`, matching `scripts/verify-deploy-target.mjs`. Regression tests added. |
| `src/lib/env/environmentGate.ts` setup screen | "Set VITE_SUPABASE_URL to the **TEST** project URL (https://**ohsdatpvfdjdemstoiuj**.supabase.co)" | **Fixed:** names the isolated TEST URL and says "never the production URL". Test added. |
| `supabase/config.toml` `project_id` | Names production | **Unchanged on purpose.** Never run a raw `supabase` command. Use `npm run supabase:test --`, which pins `--project-ref tlvnfrxzjhsjgdofwehb` and refuses `db push/reset/pull`. |
| CLI wrapper `scripts/supabase-target.mjs` and `verify-deploy-target.mjs` | Already TEST = `tlvnfrxzjhsjgdofwehb` | Correct |
| TEST CI workflow (`deploy-test-functions.yml`) | Deploys only `lead-pipeline` and `provider-connections`, only from `launch/hardening` | Correct, but narrow (see the deployment matrix) |

## 3. Security state (catalog evidence, 2026-11-12)

| Check | TEST | Production |
|---|---|---|
| `lead_model_calls` view: `security_invoker` | `true` | **(none)** |
| anon can SELECT / DELETE through `lead_model_calls` | no / no | **yes / yes** (anyone with the public key can read and delete model-spend rows) |
| Browser write policies on signals and approvals | 0 | **10** |
| Company Brain write guard | enabled (by design) | none (correct: production needs the Brain) |

The two TEST fixes are the held migrations `20261113120000_workforce_v2_security.sql` and `20261114120000_lead_model_calls_view_lockdown.sql`. Applying them to production is **approval item A1** in `AGENTORY_RECOVERY_AND_ROADMAP.md`.

## 4. Repositories, branches and checkouts

- **Repository:** `kathmanducreatives-code/aiworforce-platfrom`. The default and integration branch is **`launch/hardening`**, head `770383ea` (2026-11-10, PR #267).
- **ORION branch** `claude/agentory-audit-roadmap-64uq8n`: **0 commits behind `launch/hardening`, 31 commits plus this pass ahead** (Company Brain V1, LISA V2, collaboration, Workforce V2, Terra harness, ORION evidence, OpenAI-only chat, bundled deploy). None of it is merged.
- **Open PRs:** about 30. Most are **draft, stacked "held" chains**: Company Brain client scope #176/#178/#187, security Phase 1 #166–#173, membership #186/#190–#193, readiness #167/#168/#183/#184. Four non-draft PRs are open against `launch/hardening`:
  - #265 (infra macOS timeout);
  - #238 (provider summary UI);
  - #237 (LeadOcean hiring prototype);
  - #198 (untitled).
- **About 40 other active remote branches** from the last two weeks, mostly ATLAS and mission-engine work that has been merged or superseded.
- **Mac checkouts:** this session cannot see your Mac, so their contents are UNKNOWN. Recommended roles (not verified):
  - `~/Projects/agentory`: **do not touch**; it holds uncommitted work. Treat it as an archive until you commit or export that work yourself.
  - `~/Projects/agentory-latest`: rename-in-place candidate for the **canonical main development checkout** on `launch/hardening`.
  - `~/Projects/agentory-orion-test`: the **isolated TEST UI checkout**, on the ORION branch, with `.env.local` pointing at TEST.
  - `~/Projects/agentory-v4-test` and `~/Projects/agentory-discovery-test-prep`: probably obsolete. Before archiving either, run `git status` and `git log origin/launch/hardening..HEAD` in it.
- **Production release preparation:** a clean `git worktree` of `launch/hardening` at the exact release commit. Never deploy production from a working checkout; the current production functions came from three different local folders, which is why their commits are unknown.

## 5. One development workflow from now on

1. `launch/hardening` stays the integration branch. Every change goes through a PR into it.
2. One feature branch per stream: ATLAS (separate workstream), ORION (this branch), Company Brain, LISA. Rebase or merge `launch/hardening` into it weekly.
3. **TEST deploys come from CI** (extend `deploy-test-functions.yml` to `pilot-chat` with the bundled build). Hand deploys use only the TEST-pinned scripts.
4. **Production deploys only via the `workflow_dispatch` production workflows**, from `launch/hardening`, with the commit recorded. No more deploys from local folders.
5. Each function records its commit at deploy time (`withBuildStamp` exists; publish the SHA).

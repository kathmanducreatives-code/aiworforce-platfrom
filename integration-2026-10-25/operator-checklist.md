# Operator checklist: Lead Discovery to the first controlled TEST run

Every ☐ is a manual check or an approval. Nothing here is done by merging alone.

## A. Before any merge: deployment settings (owner)
- ☐ **Railway** worker service: automatic deployments **off**, and the last deployment is still 12 Oct 07:14. Note its ID.
- ☐ **Netlify** `teal-chimera-be7c79`: builds **stopped**; branch deploys and previews off; no second site builds this repo.
- ☐ **Lovable:** note which branch it syncs; publishing stays manual; no pending pushes.
- ☐ **GitHub:**
  - webhooks contain only hooks you can name;
  - **the Supabase app is not connected**, because it would apply #169's two *normal* migrations on merge;
  - no Vercel or Render app is installed;
  - `CI gate` is a required check;
  - merge commits are allowed.
- ☐ **Workflows:** only `ci.yml` runs on push to `launch/hardening`. `deploy-held-back-functions.yml` and `discovery-test-worker.yml` are dispatch-only.

## B. Merge order (merge commits; delete each head so stacks retarget; full `CI gate` green on each head first)

| # | PR (head) | Stacked on | Notes |
|---|---|---|---|
| 1 | **#181** `90bd993f` clock fix | launch | **First.** Full CI run 40172330252 passed all 16 jobs. Every other PR's edge job is red until it lands |
| 2 | #144 `385173f` | launch | Batch 1 |
| 3 | #153 `6223dd5` | launch | Batch 1. Held reaper SQL, never applied by merging. README row conflict with #158 (keep both) |
| 4 | #149 `c704f92` → #157 `005d508` | #157 on #149 | Batch 2 |
| 5 | #145 `37b3b1a` → #150 `be625f4` → #154 `266dc470` → #158 `b8998427` | each on the previous | Batch 3. README rows: keep all |
| 6 | **#179** `d3d68201` pre-effect guard | launch | Needed for TEST steps 5b/5c. Merges cleanly onto 2–5 and onto #169/#176 |
| 7 | #175 `dbd73f06` S18a | launch | Optional for TEST |
| 8 | #177 `05e288e1` OWN-01 | launch | **Held SQL.** Merging applies nothing |
| 9 | #165 `d0647f6d` → #180 `dd7cba84` | #180 on #165 | Seller facts (C1–C4) |
| 10 | #182 `50928cb4` acceptance pack | #158 | After #158 (merge #158's new head into it first, or let GitHub retarget) |
| — | #184 `cd3a7a00` C5 | #168 (→ #167 → #160 → #147) | Lands with Brain's Phase 2 chain, after **Brain resolves #168 ↔ #169/#176** in `generate-company-brain-draft` (keep AUTH-06's authorized writer) |
| — | #169 → #176 (Brain), #171–#173 (Codex) | their stacks | Owners' order. **When #153 and #169 meet, `mutation.sh` needs one restore loop naming both `$reaper_sql` and `$brain_writer_sql`, plus both proof blocks** (diff on the evidence branch) |
| ✗ | #107 (Codex) | — | **Close or renumber.** It duplicates held `20261019120000` in the same directory |

No PR needs a rebase today: `launch/hardening` is still `8b0e2b6`. After each merge, re-run CI on the next head.

## C. Migrations

**Held** (`supabase/migrations-held/`). Never applied by a merge; each needs its own ⛔ approval and is applied with `psql` in this order:

| Order | File | Gate |
|---|---|---|
| 1 | baseline, V2 chain (`20260910140000`, `20260915120000`, `20261003120000`, `20261011120000`, `20261019120000`) | TEST only, via `build-test-schema.sh` |
| 2 | `20261015140000_discovery_smoke_admission` | TEST only (required for the run) |
| 3 | `20261015130000` re-arm, then `20261022120000` reaper | Billing approval. The reaper only after #156 is deployed |
| 4 | `20261025120000` OWN-01 (#177) | `own01-parent-preflight.sql` must print `OK 0` first |
| 5 | `20261024160000_client_company_brain` (#176, Brain) | After the #174 contract is agreed |
| — | `20261015120000_provider_purchase_claims` | Proposed, not wired: **do not apply** |

**Normal** (`supabase/migrations/`). These apply on deploy, or on merge if the Supabase app is connected:
- #169's `20261023120000` and `20261024120000` (Brain);
- #159's `20261022120000_close_workspace_self_join`. It shares a **version number** with #153's held reaper. That's harmless while the reaper stays held; renumber before promoting it.

## D. TEST secrets (Environment `discovery-test`, by name)
- ☐ vars `TEST_PROJECT_REF`, `TEST_WORKSPACE_ID`
- ☐ secrets `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_SUPABASE_ANON_KEY`, `TEST_OPENAI_API_KEY`
- ☐ **`TEST_APIFY_API_TOKEN` absent** for every zero-Apify step
- ☐ a required reviewer on the Environment
- ☐ the OpenAI TEST project has a **hard** budget
- ☐ a **new** production-test Apify account is verified separately (the old one is assumed unusable), only for the paid A7 later

## E. Rollback
- **Code:** `git revert -m 1 <merge>` in reverse merge order. Nothing deploys unless dispatched.
- **Held SQL:** each has `rollback/<file>.down.sql`. OWN-01's restores the ID-only keys under the same names (round-trip verified).
- **Edge functions:** redeploy the previous SHA with `deploy-held-back-functions.yml` (dispatch, typed SHA). **Worker:** redeploy the previous image.
- **TEST run:** `select public.stop_discovery_smoke('<queue_id>', 'operator stop');` (one-way). Then cancel the workflow run.

## F. Approvals needed (each separately)
1. Merges B1–B10.
2. Hosted TEST: the held migrations C1–C2 (+ C3 or a written waiver).
3. TEST step 2: the providers-off dry run (`--proposal`, $0).
4. TEST step 3: zero-Apify real-GPT (≤ $0.075 OpenAI, $0 Apify).
5. TEST step 5: the retry/resume scenarios (5b needs a temporary membership removal on TEST).
6. Later and separate: the paid A7 (~$0.25), production deploy, production migrations, and enabling Lead V2 for one workspace.

## G. Local gate not covered by CI
`tests/realprocess/run.sh` (real worker processes, SIGKILL adoption, zero-Apify kickoff) is **not run by CI**. Run it on the merged dispatch SHA before TEST. It passed 3/3 on the combined tree once #154 `266dc470` and #158 `b8998427` seeded the requester as a workspace member, which the #179 guard requires.

# Company Brain V2: hosted validation plan

Release candidate: `claude/brain-v2-integration` at `cccfd879`, accepted for hosted validation on 2026-11-22. Nothing here has been purchased, transferred, deployed or migrated. Each owner action below is a separate decision.

## 1. Target infrastructure

| Org | Plan | Projects | Cost |
|---|---|---|---|
| Existing `wokikdjpvidhltivuzgh` | **Pro** | Agentory production `ohsdatpvfdjdemstoiuj` (Micro) | $25 plan + $10 Micro − $10 credit = **$25/month**, plus any usage over quota |
| New "Agentory TEST" | Free | ATLAS TEST `tlvnfrxzjhsjgdofwehb`, Brain TEST (new) | $0 |
| (either) | — | AgriDrone `luvostyizefajbltukkc`, **paused and untouched** | $0 while paused |

Total: about **$25/month**, against $45 for three projects in one Pro org.

### Feasibility (Supabase documentation, 2026-11-22)

**Free project limit.**
- Free projects are counted *per Owner or Admin, across every Free org they own or administer*. The default is two. **Paused projects do not count.**
- ATLAS TEST and Brain TEST are the owner's two free projects, and AgriDrone stays paused, so the arrangement fits exactly.
- Restoring AgriDrone later while both TEST projects are active would exceed the limit. It would need a Pro org or one TEST project paused.
- **Keep the new Free org's Owners and Admins to the owner alone.** Each Owner or Admin is checked against the limit.

**A transfer changes ownership, not infrastructure.**
- Preserved: the project ref and API URL, the API keys (anon and service_role), the JWT secret, the database connection strings and pooler host, Edge Functions and their secrets, cron jobs, auth users and data.
- **No downtime** for Free → Free.

**Who can transfer.** Only an **Owner** of the source org; an Administrator cannot. The same account must be Owner, Admin or Developer of the target org.

**Blockers to check before transferring.** None are expected for ATLAS TEST:
- a GitHub connection on the project (disconnect it first);
- branches (ATLAS TEST has none, checked 2026-11-22);
- log drains;
- Advanced MFA;
- project-scoped members or pending invitations;
- overdue invoices;
- a Free source org that has exceeded its quota.

**No undo.** Not an issue for a Free → Free move, which removes nothing.

**Why ATLAS TEST moves and production stays.**
- Production is never transferred. It stays in the org it is in, and only that org is upgraded, so no production identifier, connection or integration changes.
- **ATLAS TEST must move *before* the upgrade.** Otherwise it would become a Pro project billed at +$10/month. While both orgs are Free, the move has no downtime and removes nothing.

**AgriDrone.**
- It stays paused, and it is never restored, wiped or deleted.
- The documentation does not say whether a *paused* project can be transferred, or how a paused project behaves once its org is Pro. **Check the project's page in the dashboard before upgrading.**
- If the dashboard offers a transfer for it, move it to the Free org too. Paused, it does not count towards the limit.
- If no transfer is offered, leave it paused in the Pro org.
- Either way, nothing is restored.

### What the move changes in this repository and its pipelines

| Item | Effect of moving ATLAS TEST |
|---|---|
| Refs hard-coded in workflows, scripts, `verify-deploy-target.mjs` and `TEST_PROJECT_REF` | **None:** the ref is unchanged |
| API URLs, anon and service keys (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`) | **None:** preserved |
| `TEST_DB_URL` (discovery-test environment) | **None:** connection strings and pooler host are preserved |
| Edge Function secrets on ATLAS TEST (OpenAI, Apify, spend flags) | **None:** preserved with the project |
| `SUPABASE_ACCESS_TOKEN` (GitHub environments `supabase-test` and `production`) | **Depends on the token type.** An account-wide personal access token keeps working, because the owner is a member of both orgs. **A token scoped to the old org stops working for ATLAS TEST.** Check the token page before the move, and if it is org-scoped, create a replacement token with access to the new org |
| GitHub environments, Vercel, Railway | No change: they reach the projects by URL, key and token |

### Brain TEST (new, in the Free org)
- **Name:** `agentory-brain-test`.
- **Region:** `ap-south-1`, production's region, so latency and behaviour match production.
- **Build:** `scripts/test-project/brain-test/build-brain-test.sh`. It refuses production, ATLAS TEST and AgriDrone, and was rehearsed on an empty database and on production's exact Postgres image.
- **Deploy:** `scripts/test-project/brain-test/deploy-brain-test.sh`. It always passes an explicit `--project-ref` and sets the spend ceiling.
- **Free-plan behaviour:** the project pauses after 7 days without activity; one click restores it.

## 2. Vercel production branch: verified as `launch/hardening`

The GitHub record for each commit shows this. Vercel attaches a "Vercel Preview Comments" check only to preview deployments.

| Commit | Vercel deployment | Preview check |
|---|---|---|
| `launch/hardening` 784b8829, 3dd08055, c114a37d, 28d99706, a2c0b55f | yes | **none** (production) |
| `claude/r1.2.1-workspace-binding`, `-rc`, `brain-v2-integration` | yes | **present** (preview) |
| `main` 15831aeb (2026-05-22) | **no deployment at all** | — |

**Consequence:** any merge into `launch/hardening` is a production frontend deploy, and the release's database and functions must already be live. The earlier plan text, "Lovable builds production from `main`", is wrong and is corrected in V2_RELEASE_PLAN.md.

**Final confirmation:** Vercel → project `agentory` → Settings → Git → Production Branch should show `launch/hardening`.

## 3. Production backup procedure (verified)

```bash
PROD_DB_URL='<Session pooler URL>' BACKUP_DIR=<encrypted folder outside the repo> \
  scripts/ops/backup-production.sh --confirm ohsdatpvfdjdemstoiuj
```

**Read-only by construction.** Every production connection runs with `default_transaction_read_only=on`, and the script checks that this holds. A write attempt in that mode was refused in the rehearsal: *"cannot execute INSERT in a read-only transaction"*.

**Steps:**
1. Exact row counts for every table in `public`, `auth` and `storage`, plus a catalogue fingerprint: public functions, policies, triggers and columns.
2. Dump with `pg_dump -Fc`, using Postgres 17 tools. The local `pg_dump` 16 cannot read a 17 server.
3. Counts again. **Any change during the dump fails the run.**
4. **Restore check.** A disposable local container of production's exact image (`supabase/postgres:17.6.1.155`) restores the dump. The row counts and the fingerprint must match exactly. Only allow-listed restore errors are accepted:
   - `pg_cron` and `pg_net`, which live only in the `postgres` database;
   - the platform role `supabase_functions_admin`.
5. Output: `manifest.json` with the verdict, plus `SHA256SUMS`.

**Rehearsal (2026-11-22).** The stand-in was production's image with the full schema chain and fictional rows. The backup ran as the non-superuser `postgres` login, as on Supabase.
- 139 tables, all row counts equal.
- Function, policy, trigger and column fingerprints equal.
- 20 restore errors, all allow-listed. **Verdict: PASS.**
- The rehearsal found and fixed one real defect: policy text depends on `search_path`, so the fingerprint now pins it.

**Limits to know:**
- Storage *files* are not in a database dump; the counts report how many objects exist.
- The dump contains customer data, auth users and any secrets stored in cron commands. Keep it encrypted and never commit it.
- If `pg_dump` reports "permission denied" on a platform-owned schema, re-run with `BACKUP_EXCLUDE_SCHEMAS="<schema>"`; the manifest records the exclusion.

## 4. R1.2.1 live acceptance gate: still open, still required

- R1.2.1 (`claude/r1.2.1-workspace-binding` @ `06297002`) has passed every local gate, and its migration has been on ATLAS TEST since 2026-11-21. **Its live gate has not run.**
- **What the gate is:** `scripts/test-project/r11-test-run.sh --confirm tlvnfrxzjhsjgdofwehb` on ATLAS TEST:
  - 20 live ORION turns, plus the R1.2.1 binding probe (app-created chat bound on first use; a foreign workspace refused), plus isolation;
  - spend capped at **$0.30** from the ledger;
  - cleans up after itself.
- **Coordination:** it deploys pilot-chat from the R1.2.1 branch to ATLAS TEST. The "Deploy and smoke-test TEST" workflow redeploys `launch/hardening` builds to ATLAS TEST on every push, so run it in a window agreed with the ATLAS session.
- **Position in the release:** it is a precondition for merging the release. It is independent of Brain TEST.

## 5. ATLAS coordination: shared code and `run-agent`

**Every Brain function bundles `_shared/missionContract`.** Since production was last deployed, `launch/hardening` has these ATLAS V4 commits, which are **not live in production**:
- `9656073e` Mission Contract v4 classification;
- `adc69510` V4 contract;
- `262fb3e7` company-first discovery, which reaches pilot-chat behind a flag that defaults to off.

Redeploying the Brain functions would therefore put this ATLAS code into production pilot-chat, notably its lead confirmation card. **The ATLAS owner must agree, or the Brain release must follow the ATLAS release.**

**`run-agent` is excluded from the Brain release.**
- Production has v275, from 2026-10-13. `launch/hardening` has 41 commits in its bundle since then, mostly ATLAS.
- LYRA keeps working on the current bundle; it only lacks the B2.4 stamp.
- `run-agent` ships with the ATLAS release.

A coordination message went to the ATLAS session ("Agentory lead discovery development") on 2026-11-22. It received the message and began checking ATLAS TEST, then stopped at a permission prompt. **No reply yet.** The independent verdict is below.

### Coordination verdict (2026-11-22, read-only evidence)

**ATLAS TEST transfer window: safe now, with one precondition.**
- No GitHub run is in progress or queued.
- The queue has no open items (last change 2026-10-30) and there are no open tasks.
- The last model call was the 08:22 smoke run.
- `discovery-test-worker` and `plan-test-strategy` run on manual dispatch only.
- The two in-database cron jobs (`sweep-stuck-runs`, `release-stale-credit-reservations`) move with the project.
- Only "TEST deploy" can start on its own: it follows CI on every `launch/hardening` push. **The window is any time without a push to `launch/hardening`.**
- **Precondition:** the ATLAS session is disconnected and waiting on a permission prompt for a read-only SQL query against ATLAS TEST. The owner should answer it, so the session doesn't resume mid-transfer.

**Mission Contract: the Brain release can include the newer contract code, under two conditions.**

The bundled changes since production pilot-chat (`2a0438bb`) are `9656073e` and `adc69510`, plus `262fb3e7`, which is flag-gated and defaults to off.
- **What changed:** an optional `operations` field, a new `implied` duplicate kind, and a stricter `empty_mission` check. The schema and instructions of the GPT V4 interpreter also changed.
- **Old and new readers agree on approvals.** The approval hash spreads every contract field (`hashedView`), so production's older lead engine (`run-agent` v275, `lead-pipeline`) hashes a contract exactly as the new code does. The new fields are optional and absent from v1-converted contracts, so old readers ignore nothing they would have needed.
- **Production runs with the V4 flags off.**
  - Messages in the last 30 days: 0 shadow cards, 0 V4 cards, 1 card carrying a v1 contract binding.
  - With `AGENTORY_CHAT_CONTRACT_V4` and `_SHADOW` unset, pilot-chat returns the **v1 mission unchanged** plus its binding stamp (`chatIntegration.contractForCard`).
  - The GPT interpreter, where most of the change sits, is never called.
  - The stricter check applies only to missions that already carry a V4 contract, which production does not create.
- **Other Brain functions:**
  - `generate-company-brain-draft`, `setup-company-brain`, `daily-brief`, `run-radar-scan` and `run-monitoring-scan` reach the contract only as a deep transitive import (through `missionContract/authority.ts`), and create or approve no mission.
  - `company-brain-memory` does not import it.
- **TEST has already run this code** (`784b8829`), and the smoke run passed with "contract mission-contract-v1; criteria frozen".
- **Conditions:**
  1. **Before the deploy,** check the production secret *names*: `AGENTORY_CHAT_CONTRACT_V4` and `AGENTORY_CHAT_CONTRACT_V4_SHADOW` must be absent, and `AGENTORY_CHAT_CONTRACT_BINDING` must not be `enforce`.
  2. **The ATLAS owner acknowledges** that the change reaches production pilot-chat in its dormant state. Turning it on remains the ATLAS rollout's own staged decision (mission-contract-rollout.md §7).

If either condition is not met, the Brain release follows the ATLAS production release.

**`run-agent`: remains excluded** from the initial Brain release. Its 41 bundle commits since v275 are ATLAS lead-engine changes, and B2.4 only adds a stamp there.

**A finding outside the Brain release (production, pre-existing).** The production alarm ("Ops health") has failed on all of its last 100 runs:
- `CRITICAL queue_unclaimed`: one mission has waited about 58,000 minutes (about 40 days).
- `CRITICAL worker_unhealthy`: the worker's `/health` returns HTTP 404.

The last Railway production deploy was 2026-10-12. This is the ATLAS/worker owner's to triage. It does not block the Brain release, but production lead missions started from chat would not be processed until it is fixed.

## 6. Hosted Brain TEST acceptance

**Spending.** Only the opt-in real ORION check spends money: two chat turns, each a request-understanding call plus a conversation call.

| Measure | Value |
|---|---|
| Observed cost on ATLAS TEST (last 14 days, 342 calls, all priced) | understanding ≤ $0.0012; conversation ≤ $0.0028. **≤ $0.004 per turn, about $0.01 for the run** |
| Theoretical worst case under the per-call admission cap ($0.05) | 4 calls × $0.05 = $0.20 |
| **Proposed approved limit** | **$0.25**, enforced three ways (below) |

The three layers of enforcement:
1. **Server, before every call:** `MODEL_SPEND_CEILING_USD=0.25` per workspace, enforced (fail-closed). Each run uses a fresh workspace.
2. **Server, per call:** `AGENTORY_ROUTE_MAX_USD_PER_CALL=0.05`.
3. **Suite, after the run:** check **A6.13** totals this run's ledger rows. They must be priced, non-zero and ≤ `--max-usd`, or the run fails. The suite refuses `--allow-orion-chat` without `--max-usd`, and refuses any limit above $1.00.

**Proven locally** (`tests/browser/brainAcceptance.local.test.ts`; real GoTrue, real PostgREST, the real `generate-company-brain-draft`, `company-brain-memory` and `pilot-chat` handlers; a scripted OpenAI stand-in; no network):
- the 38 checks with no model;
- A6.9–A6.13 pass: a real turn, ORION's offer pending, the editor approves, a **new conversation** answers with the post-approval context id (a different id from before the approval), and the spend is recorded and within the limit;
- **the spend check works:** with a limit below the run's spend, exactly A6.13 fails.

**Commands, in the owner's shell, once Brain TEST exists and each step is approved:**

```bash
# 0. never in chat: the DB URL, the token and keys come from the owner's password manager / dashboard
export BRAIN_TEST_PROJECT_REF=<new ref>

# 1. schema
BRAIN_TEST_DB_URL='<Brain TEST session pooler URL>' \
  scripts/test-project/brain-test/build-brain-test.sh --confirm "$BRAIN_TEST_PROJECT_REF"

# 2. functions + spend ceiling (needs SUPABASE_ACCESS_TOKEN with access to the Free org)
scripts/test-project/brain-test/deploy-brain-test.sh --confirm "$BRAIN_TEST_PROJECT_REF" --spend-ceiling-usd 0.25

# 3a. acceptance without any model call (38 checks)
BRAIN_TEST_URL="https://$BRAIN_TEST_PROJECT_REF.supabase.co" BRAIN_TEST_ANON_KEY='…' BRAIN_TEST_SERVICE_ROLE_KEY='…' \
  deno run --allow-net --allow-env --allow-read --allow-write \
  scripts/test-project/brain-test/acceptance.ts --confirm "$BRAIN_TEST_PROJECT_REF" --report brain-acceptance.json

# 3b. with the two real ORION turns (needs OPENAI_API_KEY set on Brain TEST in the dashboard)
BRAIN_TEST_URL=… BRAIN_TEST_ANON_KEY=… BRAIN_TEST_SERVICE_ROLE_KEY=… \
  deno run --allow-net --allow-env --allow-read --allow-write \
  scripts/test-project/brain-test/acceptance.ts --confirm "$BRAIN_TEST_PROJECT_REF" \
  --allow-orion-chat --max-usd 0.25 --report brain-acceptance-chat.json
```

**Pass criteria:**
- 3a: `0 failed`, all eight areas reported.
- 3b: `0 failed`, including A6.9–A6.13. The report's `notes` gives the exact spend.

## 7. Order of what remains (each step needs approval)

1. Owner: the dashboard checks in §8.
2. ATLAS: reply on §5, and an agreed window for the R1.2.1 gate.
3. Owner: create the Free org, transfer ATLAS TEST (and AgriDrone, if offered), then upgrade the original org to Pro.
4. Owner: create Brain TEST, then run §6 steps 1–3. **Hosted acceptance review.**
5. R1.2.1 live gate on ATLAS TEST (§4).
6. **Release preflight review:**
   - the production backup (§3), with a PASS verdict;
   - production function versions recorded;
   - the order of migrations 1–3;
   - the function list;
   - the ATLAS agreement.
7. Only then: production migrations, then function deploys, then the merge into `launch/hardening`, which is the frontend deploy.

## 8. Dashboard actions for the owner

All in supabase.com/dashboard unless stated. Nothing is purchased or moved until step D.

**A. Look first (no changes):**
1. *Account → Access Tokens.* Is the token used by GitHub (`SUPABASE_ACCESS_TOKEN`) a personal, account-wide token, or scoped to an organization? An org-scoped token needs replacing after the move.
2. *Project ATLAS TEST → Settings → Integrations.* Is GitHub connected? If yes, it must be disconnected before the transfer.
3. *Org → Billing.* There should be no overdue invoice.
4. *Org → Team.* Note the members. Anyone who is not added to the new Free org loses access to ATLAS TEST after the move.
5. *Project AgriDrone* (paused). Look only: does the project's settings page offer "Transfer project"? Do not restore it.

**B. Vercel → project `agentory` → Settings → Git → Production Branch.** Confirm it is `launch/hardening`. The GitHub evidence already says so.

**C. Create the Free org.** *Organization dropdown → New organization*, Free Plan, named for example "Agentory TEST". Be its only Owner. Add other people only as **Developer**, a role that does not count against the free-project limit.

**D. Transfer ATLAS TEST, while the original org is still Free.** *ATLAS TEST → Settings → General → Transfer project → "Agentory TEST".*
- Afterwards, check that ATLAS TEST is still `tlvnfrxzjhsjgdofwehb` at the same URL.
- Then tell this session, and I will check the TEST deploy, worker and smoke workflows still authenticate.
- Optionally move AgriDrone the same way, while it stays paused.
- **Coordinate the timing with the ATLAS session.**

**E. Upgrade the original org to Pro.** *Org → Billing → Change plan → Pro.* Confirm the summary shows production on Micro and a net of about $25/month.

**F. Create Brain TEST in the Free org.** Name `agentory-brain-test`, region `ap-south-1`, with a strong database password stored in the password manager. Then:
1. *Database → Extensions:* enable `pg_cron` and `pg_net`.
2. *Edge Functions → Secrets:* add `OPENAI_API_KEY`, only if step 3b of §6 is approved.
3. Send this session the new **project ref** only. Keys and passwords stay out of chat; they go into your local shell or a new GitHub environment `brain-test`.

**G. Production database connection string, for the backup.** *Production → Connect → Session pooler* (IPv4), using the existing database password. **Do not reset the production database password**, since running services use it.

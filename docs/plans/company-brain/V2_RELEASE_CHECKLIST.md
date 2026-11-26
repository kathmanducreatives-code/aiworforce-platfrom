# Company Brain V2: release checklist

Status as of 2026-11-26. Release tree: `claude/brain-v2-integration` at `7481c8e2`. It contains:
- `launch/hardening` `d46474e4`, which includes ATLAS PRs #279 and #280;
- R1.2.1 `c2f47738`;
- the Brain RC and B2.4.

Every step marked ⛔ needs the owner's separate approval. Nothing below has been done on production.

## Done

| Gate | Evidence |
|---|---|
| Local gates on the release tree | Edge 10,318 / 0 (after a date-pinned test fix). `deno check` passes. Earlier, on the same Brain code: contract lane 483/0, mutation 152/152, browser 4/4 · 4/4 · 5/5, real-process 4/0 |
| **R1.2.1 live acceptance on ATLAS TEST** | **PASS.** See `docs/release/2026-11-26-r1.2.1/R1.2.1_ACCEPTANCE.md`. $0.146 in total; cleanup verified |
| Hosted acceptance suite | 38 checks without the model, plus 5 opt-in real-ORION checks, each with a spend limit. Proven locally |
| Production backup procedure | `scripts/ops/backup-production.sh`. **Read-only is now enforced per transaction**, because the pooler drops `PGOPTIONS`. Rehearsal PASS on `supabase/postgres:17.6.1.155` |
| TEST credentials | Keychain + scoped PGPASSFILE (`scripts/test-env/`). Validated on macOS on 2026-11-26. Self-test 24/24 |
| ATLAS #279/#280 in the Brain bundles | **None.** The deploy scope is unchanged |

## Remaining, in order

### A. Infrastructure: Brain TEST (Free org)

1. ⛔ **Read-only dashboard checks:**
   - deploy-token scope: account-wide, or scoped to an org?
   - does ATLAS TEST have a GitHub integration?
   - any overdue invoice?
   - the org's members;
   - production secret names: `AGENTORY_CHAT_CONTRACT_V4` and `_V4_SHADOW` absent, `_BINDING` not `enforce`.
2. ⛔ **Transfer ATLAS TEST to the new Free org, at a time agreed with the ATLAS session.**
   - Its ref, URL, keys and the Keychain/pgpass settings are unchanged. The pooler host and user stay the same.
   - Run `agentory-test-db check` afterwards.
3. ⛔ **Upgrade production's org to Pro.** About $25/month. This purchase is what frees a third Free project.
4. ⛔ **Create `agentory-brain-test`** in the Free org, in `ap-south-1`. Enable `pg_cron` and `pg_net`.
5. **Add the Brain TEST credential** to Keychain under its own account key. Use a separate settings file, so it can never be confused with ATLAS TEST:
   ```bash
   AGENTORY_TEST_CONF=~/.config/agentory/brain-test-db.conf AGENTORY_TEST_REF=<brain-test-ref> agentory-test-db store-password
   ```
   The settings file needs `AGENTORY_TEST_REF=<brain-test-ref>`.
6. ⛔ **Build:** `build-brain-test.sh --confirm <ref>`. Expect four `ok` lines.
7. ⛔ **Deploy:** `deploy-brain-test.sh --confirm <ref> --spend-ceiling-usd 0.25`. This deploys 7 functions, never `run-agent`, and needs Docker.
8. **Acceptance:**
   - without the model: `acceptance.ts --confirm <ref>`;
   - then ⛔, as a paid run: `--allow-orion-chat --max-usd 0.25`.

   I'll review both reports.

### B. Production preflight (separate approval, after A passes)

1. ⛔ **Backup:**
   ```bash
   PROD_DB_URL=… BACKUP_DIR=<encrypted, outside repo> scripts/ops/backup-production.sh --confirm ohsdatpvfdjdemstoiuj
   ```
   The verdict must be **PASS**. It is read-only.
2. Record the current production function versions with `supabase functions list --project-ref ohsdatpvfdjdemstoiuj`.
3. **Scope:**
   - deploy `generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory` and `daily-brief`;
   - `pilot-chat` only after the ATLAS owner signs off on the two flag-free ATLAS rule changes it would carry (`businessModelMatch` and `icpDiscoveryConstraints`), or after the ATLAS production release;
   - exclude `run-agent`, `run-radar-scan` and `run-monitoring-scan`.

### C. Production release (⛔ each step)

1. Apply the migrations in order:
   1. R1.2.1 conversation guard;
   2. B2.2 provenance;
   3. B2.3 activation.

   The rollback order is 3 → 2 → 1, which has been rehearsed.
2. Deploy the functions in scope with an explicit `--project-ref`.
3. Merge the release into `launch/hardening` **last**. Vercel's production branch is `launch/hardening`, so this merge is the frontend deploy.
4. Smoke test on the fictional internal workspace: no paid calls.

## Open items, not owned by the Brain release

- **The ATLAS discovery attempt on ATLAS TEST (2026-11-25 05:37–05:44)** by user `3d733f7b…` (a gmail.com account). It reserved 2,100 Apify credits and released them, and nothing was purchased. The owner must confirm the account is theirs.
- **The production worker is down** (since about 2026-10-13: Railway trial expired; a 40-day-old mission is still unclaimed). This belongs to ATLAS.
- **The ATLAS Apify pilot stays paused** until the owner approves it separately.

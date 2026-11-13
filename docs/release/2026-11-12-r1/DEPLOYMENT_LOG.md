# R1 deployment log

**Approved by the owner:** `APPROVE R1 3bef8fd03998c4133b9bebaf87acdd03a3dad5f9` (2026-11-13).

## Stage 1: database (production `ohsdatpvfdjdemstoiuj`). DONE 2026-11-13.

**Applied** through the Supabase Management API (`apply_migration`), in order. Each ran as one transaction.

| # | Recorded migration name | Source | Result |
|---|---|---|---|
| D1 | `workforce_v2_security` | `migrations-held/20261113120000_workforce_v2_security.sql` (sha256 `c20a25b9…`), verbatim | success |
| D2 | `lead_model_calls_view_lockdown` | `migrations-held/20261114120000_lead_model_calls_view_lockdown.sql` (`d9ceae2d…`), verbatim | success |
| D3 | `company_brain_server_writes_only` | `migrations/20261023120000_…sql` (`d490ead2…`): the file's three statements | success |
| D4 | `company_brain_authorized_writer` | `migrations/20261024120000_…sql` (`a8fb5531…`): the file's statements | success |
| D5 | `company_brain_memory` | `migrations-held/20261110120000_…sql` (`4f0f3de8…`) with whole-line `--` comments removed. The remaining 931 lines are identical to the original (checked), and the stripped file was re-rehearsed on the production-shaped clone with the same results before applying. | success |

**Preflight** (immediately before D1; matched the 2026-11-12 baseline):
- 28 migrations; 10 browser write policies; view without `security_invoker`;
- Company Brain insert/update policies present; no memory tables;
- rows: approvals 0, signal_events 40, monitoring_subjects 6, ledger 4,517, Brain 2, workspaces 3, members 1;
- Brain row md5: `b88e3760…`, `6b8f3e30…`.

**Post-verification:**
- 33 migrations.
- **0** non-SELECT browser policies on the four tables.
- `lead_model_calls` has `security_invoker=true`.
- `company_brain`: only the member SELECT policy remains; 0 browser write grants.
- 11 `company_brain*` functions; RLS on all 6 `company_brain_*` tables.
- 2 revision rows backfilled (one per existing Brain).
- **Row counts unchanged; both Brain rows byte-identical (same md5).**

**Rolled-back role probes on production:**
- Security: anon cannot read or delete through the spend view. A member cannot insert signals, update approvals or update monitoring subjects. The member still reads their own signals (37) and ledger (4,472). The service role reads 1,392 model rows and writes.
- Company Brain: the browser can neither update the Brain, insert memory nor call the writer. The owner reads their Brain (1) and revisions (1). The writer without a live session returns `session_invalid`.

## Stage 2: flags and functions. PENDING (owner's shell)

`scripts/release/deploy-production-release.sh --check`, then `--deploy`, with `--confirm ohsdatpvfdjdemstoiuj --sha 3bef8fd03998c4133b9bebaf87acdd03a3dad5f9`, from a clean checkout of that commit.

## Stage 3: frontend. PENDING (owner, in Lovable)

## Stage 4: live verification. PENDING (after stages 2 and 3)

## Interim state

The database is ahead of the deployed functions. This is expected and safe:

| Path | Status until stage 2 |
|---|---|
| The live `agentory.space` site | Talks to `wqnig…`, so it is unaffected |
| Production `pilot-chat` (`86ac1b92`) | Writes only through the service role; unaffected |
| Old `generate-company-brain-draft` / `setup-company-brain` | Write through the service role directly. They keep working, without the new role checks, until replaced. |
| Any browser that wrote the Brain directly (old frontend builds) | Now refused, by design |

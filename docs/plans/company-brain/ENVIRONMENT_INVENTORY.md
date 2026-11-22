# Company Brain: authoritative environment inventory

**Verified 2026-11-22 with read-only checks:** Supabase catalog queries (`pg_class`, `pg_proc`, `pg_trigger`, `pg_policies`, `information_schema`), the migration history, the edge function list and aggregate row counts. No customer row was read, and nothing was written.

Project refs were confirmed before every call:
- production `ohsdatpvfdjdemstoiuj` ("agentory");
- TEST `tlvnfrxzjhsjgdofwehb` ("agentory-discovery-test").

## The contradiction, resolved

| Claim | Source | Verdict |
|---|---|---|
| "V1 memory is deployed (production)" | Phase 2 audit, `V2_AUDIT_AND_ROADMAP.md` | **Correct.** |
| "V1 memory was never applied to a hosted project" | My B2.2/B2.3 report, taken from `V1_TEST_DEPLOYMENT.md` and the held README without checking a database | **Wrong.** Production has it. Only TEST lacks it. |

Production applied the V1 memory migration on **2026-11-13**, the same day as the Brain write-hardening migrations. Three repo documents are out of date and are corrected by this inventory:
- `supabase/migrations-held/README.md`;
- `docs/plans/company-brain/V1_TEST_DEPLOYMENT.md`;
- `docs/plans/company-brain/V2_B22_B23_IMPLEMENTATION.md` §intro.

## Production (`ohsdatpvfdjdemstoiuj`)

**Migrations applied (Brain-related):**

| Version | Name |
|---|---|
| 20260816120000 | baseline_schema |
| 20261113075021 | workforce_v2_security |
| 20261113075202 | lead_model_calls_view_lockdown |
| 20261113075433 | company_brain_server_writes_only |
| 20261113075522 | company_brain_authorized_writer |
| 20261113080619 | **company_brain_memory** (V1) |

`monitoring_cron` (20260825140000) and `resume_stalled_leads_cron` are also applied. Monitoring subject `78372f06…` was disabled by containment Option A on 2026-11-20, so automatic monitoring remains contained.

**Schema present:**
- **Tables:** `company_brain`, `company_brain_research_runs`, `company_brain_revisions`, `company_brain_memory`, `company_brain_memory_history`, `company_brain_memory_proposals`, `company_brain_memory_requests`.
- **Revision columns:** V1 only (`actor_kind`, `actor_id`, `permission`, `changed_sections`, redaction fields). **No B2.2 `source_kind`/`source_ref`/`reason`.**
- **Functions:** `company_brain_authorized_write`, `company_brain_write_authorization`, `company_brain_memory_authorize`, `company_brain_memory_write`, `company_brain_proposal_submit`, `company_brain_proposal_review`, `company_brain_memory_redact`, `company_brain_memory_snapshot`, `company_brain_memory_value_valid`, `company_brain_memory_guard_history`, `company_brain_record_revision`.
- **Not present:** `company_brain_provenanced_write` (B2.2). `company_brain_proposal_submit` does not accept decisions (B2.3).
- **Triggers:** `company_brain_record_revision`, `company_brain_set_updated_at` on `company_brain`; the append-only guards on revisions and history.
- **Policies:** member SELECT only on every Brain table. No browser insert or update policy, so writes are server-only.
- `conversations.workspace_id` is present (R1.2).

**Code identity with the repo** (md5 of each function body):
- `company_brain_authorized_write`, `company_brain_record_revision`, `company_brain_proposal_review` and `company_brain_memory_redact` are byte-identical to repo V1 (`afa33cf6`).
- `company_brain_memory_write` and `company_brain_proposal_submit` are identical to repo V1 once SQL comment lines are stripped. The applying tool drops comments. **There is no logic drift.**

**Usage (aggregate counts only):** 2 Brain rows, 2 revisions. **0 memory items, 0 proposals, 0 history rows.** Memory is deployed but has never been used.

**Brain-related edge functions:**

| Function | Version | Last deployed |
|---|---|---|
| `company-brain-memory` | v1 | 2026-11-13 10:16 UTC |
| `generate-company-brain-draft` | v46 | 2026-11-13 10:17 UTC |
| `setup-company-brain` | v51 | 2026-11-13 10:17 UTC |
| `daily-brief` | v49 | 2026-11-13 10:17 UTC |
| `pilot-chat` (R1.2) | v211 | 2026-11-20 09:01 UTC |
| `run-agent` (LYRA content) | v275 | 2026-10-13 |
| `run-monitoring-scan`, `run-radar-scan`, `run-monitoring-tick` | deployed | **not modified** by Brain V2 |

**What this means for release:** production already has V1. The Company Brain V2 database delta is exactly:
- held `20261122120000` (B2.2 provenance);
- held `20261122130000` (B2.3 decision proposals).

Both are additive. The function delta is B2.0–B2.3 code on top of the versions deployed above.

## TEST (`tlvnfrxzjhsjgdofwehb`)

**Migrations applied:** `lead_mission_v2_exhausted_lease_terminal`, `provider_connections`, `lead_pipeline_checkpoints`, `workforce_v2_security`, `lead_model_calls_view_lockdown`, `conversation_workspace_guard` (R1.2.1, 2026-11-21).

**Brain schema present:**
- `company_brain` and `company_brain_research_runs` only.
- **No** memory tables, **no** revisions, **no** `company_brain_authorized_write` and **no** memory RPCs.
- Policies still include browser `company_brain_member_insert` / `company_brain_member_update`, because TEST never received the write-hardening migrations.
- Trigger `discovery_test_no_company_brain` is **enabled ALWAYS**: it refuses every Brain write by design.
- `company_brain` rows: **0**.

**Edge functions:** `daily-brief` v8, `lead-pipeline` v47, `provider-connections` v30, `pilot-chat` v11. **No** Brain function and **no** `company-brain-memory`.

**Conclusion:** TEST cannot host Brain validation in its current form, and must not be changed without approval (it is the ATLAS discovery environment).

## Local verification stack (what B2.0–B2.3 were tested on)

Postgres 17 is built by `tests/db-contract/bootstrap.sh` from the held baseline, every `supabase/migrations/` file and the held chains, including V1, B2.2 and B2.3. GoTrue, PostgREST, the real handlers and the real page run in headless Chrome. Fictional data, loopback only.

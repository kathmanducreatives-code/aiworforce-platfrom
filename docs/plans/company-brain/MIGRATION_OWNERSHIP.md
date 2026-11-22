# Migration ownership: Company Brain vs ATLAS

Two Claude Code sessions change this repository in parallel:
- **Company Brain V2** works on branch `claude/company-brain-v2`.
- **ATLAS V5 / lead discovery** works on its own branches.

This register records which database objects each one owns, so that their held migrations never collide.

## Reserved by Company Brain V2

| Held migration | Objects | Status |
|---|---|---|
| `20261110120000_company_brain_memory.sql` (V1) | `company_brain_revisions`, `company_brain_memory*` tables, the memory and proposal functions, the revision trigger | Held; applied only in the local contract lane |
| `20261122120000_company_brain_provenance.sql` (B2.2) | `company_brain_revisions.source_kind/source_ref/reason`, `company_brain_record_revision`, `company_brain_provenanced_write` | Held; contract lane only |
| `20261122130000_company_brain_memory_activation.sql` (B2.3) | `company_brain_memory_proposals` (decision proposals), `company_brain_proposal_submit`, `company_brain_proposal_review` | Held; contract lane only |

Every file has a rollback in `supabase/migrations-held/rollback/`.

## Shared and frozen
- **`company_brain_authorized_write`** (`20261024120000`, in `supabase/migrations/`) is not modified by B2.2 or B2.3. B2.2 wraps it instead.
- **The ATLAS Brain read contract** must not change: `compilerBrainContext`, `contractBrainInput` (`BrainMergeInput`) and `brainPlanningContext`. It is pinned by `tests/edge-functions/_shared/companyBrainAtlasContract.test.ts` (golden).

## Not touched by Company Brain V2
- ATLAS discovery, actor selection and execution, and their tables and functions.
- ATLAS TEST fixtures.

## Coordination log
- **2026-11-21:** The Brain V2 session sent the ATLAS session (blocked at the time, waiting on the user) a non-interrupting note. It listed the timestamps and objects above and asked that any planned ATLAS migration on these objects be raised with the user. No reply has been received yet. A search of all remote branches found no ATLAS held migration later than `20261114120000`.

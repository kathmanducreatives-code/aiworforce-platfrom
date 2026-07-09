# Junk-lead audit — READ-ONLY dry run (Part 2)

This is an **audit tool only**. It classifies stored leads that *look* like junk so a
human can review them. It **never deletes, archives, or mutates anything** on its own.
Nothing here should be run against production without explicit approval, and even then
the SQL below is `SELECT`-only.

## What counts as an archive candidate

A row is flagged **only** when it has no real value AND no human has touched it:

- no verifiable `source_url` (or an explicit `proof_incomplete` sentinel), or
- the company website is a link shortener (`bit.ly`, `lnkd.in`, `t.co`, …) with no verified domain, or
- the pipeline already flagged it `recruiter_proxy = true` (staffing proxy; real employer hidden), or
- `match_tier = reject` / `gate_decision` contains `reject`, or
- empty identity (no company, no domain, no source).

A row is **protected** (never flagged) when a human acted on it — status/contact/enrichment/draft
is `approved` / `contacted` / `sent` / `replied` / `enriched`, or `draft_status = approved`,
or `raw.user_approved = true`.

The classifier lives in [`../supabase/functions/_shared/leadJunkAudit.ts`](../supabase/functions/_shared/leadJunkAudit.ts)
(`classifyLeadForAudit`, `auditLeadBatch`) and is unit-tested in `leadJunkAudit.test.ts`.

## Step 1 — read-only SQL (run in the Supabase SQL editor, one workspace at a time)

```sql
-- DRY RUN. SELECT only. Scope to a SINGLE workspace. Never cross-workspace.
-- Replace :workspace_id before running.
select
  id,
  company_name,
  website,
  raw->>'domain'            as domain,
  coalesce(source_url, raw->>'source_url', raw->>'job_url') as source_url,
  status,
  raw->>'match_tier'        as match_tier,
  raw->>'gate_decision'     as gate_decision,
  (raw->>'recruiter_proxy')::boolean       as recruiter_proxy,
  (raw->>'website_shortener_dropped')::boolean as shortener_dropped
from lead_candidates
where workspace_id = :workspace_id
order by created_at desc
limit 500;
```

Export the result to JSON/CSV. **Do not** run any `delete` / `update` here.

## Step 2 — classify locally (still a dry run, no DB writes)

Feed the exported rows to `auditLeadBatch(rows)`. It returns:

```
{ reviewed, keep, archive_candidates, protected, archive_ids, reason_counts }
```

`archive_ids` is the list a human could *consider* archiving. Review each reason before
deciding anything.

## Step 3 — STOP

Do not delete. If archiving is later approved, prefer a **soft** archive
(`update lead_candidates set status = 'archived' where id = any(:ids) and workspace_id = :workspace_id`)
over a hard `delete`, scoped to the single workspace, and never touching protected rows.
That step is out of scope for this task and must not be run without explicit approval.

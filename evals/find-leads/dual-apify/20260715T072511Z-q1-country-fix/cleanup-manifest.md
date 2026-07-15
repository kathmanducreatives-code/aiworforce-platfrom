# Cleanup manifest — 4 off-target rows from plan da79cba3 (DRAFT — do NOT execute)

The failed Q1 success-path probe (q1-country-fix-20260715T072511Z) routed a
FOUNDER (person) request to the jobs actor and persisted 4 sales-job/company
records. These are provider-backed (verified provenance) but the WRONG entity
type for the request. This manifest records them for a future authorized cleanup.
**No SQL here has been executed; the rows are NOT modified.**

- workspace_id: `00000000-0000-0000-0000-000000000001`
- plan_id: `da79cba3-e87c-42ab-8ef8-844aeb740415`
- workflow_run_id (provider_run_id): `6a8cec79-5df1-401c-baf8-8cb5b7d462ba`

## Rows (lead_candidates)
| lead_candidate id | account_id | contact_id | drafts | source_url (job) |
|---|---|---|---|---|
| `4d998a84-e126-4e52-ab48-c0d4071b4477` | `f479ba6d-d2f7-4e9b-a89e-7284e2291e91` | none | 0 | .../jobs/view/sales-representative-at-flagpoles-etc-4412229384 |
| `0dd558fd-a04a-44eb-be5a-351336191e7e` | `87e545cb-1550-45d9-9798-16d4957934cd` | none | 0 | .../jobs/view/inside-sales-specialist-...-xcel-energy-4431148792 |
| `5bad7e73-5d63-42bf-b25b-3258dce65a75` | `a19b5a9d-5535-4678-92da-b0ad6079fa99` | none | 0 | .../jobs/view/inside-sales-specialist-at-pursuit-4436103505 |
| `22e7bf6f-3c93-4fdc-a41e-be19f88af680` | `f65fdaea-d97f-4b1a-a24b-d6ec617e6eda` | none | 0 | .../jobs/view/sales-development-representative-at-level-data-4103454950 |

## Dependent rows
- outreach_drafts: **0** (none reference these leads)
- contacts: **0** (contact_id is null on all four)
- accounts: 4 (one per lead) — delete ONLY if no other lead_candidates reference them.

## Safe deletion order (draft SQL — NOT executed)
```sql
-- 1) delete the 4 off-target lead_candidates (scoped to the failed plan)
delete from lead_candidates
where id in (
  '4d998a84-e126-4e52-ab48-c0d4071b4477',
  '0dd558fd-a04a-44eb-be5a-351336191e7e',
  '5bad7e73-5d63-42bf-b25b-3258dce65a75',
  '22e7bf6f-3c93-4fdc-a41e-be19f88af680'
)
and plan_id = 'da79cba3-e87c-42ab-8ef8-844aeb740415'
and workspace_id = '00000000-0000-0000-0000-000000000001';

-- 2) OPTIONAL: remove the 4 orphaned accounts only if no other lead references them
delete from accounts a
where a.id in (
  'f479ba6d-d2f7-4e9b-a89e-7284e2291e91',
  '87e545cb-1550-45d9-9798-16d4957934cd',
  'a19b5a9d-5535-4678-92da-b0ad6079fa99',
  'f65fdaea-d97f-4b1a-a24b-d6ec617e6eda'
)
and a.workspace_id = '00000000-0000-0000-0000-000000000001'
and not exists (select 1 from lead_candidates lc where lc.account_id = a.id);
```

## Notes
- Run against TEST (`zbwsbnqqpkvdhqwavjke`) only. Never production.
- No credentials appear in this file.
- After cleanup, expected workspace baseline returns to lead_candidates = 426.
- Verify counts before/after; wrap in a transaction if executing.

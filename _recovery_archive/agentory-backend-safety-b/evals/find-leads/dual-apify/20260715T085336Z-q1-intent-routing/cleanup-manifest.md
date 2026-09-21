# Cleanup manifest — Q1 test rows (DRAFT — do NOT execute)

Evidence-only. Records the TEST rows that a **separately authorized** cleanup
should remove before the next clean Q1 probe. **No SQL here has been executed;
no rows were modified by this implementation task.** Run against TEST
(`zbwsbnqqpkvdhqwavjke`) only — never production (`wqnigjhcwjxtmordrwno`).

- workspace_id: `00000000-0000-0000-0000-000000000001`

Two independent sets. Keep them separate.

---

## Set A — 5 rejected PERSON rows (this Q1 run, plan d94484db)

The intent-routing Q1 run sourced five genuine HarvestAPI person profiles that
the scoring stack tiered `rejected`; under the old (pre-fix) path they persisted
before Aria. With the fix on `find-leads-person-quality-persistence` they would
be STAGED, not persisted. These already-persisted rows are left in place for a
separately authorized cleanup.

- plan_id: `d94484db-5e60-49ec-a08b-66f7f888bab7`
- provider_run_id: `bd3cda5c-6f79-4be9-be03-f6a13f61762b`

| lead_candidate id | person | company | contact_id | signal_id | account_id | drafts |
|---|---|---|---|---|---|---|
| `9f71135e-758d-42ef-96ce-001f4e6b6015` | Jeff Esposito | VeraAI Technologies Inc. | `c48d96e5-5006-4da1-a628-80d3e0c24e38` | `074cbf59-3384-41f9-bc17-3ca6a58916b7` | none | 0 |
| `033a9983-ba2d-4fcb-b1d7-2e912847b9a4` | Jim Smith | Proper Sky - Managed IT Services | `057e8b76-50c9-4428-85ad-13139e3bc8c9` | `450dad86-772b-4ba8-8642-fdece544d2d5` | none | 0 |
| `af7301ad-d655-4b53-a2ba-22298a026c0b` | Nabeel Farooq | Improdata | `58f2117d-a625-4d2d-8115-bac0152d192e` | `e690a24f-72b3-4fe1-93a4-8a117fe1e03c` | none | 0 |
| `9725d5cb-a84d-4688-862b-5e119138286c` | Kumar Velugula | XNODE Inc. | `3720b7e8-1f43-4ba4-a7dc-a79bf477e15f` | `922bcce9-b104-47f0-bebe-b7a91056470d` | none | 0 |
| `0469f5f3-1423-417c-a5dc-8b81f480248f` | Joe Apfelbaum | evyAI | `6914d225-f03b-47a5-a47a-d71445caac66` | `9ac158d0-3fa8-499e-9796-591131c82287` | none | 0 |

### Dependent rows (Set A)
- outreach_drafts: **0** (none reference these leads)
- accounts: **0** (account_id is null on all five)
- contacts: 5 (one per lead, upserted by linkedin_url)
- signals: 5 (one per lead, `signal_type=people_profile`)

### Safe deletion order (draft SQL — NOT executed)
```sql
-- 1) delete the 5 rejected person lead_candidates (scoped to the Q1 plan)
delete from lead_candidates
where id in (
  '9f71135e-758d-42ef-96ce-001f4e6b6015',
  '033a9983-ba2d-4fcb-b1d7-2e912847b9a4',
  'af7301ad-d655-4b53-a2ba-22298a026c0b',
  '9725d5cb-a84d-4688-862b-5e119138286c',
  '0469f5f3-1423-417c-a5dc-8b81f480248f'
)
and plan_id = 'd94484db-5e60-49ec-a08b-66f7f888bab7'
and workspace_id = '00000000-0000-0000-0000-000000000001';

-- 2) OPTIONAL: delete the 5 signals created for these people (scoped to the plan)
delete from signals
where id in (
  '074cbf59-3384-41f9-bc17-3ca6a58916b7',
  '450dad86-772b-4ba8-8642-fdece544d2d5',
  'e690a24f-72b3-4fe1-93a4-8a117fe1e03c',
  '922bcce9-b104-47f0-bebe-b7a91056470d',
  '9ac158d0-3fa8-499e-9796-591131c82287'
)
and plan_id = 'd94484db-5e60-49ec-a08b-66f7f888bab7'
and workspace_id = '00000000-0000-0000-0000-000000000001';

-- 3) OPTIONAL: delete the 5 contacts only if no other lead references them
delete from contacts c
where c.id in (
  'c48d96e5-5006-4da1-a628-80d3e0c24e38',
  '057e8b76-50c9-4428-85ad-13139e3bc8c9',
  '58f2117d-a625-4d2d-8115-bac0152d192e',
  '3720b7e8-1f43-4ba4-a7dc-a79bf477e15f',
  '6914d225-f03b-47a5-a47a-d71445caac66'
)
and c.workspace_id = '00000000-0000-0000-0000-000000000001'
and not exists (select 1 from lead_candidates lc where lc.contact_id = c.id);
```

---

## Set B — 4 older off-target COMPANY/JOB rows (prior failed run, plan da79cba3)

Unchanged from the prior manifest — recorded here for completeness. These were
persisted by the earlier country-fix probe that routed a founder request to the
jobs actor. See
`evals/find-leads/dual-apify/20260715T072511Z-q1-country-fix/cleanup-manifest.md`
for the authoritative Set B manifest and draft SQL.

- plan_id: `da79cba3-e87c-42ab-8ef8-844aeb740415`
- lead_candidate ids: `4d998a84-e126-4e52-ab48-c0d4071b4477`,
  `0dd558fd-a04a-44eb-be5a-351336191e7e`, `5bad7e73-5d63-42bf-b25b-3258dce65a75`,
  `22e7bf6f-3c93-4fdc-a41e-be19f88af680`
- `lead_type=company`, 4 orphaned accounts, 0 contacts, 0 drafts.

---

## Notes
- Run against TEST (`zbwsbnqqpkvdhqwavjke`) only. Never production.
- No credentials appear in this file.
- Baseline arithmetic: workspace lead_candidates = 435 today. Removing Set A (5)
  → 430; additionally removing Set B (4) → 426.
- Verify counts before/after; wrap in a transaction if executing.
- Do NOT execute as part of the implementation task — a clean baseline is a
  prerequisite for the NEXT Q1 probe, performed under separate authorization.

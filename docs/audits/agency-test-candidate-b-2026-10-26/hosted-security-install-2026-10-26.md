# TEST security migrations installed and verified (2026-10-26)

Installed by the owner in the Supabase SQL Editor of `tlvnfrxzjhsjgdofwehb`
(the connector's confirmation prompt timed out three times; nothing was applied
by it). Verified read-only by Backend afterwards.

| Migration (commit 6d448610) | file sha256 | function body md5 (repo = TEST) |
|---|---|---|
| 20261025130000_tasks_commit_boundary | 10bd098d… | e5d8d05b64e61f5b1a6eeea0e2c65c66 |
| 20261025150000_task_plans_parent_identity | 17f117ea… | ae5fd38ad85f640194ef445738e627b1 |
| 20261025160000_workspace_members_app_surface | 3f514d87… | 28a84ab94661812fe3e23c71701f4029 |

- Triggers (all enabled): tasks_commit_boundary (BEFORE INSERT OR UPDATE OF workspace_id, user_id, plan_id, task_plan_id ON tasks), task_plans_parent_identity (BEFORE INSERT OR UPDATE OF id, workspace_id ON task_plans), workspace_members_app_surface (BEFORE DELETE OR UPDATE, row), workspace_members_app_surface_truncate (BEFORE TRUNCATE, statement).
- Functions owned by postgres; the two plan/task functions SECURITY DEFINER, the membership one INVOKER; EXECUTE revoked from public, anon, authenticated, service_role.
- service_role on workspace_members: SELECT, INSERT only (UPDATE/DELETE/TRUNCATE revoked). authenticated: SELECT only.
- Migration history table unchanged (SQL Editor does not record): `20261021145108 lead_mission_v2_exhausted_lease_terminal` only.

Preflight P01–P17: 14 PASS → **15 PASS (P15 4/4, P16 ok)**, 0 FAIL; P05 re-arm installed (INFO), P06 not installed (INFO), P17 client schema absent (INFO).
Schema S01–S05, S08 PASS; S06/S07 INFO. Zero unexpected failures.

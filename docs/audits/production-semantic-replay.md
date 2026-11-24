# Production semantic replay — run-agent `e4da19e8` → `launch/hardening`

Option E, Stage 7. **No production access and no production change.** Generated offline by
`scripts/dev/production-replay.ts`. It replays every stored `lead-mission-v1` fixture through
the live production `run-agent` compiler (`e4da19e8`) and through this branch's compiler, then
compares what each mission *means*.

**Result: 49 of 83 stored missions would change meaning on a production `run-agent` redeploy.**
`production-replay-approved.json` approves none of them, so the gate added to
`deploy-held-back-functions.yml` would stop that deploy. The historical deploy (`86ac1b92` →
`e4da19e8`) replays with 0 changes, so the gate does not block a release that was correct.

## Owner decisions

The groups below count missions, so a mission can appear in more than one group.

| # | Change | Missions | Origin | Recommendation |
|---|---|---|---|---|
| A | A US / state location gets `geography_scope: headquarters`. Before, it had no scope, so any US evidence counted. | 34 | #210 (`579201e`): "US companies" means US-headquartered unless the request speaks of presence | **Approve**, except the two stored missions in **A-bad** below |
| A2 | "opened a new office in the US" gets scope **presence** | 1 | #210 | **Approve** (correct) |
| B | `company_stage: startup`: hard → target (still disclosed as `unprovable_today`) | 18 (8 requests that say "startups" as a description, 10 monitoring missions from the workspace ICP) | Q3/G08 (`94fdab4`) + Stage 5 monitoring fix | **Approve**. Before, an unprovable hard "startup" left every candidate pending (canary d1eff17a: 0 of 36). |
| C | Removed: "startup" filed from a stage word ("Series A or Series B"), whose stage keeps its own hard criterion; Contract-2 restated hiring/funding constraints, whose role and 180-day window survive on the hard signals | 3 | Q3 (`94fdab4`), `7b3519c` | **Approve**. No meaning is lost; the requirement-coverage invariant (Stage 5) checks this. |
| D | `missionHiringSalesRoles`: hard `hiring_activity: "sales roles"` changes from `ok` to **`unprovable_today`** | 1 | `7b3519c` (a hard constraint that no evidence answers is disclosed, never silently "ok") | **Decide.** Approving means this stored mission is disclosed as unprovable and will qualify no company. The alternative is to map "sales roles" to the sales role family (a separate, small compiler change). |
| E | "either raised funding … or hiring sales" becomes **one OR requirement** (`any_of`). Before, both were required. | 1 | `36a1131` | **Approve** (fixes an AND/OR misreading) |

**A-bad:** two stored quality-run missions are already misinterpreted in storage: "Find companies
outside the United States." and "…serving the US but headquartered outside the US." Both hold a
hard `locations: United States`. Under the headquarters scope they would now *require* a US
headquarters, which is the opposite of the request. Neither release reads them correctly.
Recommendation: do not approve these two; mark them as not to be re-run.

To approve a change, add `{key, before, after, reason, approvedBy}` for that mission to
`tests/fixtures/mission-semantics/production-replay-approved.json`. `before` and `after` are the
semantics fingerprints from `--report`. That file is owner-required in `pr-risk`. An approval
clears only that mission's exact before → after change.

## Every difference

| Mission | Request | Difference |
|---|---|---|
| `edge-functions/_shared/fixtures/providers-off-evidence.json#$.lead_mission` | Find 1 US B2B software company with a current declared 11–50 employee band and an open Acc | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/canary-1156c062/result.json#$.lead_mission` | Find 1 company that must be based in the US, must have a LinkedIn-declared company size of | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/canary-98ce374b-mission.json#$` | Find 5 US AI SaaS companies with 11–50 employees, funding in the last 2 years, and at leas | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[0].mission` | Find US B2B SaaS companies hiring growth marketers. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[3].mission` | Find US B2B SaaS companies that recently raised funding. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[14].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[15].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[16].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[17].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[18].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[19].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[20].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[21].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[22].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[23].mission` | Find US B2B SaaS companies. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/size-semantics-replay-2026-09-24/canary_companies.json#$.mission` | Find 1 US company with 11–50 employees that raised funding in the last 2 years. | geography:united_states: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.P01.lead_mission` | Find 100 US AI companies with exactly 17 employees. | geography:united_states: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.K03.lead_mission` | Find companies outside the United States. | geography:united_states: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.G08.lead_mission` | Find companies serving the US but headquartered outside the US. | geography:united_states: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.L03.lead_mission` | Find companies in New York or California. | geography:california: geography_scope - → headquarters; geography:new_york: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.J07.lead_mission` | Find 20 US AI infrastructure companies with 11–200 employees that have raised institutiona | geography:united_states: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.Z08.lead_mission` | I am looking for companies, specifically companies that are AI companies, meaning artifici | geography:united_states: geography_scope - → headquarters |
| `replay/fixtures/canary8.hiring-affordability.json#$.mission` | Find 5 US AI SaaS companies with 11–50 employees, funding in the last 2 years, and at leas | geography:united_states: geography_scope - → headquarters |
| `replay/fixtures/g5.funding-screen.json#$.mission` | Find 1 company that must be based in the US, must have a LinkedIn-declared company size of | geography:united_states: geography_scope - → headquarters |
| `replay/fixtures/queryBa9a6791a.job-first.json#$.mission` | Find 3 US software companies with 11–50 employees that are currently hiring sales. | geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[8].mission` | Find companies that recently opened a new office in the US. | geography:united_states: geography_scope - → presence |
| `fixtures/lead-v2/canary-62c8b188-mission.json#$` | Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer. | company_stage:startup: kind hard → target; geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[1].mission` | Find US B2B SaaS startups hiring growth marketers. | company_stage:startup: kind hard → target; geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[2].mission` | Find 3 seed-stage B2B SaaS startups in the US hiring their first growth marketer. | company_stage:startup: kind hard → target; geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/p0-legacy-graph-snapshots.json#$.cases[11].mission` | Find 5 AI startups hiring software engineers. | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[0].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[2].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[4].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[6].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[8].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[10].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[12].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[14].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[16].mission` | [monitoring] the workspace ICP | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/p0-legacy-monitoring-snapshots.json#$.cases[18].mission` | [monitoring] the workspace ICP, competitor Rival | company_stage:startup: kind hard → target |
| `fixtures/lead-v2/run-1e52d43c/plan.json#$.steps[0].metadata.tool_input.lead_mission` | Find 3 seed-stage B2B SaaS startups in the US hiring their first growth marketer. | company_stage:startup: kind hard → target; geography:united_states: geography_scope - → headquarters |
| `fixtures/lead-v2/run-4250f181/plan.json#$.steps[0].metadata.tool_input.lead_mission` | Find 3 seed-stage B2B SaaS startups in the US that are hiring their first growth marketer. | company_stage:startup: kind hard → target; geography:united_states: geography_scope - → headquarters |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.K05.lead_mission` | Find recently funded AI startups that are not currently hiring sales. | company_stage:startup: kind hard → target |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.E01.lead_mission` | Find 5 AI startups that have raised venture funding. | company_stage:startup: kind hard → target |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.E05.lead_mission` | Find 5 AI companies that raised Series A or Series B. | removed hard company_stage:startup |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.J06.lead_mission` | Find 10 US recruiting-tech companies with 11–50 employees that raised Seed or Series A fun | removed hard company_stage:startup; geography:united_states: geography_scope - → headquarters |
| `replay/fixtures/canarySession2.contract2.json#$.mission` | Find one US company hiring Account Executives that raised funding within the last six mont | removed target constraint:_field_funding_event_value_180_; removed hard constraint:_field_hiring_value_account_executives_; geography:united_states: geography_scope - → headquarters |
| `edge-functions/_shared/fixtures/missionHiringSalesRoles.json#$` | Find companies matching my ICP that are actively hiring sales roles. | constraint:_field_hiring_activity_value_sales_roles_: status ok → unprovable_today |
| `lead-v2-quality/fixtures/quality-run-2026-10-06.json#$.cases.L05.lead_mission` | Find US companies that either raised funding recently or are hiring sales. | funding:_event_funding_subject_company_qualifier_: any_of changed; geography:united_states: geography_scope - → headquarters; hiring:_event_hiring_subject_company_qualifier_role_terms_sales_rol: any_of changed |

## TEST readiness: ✅ READY

- Commit: `14cbfb36a42d639568e307234b5a1ea5409f4736`
- Project: `tlvnfrxzjhsjgdofwehb` (TEST)
- Deployed this run: none (unchanged)
- Versions: lead-pipeline {"before":28,"after":28}; provider-connections {"before":19,"after":19}
- Stage: done
- Run: https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/42240945436

| # | Check | Result | Detail | Likely cause |
|---|---|---|---|---|
| 1 | lead-pipeline active | ✅ pass | v28 ACTIVE, verify_jwt on (not redeployed) |  |
| 3 | lead-pipeline commit | ✅ pass | x-agentory-build 14cbfb36a42d (unchanged, graph untouched) |  |
| 1 | provider-connections active | ✅ pass | v19 ACTIVE, verify_jwt on (not redeployed) |  |
| 3 | provider-connections commit | ✅ pass | x-agentory-build 07add82c15e4 (unchanged, graph untouched) |  |
| 2 | Correct project | ✅ pass | tlvnfrxzjhsjgdofwehb only (hard-coded; production ref refused) |  |
| 4 | lead-pipeline JWT enforced | ✅ pass | no auth → 401 at the gateway; publishable key only → 401 in the function |  |
| 4 | provider-connections JWT enforced | ✅ pass | no auth → 401 at the gateway; publishable key only → 401 in the function |  |
| 7a | Discovery flags present | ✅ pass | LEAD_PIPELINE_ENABLED, LEAD_PIPELINE_WORKSPACES, PROVIDER_DISCOVERY_ENABLED, PROVIDER_DISCOVERY_WORKSPACES, PROVIDER_APIFY_DISCOVERY_ENABLED |  |
| 7 | Disabled capabilities stay disabled (flags) | ✅ pass | absent: PROVIDER_APOLLO_ENABLED, LEAD_PIPELINE_PHONES_ENABLED, LEAD_PIPELINE_SIGNALS_ENABLED, DISCOVERY_EVIDENCE_CACHE_ENABLED, APOLLO_COMMERCIAL_TERMS_CONFIRMED |  |
| 5a | Allowlists name only the TEST workspace | ✅ pass | LEAD_PIPELINE_WORKSPACES and PROVIDER_DISCOVERY_WORKSPACES = the TEST workspace exactly |  |
| 7b | Disabled capabilities stay disabled (code) | ✅ pass | Apollo, founder check, company employees, people search, funding corroboration: unavailable |  |
| 5 | Workspace allowlist enforced | ✅ pass | a real non-allowlisted TEST workspace → 403 from both functions (before any model call) |  |
| 6 | Unauthorized workspace denied | ✅ pass | unknown workspace → 403 |  |
| 7c | Apollo disabled (live) | ✅ pass | apollo: enabled=false, status=not_connected |  |
| P0 | strategy_plan answered | ✅ pass | HTTP 200, status ready |  |
| P1 | Hard requirements | ✅ pass | geography_hq, signal |  |
| P2 | Soft employee-size preference | ✅ pass | employee_range 20–500 is a preference |  |
| P3 | Appropriate sales title | ✅ pass | role family gtm_sales; titles searched: Founding Account Executive \| Account Executive |  |
| P4 | Strategy selection | ✅ pass | apify_only (selected by model); steps: apify.linkedin_job_search≤20, apify.linkedin_company_record≤10 |  |
| P5 | Valid plan hash | ✅ pass | 4fed5894cdd88b1b57258886c331218cc0e697092d2bd59f6514d297c9764e1f |  |
| P6 | Budget ceiling | ✅ pass | worst case $0.06105 Apify, 0 LeadOcean records (ceilings $0.25, 50) |  |
| P7 | Signed approval token | ✅ pass | issued (value not shown): plan-token-v1, this workspace and plan hash, one walk, expires in 24h |  |
| P8 | Interpretation contract in effect | ✅ pass | contract mission-contract-v1; understanding none (roles 0, places 0, signals 0, rejected 0, ambiguities 0); criteria frozen |  |
| 8 | Spending ledger unchanged | ✅ pass | provider_usage_ledger 0, lead_execution_calls 41 (unchanged) |  |
| 9 | No phone enrichment or outreach | ✅ pass | call, email and outreach tables unchanged |  |
| 8b | No lead/ATLAS writes | ✅ pass | leads, accounts, contacts, checkpoints, connections unchanged |  |
| 10 | No production mutations | ✅ pass | production lead-pipeline, provider-connections unchanged: {"lead-pipeline":{"status":404,"build":null},"provider-connections":{"status":404,"build":null}} |  |

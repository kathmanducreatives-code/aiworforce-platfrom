# Scenario matrix

Runtime statuses describe the exercised boundary. H04 also has a verified compiler FAIL. NOT SUPPORTED does not mean negative intent or founder-role semantics passed. Counts are companies, not evidence rows.

| ID | Customer request | Expected qualified | Integration status / q | PR113 status / q | Observation |
|---|---|---:|---|---|---|
| L01 | Find founders commenting on LinkedIn about problems with outbound sales in the last 30 days. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | Founder outbound comments: no executable comment route; intent not evaluated. |
| L02 | Find founders explicitly searching for a CRM in LinkedIn comments within the last 30 days. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | CRM search comments: no executable comment route. |
| L03 | Find founders discussing hiring agencies in LinkedIn comments within the last 30 days. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | Hiring-agency discussions: no executable comment route. |
| L04 | Find founders who must be looking for new sales tools in their LinkedIn comments. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | Negative tool intent: fixture preserved only; semantic rejection not reached. |
| L05 | Find companies whose founders must be asking for a CRM in LinkedIn comments. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | Employee instead of founder: fixture preserved only; role verification not reached. |
| L06 | Find founders who commented about outbound problems within the last 7 days. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | 2020 comment freshly scraped: original timestamp preserved by normalizer; mission recency not reached. |
| L07 | Find founders commenting about outbound sales problems on LinkedIn. | None | NOT SUPPORTED / — | NOT SUPPORTED / — | Unavailable comment retrieval: unsupported before provider invocation; no fake provider success. |
| L08 | Find 1 B2B software company whose founder must have commented about outbound problems, and which must be hiring Account Executives. | 0 | FAIL / 1 | FAIL / 1 | Mandatory founder comment plus hiring: 1 qualified with no social evidence. |
| L09 | Find 1 B2B software company whose founder must be posting about CRM buying on LinkedIn. | 0 | NOT SUPPORTED / — | NOT SUPPORTED / — | Founder CRM posts: no executable verification route. |
| H01 | Find 1 B2B software company hiring Account Executives within the last 30 days. | 1 | PASS / 1 | PASS / 1 | AE positive control: fresh matched employer qualifies. |
| H02 | Find 1 B2B software company that must be hiring its first sales representative within the last 30 days. | 1 | PASS / 1 | PASS / 1 | First sales hire positive: explicit first-hire text qualifies. |
| H03 | Find 1 B2B software company that must be hiring its first sales representative within the last 30 days. | 0 | FAIL / 1 | FAIL / 1 | First sales hire negative: ordinary job also qualifies; mandatory qualifier not checked. |
| H04 | Find 1 B2B software company that must be rapidly expanding its sales team within the last 30 days. | 0 | NOT SUPPORTED / — | NOT SUPPORTED / — | Rapid sales-team growth compiled as physical expansion; compiler FAIL, runtime safely unsupported. |
| H05 | Find 1 recruiting agency hiring its own Account Executives within the last 30 days. | 1 | FAIL / 0 | FAIL / 0 | Recruiting agency own staff: blanket agency filter discards employer before evaluation. |
| H06 | Find 1 recruiting agency hiring its own Account Executives within the last 30 days. | 0 | PASS / 0 | PASS / 0 | Agency client posting: no qualification, but blanket filter masks client-specific attribution check. |
| H07 | Find 1 B2B software company hiring Account Executives within the last 30 days. | 0 | PASS / 0 | PASS / 0 | Old job still LISTED: no qualification. |
| H08 | Find 1 B2B software company hiring Account Executives within the last 30 days. | 0 | PASS / 0 | PASS / 0 | Closed job: no qualification. |
| H09 | Find 1 B2B software company hiring Account Executives within the last 30 days. | 1 | PASS / 1 | PASS / 1 | Duplicate jobs: one qualified employer, no duplicate company result. |
| H10 | Find 1 B2B software company hiring only Account Executives within the last 30 days. Do not broaden the role. | 0 | FAIL / 1 | PASS / 0 | Only AE, no broadening; SDR posting: base qualifies, PR113 rejects. |
| C01 | Find 1 B2B software company that must be hiring Account Executives AND whose founder must have discussed outbound problems on LinkedIn. | 0 | FAIL / 1 | FAIL / 1 | Hiring AND mandatory founder discussion: 1 qualified while social criterion UNKNOWN/target. |
| C02 | Find 1 B2B software company hiring Account Executives OR having raised funding in the last 90 days. | 1 | FAIL / 0 | FAIL / 0 | Hiring OR funding: compiler loses cross-dimension OR; funding suppresses hiring discovery. q0 is not isolated proof of OR rejection (business proof also absent). |
| C03 | Find 1 B2B software company that must have opened a new office AND recently adopted Salesforce. | 0 | NOT SUPPORTED / — | NOT SUPPORTED / — | Expansion AND technology adoption: unavailable executable chain, not simulated as working. |
| C04 | Find 1 B2B software company hiring Account Executives in the last 7 days AND whose founder must have commented on outbound in the last 30 days. | 0 | FAIL / 1 | FAIL / 1 | Hiring 7d AND founder comment 30d: compiled windows 7d/90d; missing founder proof still qualifies. |
| C05 | Find 1 US-headquartered B2B software company hiring Account Executives in the last 30 days. | 0 | PASS / 0 | PASS / 0 | Discovery US vs company-details Canada: no qualification. |
| C06 | Find 1 B2B software company that must be hiring Account Executives within the last 30 days. | 0 | PASS / 0 | PASS / 0 | ICP matches but no mandatory buying signal: no qualification. |
| C07 | Find 1 B2B software company hiring Account Executives in the last 7 days AND having raised venture funding in the last 90 days. | 0 | PASS / 0 | PASS / 0 | Hiring 7d AND venture funding 90d: distinct windows preserved; absent funding prevents qualification. |
| R01 | Find 1 B2B software company hiring Account Executives. | 0 | BLOCKED / 0 | BLOCKED / 0 | Wrong Actor for job capability: validator blocks; zero provider calls. |
| R02 | Find 1 B2B software company hiring Account Executives. | 0 | BLOCKED / 0 | BLOCKED / 0 | Invented comment capability: validator blocks; zero provider calls. |
| R03 | Find 1 B2B software company hiring Account Executives. | 0 | FAIL / 1 | PASS / 0 | Overconfident evaluator cites invented evidence ID: base qualifies, PR113 rejects. |
| R04 | Find 1 B2B software company hiring Account Executives. | 0 | FAIL / 1 | PASS / 0 | Empty company details: base qualifies, PR113 rejects. |
| R05 | Find 1 B2B software company hiring Account Executives. | 0 | PASS / 0 | PASS / 0 | Job identifies foreign employer: upstream ownership guard prevents qualification. |
| R06 | Find 1 B2B software company hiring Account Executives. | 0 | PASS / 0 | PASS / 0 | Job provider throws TimeoutError: no qualification or fallback purchase. |
| R07 | Find 1 B2B software company hiring Account Executives. | 0 | BLOCKED / — | BLOCKED / — | Real readiness policy marks job Actor unavailable: blocked before calls. |
| R08 | Find 1 B2B software company hiring Account Executives. | 0 | FAIL / 1 | PASS / 0 | Evaluation binding times out after optimistic batch: base qualifies, PR113 rejects. |
| R09 | Find 1 B2B software company hiring Account Executives. | 0 | FAIL / 1 | FAIL / 1 | Aggregate model FAIL with per-criterion PASS: both qualify (known prior finding). |
| R11 | Find 1 B2B software company hiring Account Executives. | 0 | FAIL / 1 | PASS / 0 | Company-details response only foreign strong identity: base qualifies, PR113 rejects. |
| R12 | Find 1 B2B software company hiring Account Executives. | 1 | PASS / 1 | PASS / 1 | Several company identities, including exact LinkedIn match: exact employer selected, qualifies. |
| F01 | Find 1 B2B software company with a recent funding announcement within the last 90 days. | 0 | PASS / 0 | PASS / 0 | No funding round returned: no qualification; fallback profile search plus guarded claim verifier pair. |
| F02 | Find 1 B2B software company with a recent funding announcement within the last 90 days. | None | NOT TESTED / 0 | NOT TESTED / 0 | Positive matched recent funding: real funding criterion PASS; full mission NOT TESTED because website/business-proof phase not executed. |
| R10 | Find 1 B2B software company hiring Account Executives. | None | NOT TESTED / 1 | NOT TESTED / 0 | AbortError before details plus checkpoint resume: no repeat provider calls on completed engine snapshot; full queue recovery NOT TESTED. |

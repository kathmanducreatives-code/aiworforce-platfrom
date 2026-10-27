# Hosted providers-off rehearsal — PASS (attempt 5, 2026-10-27)

| | |
|---|---|
| Run | [40473535143](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40473535143) |
| Commit | 6d448610acd2e43b6610fba2f87e56c6f4ca3dba (`test/agency-candidate-b-operator`) |
| Inputs | providers=none, session_minutes=25, expected_sha=6d448610… |
| Guard | PASS (08:28:20 UTC); checkout at the approved SHA; worker step started 08:28:26 |
| Kickoff | self-verifying file sha256 a1d754c2…d42d (wraps reviewed 945bcaab…b1c6), run by the owner in the TEST SQL Editor: KICKOFF_COMMITTED, queue 14d9ef61-6913-4366-ad97-a4b85f39e300 at 08:35:32 |
| Claim | the worker claimed within ~4 s; task 6911f8f1-fd18-469f-993f-c602bc2aaa6a |
| Outcome | queue `failed`, last_outcome `failed:unhandled_exception`, terminal, 1 attempt (expected without #149: no planner key) |

Providers-off judge (`judge-real-gpt-run.ts --providers-off`, from 6d448610): **O1–O7 PASS, AUTOMATIC: PASS** (`hosted-run5/judge-providers-off.txt`, evidence `hosted-run5/evidence.json`).
- 0 admitted operations (model, provider, poll); 0 ledger rows; 0 credit transactions; credits 10 / 0; 0 leads; credit check empty.
- smoke-reconciliation: 0 rows; smoke-credit-reconciliation: 0 rows.
- Authorization 52ad61e7-f675-4046-bf7a-45efd573effe stopped ("providers-off rehearsal attempt 5 complete: judge PASS").
- Final preflight (08:38 UTC): P01, P07–P16 PASS (P09 10/0, P11 0, P12 0, P13 0, P15 4, P16 ok); no operations, ledger or credit rows since 08:00.

Earlier attempts (1–4) are recorded alongside: guard refusal (URL secret), three kickoffs outside the worker window, all stopped/cancelled with no effects.
